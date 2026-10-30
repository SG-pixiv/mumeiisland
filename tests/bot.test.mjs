// 디스코드 봇: 가짜 DB(Supabase 흉내) + 가짜 디스코드로 실제 쓰는 흐름을 처음부터 끝까지 확인해요
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../bot/src/service.js';
import { createRouter, EPHEMERAL } from '../bot/src/router.js';
import { tally, eventChoices, joinProblem, signupMessage, pickMvpEvent } from '../bot/src/logic.js';
import { commands } from '../bot/src/commands.js';
import { memoryStore, channelsOf } from '../bot/src/store.js';
import { roundResultMessage, pts, autoAnnouncePlan, autoAnnounceText, kstWhenWord, introDefaults, introMessage, eventEnded, parseChannel, tierRolePlan, SELF_REGISTER_MEMO } from '../bot/src/logic.js';

// ── 가짜 Supabase
const KEYS = {
  events: ['id'], players: ['id'], player_private: ['player_id'], event_participants: ['event_id', 'player_id'],
  event_teams: ['event_id', 'player_id'], bot_messages: ['event_id', 'kind'], mvp_votes: ['event_id', 'voter_player_id'],
  player_rank_stats: ['player_id'], discord_link_requests: ['id'], tier_history: ['id'], admins: ['user_id'], admin_keys: ['id'], admin_grants: ['discord_id'], round_mvp_votes: ['round_id', 'voter_player_id']
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
        if (!(t.admins ?? []).some((a) => a.discord_id === args.p_by_discord && ['owner', 'co_owner'].includes(a.role) && !a.revoked_at)) return { data: null, error: { message: '관리자 추가는 무명섬 소유자 · 공동 소유자만 할 수 있어요' } };
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
  site_settings: [{ id: 1, records_public: true, records_from_episode: 1, records_items: {} }],
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
  let clock = NOW;
  const service = createService(db, { siteUrl: 'https://mumei.test', rng, now: () => clock });
  const sent = [], edits = [], dms = [];
  const store = memoryStore();
  let gone = new Set();
  let failing = false;
  const deleted = [];
  const deleteFails = {};
  const memberRoles = new Map();   // 디스코드 id → Set(역할)
  const roleCalls = [];
  let roleFails = false;
  const router = createRouter({
    service, guildId: 'G', siteUrl: 'https://mumei.test', log: { warn() {}, info() {} },
    sendMessage: async (channelId, payload) => { if (failing) throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); const m = { id: `M${sent.length + 1}`, channelId }; sent.push({ ...m, payload }); return m; },
    editMessage: async (channelId, id, payload) => { if (gone.has(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 }); edits.push({ channelId, id, payload }); },
    deleteMessage: async (channelId, id) => {
      if (deleteFails[id]) throw Object.assign(new Error('delete failed'), { code: deleteFails[id] });
      deleted.push({ channelId, id });
    },
    sendDM: async (userId, content) => { if (dmFails) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 }); dms.push({ userId, content }); },
    canPost: async () => postable,
    setMemberRole: async (userId, roleId, on) => {
      const set = memberRoles.get(userId) ?? new Set();
      memberRoles.set(userId, set);
      const has = set.has(roleId);
      if (roleFails && on !== has) throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
      if (on && !has) { set.add(roleId); roleCalls.push(['add', userId]); return 'added'; }
      if (!on && has) { set.delete(roleId); roleCalls.push(['remove', userId]); return 'removed'; }
      return 'same';
    },
    store,
    now: () => clock
  });
  const run = async (o) => {
    const replies = [];
    const i = {
      guildId: o.guild ?? 'G', channelId: o.channel ?? 'C1', user: { id: o.user ?? 'D1', username: 'user' }, member: { displayName: o.nick ?? '디코닉' },
      memberPermissions: { has: (bit) => !!o.admin && bit === 8n },
      commandName: o.cmd, customId: o.custom, values: o.values,
      options: {
        getString: (k) => o.opts?.[k] ?? null, getInteger: (k) => o.ints?.[k] ?? null, getSubcommand: () => o.sub, getFocused: () => o.focus ?? '',
        getUser: (k) => o.users?.[k] ?? null, getMember: (k) => (o.users?.[k] ? { displayName: o.users[k].nick } : null),
        getChannel: (k) => o.channels?.[k] ?? null, getRole: (k) => o.roles?.[k] ?? null
      },
      isAutocomplete: () => o.kind === 'auto', isButton: () => o.kind === 'button', isStringSelectMenu: () => o.kind === 'select', isChatInputCommand: () => (o.kind ?? 'cmd') === 'cmd',
      isModalSubmit: () => o.kind === 'modal', fields: { getTextInputValue: (k) => o.fields?.[k] ?? '' },
      showModal: async (x) => { replies.push({ modal: x }); },
      deferReply: async (x) => { replies.push({ defer: x }); },
      editReply: async (x) => { replies.push(x); }, reply: async (x) => { replies.push(x); }, respond: async (x) => { replies.push({ choices: x }); }
    };
    await router.handle(i);
    return replies;
  };
  const last = (r) => r[r.length - 1]?.content ?? '';
  return { db, service, router, run, last, sent, edits, gone, dms, store, deleted, deleteFails, memberRoles, roleCalls, roleFails: (v) => { roleFails = v; }, failSend: (v) => { failing = v; }, wait: (minutes) => { clock += minutes * 60_000; } };
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
  assert.equal(commands.length, 15);
});

test('/연결 → 승인 대기, 다시 보내면 요청을 바꿔요', async () => {
  const s = setup();
  // 없는 닉네임이면 등록 창이 떠요 (닉네임 · 디스코드 이름이 미리 채워져요)
  const modal = (await s.run({ cmd: '연결', opts: { 게임닉네임: '없는사람' } }))[0].modal;
  assert.equal(modal.custom_id, 'regform');
  assert.deepEqual(modal.components.map((r) => [r.components[0].custom_id, r.components[0].value ?? '']), [['name', '디코닉'], ['nick', '없는사람'], ['channel', '']]);
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

test('라운드 MVP: 확정하면 결과 공지 + 투표 자동 열기 → 30분 뒤 자동 마감 · 발표 · 투표 메시지 삭제', async () => {
  const s = setup(() => 0.99);   // 추첨은 마지막 후보
  s.db.t.player_private.push({ player_id: 'P1', discord_id: 'D1' });
  await s.run({ cmd: '채널설정', sub: '공지', admin: true, channels: { 채널: { id: 'C-ANN' } } });
  await s.router.announceResults();                                  // 처음: 예전 판(R1)은 표시만, 투표도 안 열어요
  assert.equal(s.sent.length, 0);
  s.db.t.rounds.push({ id: 'R2', event_id: 'E0', round_no: 2, status: 'confirmed', confirmed_at: iso(-1), mvp_vote_status: 'none' });
  assert.equal(await s.router.announceResults(), 1);
  assert.equal(s.sent.length, 2, '결과 공지 + 투표');
  const vote = s.sent[1];
  const menu = vote.payload.components[0].components[0];
  assert.equal(menu.custom_id, 'rmvp:R2');
  assert.deepEqual(menu.options.map((o) => [o.label, o.description]), [['루미', '팀 1 · 0킬 0어시'], ['나딘', '팀 2 · 0킬 0어시']]);
  assert.match(vote.payload.embeds[0].title, /2라운드 MVP 투표/);
  assert.match(vote.payload.embeds[0].description, /<t:\d+:R> 마감 · 🗳️ \*\*0 \/ 3명\*\*/);
  const r2 = () => s.db.t.rounds.find((r) => r.id === 'R2');
  assert.deepEqual([r2().mvp_vote_status, r2().mvp_message_id, r2().mvp_vote_closes_at], ['open', vote.id, new Date(NOW + 30 * 60_000).toISOString()]);

  // 투표
  const pick = (user, who) => s.run({ kind: 'select', custom: 'rmvp:R2', values: [who], user });
  assert.match(s.last(await pick('D1', 'P3')), /참가자만/);          // 귀련은 E0 에 안 나왔어요
  assert.match(s.last(await pick('D2', 'P2')), /자기 자신/);
  assert.match(s.last(await pick('D2', 'P4')), /후보가 아니에요/);   // 혜진은 참가자지만 이 판 기록에 없어요
  assert.match(s.last(await pick('D2', 'P3')), /나딘\*\* 님에게 투표/);
  await pick('D4', 'P3');
  await pick('D4', 'P2');                                             // 바꾸기 → 루미 1 · 나딘 1
  assert.equal(s.db.t.round_mvp_votes.length, 2);
  assert.match(s.edits.at(-1).payload.embeds[0].description, /2 \/ 3명/);
  assert.match(s.last(await s.run({ kind: 'select', custom: 'mvp:E0', values: ['P3'], user: 'D2' })), /라운드마다/);   // 예전 내전 투표 메뉴

  // 30분 전에는 안 닫아요 → 지나면 자동 마감
  s.wait(29);
  assert.equal(await s.router.closeDueVotes(), 0);
  s.wait(2);
  assert.match(s.last(await pick('D3', 'P2')), /막 마감됐어요/);
  assert.equal(await s.router.closeDueVotes(), 1);
  assert.deepEqual([r2().mvp_vote_status, r2().mvp_player_id, r2().mvp_vote_result.drawn, r2().mvp_message_id], ['closed', 'P3', true, null]);
  const ann = s.sent.at(-1);
  assert.equal(ann.channelId, 'C-ANN');
  assert.equal(ann.payload.embeds[0].title, '🏆 10월 24일 내전 2라운드 MVP는 나딘!');
  assert.match(ann.payload.embeds[0].description, /공동 1위 2명\(각 1표\) 중에서 추첨/);
  assert.deepEqual(s.deleted.map((d) => d.id), [vote.id], '투표 메시지는 지워요');
  assert.deepEqual(s.store.get().posts.map((p) => p.k), ['result', 'mvp-result'], '결과 · 발표만 남아요');
  assert.equal(await s.router.closeDueVotes(), 0);
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '마감', admin: true })), /투표 중인 라운드가 없어요/);
  // 다시 확정해도 투표를 또 열지 않아요
  r2().confirmed_at = iso(-0.2);
  await s.router.announceResults();
  assert.equal(s.sent.at(-1).payload.embeds[0].title, '🏁 10월 24일 내전 2라운드 결과 (수정됨)');
});

test('/mvp 시작 · 마감: 운영진이 손으로 열고(다시 열기) 바로 마감', async () => {
  const s = setup(() => 0);
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '시작' })), /운영진/);
  s.db.t.rounds.push({ id: 'R2', event_id: 'E0', round_no: 2, status: 'confirmed', confirmed_at: iso(-1), mvp_vote_status: 'none' });
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '시작', admin: true, ints: { 라운드: 1 } })), /무명섬 선수가 2명 이상/);   // R1 은 선수 기록이 없어요
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '시작', admin: true, ints: { 라운드: 9 } })), /투표를 열 라운드가 없어요/);
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '시작', admin: true })), /2라운드\*\* MVP 투표를 이 채널에 열었어요! 30분 뒤 자동으로/);   // 비우면 가장 최근 내전 · 라운드
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '시작', admin: true })), /이미 열려 있어요/);
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '마감', admin: true })), /아무도 투표하지 않아서 MVP 는 없어요/);
  assert.equal(s.db.t.rounds.find((r) => r.id === 'R2').mvp_player_id, null);
  // 다시 열기 → 표가 있으면 바로 마감
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '시작', admin: true, opts: { 내전: 'E0' }, ints: { 라운드: 2 } })), /다시 열었어요/);
  await s.run({ kind: 'select', custom: 'rmvp:R2', values: ['P2'], user: 'D3' });
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '마감', admin: true })), /\*\*2라운드\*\* MVP는 \*\*루미\*\*/);
  assert.equal(s.db.t.rounds.find((r) => r.id === 'R2').mvp_player_id, 'P2');
  // 투표 중에 확정을 취소하면 마감 때 투표만 접어요
  s.db.t.rounds.find((r) => r.id === 'R2').mvp_vote_status = 'none';
  await s.run({ cmd: 'mvp', sub: '시작', admin: true });
  s.db.t.rounds.find((r) => r.id === 'R2').status = 'pending';
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '마감', admin: true })), /확정이 취소돼서 투표를 접었어요/);
});

test('cleanupEnded: 내전이 끝나면 참가 공지 · 투표만 지우고 결과 · 발표는 남겨요', async () => {
  const s = setup();
  const e1 = () => s.db.t.events.find((e) => e.id === 'E1');
  e1().status = 'open';
  e1().planned_rounds = 1;
  await s.run({ cmd: '채널설정', sub: '공지', admin: true, channels: { 채널: { id: 'C-ANN' } } });
  await s.router.autoAnnounce();                                  // 참가 공지 M1
  assert.equal(await s.router.cleanupEnded(), 0, '시작 전');
  e1().starts_at = iso(-24 - 1);                                  // 1시간 전에 시작
  assert.equal(await s.router.cleanupEnded(), 0, '아직 라운드를 다 안 했어요');
  s.store.update({ posts: [...s.store.get().posts, { e: 'E1', k: 'result', c: 'C-ANN', m: 'RES1' }, { e: 'E1', k: 'mvp-result', c: 'C-ANN', m: 'ANN1' }, { e: 'E1', k: 'round-vote', c: 'C-ANN', m: 'VOTE1' }] });
  s.db.t.rounds.push({ id: 'R9', event_id: 'E1', round_no: 1, status: 'confirmed', confirmed_at: iso(-24), mvp_vote_status: 'open' });
  assert.equal(await s.router.cleanupEnded(), 0, '투표가 아직 열려 있어요');
  s.db.t.rounds.find((r) => r.id === 'R9').mvp_vote_status = 'closed';
  assert.equal(await s.router.cleanupEnded(), 2);
  assert.deepEqual(s.deleted.map((d) => d.id).sort(), ['M1', 'VOTE1']);
  assert.deepEqual(s.store.get().posts.map((p) => p.m), ['RES1', 'ANN1']);
  assert.equal(s.db.t.bot_messages.filter((m) => m.event_id === 'E1').length, 0);
  assert.equal(await s.router.cleanupEnded(), 0, '한 번만');
});

test('eventEnded: 완료 · 12시간 · 예정 라운드를 다 하고 투표도 끝', () => {
  const H = 3600_000;
  const now = Date.parse('2026-11-07T15:00:00Z');
  const ev = (o = {}) => ({ id: 'A', starts_at: new Date(now - 2 * H).toISOString(), status: 'fixed', planned_rounds: 2, ...o });
  const r = (no, o = {}) => ({ event_id: 'A', round_no: no, status: 'confirmed', mvp_vote_status: 'closed', ...o });
  assert.equal(eventEnded(ev({ starts_at: new Date(now + H).toISOString(), status: 'done' }), [], now), false, '시작 전이면 아니에요');
  assert.equal(eventEnded(ev({ status: 'done' }), [], now), true);
  assert.equal(eventEnded(ev(), [], now + 10 * H), true, '시작 12시간 뒤');
  assert.equal(eventEnded(ev(), [r(1)], now), false);
  assert.equal(eventEnded(ev(), [r(1), r(2, { mvp_vote_status: 'open' })], now), false);
  assert.equal(eventEnded(ev(), [r(1), r(2, { status: 'pending' })], now), false);
  assert.equal(eventEnded(ev(), [r(1), r(2, { mvp_vote_status: 'none' })], now), true);
  assert.equal(eventEnded(ev({ planned_rounds: 0 }), [r(1)], now), false);
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

test('기록 비공개: 결과 공지 · MVP 투표를 쉬고, 다시 켜도 쉬는 동안의 판은 안 올려요', async () => {
  const s = setup();
  await s.run({ cmd: '채널설정', sub: '공지', admin: true, channels: { 채널: { id: 'C-ANN' } } });
  await s.router.announceResults();                                  // 처음: 예전 판은 표시만
  const settings = s.db.t.site_settings[0];
  settings.records_public = false;
  s.db.t.rounds.push({ id: 'R2', event_id: 'E0', round_no: 2, status: 'confirmed', confirmed_at: iso(-1), mvp_vote_status: 'none' });
  assert.equal(await s.router.announceResults(), 0);
  assert.equal(s.sent.length, 0, '비공개면 결과도 투표도 안 올려요');
  assert.equal(s.db.t.rounds.find((r) => r.id === 'R2').mvp_vote_status, 'none');
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '시작', admin: true })), /비공개라 라운드 MVP 투표를 쉬고/);

  // 다시 공개: 쉬는 동안 확정한 R2 는 안 올라가고, 새로 확정한 판부터
  settings.records_public = true;
  for (const id of ['R3', 'R4', 'R5']) s.db.t.round_players.push(...s.db.t.round_players.filter((x) => x.round_id === 'R2').map((x) => ({ ...x, round_id: id })));
  assert.equal(await s.router.announceResults(), 0);
  s.db.t.rounds.push({ id: 'R3', event_id: 'E0', round_no: 3, status: 'confirmed', confirmed_at: iso(-0.5), mvp_vote_status: 'none' });
  assert.equal(await s.router.announceResults(), 1);
  assert.equal(s.sent.length, 2, '결과 + 투표');

  // 내전 기록만 끄고 라운드 MVP 는 켜 두면 투표만
  settings.records_items = { results: { on: false } };
  s.db.t.rounds.push({ id: 'R4', event_id: 'E0', round_no: 4, status: 'confirmed', confirmed_at: iso(-0.4), mvp_vote_status: 'none' });
  assert.equal(await s.router.announceResults(), 0);
  assert.equal(s.sent.length, 3);
  assert.equal(s.sent.at(-1).payload.components[0].components[0].custom_id, 'rmvp:R4');

  // 라운드 MVP 만 끄면 결과만
  settings.records_items = { mvp: { on: false } };
  s.db.t.rounds.push({ id: 'R5', event_id: 'E0', round_no: 5, status: 'confirmed', confirmed_at: iso(-0.3), mvp_vote_status: 'none' });
  assert.equal(await s.router.announceResults(), 1);
  assert.equal(s.sent.length, 4);
  assert.match(s.sent.at(-1).payload.embeds[0].title, /5라운드 결과/);

  // 12단계 SQL 전(설정 표가 없음)이면 비공개로 봐요
  delete s.db.t.site_settings;
  s.db.from = ((orig) => (name) => (name === 'site_settings' ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) }) }) } : orig(name)))(s.db.from.bind(s.db));
  assert.deepEqual(await s.service.recordsVisibility(), { results: false, mvp: false });
});

test('선수 등록: 등록 창 → 바로 3티어 선수 + 디스코드 연결, 겹치면 다시', async () => {
  const s = setup();
  const submit = (fields, user = 'D9', nick = '새친구') => s.run({ kind: 'modal', custom: 'regform', user, nick, fields });
  // 빈칸 · 이미 있는 이름이면 다시 (버튼으로 창을 다시 열어요)
  let r = await submit({ name: '', nick: 'newbie' });
  assert.match(s.last(r), /이름을 적어 주세요/);
  r = await submit({ name: '루미', nick: 'newbie' });
  assert.match(s.last(r), /'루미' 이름의 선수가 이미 있어요/);
  assert.equal(r.at(-1).components[0].components[0].custom_id, 'reg:p');
  // 이미 있는 닉네임이면 새로 만들지 않고 연결 요청 (운영진 승인)
  r = await submit({ name: '아무개', nick: 'nadine' });
  assert.match(s.last(r), /이미 무명섬에 있어서 새로 등록하지 않았어요. 대신 '나딘' 선수로 연결 요청/);
  assert.equal(s.db.t.players.length, 4);

  // 등록: 치지직 주소면 채널도 연결
  r = await submit({ name: ' 새  친구 ', nick: 'NewFriend', channel: 'https://chzzk.naver.com/live/0123456789abcdef0123456789ABCDEF' });
  assert.match(s.last(r), /\*\*새 친구\*\* 선수로 등록했어요! \(게임 닉네임 `NewFriend` · 3티어\)/);
  assert.match(s.last(r), /방송 채널도 연결했어요/);
  const p = s.db.t.players.find((x) => x.er_nickname === 'NewFriend');
  assert.deepEqual([p.display_name, p.balance_tier, p.active, p.chzzk_channel_id, p.photo_source], ['새 친구', 3, true, '0123456789abcdef0123456789abcdef', 'chzzk']);
  assert.equal(s.db.t.player_private.find((x) => x.player_id === p.id).discord_id, 'D9');
  assert.equal(s.db.t.tier_history.find((x) => x.player_id === p.id).memo, SELF_REGISTER_MEMO);
  assert.equal(s.db.t.discord_link_requests.filter((x) => x.discord_id === 'D9' && x.status === 'pending').length, 0, '대기 중이던 연결 요청은 지워요');
  // 등록하자마자 내정보 · 참가가 돼요
  assert.match(s.last(await s.run({ cmd: '내정보', user: 'D9' })), /\*\*새 친구\*\* · 3티어/);
  s.db.t.events.find((e) => e.id === 'E1').status = 'open';
  assert.match(s.last(await s.run({ cmd: '참가', user: 'D9' })), /참가 신청 완료|신청했어요/);
  // 다시 등록하려 하면 이미 등록
  assert.match(s.last(await submit({ name: '또', nick: 'another' })), /이미 '새 친구' 선수로 등록돼 있어요/);
  assert.match(s.last(await s.run({ cmd: '등록', user: 'D9' })), /이미 '새 친구' 선수로 등록돼 있어요/);
  assert.equal((await s.run({ cmd: '등록', user: 'D8' }))[0].modal.custom_id, 'regform');
  // 이미 연결된 사람이 없는 닉네임으로 /연결 하면 등록 창 대신 안내
  assert.match(s.last(await s.run({ cmd: '연결', user: 'D9', opts: { 게임닉네임: '없는닉' } })), /무명섬에 없어요/);

  // 유튜브 · 알아볼 수 없는 주소
  r = await submit({ name: '유튜버', nick: 'yt1', channel: 'youtube.com/@mumei' }, 'D7');
  assert.equal(s.db.t.players.find((x) => x.er_nickname === 'yt1').youtube_url, 'https://youtube.com/@mumei');
  r = await submit({ name: '이름만', nick: 'n1', channel: '그냥 이름' }, 'D6');
  assert.match(s.last(r), /방송 채널 주소를 알아보지 못했어요/);
  assert.deepEqual([parseChannel('').ok, parseChannel('abc').ok, parseChannel('https://youtu.be/x').youtube_url], [true, false, 'https://youtu.be/x']);
});

test('새 인원: 들어오면 환영 채널에 안내 → 고르면 지우고, 24시간 지나도 지워요', async () => {
  const s = setup();
  assert.equal(await s.router.welcome({ userId: 'N1' }), false, '공지 · 환영 채널이 없으면 안 올려요');
  await s.run({ cmd: '채널설정', sub: '공지', admin: true, channels: { 채널: { id: 'C-ANN' } } });
  assert.equal(await s.router.welcome({ userId: 'N1' }), true);
  assert.equal(s.sent.at(-1).channelId, 'C-ANN', '환영 채널이 없으면 공지 채널');
  assert.equal(s.sent.at(-1).payload.content, '<@N1>');
  assert.deepEqual(s.sent.at(-1).payload.components[0].components.map((b) => b.custom_id), ['reg:p:N1', 'reg:s:N1']);
  assert.equal(await s.router.welcome({ userId: 'B1', bot: true }), false, '봇은 빼요');
  assert.equal(await s.router.welcome({ userId: 'D2' }), false, '이미 연결된 선수(다시 들어온 사람)는 빼요');
  assert.equal(await s.router.welcome({ userId: 'N1', guild: 'OTHER' }), false);

  await s.run({ cmd: '채널설정', sub: '환영', admin: true, channels: { 채널: { id: 'C-HI' } } });
  await s.router.welcome({ userId: 'N2' });
  assert.equal(s.sent.at(-1).channelId, 'C-HI');
  assert.match(s.last(await s.run({ cmd: '채널설정', sub: '보기', admin: true })), /새 인원 환영 채널: <#C-HI>/);

  // N1 이 [관계자예요] → 답장하고 환영 메시지를 지워요
  assert.match(s.last(await s.run({ kind: 'button', custom: 'reg:s:N1', user: 'N1' })), /관계자로 확인했어요/);
  assert.deepEqual(s.deleted.map((d) => d.id), ['M1']);
  // N2 가 [선수예요] → 등록 창 → 등록하면 환영 메시지를 지워요
  assert.equal((await s.run({ kind: 'button', custom: 'reg:p:N2', user: 'N2', nick: '둘째' }))[0].modal.components[0].components[0].value, '둘째');
  await s.run({ kind: 'modal', custom: 'regform', user: 'N2', fields: { name: '둘째', nick: 'second' } });
  assert.deepEqual(s.deleted.map((d) => d.id), ['M1', 'M2']);
  // 이미 등록된 사람이 버튼을 누르면
  assert.match(s.last(await s.run({ kind: 'button', custom: 'reg:p', user: 'D2' })), /이미 '루미' 선수로 등록돼 있어요/);

  // 24시간 지나면 남은 안내도 지워요
  await s.router.welcome({ userId: 'N3' });
  s.wait(23 * 60);
  assert.equal(await s.router.cleanupWelcomes(), 0);
  s.wait(2 * 60);
  assert.equal(await s.router.cleanupWelcomes(), 1);
  assert.equal((s.store.get().welcomes ?? []).length, 0);

  // /등록안내 (운영진)
  assert.match(s.last(await s.run({ cmd: '등록안내' })), /운영진/);
  await s.run({ cmd: '등록안내', admin: true, channel: 'C-RULES' });
  assert.equal(s.sent.at(-1).channelId, 'C-RULES');
  assert.deepEqual(s.sent.at(-1).payload.components[0].components.map((b) => b.custom_id), ['reg:p', 'reg:s']);
});

test('1티어(오더) 역할: 연결된 1티어에게 주고, 티어가 바뀌거나 연결을 풀면 빼요', async () => {
  const s = setup();
  s.db.t.player_private.push({ player_id: 'P1', discord_id: 'D1' });   // 귀련 1티어
  s.memberRoles.set('D3', new Set(['ROLE1']));                           // 나딘(3티어)이 손으로 받은 역할
  s.memberRoles.set('X9', new Set(['ROLE1']));                           // 무명섬과 상관없는 사람은 안 건드려요
  assert.deepEqual(await s.router.syncTierRole(), { added: 0, removed: 0, failed: 0 }, '역할을 안 정하면 아무것도 안 해요');
  const r = s.last(await s.run({ cmd: '채널설정', sub: '역할', admin: true, roles: { 역할: { id: 'ROLE1' } } }));
  assert.match(r, /1티어\*\* 선수.*<@&ROLE1>/);
  assert.match(r, /1명에게 주고 1명에게서 뺐어요/);
  assert.deepEqual(s.roleCalls, [['add', 'D1'], ['remove', 'D3']]);
  assert.equal(s.memberRoles.get('X9').has('ROLE1'), true);
  assert.match(s.last(await s.run({ cmd: '채널설정', sub: '보기', admin: true })), /1티어\(오더\) 역할: <@&ROLE1>/);

  // 웹에서 루미를 1티어로 올리면 주고, 귀련을 2티어로 내리면 빼요
  s.db.t.players.find((p) => p.id === 'P2').balance_tier = 1;
  s.db.t.players.find((p) => p.id === 'P1').balance_tier = 2;
  assert.deepEqual(await s.router.syncTierRole(), { added: 1, removed: 1, failed: 0 });
  assert.deepEqual(s.roleCalls.slice(2), [['add', 'D2'], ['remove', 'D1']]);
  // 그대로면 아무것도 안 바뀌어요
  assert.deepEqual(await s.router.syncTierRole(), { added: 0, removed: 0, failed: 0 });
  // 루미가 /연결해제 하면 빼요
  s.db.t.player_private.find((x) => x.player_id === 'P2').discord_id = null;
  assert.deepEqual(await s.router.syncTierRole(), { added: 0, removed: 1, failed: 0 });
  // 쉬는 선수(활동 안 함)도 빼요
  s.db.t.player_private.find((x) => x.player_id === 'P2').discord_id = 'D2';
  s.db.t.players.find((p) => p.id === 'P2').active = false;
  assert.deepEqual(await s.router.syncTierRole(), { added: 0, removed: 0, failed: 0 });
  // 권한이 없으면 실패 개수로 알려 줘요
  s.db.t.players.find((p) => p.id === 'P2').active = true;
  s.roleFails(true);
  assert.equal((await s.router.syncTierRole()).failed, 1);
  s.roleFails(false);
  assert.match(s.last(await s.run({ cmd: '채널설정', sub: '역할해제', admin: true })), /1티어 역할 자동 관리를 껐어요/);
  assert.deepEqual(await s.router.syncTierRole(), { added: 0, removed: 0, failed: 0 });

  assert.deepEqual(tierRolePlan({ links: [{ discord_id: 'a', tier: 1, active: true }, { discord_id: 'b', tier: 2 }], managed: ['c', 'a'] }), { add: ['a'], remove: ['b', 'c'], managed: ['a'] });
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

test('공동 소유자: 관리자 추가 · 해제는 되고, 소유자 · 다른 공동 소유자는 못 빼요', async () => {
  const s = setup();
  s.db.t.admins.push(
    { user_id: 'U-CO', discord_id: 'D-CO', discord_name: '공동이', role: 'co_owner', registered_via: '웹에서 받은 키', created_at: new Date(Date.now() - 100 * 60000).toISOString(), last_seen_at: null, revoked_at: null },
    { user_id: 'U-CO2', discord_id: 'D-CO2', discord_name: '공동둘', role: 'co_owner', registered_via: '웹에서 받은 키', created_at: new Date(Date.now() - 90 * 60000).toISOString(), last_seen_at: null, revoked_at: null }
  );
  // 목록: 소유자 → 공동 소유자 → 관리자 순
  const list = s.last(await s.run({ cmd: '관리자목록', user: 'D-CO' }));
  assert.match(list, /👑 \*\*SG\*\* \(소유자\)[\s\S]*🌟 \*\*공동이\*\* \(공동 소유자\)[\s\S]*🛡️ \*\*운석\*\*/);

  // 공동 소유자도 /관리자추가 돼요
  const newbie = { 유저: { id: 'D7', nick: '새 운영진' } };
  assert.match(s.last(await s.run({ cmd: '관리자추가', user: 'D-CO', users: newbie })), /새 운영진 님을 무명섬 관리자로 추가했어요/);
  assert.deepEqual(s.db.calls.at(-1), ['bot_grant_admin', { p_by_discord: 'D-CO', p_discord_id: 'D7', p_name: '새 운영진' }]);

  // 소유자 · 다른 공동 소유자는 못 빼고, 일반 관리자는 빼요
  assert.match(s.last(await s.run({ cmd: '관리자해제', user: 'D-CO', users: { 유저: { id: 'D-SG', nick: 'SG' } } })), /소유자는 해제할 수 없어요/);
  assert.match(s.last(await s.run({ cmd: '관리자해제', user: 'D-CO', users: { 유저: { id: 'D-CO2', nick: '공동둘' } } })), /공동 소유자는 소유자만 뺄 수 있어요/);
  assert.equal(s.db.t.admins.find((x) => x.user_id === 'U-CO2').revoked_at, null);
  assert.match(s.last(await s.run({ cmd: '관리자해제', user: 'D-CO', users: { 유저: { id: 'D-A', nick: '운석' } } })), /운석 님을 무명섬 관리자에서 뺐어요/);

  // 소유자는 공동 소유자를 뺄 수 있고, 빼면 관리자로 내려가요
  assert.match(s.last(await s.run({ cmd: '관리자해제', user: 'D-SG', users: { 유저: { id: 'D-CO2', nick: '공동둘' } } })), /공동둘 님을 무명섬 관리자에서 뺐어요/);
  const co2 = s.db.t.admins.find((x) => x.user_id === 'U-CO2');
  assert.ok(co2.revoked_at);
  assert.equal(co2.role, 'admin');
});

test('/관리자추가: 8단계 SQL 전이면 알려 줘요', async () => {
  const s = setup();
  s.db.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.bot_grant_admin' } });
  assert.match(s.last(await s.run({ cmd: '관리자추가', user: 'D-SG', users: { 유저: { id: 'D7', nick: '새 운영진' } } })), /8단계/);
});

test('autoAnnouncePlan: 모집 중이 되면 바로 · 24시간 전에 한 번 더 · 겹치면 한 번만', () => {
  const H = 3600_000;
  const T0 = Date.parse('2026-11-07T11:00:00Z');                  // 11월 7일 토 20:00 (한국)
  const ev = (o = {}) => ({ id: 'A', title: '11월 7일 내전', starts_at: new Date(T0).toISOString(), status: 'open', ...o });
  // ① 3일 전에 모집 중 → 바로 한 번
  let r = autoAnnouncePlan([ev()], new Map(), {}, T0 - 72 * H);
  assert.deepEqual(r.posts.map((p) => p.kind), ['open']);
  const postedAt = new Map([['A', new Date(T0 - 72 * H).toISOString()]]);
  assert.equal(autoAnnouncePlan([ev()], postedAt, r.marks, T0 - 71 * H).posts.length, 0, '다시 안 올려요');
  // ② 24시간 전이 되면 한 번 더, 그 뒤로는 안 올려요
  r = autoAnnouncePlan([ev()], postedAt, r.marks, T0 - 24 * H + 1000);
  assert.deepEqual(r.posts.map((p) => p.kind), ['d1']);
  assert.equal(autoAnnouncePlan([ev()], new Map([['A', new Date(T0 - 24 * H + 2000).toISOString()]]), r.marks, T0 - 23 * H).posts.length, 0);
  // ③ 시작 20시간 전에 처음 모집 중 → 한 번만 (하루 전 공지 겸)
  r = autoAnnouncePlan([ev()], new Map(), {}, T0 - 20 * H);
  assert.deepEqual(r.posts.map((p) => p.kind), ['open']);
  assert.equal(autoAnnouncePlan([ev()], new Map([['A', new Date(T0 - 20 * H).toISOString()]]), r.marks, T0 - 19 * H).posts.length, 0);
  // ④ /내전공지 로 이미 올렸으면: 24시간 밖이면 하루 전에만, 24시간 안에 올렸으면 안 올려요
  r = autoAnnouncePlan([ev()], new Map([['A', new Date(T0 - 50 * H).toISOString()]]), {}, T0 - 40 * H);
  assert.equal(r.posts.length, 0);
  assert.deepEqual(autoAnnouncePlan([ev()], new Map([['A', new Date(T0 - 50 * H).toISOString()]]), r.marks, T0 - 23 * H).posts.map((p) => p.kind), ['d1']);
  assert.equal(autoAnnouncePlan([ev()], new Map([['A', new Date(T0 - 2 * H).toISOString()]]), {}, T0 - H).posts.length, 0);
  // ⑤ 예정은 안 올려요, 확정은 하루 전에만, 끝났거나 시작한 내전은 무시 (기록도 지워요)
  assert.equal(autoAnnouncePlan([ev({ status: 'plan' })], new Map(), {}, T0 - 10 * H).posts.length, 0);
  assert.equal(autoAnnouncePlan([ev({ status: 'fixed' })], new Map(), {}, T0 - 30 * H).posts.length, 0);
  assert.deepEqual(autoAnnouncePlan([ev({ status: 'fixed' })], new Map(), {}, T0 - 10 * H).posts.map((p) => p.kind), ['d1']);
  assert.deepEqual(autoAnnouncePlan([ev()], new Map(), { A: { open: true } }, T0 + H), { posts: [], marks: {} });
  // ⑥ 하루 전 공지 뒤에 일정을 이틀 미루면, 새 시각 기준 24시간 전에 다시
  r = autoAnnouncePlan([ev()], postedAt, { A: { open: true } }, T0 - 10 * H);
  const moved = ev({ starts_at: new Date(T0 + 48 * H).toISOString() });
  assert.equal(autoAnnouncePlan([moved], new Map([['A', new Date(T0 - 10 * H).toISOString()]]), r.marks, T0 - 9 * H).posts.length, 0);
  assert.deepEqual(autoAnnouncePlan([moved], new Map([['A', new Date(T0 - 10 * H).toISOString()]]), r.marks, T0 + 25 * H).posts.map((p) => p.kind), ['d1']);
});

test('autoAnnounceText · kstWhenWord: 한국 시간으로 오늘 · 내일', () => {
  const start = '2026-11-07T11:00:00Z';                              // 토 20:00
  assert.equal(kstWhenWord(start, Date.parse('2026-11-06T12:00:00Z')), '내일 오후 8시');   // 금 21:00
  assert.equal(kstWhenWord(start, Date.parse('2026-11-07T01:00:00Z')), '오늘 오후 8시');   // 토 10:00
  assert.equal(kstWhenWord('2026-11-07T11:30:00Z', Date.parse('2026-11-06T16:00:00Z')), '오늘 오후 8시 30분');   // 토 01:00 → 오늘
  assert.equal(kstWhenWord('2026-11-07T03:00:00Z', Date.parse('2026-11-04T03:00:00Z')), '3일 뒤 오후 12시');
  const e = { starts_at: start, status: 'open' };
  assert.match(autoAnnounceText({ event: e, kind: 'open' }, Date.parse('2026-11-03T00:00:00Z')), /^📢 \*\*참가 모집을 시작했어요!/);
  assert.match(autoAnnounceText({ event: e, kind: 'open' }, Date.parse('2026-11-06T12:00:00Z')), /참가 모집 시작! 내일 오후 8시 내전이에요/);
  assert.match(autoAnnounceText({ event: e, kind: 'd1' }, Date.parse('2026-11-06T11:00:00Z')), /^⏰ \*\*내일 오후 8시 내전이에요!\*\* 아직 신청/);
  assert.match(autoAnnounceText({ event: { ...e, status: 'fixed' }, kind: 'd1' }, Date.parse('2026-11-06T11:00:00Z')), /참가 명단이 확정됐어요/);
});

test('autoAnnounce: 공지 채널이 있을 때만, 한 번만 올리고 예전 공지 버튼은 떼요', async () => {
  const s = setup();
  s.db.t.events.find((e) => e.id === 'E1').status = 'open';         // 내일 20:00 (지금부터 23시간 뒤) 내전을 모집 중으로
  assert.equal(await s.router.autoAnnounce(), 0, '공지 채널이 없으면 안 올려요');
  assert.equal(s.sent.length, 0);
  await s.run({ cmd: '채널설정', sub: '공지', admin: true, channels: { 채널: { id: 'C-ANN' } } });
  assert.equal(await s.router.autoAnnounce(), 1);
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].channelId, 'C-ANN');
  assert.match(s.sent[0].payload.content, /참가 모집 시작! 내일 오후 8시 내전이에요/);
  assert.equal(s.sent[0].payload.components[0].components[0].disabled, false, '참가하기 버튼');
  assert.equal(s.db.t.bot_messages.length, 1);
  assert.equal(await s.router.autoAnnounce(), 0, '다시 안 올려요');
  // 올리다 실패하면 다음 번에 다시
  const t = setup(() => 0.99, { postable: true });
  t.db.t.events.find((e) => e.id === 'E1').status = 'open';
  await t.run({ cmd: '채널설정', sub: '공지', admin: true, channels: { 채널: { id: 'C-ANN' } } });
  const realSend = t.router;
  t.failSend(true);
  assert.equal(await realSend.autoAnnounce(), 0);
  t.failSend(false);
  assert.equal(await realSend.autoAnnounce(), 1);
});

test('/소개공지: 운영진만 · 창에서 고친 제목 · 내용으로 그림 + 사이트 버튼 공지', async () => {
  const s = setup();
  assert.match(s.last(await s.run({ cmd: '소개공지' })), /운영진/);
  // 명령어 채널을 정해 두면 안내에 그 채널이 들어가요
  await s.run({ cmd: '채널설정', sub: '명령어', admin: true, channel: 'C-CMD' });
  const r = await s.run({ cmd: '소개공지', user: 'D-A' });                       // 서버 관리자가 아니어도 무명섬 관리자면 돼요
  const modal = r.at(-1).modal;
  assert.equal(modal.custom_id, 'intro');
  assert.match(modal.components[1].components[0].value, /<#C-CMD> 에서 `\/연결 게임닉네임`/);
  assert.ok(modal.title.length <= 45 && modal.components.every((row) => row.components[0].label.length <= 45));

  // 창에서 보내기 → 그 채널에
  assert.match(s.last(await s.run({ kind: 'modal', custom: 'intro', fields: { title: '잘 왔군', body: '나의 무명섬에.' } })), /운영진/);
  const done = s.last(await s.run({ kind: 'modal', custom: 'intro', user: 'D-SG', channel: 'C-HELLO', fields: { title: ' 잘 왔군 ', body: '나의 무명섬에.' } }));
  assert.match(done, /소개 공지를 이 채널에 올렸어요/);
  const m = s.sent.at(-1);
  assert.equal(m.channelId, 'C-HELLO');
  const e = m.payload.embeds[0];
  assert.deepEqual([e.title, e.url, e.description, e.image.url], ['잘 왔군', 'https://mumei.test', '나의 무명섬에.', 'https://mumei.test/welcome.png']);
  assert.deepEqual(m.payload.components[0].components.map((b) => [b.style, b.url]), [[5, 'https://mumei.test'], [5, 'https://mumei.test/schedule'], [5, 'https://mumei.test/matches'], [5, 'https://mumei.test/players'], [5, 'https://mumei.test/rules']]);
  // 다른 창 · 권한 없는 채널
  assert.equal((await s.run({ kind: 'modal', custom: 'other', user: 'D-SG' })).length, 0);
  const t = setup(() => 0.99, { postable: false });
  assert.match(t.last(await t.run({ kind: 'modal', custom: 'intro', user: 'D-SG', fields: { title: 'a', body: 'b' } })), /글을 쓸 수 없어요/);
  assert.equal(t.sent.length, 0);
});

test('introDefaults · introMessage: 명령어 채널이 없으면 "아무 채널에서", 사이트 주소가 없으면 그림 · 버튼 없이', () => {
  assert.match(introDefaults().body, /아무 채널에서 `\/연결 게임닉네임`/);
  assert.ok(introDefaults().body.length <= 4000);
  const m = introMessage({ title: '', body: 'x', siteUrl: '' });
  assert.deepEqual([m.embeds[0].title, m.embeds[0].image, m.components.length], ['무명섬', undefined, 0]);
});

test('cleanupDeleted: 웹에서 내전을 지우면 그 내전의 디스코드 메시지도 지워요', async () => {
  const s = setup();
  const dropEvent = (id) => {   // 웹에서 삭제 = events 행 삭제 + bot_messages 가 같이 지워짐 (on delete cascade)
    s.db.t.events = s.db.t.events.filter((e) => e.id !== id);
    s.db.t.bot_messages = s.db.t.bot_messages.filter((m) => m.event_id !== id);
  };
  // 배포 전부터 DB 에 있던 공지 기록 → 처음 정리 때 기억해 둬요 (그 전에 다른 메시지를 먼저 기억했어도)
  s.db.t.bot_messages.push({ event_id: 'E0', kind: 'signup', channel_id: 'C-OLD', message_id: 'OLD1', created_at: iso(-200) });
  s.store.update({ posts: [{ e: 'E9', k: 'result', c: 'C-X', m: 'NEW0', t: iso(-1) }] });
  assert.equal(await s.router.cleanupDeleted(), 1, '이미 지워진 내전 E9 의 메시지는 바로 지워요');
  assert.deepEqual(s.deleted.map((d) => d.id), ['NEW0']);
  assert.deepEqual(s.store.get().posts.map((p) => p.m), ['OLD1']);
  s.deleted.length = 0;

  // E1: 자동 공지 + /내전공지 (예전 공지 포함 두 개)
  s.db.t.events.find((e) => e.id === 'E1').status = 'open';
  await s.run({ cmd: '채널설정', sub: '공지', admin: true, channels: { 채널: { id: 'C-ANN' } } });
  await s.router.autoAnnounce();
  await s.run({ cmd: '내전공지', admin: true, opts: { 내전: 'E1' } });
  assert.deepEqual(s.store.get().posts.filter((p) => p.e === 'E1').map((p) => [p.k, p.c]), [['signup', 'C-ANN'], ['signup', 'C-ANN']]);
  assert.equal(await s.router.cleanupDeleted(), 0, '내전이 있으면 안 지워요');
  assert.equal(s.deleted.length, 0);

  // E1 삭제 → 두 메시지 다 지워요, E0 은 그대로
  dropEvent('E1');
  assert.equal(await s.router.cleanupDeleted(), 2);
  assert.deepEqual(s.deleted.map((d) => d.id).sort(), ['M1', 'M2']);
  assert.deepEqual(s.store.get().posts.map((p) => p.m), ['OLD1']);
  assert.equal(await s.router.cleanupDeleted(), 0, '두 번 지우지 않아요');

  // E0 삭제: 예전 테스트 서버처럼 봇이 못 들어가는 채널이면 잊어요
  s.deleteFails.OLD1 = 50001;
  dropEvent('E0');
  assert.equal(await s.router.cleanupDeleted(), 0);
  assert.equal(s.store.get().posts.length, 0);
});

test('cleanupDeleted: 잠깐 실패하면 다시 (5번까지), 라운드 결과 · MVP 발표도 지워요', async () => {
  const s = setup();
  await s.run({ cmd: '채널설정', sub: '공지', admin: true, channels: { 채널: { id: 'C-ANN' } } });
  // 라운드 결과 공지 (E0 의 R2): 처음 한 번은 표시만, 그다음 새 확정부터 올라가요
  await s.router.announceResults();
  s.db.t.rounds.push({ id: 'R2', event_id: 'E0', round_no: 2, status: 'confirmed', confirmed_at: iso(-1) });
  assert.equal(await s.router.announceResults(), 1);
  assert.deepEqual(s.store.get().posts.map((p) => [p.e, p.k]), [['E0', 'result'], ['E0', 'round-vote']]);   // 결과 + 라운드 MVP 투표
  await s.router.closeDueVotes();
  s.store.update({ posts: s.store.get().posts.filter((p) => p.k === 'result') });
  const id = s.store.get().posts[0].m;
  s.deleteFails[id] = 500;
  s.db.t.events = s.db.t.events.filter((e) => e.id !== 'E0');
  for (let n = 1; n <= 4; n++) { await s.router.cleanupDeleted(); assert.equal(s.store.get().posts[0].n, n); }
  delete s.deleteFails[id];
  assert.equal(await s.router.cleanupDeleted(), 1);
  assert.equal(s.store.get().posts.length, 0);
});

test('라운드 MVP: 자동 마감과 /mvp 마감이 겹쳐도 발표는 한 번만', async () => {
  const s = setup();
  await s.run({ cmd: '채널설정', sub: '공지', admin: true, channels: { 채널: { id: 'C-ANN' } } });
  s.db.t.rounds.push({ id: 'R2', event_id: 'E0', round_no: 2, status: 'confirmed', confirmed_at: iso(-1), mvp_vote_status: 'none' });
  await s.run({ cmd: 'mvp', sub: '시작', admin: true });
  await s.run({ kind: 'select', custom: 'rmvp:R2', values: ['P2'], user: 'D3' });
  s.wait(31);
  const [a, b] = await Promise.all([s.router.closeDueVotes(), s.run({ cmd: 'mvp', sub: '마감', admin: true })]);
  const shown = s.sent.filter((m) => /MVP는/.test(m.payload.embeds?.[0]?.title ?? ''));
  assert.equal(shown.length, 1, `발표 ${shown.length}번 (${a}, ${s.last(b)})`);
});
