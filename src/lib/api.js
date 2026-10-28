// 화면에서 쓰는 모양으로 데이터를 모아 주는 함수들
import { select } from './db.js';

function combine(rows, sfx = '') {
  const games = rows.reduce((s, r) => s + Number(r['games' + sfx] || 0), 0);
  const wins = rows.reduce((s, r) => s + Number(r['wins' + sfx] || 0), 0);
  if (!games) return { games: 0, wins: 0, avgRank: null, avgTk: null, avgTotal: null };
  const w = (f) => rows.reduce((s, r) => s + Number(r[f + sfx] || 0) * Number(r['games' + sfx] || 0), 0) / games;
  return { games, wins, avgRank: w('avg_rank'), avgTk: w('avg_tk'), avgTotal: w('avg_total') };
}

export function normPlayer(row, rank, statRows = [], season = null) {
  return {
    id: row.id,
    name: row.display_name,
    erNickname: row.er_nickname,
    erUid: row.er_uid,
    tier: row.balance_tier,
    role: row.role || '',
    note: row.strength_note || '',
    chzzkId: row.chzzk_channel_id || '',
    youtubeUrl: row.youtube_url || '',
    photoSource: row.photo_source,
    chzzkImage: row.chzzk_image_url,
    youtubeImage: row.youtube_image_url,
    customPhoto: row.custom_photo_url,
    isLive: !!row.is_live,
    liveTitle: row.live_title || '',
    liveViewers: row.live_viewers,
    active: row.active,
    raw: row,
    rank: rank
      ? {
          score: rank.rank_score, games: rank.rank_games || 0, wins: rank.rank_wins || 0,
          top: (rank.top_characters || []).map((c) => c.name), season: rank.season_id,
          syncedAt: rank.synced_at, error: rank.sync_error
        }
      : null,
    season: combine(statRows.filter((r) => season === null || r.season === season)),
    recent: combine(statRows, '_30d'),
    all: combine(statRows)
  };
}

export async function currentSeason() {
  const ev = await select('events', { order: 'season', asc: false, limit: 1 });
  return ev[0]?.season ?? 1;
}

export async function loadPlayers({ includeInactive = false } = {}) {
  const [rows, ranks, stats, season] = await Promise.all([
    select('players', includeInactive ? { order: 'display_name' } : { eq: { active: true }, order: 'display_name' }),
    select('player_rank_stats'),
    select('v_player_stats'),
    currentSeason()
  ]);
  const rankBy = new Map(ranks.map((r) => [r.player_id, r]));
  const list = rows.map((r) => normPlayer(r, rankBy.get(r.id), stats.filter((s) => s.player_id === r.id), season));
  return { list, byId: new Map(list.map((p) => [p.id, p])), season };
}

export async function loadPlayerDetail(id) {
  const [{ byId, season }, rounds, history] = await Promise.all([
    loadPlayers({ includeInactive: true }),
    select('v_player_rounds', { eq: { player_id: id }, order: 'played_at', asc: false }),
    select('tier_history', { eq: { player_id: id }, order: 'changed_at', asc: false })
  ]);
  const player = byId.get(id);
  if (!player) return null;
  const chars = new Map();
  for (const r of rounds) {
    const k = r.character_name || '알 수 없음';
    const c = chars.get(k) || { name: k, games: 0, wins: 0, rankSum: 0, totalSum: 0 };
    c.games++; if (r.team_rank === 1) c.wins++; c.rankSum += r.team_rank; c.totalSum += Number(r.total) || 0;
    chars.set(k, c);
  }
  const characters = [...chars.values()].sort((a, b) => b.games - a.games)
    .map((c) => ({ ...c, avgRank: c.rankSum / c.games, avgTotal: c.totalSum / c.games }));
  return { player, season, rounds, characters, history };
}

export async function loadEvents() {
  const [events, parts] = await Promise.all([select('events', { order: 'starts_at' }), select('event_participants')]);
  const counts = new Map();
  parts.forEach((p) => counts.set(p.event_id, (counts.get(p.event_id) || 0) + 1));
  return events.map((e) => ({ ...e, joined: counts.get(e.id) || 0 }));
}

export function nextEvent(events) {
  const now = Date.now() - 6 * 3600000;
  return events.filter((e) => e.status !== 'done' && new Date(e.starts_at).getTime() >= now)
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0] || null;
}

// 팀 번호별 멤버: 공개된 팀 편성이 있으면 그걸, 없으면 결과 기록에서
export function teamMembers(teamRows, playerRounds, byId) {
  const map = new Map();
  const add = (teamNo, entry) => {
    if (!map.has(teamNo)) map.set(teamNo, []);
    const list = map.get(teamNo);
    if (!list.some((m) => m.key === entry.key)) list.push(entry);
  };
  if (teamRows.length) {
    teamRows.slice().sort((a, b) => a.slot_tier - b.slot_tier).forEach((t) => {
      const p = byId.get(t.player_id);
      add(t.team_no, { key: t.player_id, id: t.player_id, name: p?.name || '알 수 없음', tier: t.slot_tier, player: p });
    });
  } else {
    playerRounds.forEach((r) => {
      const p = r.player_id ? byId.get(r.player_id) : null;
      add(r.team_no, { key: r.player_id || r.csv_nickname, id: r.player_id, name: p?.name || r.csv_nickname, tier: p?.tier || 3, player: p });
    });
    map.forEach((list) => list.sort((a, b) => a.tier - b.tier));
  }
  return map;
}

export async function loadEventDetail(id) {
  const [[ev], scores, standings, prounds, teams, { byId }] = await Promise.all([
    select('events', { eq: { id } }),
    select('v_round_team_scores', { eq: { event_id: id } }),
    select('v_event_standings', { eq: { event_id: id } }),
    select('v_player_rounds', { eq: { event_id: id } }),
    select('event_teams', { eq: { event_id: id } }),
    loadPlayers({ includeInactive: true })
  ]);
  if (!ev) return null;
  const roundNos = [...new Set(scores.map((s) => s.round_no))].sort((a, b) => a - b);
  return { event: ev, scores, standings, prounds, roundNos, members: teamMembers(teams, prounds, byId), byId };
}

export async function loadMatchList() {
  const [events, standings, teams, prounds, { byId }] = await Promise.all([
    loadEvents(),
    select('v_event_standings'),
    select('event_teams'),
    select('v_player_rounds'),
    loadPlayers({ includeInactive: true })
  ]);
  const played = events.filter((e) => standings.some((s) => s.event_id === e.id))
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
  return played.map((e) => {
    const st = standings.filter((s) => s.event_id === e.id).sort((a, b) => a.standing - b.standing);
    const winner = st[0];
    const members = teamMembers(teams.filter((t) => t.event_id === e.id), prounds.filter((r) => r.event_id === e.id), byId);
    const rounds = Math.max(0, ...st.map((s) => Number(s.rounds)));
    return { ...e, winner, winnerMembers: winner ? members.get(winner.team_no) || [] : [], teams: st.length, rounds, mvp: e.mvp_player_id ? byId.get(e.mvp_player_id) : null };
  });
}

export async function loadScoring() {
  const [s] = await select('scoring_rules', { eq: { id: 1 } });
  return s || { placement: [10, 7, 5, 4, 3, 2, 1, 0], ks_early: 0.5, ks_late: 1, penalty: 1 };
}

export async function loadTeamsBoard(eventId) {
  const events = await loadEvents();
  const ev = eventId ? events.find((e) => e.id === eventId) : nextEvent(events.filter((e) => e.teams_public)) || nextEvent(events);
  if (!ev) return { event: null };
  const [teams, drafts, parts, { byId }] = await Promise.all([
    select('event_teams', { eq: { event_id: ev.id } }),
    select('drafts', { eq: { event_id: ev.id } }),
    select('event_participants', { eq: { event_id: ev.id } }),
    loadPlayers({ includeInactive: true })
  ]);
  return { event: ev, teams, draft: drafts[0] || null, participants: parts.map((p) => byId.get(p.player_id)).filter(Boolean), byId };
}
