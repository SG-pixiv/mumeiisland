import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreTable, teamPlan, emptyTeams, teamStats, balance, poolFrom, signature,
  draftSequence, draftTeams, recommendPicks, autoFillDraft, captainOrderFromPrev
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
/** 가능한 배치를 전부 계산한 가장 작은 분산 */
function bruteBest(fixed, pool, value) {
  let best = Infinity;
  const free = (t) => fixed.map((x, i) => (x[t] ? -1 : i)).filter((i) => i >= 0);
  for (const p2 of permutations(pool[2])) for (const p3 of permutations(pool[3])) {
    const teams = fixed.map((t) => ({ ...t }));
    free(2).forEach((i, k) => { teams[i][2] = p2[k]; });
    free(3).forEach((i, k) => { teams[i][3] = p3[k]; });
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

test('팀 계획: 티어 인원이 맞아야 해요', () => {
  assert.deepEqual(teamPlan(players12).teams, 4);
  assert.equal(teamPlan(players12).ok, true);
  const bad = teamPlan([...players12.slice(0, 4), ...players12.slice(4, 8), P('b5', 2, 4000), ...players12.slice(8, 11)]);
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(' '), /2티어가 5명/);
  assert.match(bad.problems.join(' '), /3티어가 3명/);
  assert.equal(teamPlan([]).ok, false);
});

test('자동 편성: 가능한 배치 중 가장 고른 것을 찾아요', () => {
  const value = valueOf(players12);
  const fixed = emptyTeams(4);
  ['a1', 'a2', 'a3', 'a4'].forEach((id, i) => { fixed[i][1] = id; });   // 1티어는 팀마다 고정
  const pool = poolFrom(players12, fixed);
  const r = balance({ fixed, pool, value, rng: seeded() });
  assert.ok(Math.abs(r.stats.variance - bruteBest(fixed, pool, value)) < 1e-6, `분산 ${r.stats.variance} vs 최선 ${bruteBest(fixed, pool, value)}`);
  for (const team of r.teams) assert.ok(team[1] && team[2] && team[3]);
});

test('자동 편성: 1티어까지 섞어도 최선 · 잠근 선수는 그 자리 그대로', () => {
  const value = valueOf(players12);
  const fixed = emptyTeams(4);
  fixed[2][2] = 'b1';   // 잠금: 3번 팀의 2티어는 b1
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

test('드래프트 순서: 2티어는 팀장 순서대로, 3티어는 거꾸로', () => {
  const seq = draftSequence(['k1', 'k2', 'k3']);
  assert.deepEqual(seq.map((s) => `${s.captain}:${s.tier}`), ['k1:2', 'k2:2', 'k3:2', 'k3:3', 'k2:3', 'k1:3']);
  const teams = draftTeams(['k1', 'k2', 'k3'], [{ player_id: 'b1', team_no: 1, slot_tier: 2 }, { player_id: 'c1', team_no: 3, slot_tier: 3 }]);
  assert.deepEqual(teams, [{ 1: 'k1', 2: 'b1', 3: null }, { 1: 'k2', 2: null, 3: null }, { 1: 'k3', 2: null, 3: 'c1' }]);
});

test('드래프트 추천 · 남은 지명 자동 채우기', () => {
  const value = valueOf(players12);
  const captains = ['a1', 'a2', 'a3', 'a4'];
  const picks = [{ player_id: 'b4', team_no: 1, slot_tier: 2 }];   // 1번 팀장이 2티어 b4 를 이미 뽑았어요
  const fixed = draftTeams(captains, picks);
  const pool = poolFrom(players12, fixed);
  // 다음은 2번 팀장의 2티어 지명: 추천 1순위를 넣었을 때가 다른 후보보다 나빠지면 안 돼요
  const rec = recommendPicks({ fixed, pool, value, team: 1, tier: 2, rng: seeded(5) });
  assert.equal(rec.length, 3);
  for (const r of rec) {
    const f = fixed.map((t) => ({ ...t })); f[1][2] = r.id;
    const best = bruteBest(f, { 1: [], 2: pool[2].filter((x) => x !== r.id), 3: pool[3] }, value);
    assert.ok(Math.abs(r.variance - best) < 1e-6);
  }
  assert.ok(rec[0].variance <= rec[rec.length - 1].variance);

  const fill = autoFillDraft({ captains, picks, pool, value, rng: seeded(9) });
  assert.equal(fill.length, 7);                        // 8번 지명 중 1번은 이미 했어요
  assert.deepEqual(fill.map((f) => f.step), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(new Set(fill.map((f) => f.id)).size, 7);
  assert.ok(fill.every((f) => (f.tier === 2 ? pool[2] : pool[3]).includes(f.id)));
});

test('팀장 순서: 지난 내전 꼴찌 팀 팀장부터, 기록 없으면 뒤로', () => {
  const prev = new Map([['k1', 1], ['k2', 4], ['k3', 2]]);
  assert.deepEqual(captainOrderFromPrev(['k1', 'k2', 'k3', 'new'], prev), ['k2', 'k3', 'k1', 'new']);
  assert.deepEqual(captainOrderFromPrev(['x', 'y'], new Map()), ['x', 'y']);
});
