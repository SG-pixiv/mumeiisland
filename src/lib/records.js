// 경쟁 기록(회차 · 우승 · 개인 기록) 계산과 공개 설정. 화면 · 테스트가 같이 쓰는 순수 함수예요.
//
// 회차 = 내전 한 번 (1회차, 2회차 …)
// 회차 기준 기록: 출전 = 확정된 판에 뛴 회차 수, 우승 = 그 회차 최종 1위 팀, 평균 순위 = 회차 최종 순위 평균
// 판(라운드) 기준 기록: 판수 · 판 1위 · 평균 TK · 평균 점수 · 라운드 MVP

/** 공개 설정 항목 (관리자 → 기록 공개) */
export const RECORD_ITEMS = [
  { key: 'results', label: '내전 기록', what: '회차별 결과 페이지 · 라운드 순위 · 선수별 기록', dash: '최근 회차 결과 · 방송 중 실시간 팀 순위' },
  { key: 'hall', label: '우승 기록', what: '회차별 우승 팀 · 최다 우승 Top 10', dash: '지난 회차 우승 팀 · 최다 우승' },
  { key: 'personal', label: '개인 기록', what: '선수별 출전 · 우승 · 평균 순위 · 실험체 성적 · 회차 기록', dash: '랭킹 Top 5 · 최다 출전 · 평균 순위 1위' },
  { key: 'tk', label: 'TK (팀 킬)', what: '모든 기록 화면의 TK 칸' },
  { key: 'mvp', label: '라운드 MVP', what: 'MVP 횟수 · 라운드 MVP 표시 · 디스코드 MVP 투표와 발표' }
];
const DASH_KEYS = ['results', 'hall', 'personal'];

export const DEFAULT_ITEMS = Object.fromEntries(RECORD_ITEMS.map((i) => [i.key, DASH_KEYS.includes(i.key) ? { on: true, dash: true } : { on: true }]));
export const DEFAULT_SETTINGS = { records_public: false, records_from_episode: 1, records_items: DEFAULT_ITEMS };

/** 저장된 설정 → 화면에서 쓸 공개 여부 (전체 스위치가 꺼져 있으면 전부 숨겨요) */
export function visibility(settings, { preview = false } = {}) {
  const s = settings || DEFAULT_SETTINGS;
  const items = { ...DEFAULT_ITEMS, ...(s.records_items || {}) };
  const master = preview || !!s.records_public;
  const show = (k) => master && (preview || items[k]?.on !== false);
  const dash = (k) => show(k) && (preview || items[k]?.dash !== false);
  const v = {
    public: !!s.records_public,
    preview,
    from: Math.max(1, Math.floor(Number(s.records_from_episode)) || 1),
    dash: Object.fromEntries(DASH_KEYS.map((k) => [k, dash(k)]))
  };
  RECORD_ITEMS.forEach((i) => { v[i.key] = show(i.key); });
  v.any = RECORD_ITEMS.some((i) => v[i.key]);
  return v;
}

/** "12회차" · 회차가 없으면 빈 글자 */
export const episodeLabel = (ev) => (ev?.episode ? `${ev.episode}회차` : '');
/** "12회차 · 10월 17일 내전" */
export const eventName = (ev) => [episodeLabel(ev), ev?.title].filter(Boolean).join(' · ');

/** 12단계 SQL 전이라 회차가 비어 있으면 날짜순으로 매겨요 */
export function withEpisodes(events) {
  if (events.every((e) => e.episode)) return events;
  const order = events.slice().sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || String(a.created_at).localeCompare(String(b.created_at)));
  const no = new Map(order.map((e, i) => [e.id, i + 1]));
  return events.map((e) => (e.episode ? e : { ...e, episode: no.get(e.id) }));
}

/** 회차가 끝났는지: 완료 · 예정 라운드를 다 확정 · 시작 12시간 뒤 (확정된 판이 있을 때) */
export function eventFinished(event, confirmedRounds, now = Date.now()) {
  if (!confirmedRounds) return false;
  if (event.status === 'done') return true;
  if (confirmedRounds >= (Number(event.planned_rounds) || 0)) return true;
  return now >= Date.parse(event.starts_at) + 12 * 3600000;
}

const avgOf = (sum, n) => (n ? sum / n : null);

/**
 * 회차별 결과
 * standings: v_event_standings · prounds: v_player_rounds (선수 · 팀 번호)
 * → [{ event, episode, finished, rounds, teams: [{ team_no, standing, total, rs, ks, pen, rounds, members: [{ id, name }] }], winners }]
 *   새 회차가 앞으로 와요
 */
export function episodeResults({ events, standings, prounds, nameOf = () => null, now = Date.now() }) {
  const byEvent = new Map();
  standings.forEach((s) => { if (!byEvent.has(s.event_id)) byEvent.set(s.event_id, []); byEvent.get(s.event_id).push(s); });
  const membersOf = new Map();   // event_id → team_no → Map(key → member)
  prounds.forEach((r) => {
    if (!membersOf.has(r.event_id)) membersOf.set(r.event_id, new Map());
    const teams = membersOf.get(r.event_id);
    if (!teams.has(r.team_no)) teams.set(r.team_no, new Map());
    const key = r.player_id || 'nick:' + r.csv_nickname;
    if (!teams.get(r.team_no).has(key)) teams.get(r.team_no).set(key, { id: r.player_id || null, name: (r.player_id && nameOf(r.player_id)) || r.csv_nickname });
  });
  return events.filter((e) => byEvent.has(e.id)).map((e) => {
    const st = byEvent.get(e.id);
    const rounds = Math.max(0, ...st.map((s) => Number(s.rounds) || 0));
    const teams = st.map((s) => ({
      team_no: s.team_no, standing: Number(s.standing), total: Number(s.total), rs: Number(s.rs), ks: Number(s.ks), pen: Number(s.pen),
      rounds: Number(s.rounds), members: [...(membersOf.get(e.id)?.get(s.team_no)?.values() ?? [])]
    })).sort((a, b) => a.standing - b.standing || a.team_no - b.team_no);
    return { event: e, episode: e.episode, finished: eventFinished(e, rounds, now), rounds, teams, winners: teams.filter((t) => t.standing === 1) };
  }).sort((a, b) => (b.episode || 0) - (a.episode || 0) || Date.parse(b.event.starts_at) - Date.parse(a.event.starts_at));
}

/**
 * 선수별 기록 (from 회차부터)
 * results: episodeResults · prounds: v_player_rounds · mvpRounds: [{ event_id, mvp_player_id }]
 * → Map(player_id → 기록)
 */
export function playerRecords({ results, prounds, mvpRounds = [], from = 1 }) {
  const counted = new Map(results.filter((r) => (r.episode || 0) >= from).map((r) => [r.event.id, r]));
  const recs = new Map();
  const rec = (id) => {
    if (!recs.has(id)) recs.set(id, { id, episodes: 0, wins: 0, podiums: 0, standingSum: 0, roundGames: 0, roundWins: 0, tkSum: 0, totalSum: 0, mvp: 0, history: [] });
    return recs.get(id);
  };
  // 회차 기준: 끝난 회차에서 그 선수가 뛴 팀의 최종 순위
  for (const r of counted.values()) {
    if (!r.finished) continue;
    for (const t of r.teams) {
      for (const m of t.members) {
        if (!m.id) continue;
        const p = rec(m.id);
        if (p.history.some((h) => h.eventId === r.event.id)) continue;
        p.episodes++;
        p.standingSum += t.standing;
        if (t.standing === 1) p.wins++;
        if (t.standing <= 3) p.podiums++;
        p.history.push({ eventId: r.event.id, episode: r.episode, title: r.event.title, startsAt: r.event.starts_at, standing: t.standing, teams: r.teams.length, teamNo: t.team_no, total: t.total, mates: t.members.filter((x) => x.id !== m.id) });
      }
    }
  }
  // 판 기준
  for (const g of prounds) {
    if (!g.player_id || !counted.has(g.event_id)) continue;
    const p = rec(g.player_id);
    p.roundGames++;
    if (Number(g.team_rank) === 1) p.roundWins++;
    p.tkSum += Number(g.team_kills) || 0;
    p.totalSum += Number(g.total) || 0;
  }
  for (const m of mvpRounds) {
    if (m.mvp_player_id && counted.has(m.event_id)) rec(m.mvp_player_id).mvp++;
  }
  for (const p of recs.values()) {
    p.avgStanding = avgOf(p.standingSum, p.episodes);
    p.winRate = p.episodes ? p.wins / p.episodes : null;
    p.avgTk = avgOf(p.tkSum, p.roundGames);
    p.avgTotal = avgOf(p.totalSum, p.roundGames);
    p.history.sort((a, b) => (b.episode || 0) - (a.episode || 0));
  }
  return recs;
}

/** 빈 기록 (기록이 없는 선수) */
export const emptyRecord = (id) => ({ id, episodes: 0, wins: 0, podiums: 0, standingSum: 0, roundGames: 0, roundWins: 0, tkSum: 0, totalSum: 0, mvp: 0, history: [], avgStanding: null, winRate: null, avgTk: null, avgTotal: null });

/** 랭킹 순서: 우승 많은 순 → 평균 순위 좋은 순 → 출전 많은 순 */
export function rankOrder(a, b) {
  return b.wins - a.wins || (a.avgStanding ?? 99) - (b.avgStanding ?? 99) || b.episodes - a.episodes;
}

/** 대시보드 카드: 최다 우승 · 최다 출전 · 평균 순위 1위 (minGames 회차 이상) */
export function leaders(records, { minGames = 3 } = {}) {
  const list = [...records.values()].filter((r) => r.episodes > 0);
  const mostWins = list.filter((r) => r.wins > 0).sort((a, b) => b.wins - a.wins || b.episodes - a.episodes)[0] || null;
  const mostGames = list.slice().sort((a, b) => b.episodes - a.episodes || b.wins - a.wins)[0] || null;
  const enough = list.filter((r) => r.episodes >= minGames);
  const bestAvg = enough.sort((a, b) => a.avgStanding - b.avgStanding || b.episodes - a.episodes)[0] || null;
  return { mostWins, mostGames, bestAvg, minGames };
}

/** 최다 우승 Top N (같은 횟수는 같은 순위) */
export function winRanking(records, n = 10) {
  const list = [...records.values()].filter((r) => r.wins > 0).sort((a, b) => b.wins - a.wins || b.episodes - a.episodes).slice(0, n);
  let rank = 0;
  return list.map((r, i) => { if (i === 0 || r.wins < list[i - 1].wins) rank = i + 1; return { ...r, rank }; });
}

/** 실시간 팀 순위: 1위와의 점수 차 */
export function withGap(teams) {
  const sorted = teams.slice().sort((a, b) => a.standing - b.standing || a.team_no - b.team_no);
  const top = sorted[0]?.total ?? 0;
  return sorted.map((t, i) => ({ ...t, gap: i === 0 ? null : top - t.total }));
}
