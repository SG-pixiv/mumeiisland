// 팀 편성 밸런스 계산 · 드래프트 순서 (관리자 화면 · 테스트가 같이 써요)
//
// 한 팀 = 1 · 2 · 3티어 한 명씩. 팀 점수 = 세 명의 솔로 랭크 점수 합.
// 팀 점수가 고르게(분산이 가장 작게) 되도록 빈자리를 채워요. 이미 정해진 자리(잠금 · 지명)는 건드리지 않아요.
// 팀 배치는 [{ 1: id, 2: id, 3: id }, …] 모양이고 빈자리는 null 이에요. 배열 순서 = 팀 번호 - 1.

export const TIERS = [1, 2, 3];
export const MAX_TEAMS = 8;

const avg = (list) => (list.length ? list.reduce((s, x) => s + x, 0) / list.length : null);

/**
 * 점수 없는 선수는 같은 티어 평균(없으면 전체 평균)으로 채워요
 * players: [{ id, tier, score }] → Map(id → { value, estimated })
 */
export function scoreTable(players) {
  const known = players.filter((p) => Number.isFinite(p.score));
  const all = avg(known.map((p) => p.score)) ?? 0;
  const byTier = {};
  for (const t of TIERS) byTier[t] = avg(known.filter((p) => p.tier === t).map((p) => p.score)) ?? all;
  return new Map(players.map((p) => [p.id, Number.isFinite(p.score)
    ? { value: p.score, estimated: false }
    : { value: Math.round(byTier[p.tier] ?? all), estimated: true }]));
}

/** 티어별 인원 → 몇 팀을 만들 수 있는지와 문제 */
export function teamPlan(players) {
  const count = { 1: 0, 2: 0, 3: 0 };
  players.forEach((p) => { if (count[p.tier] !== undefined) count[p.tier]++; });
  const n = count[1];
  const problems = [];
  if (!n) problems.push('1티어(팀장)가 한 명도 없어요');
  for (const t of [2, 3]) if (n && count[t] !== n) problems.push(`${t}티어가 ${count[t]}명이에요. 1티어(${n}명)와 같아야 ${n}팀이 돼요`);
  if (n > MAX_TEAMS) problems.push(`팀은 ${MAX_TEAMS}개(24명)까지예요`);
  return { teams: n, count, ok: problems.length === 0, problems };
}

export const emptyTeams = (n) => Array.from({ length: n }, () => ({ 1: null, 2: null, 3: null }));
const cloneTeams = (teams) => teams.map((t) => ({ 1: t[1], 2: t[2], 3: t[3] }));

/** 팀 배치 → 팀별 점수 · 평균 · 최대 차이 · 분산 */
export function teamStats(teams, value) {
  const sums = teams.map((t) => TIERS.reduce((s, tier) => s + (t[tier] ? value(t[tier]) : 0), 0));
  const mean = avg(sums) ?? 0;
  return {
    sums, mean,
    spread: sums.length ? Math.max(...sums) - Math.min(...sums) : 0,
    variance: sums.length ? sums.reduce((s, x) => s + (x - mean) ** 2, 0) / sums.length : 0
  };
}

export const signature = (teams) => teams.map((t) => TIERS.map((k) => t[k] ?? '-').join(',')).join('|');

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** 한 번: 빈자리에 무작위로 넣고, 같은 티어끼리 맞바꿔서 더 고르게 될 때까지 */
function localSearch(fixed, pool, value, rng) {
  const teams = cloneTeams(fixed);
  const free = {};
  for (const t of TIERS) {
    free[t] = teams.map((team, i) => (team[t] ? -1 : i)).filter((i) => i >= 0);
    shuffle(pool[t] || [], rng).forEach((id, k) => { if (k < free[t].length) teams[free[t][k]][t] = id; });
  }
  const sums = teams.map((t) => TIERS.reduce((s, tier) => s + (t[tier] ? value(t[tier]) : 0), 0));
  for (let guard = 0, improved = true; improved && guard < 200; guard++) {
    improved = false;
    for (const t of TIERS) {
      const f = free[t];
      for (let x = 0; x < f.length; x++) {
        for (let y = x + 1; y < f.length; y++) {
          const i = f[x], j = f[y];
          const a = teams[i][t] ? value(teams[i][t]) : 0, b = teams[j][t] ? value(teams[j][t]) : 0;
          if (a === b) continue;
          const si = sums[i] - a + b, sj = sums[j] - b + a;
          if (si * si + sj * sj < sums[i] * sums[i] + sums[j] * sums[j] - 1e-9) {
            [teams[i][t], teams[j][t]] = [teams[j][t], teams[i][t]];
            sums[i] = si; sums[j] = sj; improved = true;
          }
        }
      }
    }
  }
  return teams;
}

/**
 * 빈자리를 채워서 팀 점수를 고르게 해요
 *   fixed: 정해진 자리(잠금 · 지명) — 빈자리는 null
 *   pool: { 1: [id], 2: [id], 3: [id] } — 남은 선수 (티어별 빈자리 수만큼)
 *   value: id → 점수
 *   shuffleGood: true 면 거의 똑같이 좋은 배치 중 하나를 무작위로 (다시 돌리기용). avoid 배치는 되도록 피해요
 * → { teams, stats, options } (options = 찾은 좋은 배치 수)
 */
export function balance({ fixed, pool, value, restarts = 80, rng = Math.random, shuffleGood = false, avoid = null }) {
  const seen = new Map();
  for (let r = 0; r < restarts; r++) {
    const teams = localSearch(fixed, pool, value, rng);
    const sig = signature(teams);
    if (!seen.has(sig)) seen.set(sig, { teams, stats: teamStats(teams, value) });
  }
  const list = [...seen.values()].sort((a, b) => a.stats.variance - b.stats.variance);
  const best = list[0];
  if (!best) return { teams: cloneTeams(fixed), stats: teamStats(fixed, value), options: 0 };
  // 가장 좋은 배치와 최대 차이가 거의 같은 것(평균 팀 점수의 1.5% 또는 30점 안)은 다 "좋은 배치"로 봐요
  const slack = Math.max(30, Math.abs(best.stats.mean) * 0.015);
  const good = list.filter((x) => x.stats.spread <= best.stats.spread + slack);
  if (!shuffleGood) return { ...best, options: good.length };
  const avoidSig = avoid ? signature(avoid) : null;
  const pickFrom = good.length > 1 ? good.filter((x) => signature(x.teams) !== avoidSig) : good;
  const pick = pickFrom[Math.floor(rng() * pickFrom.length)] ?? best;
  return { ...pick, options: good.length };
}

/** 참가자 → 티어별 남은 선수 (fixed 에 이미 있는 사람은 빼요) */
export function poolFrom(players, fixed) {
  const placed = new Set(fixed.flatMap((t) => TIERS.map((k) => t[k]).filter(Boolean)));
  const pool = { 1: [], 2: [], 3: [] };
  players.forEach((p) => { if (!placed.has(p.id) && pool[p.tier]) pool[p.tier].push(p.id); });
  return pool;
}

// ── 드래프트

/** 지명 순서: 2티어는 팀장 순서대로(지난 내전 꼴찌 팀장부터), 3티어는 거꾸로(1등 팀장부터) */
export function draftSequence(captains) {
  return [...captains.map((c, i) => ({ captain: c, team: i, tier: 2 })), ...captains.map((c, i) => ({ captain: c, team: i, tier: 3 })).reverse()];
}

/** 팀장 순서 + 지금까지 지명([{ player_id, team_no, slot_tier }]) → 팀 배치 */
export function draftTeams(captains, picks) {
  const teams = captains.map((c) => ({ 1: c, 2: null, 3: null }));
  picks.forEach((p) => { const t = teams[p.team_no - 1]; if (t && (p.slot_tier === 2 || p.slot_tier === 3)) t[p.slot_tier] = p.player_id; });
  return teams;
}

/**
 * 지난 내전 순위로 팀장 순서: 꼴찌 팀에 있던 팀장이 먼저 (2티어 지명 순서)
 *   prevStanding: Map(선수 id → 지난 내전 팀 순위)  · 기록 없는 팀장은 원래 순서대로 맨 뒤
 */
export function captainOrderFromPrev(captains, prevStanding) {
  return captains.map((id, i) => ({ id, i, s: prevStanding.get(id) }))
    .sort((a, b) => (a.s == null) - (b.s == null) || (b.s ?? 0) - (a.s ?? 0) || a.i - b.i)
    .map((x) => x.id);
}
