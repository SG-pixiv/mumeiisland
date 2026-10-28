// 이리 동기화: 닉네임이 바뀌었을 때 점수를 지우지 않고, 같은 계정이면 닉네임을 따라 고쳐요
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncPlayer, pickNickname } from '../supabase/functions/er-sync/lib.ts';

const opts = { matchingMode: 3, teamMode: null };
const names = new Map([[1, '재키']]);
const statsBody = (nickname, mmr = 6100) => ({ code: 200, userStats: [{ nickname, mmr, totalGames: 40, totalWins: 8, characterStats: [{ characterCode: 1, totalGames: 20 }] }] });

/** 가짜 이리 API: accounts = { 닉네임: uid }, stats = { uid: 응답 } */
function fakeEr({ accounts = {}, stats = {} }) {
  const calls = [];
  const er = async (path) => {
    calls.push(path);
    const nick = path.match(/nickname\?query=(.+)$/);
    if (nick) {
      const uid = accounts[decodeURIComponent(nick[1])];
      return uid ? { status: 200, body: { code: 200, user: { uid, nickname: decodeURIComponent(nick[1]) } } } : { status: 200, body: { code: 404, message: 'Not Found' } };
    }
    const uid = path.match(/stats\/uid\/([^/]+)\//)?.[1];
    return stats[uid] ? { status: 200, body: stats[uid] } : { status: 200, body: { code: 404, message: 'Not Found' } };
  };
  return { er, calls };
}
function fakeDb() {
  const saved = { uid: [], stats: [], nick: [] };
  return {
    saved,
    deps: (er) => ({
      er,
      saveUid: async (id, uid) => { saved.uid.push(uid); },
      saveStats: async (id, stats, error) => { saved.stats.push({ stats, error }); },
      saveNickname: async (id, nickname) => { saved.nick.push(nickname); }
    })
  };
}
const player = (nick, uid) => ({ id: 'p1', display_name: '귀련', er_nickname: nick, er_uid: uid });

test('정상: 저장된 UID 로 점수를 받아요', async () => {
  const { er } = fakeEr({ stats: { U1: statsBody('귀련') } });
  const db = fakeDb();
  const r = await syncPlayer(player('귀련', 'U1'), 33, names, opts, db.deps(er));
  assert.equal(r.ok, true);
  assert.equal(r.rank_score, 6100);
  assert.equal(db.saved.nick.length, 0);
});

test('랭크 기록 없음: 같은 UID 가 다시 나오면 "기록 없음"으로 저장', async () => {
  const { er } = fakeEr({ accounts: { 귀련: 'U1' } });
  const db = fakeDb();
  const r = await syncPlayer(player('귀련', 'U1'), 33, names, opts, db.deps(er));
  assert.equal(r.ok, true);
  assert.equal(r.rank_score, null);
  assert.equal(db.saved.stats[0].stats.rank_score, null);
});

test('닉네임이 바뀜: 예전 UID · 예전 닉네임 둘 다 없으면 점수를 지우지 않고 알려 줘요', async () => {
  const { er } = fakeEr({ accounts: { 새닉네임: 'U9' }, stats: { U9: statsBody('새닉네임') } });
  const db = fakeDb();
  const r = await syncPlayer(player('귀련', 'U1'), 33, names, opts, db.deps(er));
  assert.equal(r.ok, false);
  assert.equal(r.nickname_missing, true);
  assert.match(r.message, /닉네임이 바뀐 것 같아요/);
  assert.deepEqual(db.saved.stats, [{ stats: null, error: r.message }]);   // 점수 없이 오류만 → 예전 점수가 남아요
  assert.equal(db.saved.uid.length, 0);
});

test('같은 계정의 닉네임이 바뀌었으면(응답 속 닉네임) 따라 고쳐요', async () => {
  const { er } = fakeEr({ stats: { U1: statsBody('귀련2') } });
  const db = fakeDb();
  const r = await syncPlayer(player('귀련', 'U1'), 33, names, opts, db.deps(er));
  assert.equal(r.ok, true);
  assert.deepEqual(r.nickname_changed, { from: '귀련', to: '귀련2' });
  assert.deepEqual(db.saved.nick, ['귀련2']);
  // 대소문자만 다르면 그대로 둬요
  const db2 = fakeDb();
  await syncPlayer(player('Guiryeon', 'U1'), 33, names, opts, db2.deps(fakeEr({ stats: { U1: statsBody('guiryeon') } }).er));
  assert.equal(db2.saved.nick.length, 0);
});

test('UID 만 새로 바뀌었으면 저장된 닉네임으로 다시 찾아서 이어 가요', async () => {
  const { er } = fakeEr({ accounts: { 귀련: 'U2' }, stats: { U2: statsBody('귀련', 6300) } });
  const db = fakeDb();
  const r = await syncPlayer(player('귀련', 'U1'), 33, names, opts, db.deps(er));
  assert.equal(r.ok, true);
  assert.equal(r.uid_changed, true);
  assert.deepEqual(db.saved.uid, ['U2']);
  assert.equal(r.rank_score, 6300);
});

test('응답 속 닉네임 꺼내기', () => {
  assert.equal(pickNickname(statsBody(' 귀련 ')), '귀련');
  assert.equal(pickNickname({ userStats: [] }), null);
  assert.equal(pickNickname(null), null);
});
