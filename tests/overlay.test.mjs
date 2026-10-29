import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pts, liveOf, pickLiveEvent, nextRoundNo, liveLabel, liveAction, teamLabeler, membersByTeam,
  buildStandings, buildRoundResult, sizeParam
} from '../src/lib/live.js';

const NOW = Date.parse('2026-10-31T21:00:00+09:00');
const ev = (id, extra = {}) => ({ id, title: id, status: 'fixed', starts_at: '2026-10-31T20:00:00+09:00', format: 'draft', planned_rounds: 4, live_state: 'idle', live_round: null, live_changed_at: null, ...extra });

test('pts: 0.5 단위만 소수점', () => {
  assert.equal(pts(12), '12');
  assert.equal(pts(12.5), '12.5');
  assert.equal(pts(null), '-');
});

test('liveOf: 7단계 전(칸 없음)이나 이상한 값은 꺼짐', () => {
  assert.equal(liveOf({}).state, 'idle');
  assert.equal(liveOf({ live_state: 'boom' }).state, 'idle');
  assert.equal(liveOf({ live_state: 'ended', live_round: 2 }).round, 2);
});

test('pickLiveEvent: 주소로 고른 것 → 방송 중인 것 → 오늘 · 곧 할 것', () => {
  const old = ev('old', { status: 'done', starts_at: '2026-10-24T20:00:00+09:00' });
  const today = ev('today');
  const nextWeek = ev('next', { starts_at: '2026-11-07T20:00:00+09:00' });
  assert.equal(pickLiveEvent([old, today, nextWeek], { now: NOW }).id, 'today');
  const liveOld = { ...old, live_state: 'ended', live_round: 3, live_changed_at: '2026-10-24T23:00:00+09:00' };
  assert.equal(pickLiveEvent([liveOld, today, nextWeek], { now: NOW }).id, 'old');
  assert.equal(pickLiveEvent([liveOld, today], { now: NOW, id: 'today' }).id, 'today');
  assert.equal(pickLiveEvent([liveOld], { now: NOW, id: 'nope' }), null);
  assert.equal(pickLiveEvent([old], { now: NOW }), null);
});

test('nextRoundNo: 올라온 라운드 · 방금 끝난 라운드 다음 번호', () => {
  const rounds = [{ event_id: 'a', round_no: 1 }, { event_id: 'a', round_no: 2 }, { event_id: 'b', round_no: 7 }, { event_id: null, round_no: 0 }];
  assert.equal(nextRoundNo(ev('a'), rounds), 3);
  assert.equal(nextRoundNo(ev('a', { live_state: 'playing', live_round: 3 }), rounds), 3, '진행 중이면 지금 라운드');
  assert.equal(nextRoundNo(ev('a', { live_state: 'ended', live_round: 3 }), rounds), 4, '결과가 미지정으로 올라왔어도 다음 번호');
  assert.equal(nextRoundNo(ev('c'), rounds), 1);
});

test('liveLabel · liveAction', () => {
  assert.equal(liveLabel(ev('a', { live_state: 'playing', live_round: 4 })), '4라운드 시작');
  assert.equal(liveLabel(ev('a', { live_state: 'ended', live_round: 3 })), '3라운드 끝');
  assert.equal(liveLabel(ev('a')), '');
  assert.deepEqual(liveAction(ev('a'), 'start', 1), { state: 'playing', round: 1 });
  assert.deepEqual(liveAction(ev('a', { live_state: 'playing', live_round: 2 }), 'end', 9), { state: 'ended', round: 2 });
  assert.deepEqual(liveAction(ev('a', { live_state: 'playing', live_round: 2 }), 'cancel'), { state: 'ended', round: 1 });
  assert.deepEqual(liveAction(ev('a', { live_state: 'playing', live_round: 1 }), 'cancel'), { state: 'idle', round: null });
  assert.deepEqual(liveAction(ev('a', { live_state: 'ended', live_round: 4 }), 'off'), { state: 'idle', round: null });
  assert.throws(() => liveAction(ev('a'), 'boom'));
});

const players = new Map([
  ['p1', { name: '새벽사냥꾼', tier: 1 }], ['p2', { name: '보급상자', tier: 2 }], ['p3', { name: '학교종소리', tier: 3 }],
  ['p4', { name: '루미아토박이', tier: 1 }], ['p5', { name: '금지구역탈출', tier: 2 }], ['p6', { name: '성당종지기', tier: 3 }]
]);
const names = new Map([...players].map(([id, p]) => [id, p.name]));
const evTeams = [
  { team_no: 1, player_id: 'p3', slot_tier: 3 }, { team_no: 1, player_id: 'p1', slot_tier: 1 }, { team_no: 1, player_id: 'p2', slot_tier: 2 },
  { team_no: 2, player_id: 'p4', slot_tier: 1 }, { team_no: 2, player_id: 'p5', slot_tier: 2 }, { team_no: 2, player_id: 'p6', slot_tier: 3 }
];

test('teamLabeler: 드래프트는 팀장 이름, 자동 편성은 팀 N', () => {
  assert.equal(teamLabeler(ev('a'), evTeams, names)(1), '새벽사냥꾼 팀');
  assert.equal(teamLabeler(ev('a', { format: 'auto' }), evTeams, names)(1), '팀 1');
  assert.equal(teamLabeler(ev('a'), [], names)(3), '팀 3');
});

test('membersByTeam: 팀 편성 우선, 없으면 결과 기록 (티어 순)', () => {
  const m = membersByTeam(evTeams, [], players);
  assert.deepEqual(m.get(1).map((x) => x.name), ['새벽사냥꾼', '보급상자', '학교종소리']);
  const fromRounds = membersByTeam([], [{ team_no: 5, player_id: 'p2', csv_nickname: 'x' }, { team_no: 5, player_id: null, csv_nickname: '손님' }, { team_no: 5, player_id: 'p2', csv_nickname: 'x' }], players);
  assert.deepEqual(fromRounds.get(5).map((x) => x.name), ['보급상자', '손님']);
});

// 2팀 · 2라운드 (킬 점수까지 같으면 같은 순위)
const scores = [
  { round_id: 'r1', round_no: 1, team_no: 1, team_rank: 1, team_kills: 9, rs: 10, ks: 6, pen: 0, total: 16 },
  { round_id: 'r1', round_no: 1, team_no: 2, team_rank: 2, team_kills: 12, rs: 7, ks: 8.5, pen: 1, total: 14.5 },
  { round_id: 'r2', round_no: 2, team_no: 1, team_rank: 2, team_kills: 3, rs: 7, ks: 3, pen: 0, total: 10 },
  { round_id: 'r2', round_no: 2, team_no: 2, team_rank: 1, team_kills: 5, rs: 10, ks: 4.5, pen: 0, total: 14.5 }
];

test('buildStandings: 누적 순위 · 라운드 칸은 계획한 라운드 수만큼', () => {
  const s = buildStandings({ event: ev('a'), scores, members: membersByTeam(evTeams, [], players), label: teamLabeler(ev('a'), evTeams, names) });
  assert.deepEqual(s.cols, [1, 2, 3, 4]);
  assert.equal(s.played, 2);
  assert.deepEqual(s.rows.map((r) => [r.rank, r.name, r.total]), [[1, '루미아토박이 팀', 29], [2, '새벽사냥꾼 팀', 26]]);
  assert.deepEqual(s.rows[0].rounds, [14.5, 14.5, null, null]);
  const tie = buildStandings({ event: ev('a'), scores: scores.slice(0, 2).map((x) => ({ ...x, total: 10, ks: 2 })) });
  assert.deepEqual(tie.rows.map((r) => r.rank), [1, 1]);
  const empty = buildStandings({ event: ev('a'), scores: [], members: membersByTeam(evTeams, [], players) });
  assert.deepEqual(empty.rows.map((r) => r.total), [0, 0], '첫 판 전에도 팀은 보여요');
});

test('buildRoundResult: 그 라운드 순위 + 그때까지 누적', () => {
  const r1 = buildRoundResult({ scores, roundNo: 1 });
  assert.deepEqual(r1.rows.map((r) => [r.rank, r.teamNo, r.cumTotal, r.cumRank]), [[1, 1, 16, 1], [2, 2, 14.5, 2]]);
  assert.equal(r1.leader.teamNo, 1);
  const r2 = buildRoundResult({ scores, roundNo: 2 });
  assert.deepEqual(r2.rows.map((r) => [r.rank, r.teamNo, r.cumTotal, r.cumRank]), [[1, 2, 29, 1], [2, 1, 26, 2]]);
  assert.equal(buildRoundResult({ scores, roundNo: 3 }), null);
});

test('sizeParam: 40~150% 사이로', () => {
  assert.equal(sizeParam('60'), 0.6);
  assert.equal(sizeParam('10'), 0.4);
  assert.equal(sizeParam('abc'), 1);
  assert.equal(sizeParam(null), 1);
});
