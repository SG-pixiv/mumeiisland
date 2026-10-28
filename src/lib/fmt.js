import { html, safeUrl } from './dom.js';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export function num(n, digits = 0) {
  if (n === null || n === undefined || n === '' || Number.isNaN(Number(n))) return '-';
  return Number(n).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(wins, games) {
  if (!games) return '-';
  return ((wins / games) * 100).toFixed(1) + '%';
}

export function score(n) {
  // 0.5 단위가 나올 수 있어서 소수점은 있을 때만 보여요
  if (n === null || n === undefined) return '-';
  const v = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function dateKo(ts, withDow = true) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}월 ${d.getDate()}일` + (withDow ? ` ${DOW[d.getDay()]}요일` : '');
}

export function timeKo(ts) {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const part = h < 6 ? '새벽' : h < 12 ? '오전' : h < 18 ? '오후' : '밤';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${part} ${hh}시` + (m ? ` ${m}분` : '');
}

export function shortDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function dateTimeShort(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const FORMAT_LABEL = { draft: '드래프트', auto: '자동 편성' };
export const STATUS_LABEL = { plan: '예정', open: '참가 모집 중', fixed: '확정', done: '완료' };

export function chzzkUrl(id) {
  return id ? `https://chzzk.naver.com/${encodeURIComponent(id)}` : '';
}

// 방송국 주소나 채널 ID 어느 쪽을 넣어도 32자리 채널 ID 만 뽑아요
export function parseChzzkId(input) {
  const s = String(input || '').trim();
  const m = s.match(/([0-9a-f]{32})/i);
  return m ? m[1].toLowerCase() : '';
}

/** 방송 보러 가기 주소: 서버가 찾은 라이브 주소 → 치지직 라이브 → 유튜브 채널 */
export function liveHref(p) {
  return safeUrl(p.liveUrl) || (p.livePlatform !== 'youtube' && p.chzzkId ? `https://chzzk.naver.com/live/${encodeURIComponent(p.chzzkId)}` : safeUrl(p.youtubeUrl)) || '';
}
export const PLATFORM_LABEL = { chzzk: '치지직', youtube: '유튜브' };

export function photoOf(p) {
  const pick = { chzzk: p.chzzkImage, youtube: p.youtubeImage, upload: p.customPhoto }[p.photoSource];
  return safeUrl(pick || p.chzzkImage || p.youtubeImage || p.customPhoto || '');
}

export function avatar(p, size = '') {
  const src = photoOf(p);
  const t = p.tier || 3;
  return html`<span class="avatar t${t} ${size}" aria-hidden="true">${src ? html`<img src="${src}" alt="" loading="lazy">` : (p.name || '?').charAt(0)}</span>`;
}

export function tierChip(t, extra = '') {
  return html`<span class="tier t${t} ${extra}">${t}티어</span>`;
}

export function tierDot(t) {
  return html`<span class="tier t${t} tier-dot">${t}</span>`;
}

export function liveBadge(small = false) {
  return html`<span class="live${small ? ' sm' : ''}">LIVE ON</span>`;
}

export function medalClass(rank) {
  return rank === 1 ? 'm1' : rank === 2 ? 'm2' : rank === 3 ? 'm3' : '';
}

const LOCK_CLOSED = 'M8 11V8a4 4 0 0 1 8 0v3';
const LOCK_OPEN = 'M8 11V7a4 4 0 0 1 7.6-1.7';
export function lockIcon(locked) {
  const stroke = locked ? '#3A2440' : '#7A6680';
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="${stroke}" stroke-width="2.5"/><path d="${locked ? LOCK_CLOSED : LOCK_OPEN}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round"/></svg>`;
}

export const STAR = html`<svg aria-hidden="true" width="26" height="26" viewBox="0 0 34 34"><path d="M17 2 L20 14 L32 17 L20 20 L17 32 L14 20 L2 17 L14 14 Z" fill="#8FDFF5" stroke="#3A2440" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
export const STAR_PINK = html`<svg aria-hidden="true" width="26" height="26" viewBox="0 0 34 34"><path d="M17 2 L20 14 L32 17 L20 20 L17 32 L14 20 L2 17 L14 14 Z" fill="#F880B9" stroke="#3A2440" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
