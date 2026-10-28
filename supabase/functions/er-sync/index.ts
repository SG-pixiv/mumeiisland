// Supabase Edge Function: 이리 Open API → 선수 솔로 랭크 점수 · 판수 · 모스트 실험체
//
// 부르는 법
//   관리자 페이지의 "이리 데이터 동기화" 버튼 (로그인한 관리자 토큰으로 호출)
//   또는 매일 자동 (pg_cron 이 service_role 키로 호출, README 참고)
// body: { player_id?: string, offset?: number, limit?: number, refresh_characters?: boolean }
//
// 필요한 Secrets (supabase secrets set ...)
//   ER_API_KEY                 이리 개발자 포털에서 받은 키 (필수)
//   ER_RANK_MATCHING_MODE      기본 3 (랭크)
//   ER_RANK_TEAM_MODE          솔로 랭크의 matchingTeamMode 값 (첫 테스트 후 정해요, 비워 두면 판수가 가장 많은 항목)
//   CRON_SECRET                (선택) 매일 자동 실행할 때 x-cron-secret 헤더로 보내는 값
//
// 배포: npx supabase functions deploy er-sync --project-ref <프로젝트 ID> --use-api
//   (supabase/config.toml 에 verify_jwt = false 가 있어요. 권한 확인은 함수 안에서 직접 해요: 관리자 로그인 토큰 또는 CRON_SECRET)

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { parseCharacterNames, pickCurrentSeason, syncPlayer, apiCode, type ErFetch, type ErResponse } from './lib.ts';

const ER_BASE = 'https://open-api.bser.io';
const ER_KEY = Deno.env.get('ER_API_KEY') ?? '';
const MATCHING_MODE = Number(Deno.env.get('ER_RANK_MATCHING_MODE') ?? '3');
const TEAM_MODE = Deno.env.get('ER_RANK_TEAM_MODE') || null;
const MIN_GAP_MS = 1100; // 개발용 키 호출 제한(초당 1회)에 맞춰요

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

// Supabase 가 함수에 넣어 주는 키. 새 프로젝트는 SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS (JSON, 이름 → 키),
// 예전 프로젝트는 SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY 라서 둘 다 읽어요.
const projectKey = (jsonName: string, legacyName: string): string => {
  try {
    const keys = JSON.parse(Deno.env.get(jsonName) ?? '{}');
    const v = keys.default ?? Object.values(keys)[0];
    if (typeof v === 'string' && v) return v;
  } catch { /* 형식이 다르면 예전 이름으로 */ }
  return Deno.env.get(legacyName) ?? '';
};

let lastCall = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const er: ErFetch = async (path: string): Promise<ErResponse> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(ER_BASE + path, { headers: { 'x-api-key': ER_KEY, accept: 'application/json' } });
    const body = await res.json().catch(() => ({}));
    const r = { status: res.status, body };
    if (apiCode(r) === 429) { await sleep(2000 * (attempt + 1)); continue; }
    return r;
  }
  return { status: 429, body: { code: 429, message: '호출 제한에 걸렸어요. 잠시 뒤 다시 해 주세요.' } };
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 로 불러 주세요' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = projectKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = projectKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
    if (!serviceKey || !anonKey) return json({ error: '함수에 프로젝트 키가 없어요 (Supabase 설정 확인 필요)' }, 500);
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    // 매일 자동 실행(CRON_SECRET 또는 서버 키)이 아니면 관리자인지 확인
    const cronSecret = Deno.env.get('CRON_SECRET');
    const isCron = (!!cronSecret && req.headers.get('x-cron-secret') === cronSecret)
      || token === serviceKey || req.headers.get('apikey') === serviceKey;
    if (!isCron) {
      if (!token) return json({ error: '관리자로 로그인한 뒤 다시 해 주세요' }, 401);
      const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: isAdmin, error } = await asUser.rpc('is_admin');
      if (error || !isAdmin) return json({ error: '관리자만 동기화할 수 있어요' }, 403);
    }
    if (!ER_KEY) return json({ error: 'ER_API_KEY Secret 이 아직 없어요' }, 500);

    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));

    // 이번 시즌 번호
    const seasonRes = await er('/v2/data/Season');
    const seasonId = pickCurrentSeason(seasonRes.body);
    if (!seasonId) return json({ error: '현재 시즌 정보를 받지 못했어요', detail: seasonRes.body }, 502);

    // 실험체 한글 이름 (처음 한 번, 또는 refresh_characters 일 때)
    const { count } = await db.from('er_characters').select('code', { count: 'exact', head: true });
    if (!count || body.refresh_characters) {
      const l10n = await er('/v1/l10n/Korean');
      const path = l10n.body?.data?.l10Path;
      if (path) {
        const text = await (await fetch(path)).text();
        const rows = [...parseCharacterNames(text)].map(([code, name_ko]) => ({ code, name_ko }));
        if (rows.length) await db.from('er_characters').upsert(rows);
      }
    }
    const { data: charRows } = await db.from('er_characters').select('code, name_ko');
    const names = new Map<number, string>((charRows ?? []).map((c: any) => [c.code, c.name_ko]));

    // 실험체 영문 이름 (게임 결과 CSV 는 영문 이름이라 결과 검토에서 한글로 바꿀 때 써요). 실패해도 동기화는 계속해요.
    try {
      const { count: noEn, error: enErr } = await db.from('er_characters').select('code', { count: 'exact', head: true }).is('name_en', null);
      if (!enErr && (noEn || body.refresh_characters)) {
        let en = new Map<number, string>();
        const cr = await er('/v2/data/Character');
        for (const c of Array.isArray(cr.body?.data) ? cr.body.data : []) {
          const code = Number(c?.code);
          const name = String(c?.name ?? '').trim();
          if (code && name) en.set(code, name);
        }
        if (!en.size) {
          const l10nEn = await er('/v1/l10n/English');
          const pathEn = l10nEn.body?.data?.l10Path;
          if (pathEn) en = parseCharacterNames(await (await fetch(pathEn)).text());
        }
        const rows = [...en].map(([code, name_en]) => ({ code, name_en, name_ko: names.get(code) ?? name_en }));
        if (rows.length) await db.from('er_characters').upsert(rows);
      }
    } catch (e) {
      console.warn('실험체 영문 이름을 받지 못했어요', e);
    }

    // 대상 선수
    let q = db.from('players').select('id, display_name, er_nickname, er_uid').eq('active', true).order('display_name');
    if (body.player_id) q = q.eq('id', body.player_id);
    const { data: players, error: pErr } = await q;
    if (pErr) throw pErr;
    const offset = Math.max(0, Number(body.offset ?? 0));
    const limit = Math.min(Math.max(1, Number(body.limit ?? 40)), 60); // 함수 실행 시간 제한 때문에 한 번에 최대 60명
    const batch = (players ?? []).slice(offset, offset + limit);

    const deps = {
      er,
      saveUid: async (id: string, uid: string | null) => {
        await db.from('players').update({ er_uid: uid, updated_at: new Date().toISOString() }).eq('id', id);
      },
      saveStats: async (id: string, stats: any, error: string | null) => {
        const now = new Date().toISOString();
        if (stats) await db.from('player_rank_stats').upsert({ player_id: id, ...stats, synced_at: now, sync_error: null });
        else await db.from('player_rank_stats').upsert({ player_id: id, synced_at: now, sync_error: error });
      }
    };

    const results = [];
    for (const p of batch) {
      try {
        results.push(await syncPlayer(p, seasonId, names, { matchingMode: MATCHING_MODE, teamMode: TEAM_MODE }, deps));
      } catch (e) {
        results.push({ player_id: p.id, name: p.display_name, ok: false, message: String((e as Error)?.message ?? e) });
      }
    }
    const done = offset + batch.length;
    return json({ season_id: seasonId, total: players?.length ?? 0, done, next_offset: done < (players?.length ?? 0) ? done : null, results });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
