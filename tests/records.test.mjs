import test from 'node:test';
import assert from 'node:assert/strict';
import {
  visibility, DEFAULT_SETTINGS, withEpisodes, eventFinished, episodeResults, playerRecords, leaders, winRanking, withGap, rankOrder, eventName
} from '../src/lib/records.js';

const H = 3600000;
const T0 = Date.parse('2026-10-17T11:00:00Z');

test('공개 설정: 기본은 비공개 · 전체 스위치 · 항목별 · 대시보드 · 미리보기', () => {
  const off = visibility(DEFAULT_SETTINGS);
  assert.equal(off.any, false);
  assert.equal(off.results || off.hall || off.personal || off.tk || off.mvp, false);
  assert.deepEqual(off.dash, { results: false, hall: false, personal: false });

  const on = visibility({ records_public: true, records_from_episode: 3, records_items: {} });
  assert.equal(on.any, true);
  assert.equal(on.results && on.hall && on.personal && on.tk && on.mvp, true);
  assert.equal(on.from, 3);

  // 항목별: TK 만 끄고, 우승 기록은 대시보드에서만 빼요
  const some = visibility({ records_public: true, records_from_episode: 1, records_items: { tk: { on: false }, hall: { on: true, dash: false } } });
  assert.equal(some.tk, false);
  assert.equal(some.hall, true);
  assert.equal(some.dash.hall, false);
  assert.equal(some.dash.results, true);
  // 꺼진 항목은 대시보드에도 안 떠요
  assert.equal(visibility({ records_public: true, records_items: { personal: { on: false, dash: true } } }).dash.personal, false);
  // 전체 스위치를 끄면 항목 설정과 상관없이 전부 숨김
  assert.equal(visibility({ records_public: false, records_items: { tk: { on: true } } }).tk, false);
  // 관리자 미리보기는 다 보여요
  const pv = visibility(DEFAULT_SETTINGS, { preview: true });
  assert.equal(pv.any && pv.tk && pv.dash.hall, true);
  // 이상한 값
  assert.equal(visibility({ records_public: true, records_from_episode: 0 }).from, 1);
});

test('회차: 비어 있으면 날짜순으로 · 이름', () => {
  const evs = withEpisodes([{ id: 'b', starts_at: '2026-10-24T11:00:00Z' }, { id: 'a', starts_at: '2026-10-17T11:00:00Z' }]);
  assert.deepEqual(evs.map((e) => [e.id, e.episode]), [['b', 2], ['a', 1]]);
  const kept = [{ id: 'x', episode: 7, starts_at: '2026-10-17T11:00:00Z' }];
  assert.equal(withEpisodes(kept), kept);
  assert.equal(eventName({ episode: 12, title: '10월 17일 내전' }), '12회차 · 10월 17일 내전');
  assert.equal(eventName({ title: '이름만' }), '이름만');
});

test('회차가 끝났는지', () => {
  const ev = { status: 'fixed', planned_rounds: 4, starts_at: new Date(T0).toISOString() };
  assert.equal(eventFinished(ev, 0, T0 + 20 * H), false, '확정된 판이 없으면 안 끝났어요');
  assert.equal(eventFinished(ev, 2, T0 + H), false);
  assert.equal(eventFinished(ev, 4, T0 + H), true, '예정 라운드를 다 했어요');
  assert.equal(eventFinished(ev, 2, T0 + 13 * H), true, '12시간이 지났어요');
  assert.equal(eventFinished({ ...ev, status: 'done' }, 1, T0), true);
});

// 3회차: 1회차(끝) · 2회차(끝, 공동 1위) · 3회차(진행 중)
const events = [
  { id: 'E1', episode: 1, title: '1회', status: 'done', planned_rounds: 2, starts_at: new Date(T0).toISOString() },
  { id: 'E2', episode: 2, title: '2회', status: 'done', planned_rounds: 2, starts_at: new Date(T0 + 7 * 24 * H).toISOString() },
  { id: 'E3', episode: 3, title: '3회', status: 'fixed', planned_rounds: 4, starts_at: new Date(T0 + 14 * 24 * H).toISOString() }
];
const standings = [
  { event_id: 'E1', team_no: 1, standing: 1, total: 30, rs: 20, ks: 10, pen: 0, rounds: 2 },
  { event_id: 'E1', team_no: 2, standing: 2, total: 20, rs: 14, ks: 6, pen: 0, rounds: 2 },
  { event_id: 'E2', team_no: 1, standing: 1, total: 25, rs: 17, ks: 8, pen: 0, rounds: 2 },
  { event_id: 'E2', team_no: 2, standing: 1, total: 25, rs: 17, ks: 8, pen: 0, rounds: 2 },
  { event_id: 'E3', team_no: 1, standing: 2, total: 5, rs: 4, ks: 1, pen: 0, rounds: 1 },
  { event_id: 'E3', team_no: 2, standing: 1, total: 12, rs: 10, ks: 2, pen: 0, rounds: 1 }
];
const pr = (event_id, round_no, player_id, team_no, team_rank, team_kills, total) => ({ event_id, round_no, player_id, csv_nickname: player_id || 'guest', team_no, team_rank, team_kills, total });
const prounds = [
  pr('E1', 1, 'A', 1, 1, 6, 16), pr('E1', 1, 'B', 1, 1, 6, 16), pr('E1', 1, 'C', 2, 2, 3, 10), pr('E1', 1, null, 2, 2, 3, 10),
  pr('E1', 2, 'A', 1, 2, 4, 14), pr('E1', 2, 'B', 1, 2, 4, 14), pr('E1', 2, 'C', 2, 1, 3, 10), pr('E1', 2, null, 2, 1, 3, 10),
  pr('E2', 1, 'A', 2, 1, 5, 13), pr('E2', 1, 'C', 1, 2, 4, 12),
  pr('E3', 1, 'A', 1, 2, 1, 5), pr('E3', 1, 'C', 2, 1, 2, 12)
];
const names = { A: '에이', B: '비', C: '씨' };

test('회차별 결과: 새 회차부터 · 우승 팀 · 팀원 · 끝났는지', () => {
  const res = episodeResults({ events, standings, prounds, nameOf: (id) => names[id], now: T0 + 14 * 24 * H + H });
  assert.deepEqual(res.map((r) => [r.episode, r.finished]), [[3, false], [2, true], [1, true]]);
  const e1 = res.find((r) => r.episode === 1);
  assert.deepEqual(e1.winners.map((w) => w.team_no), [1]);
  assert.deepEqual(e1.teams[0].members.map((m) => m.name), ['에이', '비']);
  assert.deepEqual(e1.teams[1].members.map((m) => m.name), ['씨', 'guest'], '선수로 연결 안 된 닉네임도 팀원으로');
  assert.equal(res.find((r) => r.episode === 2).winners.length, 2, '공동 1위는 둘 다 우승');
});

test('개인 기록: 끝난 회차만 우승 · 출전 · 평균 순위, 판 기록은 확정된 판 전부', () => {
  const res = episodeResults({ events, standings, prounds, now: T0 + 14 * 24 * H + H });
  const mvpRounds = [{ event_id: 'E1', mvp_player_id: 'A' }, { event_id: 'E2', mvp_player_id: 'A' }, { event_id: 'E3', mvp_player_id: 'C' }];
  const recs = playerRecords({ results: res, prounds, mvpRounds, from: 1 });
  const A = recs.get('A'), B = recs.get('B'), C = recs.get('C');
  assert.deepEqual([A.episodes, A.wins, A.avgStanding], [2, 2, 1]);
  assert.deepEqual([B.episodes, B.wins, B.avgStanding], [1, 1, 1]);
  assert.deepEqual([C.episodes, C.wins, C.avgStanding], [2, 1, 1.5], '2회차 공동 1위는 우승 · 진행 중인 3회차(지금 1위)는 아직 안 세요');
  assert.equal(A.roundGames, 4);
  assert.equal(A.roundWins, 2);
  assert.equal(A.avgTk, (6 + 4 + 5 + 1) / 4);
  assert.equal(A.mvp, 2);
  assert.equal(C.mvp, 1);
  assert.deepEqual(A.history.map((h) => [h.episode, h.standing]), [[2, 1], [1, 1]]);
  assert.deepEqual(A.history[1].mates.map((m) => m.id), ['B']);
  assert.equal(recs.has(null), false, '선수로 연결 안 된 닉네임은 개인 기록이 없어요');

  // 2회차부터 세면 1회차는 빠져요
  const from2 = playerRecords({ results: res, prounds, mvpRounds, from: 2 });
  assert.deepEqual([from2.get('A').episodes, from2.get('A').wins, from2.get('A').mvp, from2.get('A').roundGames], [1, 1, 1, 2]);
  assert.equal(from2.get('B'), undefined);

  // 랭킹 · 대시보드 카드
  const order = [...recs.values()].sort(rankOrder).map((r) => r.id);
  assert.deepEqual(order, ['A', 'B', 'C']);
  const L = leaders(recs, { minGames: 2 });
  assert.equal(L.mostWins.id, 'A');
  assert.equal(L.mostGames.id, 'A');
  assert.equal(L.bestAvg.id, 'A');
  assert.equal(leaders(recs, { minGames: 3 }).bestAvg, null, '3회차 이상 뛴 사람이 없으면 비워요');
  assert.deepEqual(winRanking(recs).map((r) => [r.id, r.rank]), [['A', 1], ['C', 2], ['B', 2]]);
});

test('최다 우승 순위: 같은 횟수는 같은 순위', () => {
  const recs = new Map([['A', { id: 'A', wins: 3, episodes: 5 }], ['B', { id: 'B', wins: 3, episodes: 4 }], ['C', { id: 'C', wins: 1, episodes: 9 }], ['D', { id: 'D', wins: 0, episodes: 9 }]]);
  assert.deepEqual(winRanking(recs).map((r) => [r.id, r.rank]), [['A', 1], ['B', 1], ['C', 3]]);
});

test('실시간 팀 순위: 1위와의 점수 차', () => {
  const g = withGap([{ team_no: 2, standing: 2, total: 9 }, { team_no: 1, standing: 1, total: 15 }, { team_no: 3, standing: 2, total: 9 }]);
  assert.deepEqual(g.map((t) => [t.team_no, t.gap]), [[1, null], [2, 6], [3, 6]]);
});
