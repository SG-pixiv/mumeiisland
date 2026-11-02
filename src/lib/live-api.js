// 방송 진행판 · 오버레이가 읽는 데이터 (오버레이는 로그인 없이 공개된 것만 읽어요)
import { select } from './db.js';
import { pickLiveEvent, teamLabeler, membersByTeam } from './live.js';

/** 7단계 SQL 을 실행했는지 (events 에 live_state 칸이 있는지) */
export const liveReady = (events) => !events.length || 'live_state' in events[0];

/**
 * 오버레이 한 장에 필요한 것 한 번에
 * withRounds: 라운드 결과 화면이면 true (선수별 팀 기록까지)
 */
// 오버레이는 10초마다 읽어서, 일정은 최근 30일 것만 받아요 (방송 중 · 곧 할 내전은 다 이 안에 있어요)
const RECENT_DAYS = 30;

export async function loadOverlay({ eventId = null, withRounds = false } = {}) {
  const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();
  let events = await select('events', { order: 'starts_at', gte: { starts_at: since } });
  if (eventId && !events.some((e) => e.id === eventId)) events = events.concat(await select('events', { eq: { id: eventId } }));   // 주소로 고른 예전 내전
  const event = pickLiveEvent(events, { id: eventId });
  if (!event) return { event: null };
  const [scores, evTeams, parts, players] = await Promise.all([
    select('v_round_team_scores', { eq: { event_id: event.id } }),
    select('event_teams', { eq: { event_id: event.id } }),   // 팀 편성 공개 전이면 빈 목록
    select('event_participants', { eq: { event_id: event.id }, columns: 'player_id' }),   // 투표 인원만 세요
    select('players', { columns: 'id, display_name, balance_tier' })
  ]);
  const lastRound = Math.max(0, ...scores.map((s) => s.round_no));
  // 라운드 결과 화면은 모든 판, 누적 순위는 팀원 이름에 쓰는 마지막 판만 받아요
  const roundIds = [...new Set(scores.filter((s) => withRounds || s.round_no === lastRound).map((s) => s.round_id))];
  const roundPlayers = roundIds.length && (withRounds || !evTeams.length)
    ? await select('round_players', { inn: { round_id: roundIds }, columns: 'round_id, player_id, csv_nickname, team_no' })
    : [];
  const people = new Map(players.map((p) => [p.id, { name: p.display_name, tier: p.balance_tier }]));
  const names = new Map(players.map((p) => [p.id, p.display_name]));
  const label = teamLabeler(event, evTeams, names);
  // 팀원: 팀 편성이 공개돼 있으면 그걸, 아니면 가장 최근 라운드 기록
  const members = membersByTeam(evTeams, roundPlayers.filter((r) => scores.some((s) => s.round_id === r.round_id && s.round_no === lastRound)), people);
  const membersOfRound = (roundNo) => (evTeams.length
    ? members
    : membersByTeam([], roundPlayers.filter((r) => scores.some((s) => s.round_id === r.round_id && s.round_no === roundNo)), people));
  return { event, scores, evTeams, members, membersOfRound, label, names, voters: parts.length, ready: liveReady(events) };
}
