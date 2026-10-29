import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreTable, teamPlan, emptyTeams, teamStats, balance, poolFrom, signature,
  draftSequence, draftTeams, captainOrderFromPrev
} from '../src/lib/balance.js';

// 늘 같은 결과가 나오는 난수
const seeded = (seed = 7) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

const P = (id, tier, score) => ({ id, tier, score });
const players12 = [
  P('a1', 1, 7200), P('a2', 1, 6900), P('a3', 1, 6400), P('a4', 1, 6100),
  P('b1', 2, 5600), P('b2', 2, 5200), P('b3', 2, 4700), P('b4', 2, 4300),
  P('c1', 3, 3900), P('c2', 3, 3300), P('c3', 3, 2800), P('c4', 3, 2500)
];
const valueOf = (list) => { const t = scoreTable(list); return (id) => t.get(id).value; };

function permutations(a) {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}
/** 가능한 배치를 전부 계산한 가장 작은 분산 (팀장은 고정, 2 · 3티어는 구분 없이 남은 자리에) */
function bruteBest(fixed, pool, value) {
  let best = Infinity;
  const free = fixed.flatMap((t, i) => [2, 3].filter((k) => !t[k]).map((k) => [i, k]));
  for (const perm of permutations(pool.rest)) {
    const teams = fixed.map((t) => ({ ...t }));
    free.forEach(([i, k], n) => { teams[i][k] = perm[n]; });
    best = Math.min(best, teamStats(teams, value).variance);
  }
  return best;
}

test('점수 없는 선수는 같은 티어 평균으로', () => {
  const t = scoreTable([P('x', 2, 5000), P('y', 2, 4000), P('z', 2, null), P('w', 3, undefined)]);
  assert.deepEqual(t.get('z'), { value: 4500, estimated: true });
  assert.deepEqual(t.get('x'), { value: 5000, estimated: false });
  assert.equal(t.get('w').value, 4500);   // 3티어에 아는 점수가 없으면 전체 평균
});

test('팀 계획: 1티어 수 = 팀 수, 2 · 3티어는 합쳐서 두 배면 돼요', () => {
  assert.deepEqual(teamPlan(players12).teams, 4);
  assert.equal(teamPlan(players12).ok, true);
  // 2티어 5명 · 3티어 3명이어도 합쳐서 8명이면 4팀
  const mixed = teamPlan([...players12.slice(0, 8), P('b5', 2, 4000), ...players12.slice(8, 11)]);
  assert.equal(mixed.ok, true);
  assert.deepEqual([mixed.teams, mixed.rest, mixed.count[2], mixed.count[3]], [4, 8, 5, 3]);
  const bad = teamPlan([...players12.slice(0, 11)]);
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(' '), /2 · 3티어가 합쳐서 7명이에요\. 1티어\(4명\)의 두 배인 8명/);
  assert.equal(teamPlan([]).ok, false);
});

test('자동 편성: 2 · 3티어 구분 없이 가능한 배치 중 가장 고른 것을 찾아요', () => {
  const value = valueOf(players12);
  const fixed = emptyTeams(4);
  ['a1', 'a2', 'a3', 'a4'].forEach((id, i) => { fixed[i][1] = id; });   // 1티어는 팀마다 고정
  const pool = poolFrom(players12, fixed);
  assert.deepEqual([pool[1].length, pool.rest.length], [0, 8]);
  const r = balance({ fixed, pool, value, rng: seeded() });
  assert.ok(Math.abs(r.stats.variance - bruteBest(fixed, pool, value)) < 1e-6, `분산 ${r.stats.variance} vs 최선 ${bruteBest(fixed, pool, value)}`);
  for (const team of r.teams) assert.ok(team[1] && team[2] && team[3]);
  for (const team of r.teams) assert.ok(team[1].startsWith('a') && !team[2].startsWith('a') && !team[3].startsWith('a'), '팀장 자리는 1티어만');
});

test('자동 편성: 한 팀에 2티어 둘 · 3티어 둘도 돼요 (점수가 더 고르면)', () => {
  // 팀장 점수 차이가 커서, 약한 팀장에게 2티어 두 명을 붙여야 고르게 돼요
  const list = [P('k1', 1, 9000), P('k2', 1, 3000), P('x1', 2, 6000), P('x2', 2, 6000), P('y1', 3, 1000), P('y2', 3, 1000)];
  const value = valueOf(list);
  const fixed = emptyTeams(2);
  fixed[0][1] = 'k1'; fixed[1][1] = 'k2';
  const r = balance({ fixed, pool: poolFrom(list, fixed), value, rng: seeded(5) });
  assert.deepEqual(r.stats.sums.slice().sort(), [11000, 15000].sort(), '9000+1000+1000 vs 3000+6000+6000');
  assert.deepEqual([r.teams[1][2], r.teams[1][3]].sort(), ['x1', 'x2']);
});

test('자동 편성: 1티어까지 섞어도 최선 · 잠근 선수는 그 자리 그대로', () => {
  const value = valueOf(players12);
  const fixed = emptyTeams(4);
  fixed[2][2] = 'b1';   // 잠금: 3번 팀의 한 자리는 b1
  fixed[0][1] = 'a4';   // 잠금: 1번 팀의 1티어는 a4
  const r = balance({ fixed, pool: poolFrom(players12, fixed), value, rng: seeded(3) });
  assert.equal(r.teams[2][2], 'b1');
  assert.equal(r.teams[0][1], 'a4');
  const all = r.teams.flatMap((t) => [t[1], t[2], t[3]]);
  assert.equal(new Set(all).size, 12);
});

test('다시 돌리기: 거의 똑같이 좋은 다른 배치를 골라요', () => {
  const value = () => 1000;   // 모두 같은 점수 → 어떤 배치든 똑같이 좋아요
  const fixed = emptyTeams(4);
  const first = balance({ fixed, pool: poolFrom(players12, fixed), value, rng: seeded(1) }).teams;
  const again = balance({ fixed, pool: poolFrom(players12, fixed), value, rng: seeded(2), shuffleGood: true, avoid: first });
  assert.notEqual(signature(again.teams), signature(first));
  assert.ok(again.options > 1);
});

test('드래프트 순서: 첫 바퀴는 팀장 순서대로, 둘째 바퀴는 거꾸로 (티어 구분 없이)', () => {
  const seq = draftSequence(['k1', 'k2', 'k3']);
  assert.deepEqual(seq.map((s) => `${s.captain}:${s.round}`), ['k1:1', 'k2:1', 'k3:1', 'k3:2', 'k2:2', 'k1:2']);
  assert.ok(seq.every((s) => !('tier' in s)));
  // 3번 팀장이 첫 바퀴에 3티어(c1), 1번 팀장이 2티어 둘을 뽑아도 돼요
  const teams = draftTeams(['k1', 'k2', 'k3'], [
    { player_id: 'b1', team_no: 1, slot_tier: 2, pick_no: 1 }, { player_id: 'c1', team_no: 3, slot_tier: 3, pick_no: 3 },
    { player_id: 'b2', team_no: 1, slot_tier: 2, pick_no: 6 }
  ]);
  assert.deepEqual(teams, [{ 1: 'k1', 2: 'b1', 3: 'b2' }, { 1: 'k2', 2: null, 3: null }, { 1: 'k3', 2: 'c1', 3: null }]);
});

test('팀장 순서: 지난 내전 꼴찌 팀 팀장부터, 기록 없으면 뒤로', () => {
  const prev = new Map([['k1', 1], ['k2', 4], ['k3', 2]]);
  assert.deepEqual(captainOrderFromPrev(['k1', 'k2', 'k3', 'new'], prev), ['k2', 'k3', 'k1', 'new']);
  assert.deepEqual(captainOrderFromPrev(['x', 'y'], new Map()), ['x', 'y']);
});
