// 이터널 리턴 사용자 설정 대전 "데이터 저장" CSV (GameResult_방번호.csv) 읽기
// 브라우저(결과 검토 화면) · Supabase 함수(upload-result) · 테스트가 같이 써요. 의존성 없는 순수 JS 예요.
//
// 확인한 형식 (2026-10, 대회 점수 산정 켠 판 기준)
//   rank, level, character, nickname, weapon, best weapon mastery, best weapon mastery level,
//   total field kill, team kill, elimination, down can not eliminate, repeat down can not eliminate,
//   down can eliminate, repeat down can eliminate, kill, assist, hunting, killer, gameId, teamName,
//   tournament total score, tournament rank score, tournament kill score
// - UTF-8 (BOM 있음), 구분자는 ", "
// - 팀 값(total field kill, elimination …, tournament …)은 같은 팀 세 줄에 똑같이 들어 있어요
// - 게임 대회 점수의 킬 점수 = elimination + 0.5 × (down can not eliminate) + (down can eliminate)
//   → 0.5점 킬 = 부활 가능한 시기(1~2일차)의 킬
// - killer 가 비어 있으면 생존, 그 판 닉네임이면 플레이어 처치, 그 밖(WildDog, Chicken …)은 처치자 불명

const COLS = {
  rank: 'rank',
  level: 'level',
  character: 'character',
  nickname: 'nickname',
  weapon: 'weapon',
  mastery: 'best weapon mastery',
  masteryLevel: 'best weapon mastery level',
  totalFieldKill: 'total field kill',
  teamKill: 'team kill',
  elimination: 'elimination',
  downNoElim: 'down can not eliminate',
  repeatDownNoElim: 'repeat down can not eliminate',
  downElim: 'down can eliminate',
  repeatDownElim: 'repeat down can eliminate',
  kills: 'kill',
  assists: 'assist',
  hunting: 'hunting',
  killer: 'killer',
  gameId: 'gameid',
  teamName: 'teamname',
  tTotal: 'tournament total score',
  tRank: 'tournament rank score',
  tKill: 'tournament kill score'
};
const REQUIRED = ['rank', 'nickname', 'teamName', 'killer', 'gameId'];
const NUMERIC = ['rank', 'level', 'masteryLevel', 'totalFieldKill', 'teamKill', 'elimination', 'downNoElim', 'repeatDownNoElim',
  'downElim', 'repeatDownElim', 'kills', 'assists', 'hunting', 'tTotal', 'tRank', 'tKill'];

/** 실험체 영문 이름 비교용 (LiDailin = Li Dailin = lidailin, István = istvan) */
export function normName(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 따옴표를 고려해서 한 줄을 칸으로 나눠요 */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') { quoted = true; cur = ''; }
    else if (ch === ',') { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const toNum = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : 0;
};

function isBotRow(nickname, character) {
  const nick = String(nickname || '');
  const ch = String(character || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (ch && new RegExp(`^${ch} bot \\d+$`, 'i').test(nick)) || /^\S+ bot \d+$/i.test(nick);
}

/**
 * CSV 글자 → { ok, error, gameId, scoringOn, hasBots, rows, teams, warnings }
 * teams 는 순위(rank) 순서예요.
 */
export function parseGameResult(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const lines = src.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { ok: false, error: '내용이 비어 있어요. 게임 결과 CSV 가 맞는지 확인해 주세요.' };

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim());
  const idx = {};
  for (const [key, name] of Object.entries(COLS)) idx[key] = header.indexOf(name);
  const missing = REQUIRED.filter((k) => idx[k] < 0);
  if (missing.length) {
    return { ok: false, error: `게임 결과 CSV 형식이 아니에요. (없는 칸: ${missing.map((k) => COLS[k]).join(', ')})` };
  }

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    if (cells.every((c) => c === '')) continue;
    const r = {};
    for (const [key, i] of Object.entries(idx)) r[key] = i >= 0 ? (cells[i] ?? '') : '';
    for (const k of NUMERIC) r[k] = toNum(r[k]);
    r.teamNo = Number(/(\d+)\s*$/.exec(r.teamName)?.[1] ?? 0) || null;
    r.isBot = isBotRow(r.nickname, r.character);
    rows.push(r);
  }
  if (!rows.length) return { ok: false, error: '선수 줄이 하나도 없어요.' };

  const warnings = [];
  const ids = [...new Set(rows.map((r) => r.gameId).filter(Boolean))];
  if (ids.length > 1) warnings.push(`한 파일에 서로 다른 gameId 가 섞여 있어요 (${ids.join(', ')})`);
  const gameId = ids[0] ? Number(ids[0]) || null : null;

  const scoringOn = rows.some((r) => r.tRank || r.tKill || r.tTotal);
  const nicknames = new Set(rows.map((r) => r.nickname));

  const groups = new Map();
  for (const r of rows) {
    const key = r.teamName || `rank-${r.rank}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const teams = [...groups.entries()].map(([key, members]) => {
    const a = members[0];
    const sumKills = members.reduce((s, m) => s + m.kills, 0);
    const totalFieldKill = Math.max(...members.map((m) => m.totalFieldKill), sumKills);
    // 0.5점 킬 수: 대회 점수가 켜져 있으면 게임 킬 점수에서 거꾸로 계산 (KS = 전체 킬 − 0.5 × 0.5점 킬)
    let earlyKills = a.downNoElim;
    let earlySource = 'down';
    if (scoringOn) {
      const e = 2 * (totalFieldKill - a.tKill);
      if (Number.isInteger(e) && e >= 0 && e <= totalFieldKill) { earlyKills = e; earlySource = 'tournament'; }
      else earlySource = 'mismatch';
    }
    const unknownDeaths = members
      .filter((m) => m.killer && !nicknames.has(m.killer))
      .map((m) => ({ nickname: m.nickname, killer: m.killer }));
    return {
      key,
      csvTeamNo: a.teamNo,
      rank: a.rank,
      members,
      totalFieldKill,
      earlyKills,
      earlySource,
      downNoElim: a.downNoElim,
      tournament: scoringOn ? { total: a.tTotal, rank: a.tRank, kill: a.tKill } : null,
      unknownDeaths,
      allBots: members.every((m) => m.isBot)
    };
  }).sort((x, y) => x.rank - y.rank || (x.csvTeamNo ?? 0) - (y.csvTeamNo ?? 0));

  const ranks = teams.map((t) => t.rank);
  if (new Set(ranks).size !== ranks.length) warnings.push('같은 순위의 팀이 둘 이상이에요');

  return { ok: true, gameId, scoringOn, hasBots: rows.some((r) => r.isBot), rows, teams, warnings };
}

/** 점수 규칙으로 팀 점수 계산 (DB 뷰 v_round_team_scores 와 같은 식) */
export function teamScore({ rank, teamKills, earlyKills, penalties }, rules) {
  const placement = rules?.placement ?? [10, 7, 5, 4, 3, 2, 1, 0];
  const ksEarly = Number(rules?.ks_early ?? 0.5);
  const ksLate = Number(rules?.ks_late ?? 1);
  const pen = Number(rules?.penalty ?? 1);
  const rs = Number(placement[rank - 1] ?? 0);
  const early = Math.max(0, Math.min(earlyKills, teamKills));
  const ks = early * ksEarly + Math.max(teamKills - early, 0) * ksLate;
  const p = penalties * pen;
  return { rs, ks, pen: p, total: rs + ks - p };
}
