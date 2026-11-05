// 블서로그 (무명섬 13 · 14단계): 설정 · 랭킹 · 소식 · 피드백 · 팀 (KEL · 마스터즈) · 티어
import { select, rpc } from './db.js';

export const ROGUE_DEFAULTS = {
  live: false, scores_open: true, feedback_open: true, game_url: '', versions: [],
  max_wave: 50, min_sec_per_wave: 15, max_party: 3, cap_nickname: 5, cap_ip: 20, banned_words: []
};

/** 블서로그 티어 (14단계). 0 아이언 ~ 9 이터니티 */
export const ROGUE_TIERS = ['아이언', '브론즈', '실버', '골드', '플래티넘', '다이아몬드', '메테오라이트', '미스릴', '데미갓', '이터니티'];
export const rogueTierName = (t) => ROGUE_TIERS[Math.max(0, Math.min(9, Number(t) || 0))];

/** 팀 리그 (14단계): 게임 1~20웨이브는 마스터즈 팀, 21웨이브부터 KEL 팀 */
export const ROGUE_LEAGUES = [['kel', 'KEL'], ['masters', '마스터즈']];

export const FEEDBACK_KINDS = [
  ['bug', '버그'], ['idea', '아이디어'], ['balance', '밸런스'], ['etc', '그 밖에']
];
export const FEEDBACK_STATUS = { new: '새 피드백', read: '읽음', done: '반영함' };

/** 블서로그 설정. 13단계 SQL 전이면 null */
export async function loadRogueSettings(columns = '*') {
  try {
    const rows = await select('rogue_settings', { eq: { id: 1 }, columns });
    return rows[0] ? { ...ROGUE_DEFAULTS, ...rows[0] } : null;
  } catch {
    return null;
  }
}

/** 초를 "12:34" 또는 "1:02:03" 으로 */
export function playTime(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** 랭킹: 'week' 이번 주 · 'all' 역대 (닉네임마다 최고 기록 하나) */
export async function loadBoard(scope = 'week', limit = 50) {
  return (await rpc('rogue_board', { p_scope: scope, p_limit: limit })) || [];
}

/** 실험체 번호 → 이름 */
export async function loadCharacterNames() {
  const rows = await select('er_characters', { columns: 'code, name_ko' }).catch(() => []);
  return new Map(rows.map((r) => [Number(r.code), r.name_ko]));
}

/** 이번 주 월요일 0시 (한국 시간) 기준 날짜 */
export function weekStartKst(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const dow = (kst.getUTCDay() + 6) % 7;   // 월요일 = 0
  kst.setUTCDate(kst.getUTCDate() - dow);
  return kst.toISOString().slice(0, 10);
}

/** 금지어 · 버전 칸: 쉼표나 줄바꿈으로 나눈 목록 */
export function splitList(text) {
  return [...new Set(String(text || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
}
