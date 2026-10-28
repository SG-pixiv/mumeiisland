// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGameResult, teamScore, splitCsvLine, normName } from '../supabase/functions/_shared/game-result.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const RULES = { placement: [10, 7, 5, 4, 3, 2, 1, 0], ks_early: 0.5, ks_late: 1, penalty: 1 };

test('대회 점수 켠 판: 게임 점수와 무명섬 계산이 8팀 모두 같아요', () => {
  const r = parseGameResult(fx('bots-scoring.csv'));
  assert.equal(r.ok, true);
  assert.equal(r.gameId, 67053703);
  assert.equal(r.scoringOn, true);
  assert.equal(r.rows.length, 24);
  assert.equal(r.teams.length, 8);
  assert.deepEqual(r.teams.map((t) => t.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const t of r.teams) {
    assert.equal(t.earlySource, 'tournament', t.key);
    const s = teamScore({ rank: t.rank, teamKills: t.totalFieldKill, earlyKills: t.earlyKills, penalties: 0 }, RULES);
    assert.equal(s.rs, t.tournament.rank, `${t.key} RS`);
    assert.equal(s.ks, t.tournament.kill, `${t.key} KS`);
    assert.equal(s.total, t.tournament.total, `${t.key} total`);
  }
  const t1 = r.teams[0];
  assert.equal(t1.key, 'Team 1');
  assert.equal(t1.totalFieldKill, 28);
  assert.equal(t1.earlyKills, 8);
  assert.equal(t1.earlyKills, t1.downNoElim);
});

test('처치자 불명: 야생동물(WildDog)에게 죽은 선수만 후보로 잡혀요', () => {
  const r = parseGameResult(fx('bots-scoring.csv'));
  const all = r.teams.flatMap((t) => t.unknownDeaths.map((d) => ({ team: t.key, ...d })));
  assert.deepEqual(all, [{ team: 'Team 2', nickname: 'Bernice bot 3', killer: 'WildDog' }]);
  const r2 = parseGameResult(fx('bots-no-scoring.csv'));
  const all2 = r2.teams.flatMap((t) => t.unknownDeaths.map((d) => d.killer));
  assert.deepEqual(all2, ['Chicken']);
});

test('대회 점수 끈 판: 0.5점 킬은 down can not eliminate 값을 써요', () => {
  const r = parseGameResult(fx('bots-no-scoring.csv'));
  assert.equal(r.scoringOn, false);
  assert.equal(r.gameId, 67048983);
  const t1 = r.teams[0];
  assert.equal(t1.tournament, null);
  assert.equal(t1.earlySource, 'down');
  assert.equal(t1.earlyKills, 6);
  assert.equal(t1.totalFieldKill, 24);
  assert.equal(teamScore({ rank: 1, teamKills: 24, earlyKills: 6, penalties: 1 }, RULES).total, 10 + 3 + 18 - 1);
});

test('봇과 사람을 구분해요', () => {
  const r = parseGameResult(fx('bots-scoring.csv'));
  const humans = r.rows.filter((x) => !x.isBot).map((x) => x.nickname);
  assert.deepEqual(humans, ['테스트유저']);
  assert.equal(r.hasBots, true);
  assert.equal(r.teams.find((t) => t.key === 'Team 1').allBots, false);
  assert.equal(r.teams.find((t) => t.key === 'Team 8').allBots, true);
  assert.equal(r.rows[0].teamNo, 1);
  assert.equal(r.rows[0].character, 'Shoichi');
});

test('형식이 다르거나 비어 있으면 알려 줘요', () => {
  assert.equal(parseGameResult('').ok, false);
  assert.match(parseGameResult('a,b,c\n1,2,3').error, /형식이 아니에요/);
});

test('CRLF · 따옴표 · 칸 순서가 바뀌어도 읽어요', () => {
  const csv = '﻿nickname, teamName, rank, killer, gameId, kill, "total field kill"\r\n"Kim, Jr", Team 3, 2, WildDog, 123, 2, 2\r\nLee, Team 3, 2, "Kim, Jr", 123, 0, 2\r\n';
  const r = parseGameResult(csv);
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].nickname, 'Kim, Jr');
  assert.equal(r.rows[1].killer, 'Kim, Jr');
  assert.equal(r.teams[0].csvTeamNo, 3);
  assert.deepEqual(r.teams[0].unknownDeaths, [{ nickname: 'Kim, Jr', killer: 'WildDog' }]);
  assert.deepEqual(splitCsvLine('a, "b ""c""", d'), ['a', 'b "c"', 'd']);
});

test('실험체 이름 비교', () => {
  assert.equal(normName('LiDailin'), normName('Li Dailin'));
  assert.equal(normName('István'), 'istvan');
});
