// 치지직 · 유튜브 방송 연동에 쓰는 순수 함수들 (서버 함수 live-sync · 테스트가 같이 써요)
//
// 치지직 (로그인 없이 쓰는 공개 주소, 브라우저 User-Agent 필요)
//   라이브 상태: GET https://api.chzzk.naver.com/polling/v2/channels/{채널ID}/live-status
//     → content.status = OPEN | CLOSE, liveTitle, concurrentUserCount, openDate("2026-10-28 20:01:02", 한국 시간)
//   채널 정보:   GET https://api.chzzk.naver.com/service/v1/channels/{채널ID}
//     → content.channelName, channelImageUrl, openLive
// 유튜브 (YouTube Data API v3 키 필요)
//   채널 찾기:   channels?part=snippet&forHandle=@핸들 | forUsername= | id=UC… (1 쿼터)
//   라이브 찾기: 채널 RSS(무료)의 최근 영상 → videos?part=snippet,liveStreamingDetails&id=…(50개까지 1 쿼터)
//                snippet.liveBroadcastContent === 'live' 인 영상

export const CHZZK_API = 'https://api.chzzk.naver.com';
export const YT_API = 'https://www.googleapis.com/youtube/v3';
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const str = (v) => (v === null || v === undefined ? '' : String(v));

/** 치지직 방송국 주소나 채널 ID 에서 32자리 채널 ID 만 */
export function parseChzzkId(input) {
  const m = str(input).match(/([0-9a-f]{32})/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * 유튜브 채널 주소 해석
 *   https://www.youtube.com/@핸들 · @핸들 → { kind: 'handle', value: '@핸들' }
 *   https://www.youtube.com/channel/UC… · UC… → { kind: 'id', value: 'UC…' }
 *   /user/이름 → { kind: 'user' }, /c/이름 → { kind: 'custom' }
 *   영상 주소(watch, youtu.be, shorts)는 채널이 아니라서 null
 */
export function parseYoutubeRef(input) {
  let s = str(input).trim();
  if (!s) return null;
  if (/^UC[\w-]{22}$/.test(s)) return { kind: 'id', value: s };
  if (/^@[^\s/?#]+$/.test(s)) return { kind: 'handle', value: safeDecode(s) };
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u;
  try { u = new URL(s); } catch { return null; }
  if (!/(^|\.)youtube\.com$/i.test(u.hostname)) return null;
  const parts = u.pathname.split('/').filter(Boolean).map(safeDecode);
  if (!parts.length) return null;
  if (parts[0].startsWith('@')) return { kind: 'handle', value: parts[0] };
  if (parts[0] === 'channel' && /^UC[\w-]{22}$/.test(parts[1] || '')) return { kind: 'id', value: parts[1] };
  if (parts[0] === 'user' && parts[1]) return { kind: 'user', value: parts[1] };
  if (parts[0] === 'c' && parts[1]) return { kind: 'custom', value: parts[1] };
  return null;
}
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

/** "2026-10-28 20:01:02" (한국 시간) → ISO */
export function kstToIso(s) {
  const m = str(s).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}+09:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** 치지직 라이브 상태 응답 → { live, title, viewers, startedAt } (응답이 이상하면 null) */
export function chzzkLive(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.code && json.code !== 200) return json.code === 404 ? { live: false, title: '', viewers: null, startedAt: null } : null;
  const c = json.content;
  if (c === null) return { live: false, title: '', viewers: null, startedAt: null };   // 방송한 적 없는 채널
  if (!c || typeof c !== 'object') return null;
  const live = String(c.status || '').toUpperCase() === 'OPEN';
  return {
    live,
    title: live ? str(c.liveTitle).trim() : '',
    viewers: live && Number.isFinite(Number(c.concurrentUserCount)) ? Number(c.concurrentUserCount) : null,
    startedAt: live ? kstToIso(c.openDate) : null
  };
}

/** 치지직 채널 정보 응답 → { name, image, openLive } */
export function chzzkChannel(json) {
  const c = json?.content;
  if (!c || typeof c !== 'object') return null;
  return { name: str(c.channelName), image: str(c.channelImageUrl) || null, openLive: !!c.openLive };
}

/** 치지직 공식 Open API 채널 목록 응답(/open/v1/channels) → Map(채널ID → 이미지) */
export function chzzkOpenChannels(json) {
  const out = new Map();
  for (const c of json?.content?.data ?? json?.data ?? []) {
    if (c?.channelId) out.set(String(c.channelId), str(c.channelImageUrl) || null);
  }
  return out;
}

/** 유튜브 채널 응답 한 개 → { id, title, image } */
export function youtubeChannelInfo(item) {
  if (!item?.id) return null;
  const th = item.snippet?.thumbnails || {};
  return { id: String(item.id), title: str(item.snippet?.title), image: th.high?.url || th.medium?.url || th.default?.url || null };
}

/** 유튜브 채널 RSS → 최근 영상 ID (새것부터) */
export function rssVideoIds(xml, max = 5) {
  const ids = [];
  for (const m of str(xml).matchAll(/<yt:videoId>([\w-]{6,})<\/yt:videoId>/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
    if (ids.length >= max) break;
  }
  return ids;
}

/** videos.list 응답 → Map(채널ID → { videoId, title, viewers, startedAt }) — 지금 방송 중인 것만 */
export function youtubeLiveByChannel(json) {
  const out = new Map();
  for (const v of json?.items ?? []) {
    const sn = v.snippet || {};
    const ls = v.liveStreamingDetails || {};
    if (sn.liveBroadcastContent !== 'live' || ls.actualEndTime) continue;
    const cur = out.get(sn.channelId);
    const viewers = Number.isFinite(Number(ls.concurrentViewers)) ? Number(ls.concurrentViewers) : null;
    if (cur && (cur.viewers ?? -1) >= (viewers ?? -1)) continue;   // 동시에 여러 개면 시청자 많은 쪽
    out.set(sn.channelId, { videoId: v.id, title: str(sn.title).trim(), viewers, startedAt: ls.actualStartTime || null });
  }
  return out;
}

/** 두 플랫폼 결과 → players 칸 값. 둘 다 방송 중이면 치지직을 먼저 보여 줘요 */
export function decideLive({ chzzkId, chzzk, youtube }) {
  if (chzzk?.live) {
    return { is_live: true, live_platform: 'chzzk', live_title: chzzk.title || null, live_viewers: chzzk.viewers, live_url: `https://chzzk.naver.com/live/${chzzkId}`, live_started_at: chzzk.startedAt };
  }
  if (youtube) {
    return { is_live: true, live_platform: 'youtube', live_title: youtube.title || null, live_viewers: youtube.viewers, live_url: `https://www.youtube.com/watch?v=${youtube.videoId}`, live_started_at: youtube.startedAt };
  }
  return { is_live: false, live_platform: null, live_title: null, live_viewers: null, live_url: null, live_started_at: null };
}
