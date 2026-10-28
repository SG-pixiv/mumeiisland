// 방송 진행판 · 오버레이가 읽는 데이터 (오버레이는 로그인 없이 공개된 것만 읽어요)
import { select, rpc } from './db.js';
import { pickLiveEvent, teamLabeler, membersByTeam } from './live.js';

/** 7단계 SQL 을 실행했는지 (events 에 live_state 칸이 있는지) */
export const liveReady = (events) => !events.length || 'live_state' in events[0];

/** MVP 투표 중 인원 (7단계 전이면 null) */
export async function voteCount(eventId) {
  try { return await rpc('mvp_vote_count', { p_event: eventId }); } catch { return null; }
}

/**
 * 오버레이 한 장에 필요한 것 한 번에
 * withRounds: 라운드 결과 화면이면 true (선수별 팀 기록까지)
 */
export async function loadOverlay({ eventId = null, withRounds = false } = {}) {
  const events = await select('events', { order: 'starts_at' });
  const event = pickLiveEvent(events, { id: eventId });
  if (!event) return { event: null };
  const [scores, evTeams, parts, players] = await Promise.all([
    select('v_round_team_scores', { eq: { event_id: event.id } }),
    select('event_teams', { eq: { event_id: event.id } }),   // 팀 편성 공개 전이면 빈 목록
    select('event_participants', { eq: { event_id: event.id } }),
    select('players', { columns: 'id, display_name, balance_tier' })
  ]);
  const roundIds = [...new Set(scores.map((s) => s.round_id))];
  const roundPlayers = roundIds.length && (withRounds || !evTeams.length)
    ? await select('round_players', { inn: { round_id: roundIds }, columns: 'round_id, player_id, csv_nickname, team_no' })
    : [];
  const people = new Map(players.map((p) => [p.id, { name: p.display_name, tier: p.balance_tier }]));
  const names = new Map(players.map((p) => [p.id, p.display_name]));
  const label = teamLabeler(event, evTeams, names);
  const lastRound = Math.max(0, ...scores.map((s) => s.round_no));
  // 팀원: 팀 편성이 공개돼 있으면 그걸, 아니면 가장 최근 라운드 기록
  const members = membersByTeam(evTeams, roundPlayers.filter((r) => scores.some((s) => s.round_id === r.round_id && s.round_no === lastRound)), people);
  const membersOfRound = (roundNo) => (evTeams.length
    ? members
    : membersByTeam([], roundPlayers.filter((r) => scores.some((s) => s.round_id === r.round_id && s.round_no === roundNo)), people));
  const teamNoOf = (playerId) => evTeams.find((t) => t.player_id === playerId)?.team_no
    ?? roundPlayers.slice().reverse().find((r) => r.player_id === playerId)?.team_no ?? null;
  const teamOf = (playerId) => { const no = teamNoOf(playerId); return no ? label(no) : ''; };
  const votes = event.mvp_vote_status === 'open' && !event.mvp_player_id ? await voteCount(event.id) : null;
  return { event, scores, evTeams, members, membersOfRound, label, names, teamOf, voters: parts.length, voteCount: votes, ready: liveReady(events) };
}
