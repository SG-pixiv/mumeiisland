// Supabase Edge Function: 치지직 · 유튜브 → 선수 프로필 사진 · LIVE ON
//
// 부르는 법
//   매일이 아니라 2분마다: pg_cron 이 x-cron-secret 헤더로 불러요 (README 11번)
//   관리자 → 선수 관리의 "방송 · 프로필 새로 고침" 버튼 (관리자 로그인 토큰)
// body: { player_id?: string, refresh_profiles?: boolean }
//
// Secrets
//   YOUTUBE_API_KEY                 (유튜브를 쓰면 필수) Google Cloud 의 YouTube Data API v3 키
//   CHZZK_CLIENT_ID / CHZZK_CLIENT_SECRET   (선택) 치지직 공식 Open API. 공개 주소가 막혔을 때 프로필 사진용
//   CRON_SECRET                     자동 실행용 (er-sync 와 같은 값)
//
// 배포: npx supabase functions deploy live-sync --project-ref <프로젝트 ID> --use-api

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  CHZZK_API, YT_API, BROWSER_UA, parseChzzkId, parseYoutubeRef, chzzkLive, chzzkChannel, chzzkOpenChannels,
  youtubeChannelInfo, rssVideoIds, uploadsPlaylistId, playlistVideoIds, youtubeLiveByChannel, decideLive
} from '../_shared/live.js';

const PROFILE_TTL_MS = 12 * 3600_000;   // 프로필 사진은 12시간마다
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

const projectKey = (jsonName: string, legacyName: string): string => {
  try {
    const keys = JSON.parse(Deno.env.get(jsonName) ?? '{}');
    const v = keys.default ?? Object.values(keys)[0];
    if (typeof v === 'string' && v) return v;
  } catch { /* 예전 이름으로 */ }
  return Deno.env.get(legacyName) ?? '';
};

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(8000) });
  const body = await res.json().catch(() => null);
  if (!res.ok && !(body && typeof body === 'object')) throw new Error(`HTTP ${res.status}`);
  return body ?? {};
}
async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
/** 여러 개를 동시에 n 개씩 */
async function eachLimit<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) await fn(list[i++]); }));
}
const chunks = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST 로 불러 주세요' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = projectKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = projectKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
    if (!url || !serviceKey || !anonKey) return json({ error: '함수에 프로젝트 키가 없어요 (Supabase 설정 확인 필요)' }, 500);
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const cronSecret = Deno.env.get('CRON_SECRET');
    const isCron = (!!cronSecret && req.headers.get('x-cron-secret') === cronSecret) || token === serviceKey || req.headers.get('apikey') === serviceKey;
    if (!isCron) {
      if (!token) return json({ error: '관리자로 로그인한 뒤 다시 해 주세요' }, 401);
      const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: isAdmin, error } = await asUser.rpc('is_admin');
      if (error || !isAdmin) return json({ error: '관리자만 새로 고칠 수 있어요' }, 403);
    }

    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const ytKey = Deno.env.get('YOUTUBE_API_KEY') ?? '';
    const chzzkId = Deno.env.get('CHZZK_CLIENT_ID') ?? '';
    const chzzkSecret = Deno.env.get('CHZZK_CLIENT_SECRET') ?? '';

    let q = db.from('players')
      .select('id, display_name, chzzk_channel_id, youtube_url, youtube_channel_id, chzzk_image_url, youtube_image_url, profile_synced_at, is_live, live_platform')
      .eq('active', true);
    if (body.player_id) q = q.eq('id', body.player_id);
    const { data: rows, error: pErr } = await q;
    if (pErr) throw pErr;
    const players = (rows ?? []).filter((p: any) => p.chzzk_channel_id || p.youtube_url);

    const now = Date.now();
    const profileDue = (p: any) => !!body.refresh_profiles || !p.profile_synced_at || now - Date.parse(p.profile_synced_at) > PROFILE_TTL_MS;
    const errors: string[] = [];
    const note = (p: any, msg: string) => errors.push(`${p.display_name}: ${msg}`);

    // ── 치지직
    const chzzk = new Map<string, any>();          // 선수 id → 라이브 결과 (null = 확인 실패)
    const chzzkImage = new Map<string, string | null>();
    const chzzkPlayers = players.filter((p: any) => parseChzzkId(p.chzzk_channel_id));
    await eachLimit(chzzkPlayers, 4, async (p: any) => {
      const id = parseChzzkId(p.chzzk_channel_id);
      try {
        const live = chzzkLive(await getJson(`${CHZZK_API}/polling/v2/channels/${id}/live-status`));
        chzzk.set(p.id, live);
        if (!live) note(p, '치지직 방송 상태를 읽지 못했어요');
      } catch (e) { chzzk.set(p.id, null); note(p, `치지직 방송 상태: ${(e as Error).message}`); }
      if (profileDue(p)) {
        try {
          const info = chzzkChannel(await getJson(`${CHZZK_API}/service/v1/channels/${id}`));
          if (info?.image) chzzkImage.set(p.id, info.image);
        } catch { /* 아래 공식 API 로 다시 시도 */ }
      }
    });
    // 공개 주소로 사진을 못 받았으면 공식 Open API (키가 있을 때만)
    const missing = chzzkPlayers.filter((p: any) => profileDue(p) && !chzzkImage.has(p.id));
    if (missing.length && chzzkId && chzzkSecret) {
      for (const group of chunks(missing, 20)) {
        try {
          const qs = group.map((p: any) => `channelIds=${parseChzzkId(p.chzzk_channel_id)}`).join('&');
          const imgs = chzzkOpenChannels(await getJson(`https://openapi.chzzk.naver.com/open/v1/channels?${qs}`, { 'Client-Id': chzzkId, 'Client-Secret': chzzkSecret }));
          group.forEach((p: any) => { const img = imgs.get(parseChzzkId(p.chzzk_channel_id)); if (img) chzzkImage.set(p.id, img); });
        } catch (e) { errors.push(`치지직 공식 API: ${(e as Error).message}`); }
      }
    }

    // ── 유튜브
    const ytChannel = new Map<string, string>();      // 선수 id → UC… 채널 ID
    const ytImage = new Map<string, string | null>();
    const ytLive = new Map<string, any>();             // 선수 id → 라이브 영상 (없으면 미설정)
    const ytChecked = new Set<string>();               // 유튜브 확인에 성공한 선수
    const ytPlayers = players.filter((p: any) => p.youtube_url);
    if (ytPlayers.length && !ytKey) errors.push('YOUTUBE_API_KEY 가 없어서 유튜브는 건너뛰었어요');
    if (ytPlayers.length && ytKey) {
      const yt = (path: string) => getJson(`${YT_API}/${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(ytKey)}`);
      // 1) 채널 ID 찾기 (처음 한 번)
      for (const p of ytPlayers as any[]) {
        if (p.youtube_channel_id) { ytChannel.set(p.id, p.youtube_channel_id); continue; }
        const ref = parseYoutubeRef(p.youtube_url);
        if (!ref) { note(p, '유튜브 주소가 채널 주소가 아니에요 (https://www.youtube.com/@핸들 형태로 넣어 주세요)'); continue; }
        try {
          let r: any;
          if (ref.kind === 'id') { ytChannel.set(p.id, ref.value); continue; }
          if (ref.kind === 'handle') r = await yt(`channels?part=snippet&forHandle=${encodeURIComponent(ref.value)}`);
          else if (ref.kind === 'user') r = await yt(`channels?part=snippet&forUsername=${encodeURIComponent(ref.value)}`);
          else r = await yt(`search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(ref.value)}`);
          if (r?.error) throw new Error(r.error.message || 'API 오류');
          const item = r?.items?.[0];
          const id = item?.id?.channelId ?? item?.id;
          if (typeof id === 'string' && id.startsWith('UC')) {
            ytChannel.set(p.id, id);
            const info = youtubeChannelInfo({ ...item, id });
            if (info?.image) ytImage.set(p.id, info.image);
          } else note(p, '유튜브 채널을 찾지 못했어요');
        } catch (e) { note(p, `유튜브 채널 찾기: ${(e as Error).message}`); }
      }
      // 2) 프로필 사진 (12시간마다)
      const needImg = (ytPlayers as any[]).filter((p) => ytChannel.has(p.id) && profileDue(p) && !ytImage.has(p.id));
      for (const group of chunks(needImg, 50)) {
        try {
          const r = await yt(`channels?part=snippet&id=${group.map((p) => ytChannel.get(p.id)).join(',')}`);
          if (r?.error) throw new Error(r.error.message || 'API 오류');
          const byId = new Map((r?.items ?? []).map((it: any) => [it.id, youtubeChannelInfo(it)]));
          group.forEach((p) => { const info: any = byId.get(ytChannel.get(p.id)); if (info?.image) ytImage.set(p.id, info.image); });
        } catch (e) { errors.push(`유튜브 프로필: ${(e as Error).message}`); }
      }
      // 3) 라이브: 채널 RSS 의 최근 영상 (무료) → 안 되면 API 업로드 목록 (1 쿼터) → videos.list
      //    RSS 는 공개 영상이 없는 채널이나 가끔 멀쩡한 채널에도 404 를 줘요
      const vids: string[] = [];
      const rssOk = new Set<string>();
      await eachLimit((ytPlayers as any[]).filter((p) => ytChannel.has(p.id)), 4, async (p) => {
        const ch = ytChannel.get(p.id) ?? '';
        try {
          rssVideoIds(await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch}`), 5).forEach((v) => vids.push(v));
          rssOk.add(p.id);
          return;
        } catch { /* 아래 API 로 다시 */ }
        try {
          const r = await yt(`playlistItems?part=contentDetails&maxResults=5&playlistId=${uploadsPlaylistId(ch)}`);
          if (r?.error) {
            if (r.error.code === 404) { rssOk.add(p.id); return; }   // 올린 영상이 없는 채널 = 방송 아님
            throw new Error(r.error.message || 'API 오류');
          }
          playlistVideoIds(r, 5).forEach((v) => vids.push(v));
          rssOk.add(p.id);
        } catch (e) { note(p, `유튜브 최근 영상을 읽지 못했어요: ${(e as Error).message}`); }
      });
      let videosOk = true;
      const liveByChannel = new Map<string, any>();
      for (const group of chunks([...new Set(vids)], 50)) {
        try {
          const r = await yt(`videos?part=snippet,liveStreamingDetails&id=${group.join(',')}`);
          if (r?.error) throw new Error(r.error.message || 'API 오류');
          youtubeLiveByChannel(r).forEach((v, ch) => liveByChannel.set(ch, v));
        } catch (e) { videosOk = false; errors.push(`유튜브 라이브 확인: ${(e as Error).message}`); }
      }
      for (const p of ytPlayers as any[]) {
        if (!rssOk.has(p.id) || !videosOk) continue;
        ytChecked.add(p.id);
        const v = liveByChannel.get(ytChannel.get(p.id) ?? "");
        if (v) ytLive.set(p.id, v);
      }
    }

    // ── 저장
    const nowIso = new Date().toISOString();
    const live: string[] = [];
    for (const p of players as any[]) {
      // live_checked_at 은 방송 상태를 확실히 확인했을 때만 바꿔요. 사이트는 20분 넘게 확인 못 한 LIVE ON 은 숨겨요
      const row: Record<string, unknown> = {};
      const hasChzzk = chzzkPlayers.includes(p);
      const chz = hasChzzk ? chzzk.get(p.id) : undefined;
      // 확인에 실패한 플랫폼(일시적인 오류)은 "모름". 직전에 그쪽에서 방송 중이었고 다른 쪽도 방송이 아니면 상태를 그대로 둬요
      const chzzkKnown = !hasChzzk || chz !== null;
      const ytKnown = !p.youtube_url || !ytKey || !ytChannel.has(p.id) || ytChecked.has(p.id);
      const anyLive = !!chz?.live || ytLive.has(p.id);
      const prevUnknown = (p.live_platform === 'chzzk' && !chzzkKnown) || (p.live_platform === 'youtube' && !ytKnown);
      if (anyLive || !prevUnknown) {
        Object.assign(row, decideLive({ chzzkId: parseChzzkId(p.chzzk_channel_id), chzzk: chz, youtube: ytLive.get(p.id) ?? null }), { live_checked_at: nowIso });
      }
      if (ytChannel.has(p.id) && ytChannel.get(p.id) !== p.youtube_channel_id) row.youtube_channel_id = ytChannel.get(p.id);
      if (chzzkImage.has(p.id)) row.chzzk_image_url = chzzkImage.get(p.id);
      if (ytImage.has(p.id)) row.youtube_image_url = ytImage.get(p.id);
      if (profileDue(p) && (chzzkImage.has(p.id) || ytImage.has(p.id))) row.profile_synced_at = nowIso;
      if (!Object.keys(row).length) continue;
      const { error } = await db.from('players').update(row).eq('id', p.id);
      if (error) note(p, `저장: ${error.message}`);
      if (row.is_live) live.push(`${p.display_name} (${row.live_platform === 'youtube' ? '유튜브' : '치지직'})`);
    }

    return json({ checked: players.length, live, youtube: ytKey ? 'on' : 'off', errors });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
