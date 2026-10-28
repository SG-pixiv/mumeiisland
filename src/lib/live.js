// 방송 진행판 · 오버레이에서 쓰는 계산 (DB 나 화면 없이 돌아가서 테스트할 수 있어요)

const HOUR = 3600000;
const time = (v) => (v ? Date.parse(v) || 0 : 0);

/** 점수 표시: 0.5 단위가 있을 때만 소수점 */
export function pts(n) {
  if (n === null || n === undefined || n === '') return '-';
  const v = Math.round(Number(n) * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** 내전의 방송 상태 (7단계 SQL 전이면 항상 idle) */
export function liveOf(ev) {
  const state = ev?.live_state === 'playing' || ev?.live_state === 'ended' ? ev.live_state : 'idle';
  return { state, round: ev?.live_round || null, changedAt: ev?.live_changed_at || null };
}

/** 오버레이 · 조종판이 다룰 내전: 주소로 고른 것 → 방송 중인 것 → 오늘 · 곧 할 것 */
export function pickLiveEvent(events, { now = Date.now(), id = null } = {}) {
  if (id) return events.find((e) => e.id === id) || null;
  const live = events.filter((e) => liveOf(e).state !== 'idle')
    .sort((a, b) => time(b.live_changed_at) - time(a.live_changed_at))[0];
  if (live) return live;
  return events.filter((e) => e.status !== 'done' && time(e.starts_at) >= now - 12 * HOUR)
    .sort((a, b) => time(a.starts_at) - time(b.starts_at))[0] || null;
}

/** 시작 버튼에 넣을 라운드 번호 (진행 중이면 지금 라운드) */
export function nextRoundNo(ev, rounds = []) {
  const { state, round } = liveOf(ev);
  const max = Math.max(0, ...rounds.filter((r) => r.event_id === ev.id).map((r) => Number(r.round_no) || 0));
  if (state === 'playing') return round || max + 1;
  return Math.max(max, state === 'ended' ? round || 0 : 0) + 1;
}

/** LIVE 배지 글자: "3라운드 시작" · "3라운드 끝" · '' */
export function liveLabel(ev) {
  const { state, round } = liveOf(ev);
  if (state === 'idle' || !round) return '';
  return `${round}라운드 ${state === 'playing' ? '시작' : '끝'}`;
}

/** 버튼 하나 누르면 바뀔 상태 */
export function liveAction(ev, act, roundNo) {
  const { round } = liveOf(ev);
  if (act === 'start') return { state: 'playing', round: roundNo };
  if (act === 'end') return { state: 'ended', round: round || roundNo };
  if (act === 'cancel') return round > 1 ? { state: 'ended', round: round - 1 } : { state: 'idle', round: null };
  if (act === 'off') return { state: 'idle', round: null };
  throw new Error('알 수 없는 버튼이에요');
}

/** 팀 이름: 드래프트면 팀장 이름 (예: 새벽사냥꾼 팀), 아니면 팀 N */
export function teamLabeler(event, evTeams = [], names = new Map()) {
  const captainOf = new Map(evTeams.filter((t) => t.slot_tier === 1).map((t) => [t.team_no, names.get(t.player_id)]));
  return (no) => (event?.format === 'draft' && captainOf.get(no) ? `${captainOf.get(no)} 팀` : `팀 ${no}`);
}

/**
 * 팀 번호 → 팀원 [{ id, name, tier }]
 * 팀 편성이 공개돼 있으면 그걸, 아니면 그 라운드 결과 기록에서
 * players: Map(id → { name, tier })
 */
export function membersByTeam(evTeams = [], roundPlayers = [], players = new Map()) {
  const map = new Map();
  const add = (no, m) => {
    const list = map.get(no) || [];
    if (!list.some((x) => x.key === m.key)) list.push(m);
    map.set(no, list);
  };
  if (evTeams.length) {
    evTeams.forEach((t) => add(t.team_no, { key: t.player_id, id: t.player_id, name: players.get(t.player_id)?.name || '알 수 없음', tier: t.slot_tier }));
  } else {
    roundPlayers.forEach((r) => {
      const p = r.player_id ? players.get(r.player_id) : null;
      add(r.team_no, { key: r.player_id || r.csv_nickname, id: r.player_id || null, name: p?.name || r.csv_nickname, tier: p?.tier || 3 });
    });
  }
  map.forEach((list) => list.sort((a, b) => a.tier - b.tier));
  return map;
}

// 합계 높은 순, 같으면 킬 점수 높은 순. 둘 다 같으면 같은 순위
function ranked(list) {
  const sorted = list.slice().sort((a, b) => b.total - a.total || b.ks - a.ks || a.teamNo - b.teamNo);
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    r.rank = prev && prev.total === r.total && prev.ks === r.ks ? prev.rank : i + 1;
  });
  return sorted;
}

function cumulative(scores, upTo = Infinity) {
  const by = new Map();
  scores.filter((s) => s.round_no <= upTo).forEach((s) => {
    const t = by.get(s.team_no) || { teamNo: s.team_no, total: 0, ks: 0 };
    t.total += Number(s.total) || 0;
    t.ks += Number(s.ks) || 0;
    by.set(s.team_no, t);
  });
  return by;
}

/**
 * 게임 중 누적 순위판
 * scores: v_round_team_scores (이 내전, 확정된 것만)
 */
export function buildStandings({ event, scores = [], members = new Map(), label = (n) => `팀 ${n}` }) {
  const played = [...new Set(scores.map((s) => s.round_no))].sort((a, b) => a - b);
  const colCount = Math.max(Number(event?.planned_rounds) || 0, played.at(-1) || 0, 1);
  const cols = Array.from({ length: colCount }, (_, i) => i + 1);
  const teamNos = [...new Set([...scores.map((s) => s.team_no), ...members.keys()])];
  const cum = cumulative(scores);
  const rows = ranked(teamNos.map((no) => ({ teamNo: no, total: cum.get(no)?.total || 0, ks: cum.get(no)?.ks || 0 })))
    .map((r) => ({
      ...r,
      name: label(r.teamNo),
      members: members.get(r.teamNo) || [],
      rounds: cols.map((c) => {
        const s = scores.find((x) => x.round_no === c && x.team_no === r.teamNo);
        return s ? Number(s.total) : null;
      })
    }));
  return { cols, rows, played: played.length, planned: colCount };
}

/** 라운드 결과 (그 라운드 순위 + 그때까지 누적) */
export function buildRoundResult({ scores = [], roundNo, members = new Map(), label = (n) => `팀 ${n}` }) {
  const round = scores.filter((s) => s.round_no === roundNo);
  if (!round.length) return null;
  const cum = ranked([...cumulative(scores, roundNo).values()]);
  const cumOf = new Map(cum.map((c) => [c.teamNo, c]));
  const rows = round.slice().sort((a, b) => a.team_rank - b.team_rank || a.team_no - b.team_no).map((s) => ({
    rank: s.team_rank,
    teamNo: s.team_no,
    name: label(s.team_no),
    members: members.get(s.team_no) || [],
    kills: s.team_kills,
    rs: Number(s.rs), ks: Number(s.ks), pen: Number(s.pen), total: Number(s.total),
    cumTotal: cumOf.get(s.team_no)?.total ?? 0,
    cumRank: cumOf.get(s.team_no)?.rank ?? null
  }));
  const leader = cum[0] ? { teamNo: cum[0].teamNo, name: label(cum[0].teamNo), total: cum[0].total } : null;
  return { roundNo, rows, leader };
}

/**
 * MVP 표시
 * done: 발표됨 · voting: 투표 중 (count / voters) · none: 없음
 * teamOf: 선수 id → 팀 이름
 */
export function mvpInfo(event, { names = new Map(), teamOf = () => '', voteCount = null, voters = 0 } = {}) {
  if (!event) return { kind: 'none' };
  if (event.mvp_player_id) {
    const res = event.mvp_vote_result || {};
    const votes = res.counts?.[event.mvp_player_id] ?? null;
    const drawn = !!res.drawn && (res.tied?.length || 0) > 1;
    const team = teamOf(event.mvp_player_id) || '';
    const total = res.votes ?? null;
    const note = drawn && votes !== null
      ? `${votes}표 공동 1위 · 추첨으로 뽑혔어요`
      : [team, votes !== null && total ? `${total}표 중 ${votes}표` : ''].filter(Boolean).join(' · ');
    return { kind: 'done', id: event.mvp_player_id, name: names.get(event.mvp_player_id) || '알 수 없음', team, votes, total, drawn, note };
  }
  if (event.mvp_vote_status === 'open') {
    const count = voteCount === null || voteCount === undefined ? null : Number(voteCount);
    const pct = count !== null && voters ? Math.min(100, Math.round((count / voters) * 100)) : 0;
    return { kind: 'voting', count, voters, pct };
  }
  return { kind: 'none' };
}

/** 주소의 ?size=60 → 0.6 (40~150%) */
export function sizeParam(value, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(1.5, Math.max(0.4, n / 100));
}
