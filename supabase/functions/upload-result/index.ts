// Supabase Edge Function: 게임 PC 업로드 프로그램 → 결과 CSV 받기
//
// 업로드 프로그램(public/uploader/mumei-uploader.mjs, 관리자 → 업로드 장치에서 받아요)이 "데이터 저장"으로 생긴 GameResult_*.csv 를 그대로 보내요.
//   POST /functions/v1/upload-result
//   헤더: x-device-key (관리자 → 업로드 장치에서 만든 키), x-file-name, x-file-mtime(선택, ISO 시간)
//   본문: CSV 글자 그대로 (text/csv)
// 받은 판은 "검토 대기"로 저장되고, 관리자가 결과 검토에서 확정해야 공개 페이지에 나와요.
// 내전은 지금 시각 기준 12시간 전 ~ 6시간 뒤에 시작하는 내전 중 가장 가까운 것으로 정해요. 없으면 "내전 미지정".
//
// 배포: npx supabase functions deploy upload-result --project-ref <프로젝트 ID> --use-api
//   (supabase/config.toml 에 verify_jwt = false. 장치 키로 직접 확인해요)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseGameResult } from '../_shared/game-result.js';

const MAX_BYTES = 200_000;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-device-key, x-file-name, x-file-mtime',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

// 새 프로젝트는 SUPABASE_SECRET_KEYS (JSON), 예전 프로젝트는 SUPABASE_SERVICE_ROLE_KEY
const projectKey = (jsonName: string, legacyName: string): string => {
  try {
    const keys = JSON.parse(Deno.env.get(jsonName) ?? '{}');
    const v = keys.default ?? Object.values(keys)[0];
    if (typeof v === 'string' && v) return v;
  } catch { /* 예전 이름으로 */ }
  return Deno.env.get(legacyName) ?? '';
};

// DB 의 public._hash_key 와 같은 방식: 대문자 · 숫자만 남겨서 SHA-256
async function hashKey(key: string): Promise<string> {
  const norm = key.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const safeName = (raw: string | null) => {
  let s = raw ?? '';
  try { s = decodeURIComponent(s); } catch { /* 그대로 */ }
  s = s.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').trim();
  return (s || 'GameResult.csv').slice(0, 120);
};

const playedAt = (raw: string | null) => {
  const t = raw ? Date.parse(raw) : NaN;
  const now = Date.now();
  return Number.isFinite(t) && t <= now + 60_000 && t >= now - 3 * 86400_000 ? new Date(t).toISOString() : new Date(now).toISOString();
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST 로 보내 주세요' }, 405);

  try {
    const deviceKey = req.headers.get('x-device-key') ?? '';
    if (!deviceKey.trim()) return json({ ok: false, error: '장치 키가 없어요. 설정 파일(uploader.config.json)을 확인해 주세요' }, 401);

    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = projectKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceKey) return json({ ok: false, error: '함수에 프로젝트 키가 없어요 (Supabase 설정 확인 필요)' }, 500);
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: device, error: dErr } = await db.from('upload_devices')
      .select('id, name, revoked_at').eq('key_hash', await hashKey(deviceKey)).maybeSingle();
    if (dErr) throw dErr;
    if (!device || device.revoked_at) return json({ ok: false, error: '등록되지 않았거나 해제된 장치 키예요. 관리자 → 업로드 장치에서 새 키를 받아 주세요' }, 401);

    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ ok: false, error: '파일이 너무 커요 (게임 결과 CSV 가 맞는지 확인해 주세요)' }, 413);
    const fileName = safeName(req.headers.get('x-file-name'));
    const parsed = parseGameResult(text);

    await db.from('upload_devices').update({ last_seen_at: new Date().toISOString(), last_file: fileName }).eq('id', device.id);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, 422);

    // 같은 판(gameId)은 한 번만
    if (parsed.gameId) {
      const { data: dup } = await db.from('rounds').select('id, round_no, status').eq('game_id', parsed.gameId).maybeSingle();
      if (dup) return json({ ok: true, duplicate: true, round_id: dup.id, message: '이미 올라간 판이라 건너뛰었어요' });
    }

    // 지금 진행 중인 내전 찾기
    const now = Date.now();
    const { data: events, error: eErr } = await db.from('events').select('id, title, starts_at, status')
      .neq('status', 'done')
      .gte('starts_at', new Date(now - 12 * 3600_000).toISOString())
      .lte('starts_at', new Date(now + 6 * 3600_000).toISOString());
    if (eErr) throw eErr;
    const ev = (events ?? []).sort((a, b) => Math.abs(Date.parse(a.starts_at) - now) - Math.abs(Date.parse(b.starts_at) - now))[0] ?? null;

    let roundNo = 0;
    if (ev) {
      const { data: last } = await db.from('rounds').select('round_no').eq('event_id', ev.id).order('round_no', { ascending: false }).limit(1);
      roundNo = (last?.[0]?.round_no ?? 0) + 1;
    }

    // 두 판이 동시에 올라와 라운드 번호가 겹치면 다음 번호로 다시 시도
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: row, error } = await db.from('rounds').insert({
        event_id: ev?.id ?? null, round_no: roundNo, status: 'pending', source: 'device',
        file_name: fileName, raw_csv: text, game_id: parsed.gameId, device_id: device.id, played_at: playedAt(req.headers.get('x-file-mtime'))
      }).select('id').single();
      if (!error) {
        return json({
          ok: true, round_id: row.id, event: ev?.title ?? null, round_no: ev ? roundNo : null,
          teams: parsed.teams?.length ?? 0, players: parsed.rows?.length ?? 0, scoring: !!parsed.scoringOn,
          message: ev
            ? `${ev.title} ${roundNo}라운드로 올렸어요. 결과 검토에서 확정해 주세요`
            : '지금 진행 중인 내전을 찾지 못해서 "내전 미지정"으로 올렸어요. 결과 검토에서 내전을 골라 주세요'
        });
      }
      if (error.code === '23505' && String(error.message).includes('game_id')) {
        return json({ ok: true, duplicate: true, message: '이미 올라간 판이라 건너뛰었어요' });
      }
      if (error.code === '23505' && ev) { roundNo++; continue; }
      throw error;
    }
    return json({ ok: false, error: '라운드 번호를 정하지 못했어요. 잠시 뒤 다시 보내 주세요' }, 409);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
