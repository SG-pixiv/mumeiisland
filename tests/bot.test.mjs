// 디스코드 봇: 가짜 DB(Supabase 흉내) + 가짜 디스코드로 실제 쓰는 흐름을 처음부터 끝까지 확인해요
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../bot/src/service.js';
import { createRouter, EPHEMERAL } from '../bot/src/router.js';
import { tally, eventChoices, joinProblem, signupMessage, pickMvpEvent } from '../bot/src/logic.js';
import { commands } from '../bot/src/commands.js';
import { memoryStore, channelsOf } from '../bot/src/store.js';
import { roundResultMessage, pts } from '../bot/src/logic.js';

// ── 가짜 Supabase
const KEYS = {
  events: ['id'], players: ['id'], player_private: ['player_id'], event_participants: ['event_id', 'player_id'],
  event_teams: ['event_id', 'player_id'], bot_messages: ['event_id', 'kind'], mvp_votes: ['event_id', 'voter_player_id'],
  player_rank_stats: ['player_id'], discord_link_requests: ['id'], admins: ['user_id'], admin_keys: ['id'], admin_grants: ['discord_id']
};
function fakeDb(seed) {
  const t = structuredClone(seed);
  const calls = [];
  let n = 0;
  class Q {
    constructor(name) { this.name = name; this.f = []; this.op = 'select'; this.one = null; this.ord = null; this.head = false; }
    select(_c, o) { if (this.op === 'select') this.head = !!o?.head; return this; }
    eq(k, v) { this.f.push((r) => r[k] === v); return this; }
    in(k, list) { this.f.push((r) => list.includes(r[k])); return this; }
    order(k, o) { this.ord = [k, o?.ascending !== false]; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    single() { this.one = 'single'; return this; }
    insert(v) { this.op = 'insert'; this.v = v; return this; }
    upsert(v, o) { this.op = 'upsert'; this.v = v; this.conflict = o?.onConflict?.split(',') ?? KEYS[this.name]; return this; }
    update(v) { this.op = 'update'; this.v = v; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
    run() {
      const rows = (t[this.name] ||= []);
      const keys = KEYS[this.name] || ['id'];
      const match = (a, b, ks) => ks.every((k) => a[k] === b[k]);
      if (this.op === 'insert') {
        for (const r0 of [].concat(this.v)) {
          const r = { id: r0.id ?? `${this.name}-${++n}`, status: this.name === 'discord_link_requests' ? 'pending' : undefined, ...r0 };
          if (rows.some((x) => match(x, r, keys) && keys.some((k) => r[k] !== undefined))) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          if (this.name === 'discord_link_requests' && rows.some((x) => x.status === 'pending' && x.discord_id === r.discord_id)) return { data: null, error: { code: '23505', message: 'discord_link_pending_key' } };
          rows.push(r);
        }
        return { data: null, error: null };
      }
      if (this.op === 'upsert') {
        for (const r of [].concat(this.v)) { const hit = rows.find((x) => match(x, r, this.conflict)); if (hit) Object.assign(hit, r); else rows.push({ ...r }); }
        return { data: null, error: null };
      }
      let out = rows.filter((r) => this.f.every((fn) => fn(r)));
      if (this.op === 'update') { out.forEach((r) => Object.assign(r, this.v)); return { data: null, error: null }; }
      if (this.op === 'delete') { t[this.name] = rows.filter((r) => !out.includes(r)); return { data: null, error: null }; }
      if (this.ord) { const [k, asc] = this.ord; out = out.slice().sort((a, b) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1)); }
      if (this.lim) out = out.slice(0, this.lim);
      if (this.head) return { data: null, error: null, count: out.length };
      if (this.one) return out.length > 1 ? { data: null, error: { message: 'multiple rows' } } : { data: out[0] ? structuredClone(out[0]) : null, error: null };
      return { data: structuredClone(out), error: null };
    }
  }
  return {
    t, calls,
    from: (name) => new Q(name),
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'bot_create_admin_key') return { data: 'ABCD-EFGH-JKLM', error: null };
      if (name === 'bot_grant_admin') {   // 8단계 SQL 흉내: 소유자 확인 → 이미 관리자 / 로그인한 적 있음(LOGGED) / 예약
        if (!(t.admins ?? []).some((a) => a.discord_id === args.p_by_discord && a.role === 'owner' && !a.revoked_at)) return { data: null, error: { message: '관리자 추가는 무명섬 소유자만 할 수 있어요' } };
        const cur = (t.admins ?? []).find((a) => a.discord_id === args.p_discord_id && !a.revoked_at);
        if (cur) return { data: { ok: true, state: 'already', name: cur.discord_name }, error: null };
        (t.admin_grants ||= []).push({ discord_id: args.p_discord_id, discord_name: args.p_name || null, created_via: 'bot', used_at: null, revoked_at: null });
        if (args.p_discord_id.startsWith('LOGGED')) {
          t.admin_grants.at(-1).used_at = 'now';
          t.admins.push({ user_id: 'U-' + args.p_discord_id, discord_id: args.p_discord_id, discord_name: args.p_name, role: 'admin', registered_via: '봇 /관리자추가', revoked_at: null });
          return { data: { ok: true, state: 'added', name: args.p_name }, error: null };
        }
        return { data: { ok: true, state: 'pending', name: args.p_name }, error: null };
      }
      return { data: null, error: { message: 'no rpc' } };
    }
  };
}

const iso = (h) => new Date(Date.parse('2026-10-31T11:00:00Z') + h * 3600_000).toISOString();
const NOW = Date.parse('2026-10-30T12:00:00Z');
const seed = () => ({
  events: [
    { id: 'E1', title: '10월 31일 내전', starts_at: iso(0), status: 'plan', format: 'draft', planned_rounds: 4, max_players: 3, setting_code: null, memo: '19:40 대기방', mvp_vote_status: 'none', mvp_player_id: null },
    { id: 'E0', title: '10월 24일 내전', starts_at: iso(-7 * 24), status: 'done', format: 'auto', planned_rounds: 3, max_players: 12, mvp_vote_status: 'none' }
  ],
  players: [
    { id: 'P1', display_name: '귀련', er_nickname: '귀련', balance_tier: 1, active: true },
    { id: 'P2', display_name: '루미', er_nickname: 'Lumi', balance_tier: 2, active: true },
    { id: 'P3', display_name: '나딘', er_nickname: 'nadine', balance_tier: 3, active: true },
    { id: 'P4', display_name: '혜진', er_nickname: 'hyejin', balance_tier: 3, active: true }
  ],
  player_private: [{ player_id: 'P2', discord_id: 'D2' }, { player_id: 'P3', discord_id: 'D3' }, { player_id: 'P4', discord_id: 'D4' }],
  player_rank_stats: [{ player_id: 'P1', rank_score: 6400, rank_games: 120 }],
  event_participants: [{ event_id: 'E0', player_id: 'P2' }, { event_id: 'E0', player_id: 'P3' }, { event_id: 'E0', player_id: 'P4' }],
  event_teams: [], bot_messages: [], mvp_votes: [], discord_link_requests: [],
  admins: [
    { user_id: 'U-SG', discord_id: 'D-SG', discord_name: 'SG', role: 'owner', registered_via: '소유자 키 (처음 한 번)', created_at: iso(-300), last_seen_at: iso(-30), revoked_at: null },
    { user_id: 'U-A', discord_id: 'D-A', discord_name: '운석', role: 'admin', registered_via: '봇 명령어로 받은 키', created_at: iso(-200), last_seen_at: null, revoked_at: null }
  ],
  rounds: [{ id: 'R1', event_id: 'E0', round_no: 1, status: 'confirmed', confirmed_at: iso(-7 * 24 + 1) }],
  v_round_team_scores: [
    { round_id: 'R2', team_no: 1, team_rank: 2, team_kills: 9, rs: 7, ks: 7.5, pen: 0, total: 14.5 },
    { round_id: 'R2', team_no: 2, team_rank: 1, team_kills: 11, rs: 10, ks: 9, pen: 1, total: 18 }
  ],
  v_event_standings: [{ event_id: 'E0', team_no: 2, standing: 1, total: 30, rounds: 2 }, { event_id: 'E0', team_no: 1, standing: 2, total: 26.5, rounds: 2 }],
  round_players: [
    { round_id: 'R2', player_id: 'P2', csv_nickname: 'Lumi', team_no: 1 }, { round_id: 'R2', player_id: null, csv_nickname: 'guest99', team_no: 1 },
    { round_id: 'R2', player_id: 'P3', csv_nickname: 'nadine', team_no: 2 }
  ],
  admin_keys: [
    { id: 'K1', target_discord: 'd-a', used_at: null, revoked_at: null, expires_at: iso(10) },
    { id: 'K2', target_discord: 'd-x', used_at: null, revoked_at: null, expires_at: iso(10) },
    { id: 'K3', target_discord: null, used_at: iso(-5), revoked_at: null, expires_at: iso(10) }
  ]
});

// ── 가짜 디스코드
function setup(rng = () => 0.99, { dmFails = false, postable = true } = {}) {
  const db = fakeDb(seed());
  const service = createService(db, { siteUrl: 'https://mumei.test', rng, now: () => NOW });
  const sent = [], edits = [], dms = [];
  const store = memoryStore();
  let gone = new Set();
  const router = createRouter({
    service, guildId: 'G', siteUrl: 'https://mumei.test', log: { warn() {}, info() {} },
    sendMessage: async (channelId, payload) => { const m = { id: `M${sent.length + 1}`, channelId }; sent.push({ ...m, payload }); return m; },
    editMessage: async (channelId, id, payload) => { if (gone.has(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 }); edits.push({ channelId, id, payload }); },
    sendDM: async (userId, content) => { if (dmFails) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 }); dms.push({ userId, content }); },
    canPost: async () => postable,
    store
  });
  const run = async (o) => {
    const replies = [];
    const i = {
      guildId: o.guild ?? 'G', channelId: o.channel ?? 'C1', user: { id: o.user ?? 'D1', username: 'user' }, member: { displayName: o.nick ?? '디코닉' },
      memberPermissions: { has: (bit) => !!o.admin && bit === 8n },
      commandName: o.cmd, customId: o.custom, values: o.values,
      options: {
        getString: (k) => o.opts?.[k] ?? null, getSubcommand: () => o.sub, getFocused: () => o.focus ?? '',
        getUser: (k) => o.users?.[k] ?? null, getMember: (k) => (o.users?.[k] ? { displayName: o.users[k].nick } : null),
        getChannel: (k) => o.channels?.[k] ?? null
      },
      isAutocomplete: () => o.kind === 'auto', isButton: () => o.kind === 'button', isStringSelectMenu: () => o.kind === 'select', isChatInputCommand: () => (o.kind ?? 'cmd') === 'cmd',
      deferReply: async (x) => { replies.push({ defer: x }); },
      editReply: async (x) => { replies.push(x); }, reply: async (x) => { replies.push(x); }, respond: async (x) => { replies.push({ choices: x }); }
    };
    await router.handle(i);
    return replies;
  };
  const last = (r) => r[r.length - 1]?.content ?? '';
  return { db, service, router, run, last, sent, edits, gone, dms, store };
}

test('명령어 목록: 이름 · 설명 길이가 디스코드 규칙에 맞아요', () => {
  const ok = /^[-_\p{L}\p{N}]{1,32}$/u;
  for (const c of commands) {
    assert.match(c.name, ok); assert.ok(c.description.length <= 100, c.name);
    for (const o of c.options ?? []) { assert.match(o.name, ok); assert.ok(o.description.length <= 100); for (const s of o.options ?? []) assert.ok(s.description.length <= 100); }
  }
  // 운영진 명령어도 목록에는 다 보여요 (봇이 서버 관리자 · 무명섬 관리자인지 확인)
  assert.deepEqual(commands.filter((c) => c.default_member_permissions).map((c) => c.name), []);
  assert.ok(commands.some((c) => c.name === '관리자추가' && c.options[0].required));
  assert.equal(commands.length, 12);
});

test('/연결 → 승인 대기, 다시 보내면 요청을 바꿔요', async () => {
  const s = setup();
  assert.match(s.last(await s.run({ cmd: '연결', opts: { 게임닉네임: '없는사람' } })), /무명섬에 없어요/);
  assert.match(s.last(await s.run({ cmd: '연결', opts: { 게임닉네임: ' LUMI ' } })), /'루미' 선수로 연결 요청/);
  assert.match(s.last(await s.run({ cmd: '연결', opts: { 게임닉네임: '귀련' } })), /'귀련' 선수로 연결 요청/);
  const pending = s.db.t.discord_link_requests.filter((r) => r.status === 'pending');
  assert.equal(pending.length, 1);
  assert.deepEqual([pending[0].discord_id, pending[0].player_id, pending[0].discord_name], ['D1', 'P1', '디코닉']);
  assert.match(s.last(await s.run({ cmd: '내정보' })), /승인을 기다리는 중/);
  // 관리자가 웹에서 승인했다고 치고
  s.db.t.player_private.push({ player_id: 'P1', discord_id: 'D1' });
  const info = s.last(await s.run({ cmd: '내정보' }));
  assert.match(info, /\*\*귀련\*\* · 1티어/);
  assert.match(info, /6,400점/);
  assert.match(s.last(await s.run({ cmd: '연결', opts: { 게임닉네임: '귀련' } })), /이미 '귀련' 선수와 연결/);
  // /연결해제: 연결을 풀고, 다시 해제하면 "없어요"
  assert.match(s.last(await s.run({ cmd: '연결해제' })), /'귀련' 선수와의 연결을 풀었어요/);
  assert.equal(s.db.t.player_private.find((r) => r.player_id === 'P1').discord_id, null);
  assert.match(s.last(await s.run({ cmd: '연결해제' })), /연결된 선수가 없어요/);
  // 대기 중인 요청만 있으면 취소
  await s.run({ cmd: '연결', opts: { 게임닉네임: '귀련' } });
  assert.match(s.last(await s.run({ cmd: '연결해제' })), /요청을 취소했어요/);
  assert.equal(s.db.t.discord_link_requests.filter((r) => r.status === 'pending').length, 0);
});

test('/내전공지 → 버튼으로 참가 · 취소, 인원 메시지가 바로 바뀌어요', async () => {
  const s = setup();
  s.db.t.player_private.push({ player_id: 'P1', discord_id: 'D1' });
  assert.match(s.last(await s.run({ cmd: '내전공지' })), /운영진\(디스코드 서버 관리자 · 무명섬 관리자\)만/);
  assert.match(s.last(await s.run({ cmd: '내전공지', admin: true })), /공지를 이 채널에 올렸어요/);
  assert.equal(s.db.t.events.find((e) => e.id === 'E1').status, 'open');                 // 예정 → 모집 중
  assert.equal(s.sent.length, 1);
  const btns = s.sent[0].payload.components[0].components;
  assert.deepEqual(btns.map((b) => b.custom_id ?? b.url), ['join:E1', 'leave:E1', 'https://mumei.test/draft?id=E1']);
  assert.match(s.sent[0].payload.embeds[0].description, /0 \/ 3명/);
  assert.deepEqual(s.db.t.bot_messages, [{ event_id: 'E1', kind: 'signup', channel_id: 'C1', message_id: 'M1', created_at: new Date(NOW).toISOString() }]);

  assert.match(s.last(await s.run({ kind: 'button', custom: 'join:E1', user: 'D9' })), /먼저 `\/연결/);  // 연결 안 된 사람
  assert.match(s.last(await s.run({ kind: 'button', custom: 'join:E1' })), /참가 신청 완료! \(1 \/ 3명\)/);
  assert.match(s.edits.at(-1).payload.embeds[0].description, /1 \/ 3명/);
  assert.match(s.edits.at(-1).payload.embeds[0].fields[0].value, /귀련/);
  assert.match(s.last(await s.run({ kind: 'button', custom: 'join:E1' })), /이미 신청했어요/);
  await s.run({ cmd: '참가', user: 'D2' });                                               // 내전을 안 골라도 모집 중인 내전으로
  await s.run({ cmd: '참가', user: 'D3' });
  assert.match(s.last(await s.run({ cmd: '참가', user: 'D4' })), /자리가 다 찼어요 \(3\/3명\)/);

  s.db.t.event_teams.push({ event_id: 'E1', player_id: 'P3', team_no: 1 });
  assert.match(s.last(await s.run({ kind: 'button', custom: 'leave:E1', user: 'D3' })), /팀이 이미 짜여/);
  assert.match(s.last(await s.run({ cmd: '참가취소', user: 'D2' })), /참가를 취소했어요\. \(2 \/ 3명\)/);
  assert.equal(s.db.t.event_participants.filter((p) => p.event_id === 'E1').length, 2);

  // 공지를 다시 올리면 예전 메시지는 버튼을 떼요
  await s.run({ cmd: '내전공지', admin: true, opts: { 내전: 'E1' } });
  assert.deepEqual(s.edits.at(-1), { channelId: 'C1', id: 'M1', payload: { components: [] } });
  assert.equal(s.db.t.bot_messages[0].message_id, 'M2');
});

test('/mvp 시작 → 투표 → /mvp 마감: 최다 득표 MVP, 공동 1위는 추첨', async () => {
  const s = setup(() => 0.99);   // 추첨은 마지막 후보
  s.db.t.player_private.push({ player_id: 'P1', discord_id: 'D1' });
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '시작', admin: true, opts: { 내전: 'E0' } })), /MVP 투표를 이 채널에 열었어요/);
  const menu = s.sent[0].payload.components[0].components[0];
  assert.equal(menu.custom_id, 'mvp:E0');
  assert.deepEqual(menu.options.map((o) => o.label), ['루미', '나딘', '혜진']);
  assert.equal(s.db.t.events.find((e) => e.id === 'E0').mvp_vote_status, 'open');

  assert.match(s.last(await s.run({ kind: 'select', custom: 'mvp:E0', values: ['P3'], user: 'D1' })), /참가자만/);   // 귀련은 E0 에 안 나왔어요
  assert.match(s.last(await s.run({ kind: 'select', custom: 'mvp:E0', values: ['P2'], user: 'D2' })), /자기 자신/);
  assert.match(s.last(await s.run({ kind: 'select', custom: 'mvp:E0', values: ['P3'], user: 'D2' })), /나딘\*\* 님에게 투표/);
  await s.run({ kind: 'select', custom: 'mvp:E0', values: ['P4'], user: 'D2' });                                    // 바꾸기
  await s.run({ kind: 'select', custom: 'mvp:E0', values: ['P2'], user: 'D3' });
  assert.equal(s.db.t.mvp_votes.length, 2);
  assert.match(s.edits.at(-1).payload.embeds[0].description, /2 \/ 3명/);

  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '마감', admin: true })), /MVP는 \*\*혜진\*\* \(공동 1위 추첨\)/);   // 루미 1 · 혜진 1 → 추첨
  const ev = s.db.t.events.find((e) => e.id === 'E0');
  assert.equal(ev.mvp_vote_status, 'closed');
  assert.equal(ev.mvp_player_id, 'P4');
  assert.deepEqual(ev.mvp_vote_result.tied.sort(), ['P2', 'P4']);
  assert.equal(ev.mvp_vote_result.drawn, true);
  assert.match(s.sent.at(-1).payload.embeds[0].title, /MVP는 혜진!/);
  assert.deepEqual(s.edits.at(-1).payload.components, []);                                                         // 투표 메뉴를 닫아요
  assert.match(s.last(await s.run({ kind: 'select', custom: 'mvp:E0', values: ['P3'], user: 'D4' })), /열려 있지 않아요/);
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '마감', admin: true })), /투표 중인 내전이 없어요/);
});

test('/관리자키: 서버 관리자만, 명령어를 쓴 디스코드 계정 전용 키', async () => {
  const s = setup();
  assert.match(s.last(await s.run({ cmd: '관리자키', user: 'D7' })), /운영진/);
  const r = s.last(await s.run({ cmd: '관리자키', user: 'D7', admin: true, nick: '새 운영진' }));
  assert.match(r, /ABCD-EFGH-JKLM/);
  assert.match(r, /https:\/\/mumei\.test\/login/);
  assert.deepEqual(s.db.calls, [['bot_create_admin_key', { p_discord_id: 'D7', p_discord_name: '새 운영진' }]]);
});

test('/관리자키 @유저 → DM, 이미 관리자면 안 만들어요 · DM 이 막히면 대신 보여 줘요', async () => {
  const s = setup();
  const newbie = { 유저: { id: 'D8', username: 'newbie', nick: '새 운영진' } };
  assert.match(s.last(await s.run({ cmd: '관리자키', admin: true, users: newbie })), /새 운영진 님에게 DM 으로/);
  assert.equal(s.dms[0].userId, 'D8');
  assert.match(s.dms[0].content, /ABCD-EFGH-JKLM/);
  assert.match(s.dms[0].content, /새 운영진 님의 디스코드 계정|지금 이 디스코드 계정/);
  assert.deepEqual(s.db.calls.at(-1), ['bot_create_admin_key', { p_discord_id: 'D8', p_discord_name: '새 운영진' }]);
  assert.match(s.last(await s.run({ cmd: '관리자키', admin: true, users: { 유저: { id: 'D-A', nick: '운석' } } })), /이미 무명섬 관리자/);
  assert.match(s.last(await s.run({ cmd: '관리자키', admin: true, user: 'D-SG' })), /이미 무명섬 관리자/);            // 나 자신도
  assert.match(s.last(await s.run({ cmd: '관리자키', admin: true, users: { 유저: { id: 'B1', bot: true, nick: '봇' } } })), /봇에게는/);
  // 서버 관리자가 아니어도 무명섬 관리자면 쓸 수 있어요
  assert.match(s.last(await s.run({ cmd: '관리자키', user: 'D-A', users: newbie })), /DM 으로/);
  assert.match(s.last(await s.run({ cmd: '관리자키', user: 'D9', users: newbie })), /운영진/);
  const f = setup(undefined, { dmFails: true });
  const r = f.last(await f.run({ cmd: '관리자키', admin: true, users: newbie }));
  assert.match(r, /DM 이 막혀 있어서 대신/);
  assert.match(r, /ABCD-EFGH-JKLM/);
  assert.match(r, /새 운영진 님의 디스코드 계정으로/);
});

test('/관리자목록 · /관리자해제 (소유자만, 남은 키도 취소)', async () => {
  const s = setup();
  const list = s.last(await s.run({ cmd: '관리자목록', admin: true }));
  assert.match(list, /무명섬 관리자 2명 · 안 쓴 키 2개/);
  assert.match(list, /👑 \*\*SG\*\* \(소유자\)/);
  assert.match(s.last(await s.run({ cmd: '관리자목록', user: 'D9' })), /운영진/);

  const a = { 유저: { id: 'D-A', nick: '운석' } };
  assert.match(s.last(await s.run({ cmd: '관리자해제', user: 'D-A', admin: true, users: a })), /소유자만/);      // 서버 관리자여도 소유자가 아니면 안 돼요
  assert.match(s.last(await s.run({ cmd: '관리자해제', user: 'D-SG', users: { 유저: { id: 'D-SG', nick: 'SG' } } })), /소유자는 해제할 수 없어요/);
  assert.match(s.last(await s.run({ cmd: '관리자해제', user: 'D-SG', users: a })), /운석 님을 무명섬 관리자에서 뺐어요\. .*안 쓴 키 1개도 취소/);
  assert.ok(s.db.t.admins.find((x) => x.user_id === 'U-A').revoked_at);
  assert.ok(s.db.t.admin_keys.find((k) => k.id === 'K1').revoked_at);
  assert.equal(s.db.t.admin_keys.find((k) => k.id === 'K2').revoked_at, null);
  assert.match(s.last(await s.run({ cmd: '관리자해제', user: 'D-SG', users: a })), /관리자가 아니에요/);
  assert.match(s.last(await s.run({ cmd: '관리자목록', user: 'D-SG' })), /관리자 1명 · 안 쓴 키 1개/);
});

test('/채널설정: 공지 채널로 올리기 · 명령어 채널 제한', async () => {
  const s = setup();
  assert.match(s.last(await s.run({ cmd: '채널설정', sub: '보기' })), /운영진/);
  assert.match(s.last(await s.run({ cmd: '채널설정', sub: '보기', admin: true })), /공지 · 알림 채널: 아직 없어요/);
  assert.match(s.last(await s.run({ cmd: '채널설정', sub: '공지', admin: true, channels: { 채널: { id: 'C-ANN' } } })), /<#C-ANN> 에 올라가요/);
  assert.match(s.last(await s.run({ cmd: '채널설정', sub: '명령어', admin: true, channel: 'C-CMD' })), /<#C-CMD> 에서만/);   // 채널을 안 고르면 지금 채널
  assert.deepEqual(channelsOf(s.store, 'G'), { announce: 'C-ANN', commands: 'C-CMD' });

  // 참가자 명령어는 명령어 채널에서만, 관리자 명령어는 어디서나
  assert.match(s.last(await s.run({ cmd: '내정보', channel: 'C1' })), /<#C-CMD> 채널에서 써 주세요/);
  assert.match(s.last(await s.run({ cmd: '내정보', channel: 'C-CMD' })), /연결된 선수가 없어요/);
  assert.match(s.last(await s.run({ cmd: '내전공지', admin: true, channel: 'C-CMD' })), /<#C-ANN>에 올렸어요/);
  assert.equal(s.sent.at(-1).channelId, 'C-ANN');
  assert.equal(s.db.t.bot_messages[0].channel_id, 'C-ANN');
  await s.run({ cmd: 'mvp', sub: '시작', admin: true, channel: 'C-CMD', opts: { 내전: 'E0' } });
  assert.equal(s.sent.at(-1).channelId, 'C-ANN');

  assert.match(s.last(await s.run({ cmd: '채널설정', sub: '명령어해제', admin: true })), /풀었어요/);
  assert.match(s.last(await s.run({ cmd: '내정보', channel: 'C1' })), /연결된 선수가 없어요/);
  const f = setup(undefined, { postable: false });
  assert.match(f.last(await f.run({ cmd: '채널설정', sub: '공지', admin: true })), /글을 쓸 수 없어요/);
  assert.deepEqual(channelsOf(f.store, 'G'), {});
});

test('라운드 결과 자동 공지: 처음엔 예전 판 건너뛰고, 확정하면 올리고, 다시 확정하면 (수정됨)', async () => {
  const s = setup();
  assert.equal(await s.router.announceResults(), 0);              // 처음: R1(예전 판)은 표시만
  assert.deepEqual(Object.keys(s.store.get().announced), ['R1']);
  s.db.t.rounds.push({ id: 'R2', event_id: 'E0', round_no: 2, status: 'confirmed', confirmed_at: iso(-1) });
  assert.equal(await s.router.announceResults(), 0);              // 공지 채널이 없으면 안 올리고 표시만
  assert.equal(s.sent.length, 0);
  await s.run({ cmd: '채널설정', sub: '공지', admin: true, channel: 'C-ANN' });
  assert.equal(await s.router.announceResults(), 0);              // 채널을 정해도 예전 판이 한꺼번에 올라가지 않아요
  s.db.t.rounds.find((r) => r.id === 'R2').confirmed_at = iso(-0.5);   // 확정 취소 → 다시 확정
  assert.equal(await s.router.announceResults(), 1);
  const e = s.sent.at(-1);
  assert.equal(e.channelId, 'C-ANN');
  const emb = e.payload.embeds[0];
  assert.equal(emb.title, '🏁 10월 24일 내전 2라운드 결과 (수정됨)');
  assert.match(emb.description, /^\*\*1위\*\* 팀 2 · \*\*18점\*\* \(순위 10 \+ 킬 9 − 감점 1\) · 11킬\n　나딘\n\*\*2위\*\* 팀 1 · \*\*14\.5점\*\*/);
  assert.match(emb.description, /루미 · guest99/);
  assert.equal(emb.fields[0].name, '누적 순위 (2라운드까지)');
  assert.equal(emb.fields[0].value, '1. 팀 2 — 30점 (2판)\n2. 팀 1 — 26.5점 (2판)');
  assert.equal(e.payload.components[0].components[0].url, 'https://mumei.test/match?id=E0');
  assert.equal(await s.router.announceResults(), 0);              // 같은 판은 한 번만

  // 드래프트 내전이면 팀장 이름으로
  s.db.t.events.find((x) => x.id === 'E0').format = 'draft';
  s.db.t.event_teams.push({ event_id: 'E0', player_id: 'P3', team_no: 2, slot_tier: 1 });
  const r = await s.service.roundResult('R2');
  assert.match(r.payload.embeds[0].description, /\*\*1위\*\* 나딘 팀/);
  assert.equal(await s.service.roundResult('R-none'), null);
  assert.deepEqual([pts(3), pts(2.5), pts('7')], ['3', '2.5', '7']);
});

test('답장은 나만 보이게, 다른 서버에서는 안 돼요, 자동완성 · 지워진 메시지 정리', async () => {
  const s = setup();
  const r = await s.run({ cmd: '내정보' });
  assert.equal(r[0].defer.flags, EPHEMERAL);
  assert.match(s.last(await s.run({ cmd: '내정보', guild: 'OTHER' })), /이 서버에서는/);
  const auto = await s.run({ kind: 'auto', focus: '31' });
  assert.deepEqual(auto[0].choices.map((c) => c.value), ['E1']);
  await s.run({ cmd: '내전공지', admin: true });
  s.gone.add('M1');
  await s.router.refreshAll();
  assert.equal(s.db.t.bot_messages.length, 0);
});

test('규칙 함수', () => {
  assert.deepEqual(tally([]).picked, null);
  const t = tally([{ candidate_player_id: 'a' }, { candidate_player_id: 'b' }, { candidate_player_id: 'a' }]);
  assert.deepEqual([t.picked, t.drawn, t.votes], ['a', false, 3]);
  const tie = tally([{ candidate_player_id: 'a' }, { candidate_player_id: 'b' }], () => 0);
  assert.deepEqual([tie.picked, tie.drawn, tie.tied], ['a', true, ['a', 'b']]);
  assert.match(joinProblem({ event: { status: 'plan', max_players: 3 }, count: 0, already: false, linked: true }), /받기 전/);
  assert.equal(joinProblem({ event: { status: 'open', max_players: 3 }, count: 2, already: false, linked: true }), '');
  const evs = seed().events;
  assert.equal(pickMvpEvent(evs, NOW).id, 'E0');                    // 아직 안 한 내전(E1)은 빼요
  assert.equal(eventChoices(evs, '', NOW)[0].value, 'E1');
  const m = signupMessage({ ...evs[0], status: 'fixed' }, [], '');
  assert.equal(m.components[0].components[0].disabled, true);        // 모집 마감이면 참가 버튼이 꺼져요
});

test('/관리자추가: 소유자만 · 서버 관리자가 아니어도 운영진 명령어를 쓸 수 있어요', async () => {
  const s = setup();
  const newbie = { 유저: { id: 'D7', nick: '새 운영진' } };
  // 서버 관리자 · 일반 관리자는 못 해요
  assert.match(s.last(await s.run({ cmd: '관리자추가', user: 'D-A', admin: true, users: newbie })), /소유자만/);
  assert.match(s.last(await s.run({ cmd: '관리자추가', user: 'D9', admin: true, users: newbie })), /소유자만/);
  assert.match(s.last(await s.run({ cmd: '관리자추가', user: 'D-SG', users: { 유저: { id: 'B1', bot: true, nick: '봇' } } })), /봇은/);
  // 추가 전에는 D7 이 운영진 명령어를 못 써요
  assert.match(s.last(await s.run({ cmd: '내전공지', user: 'D7' })), /운영진/);

  // 소유자가 추가 (사이트 로그인 전 → 예약) · DM 도 가요
  const r = s.last(await s.run({ cmd: '관리자추가', user: 'D-SG', users: newbie }));
  assert.match(r, /새 운영진 님을 무명섬 관리자로 추가했어요! 디스코드 운영진 명령어는 지금부터/);
  assert.match(r, /https:\/\/mumei\.test\/login/);
  assert.deepEqual(s.db.calls.at(-1), ['bot_grant_admin', { p_by_discord: 'D-SG', p_discord_id: 'D7', p_name: '새 운영진' }]);
  assert.equal(s.dms.at(-1).userId, 'D7');
  assert.match(s.dms.at(-1).content, /키는 필요 없어요/);

  // 서버 관리자 권한 없이도 운영진 명령어가 돼요
  assert.match(s.last(await s.run({ cmd: '내전공지', user: 'D7' })), /공지를 이 채널에 올렸어요/);
  assert.match(s.last(await s.run({ cmd: '채널설정', sub: '보기', user: 'D7' })), /공지 · 알림 채널/);
  assert.match(s.last(await s.run({ cmd: '관리자키', user: 'D7' })), /이미 무명섬 관리자예요\. https:\/\/mumei\.test\/login/);
  // 목록에 "로그인 전"으로 보여요
  assert.match(s.last(await s.run({ cmd: '관리자목록', user: 'D7' })), /관리자 2명 \(\+ 로그인 전 1명\)[\s\S]*⏳ \*\*새 운영진\*\* · 사이트 로그인 전/);
  // 다시 추가하면 이미 관리자 (예약도 관리자로 봐요) — 로그인한 적 있는 사람은 바로 관리자
  assert.match(s.last(await s.run({ cmd: '관리자추가', user: 'D-SG', users: { 유저: { id: 'LOGGED1', nick: '로그인했던사람' } } })), /바로 관리자 화면/);
  assert.match(s.last(await s.run({ cmd: '관리자추가', user: 'D-SG', users: { 유저: { id: 'D-A', nick: '운석' } } })), /이미 무명섬 관리자예요/);
  assert.equal(s.dms.filter((d) => d.userId === 'D-A').length, 0, '이미 관리자면 DM 안 보내요');

  // 소유자가 /관리자해제 하면 예약도 취소 → 다시 못 써요
  assert.match(s.last(await s.run({ cmd: '관리자해제', user: 'D-SG', users: newbie })), /새 운영진 님의 관리자 추가\(로그인 전\)를 취소했어요/);
  assert.ok(s.db.t.admin_grants.find((g) => g.discord_id === 'D7').revoked_at);
  assert.match(s.last(await s.run({ cmd: '내전공지', user: 'D7' })), /운영진/);
});

test('/관리자추가: 8단계 SQL 전이면 알려 줘요', async () => {
  const s = setup();
  s.db.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.bot_grant_admin' } });
  assert.match(s.last(await s.run({ cmd: '관리자추가', user: 'D-SG', users: { 유저: { id: 'D7', nick: '새 운영진' } } })), /8단계/);
});
