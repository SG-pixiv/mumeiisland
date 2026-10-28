// 디스코드 봇: 가짜 DB(Supabase 흉내) + 가짜 디스코드로 실제 쓰는 흐름을 처음부터 끝까지 확인해요
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../bot/src/service.js';
import { createRouter, EPHEMERAL } from '../bot/src/router.js';
import { tally, eventChoices, joinProblem, signupMessage, pickMvpEvent } from '../bot/src/logic.js';
import { commands } from '../bot/src/commands.js';

// ── 가짜 Supabase
const KEYS = {
  events: ['id'], players: ['id'], player_private: ['player_id'], event_participants: ['event_id', 'player_id'],
  event_teams: ['event_id', 'player_id'], bot_messages: ['event_id', 'kind'], mvp_votes: ['event_id', 'voter_player_id'],
  player_rank_stats: ['player_id'], discord_link_requests: ['id']
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
      if (this.head) return { data: null, error: null, count: out.length };
      if (this.one) return out.length > 1 ? { data: null, error: { message: 'multiple rows' } } : { data: out[0] ? structuredClone(out[0]) : null, error: null };
      return { data: structuredClone(out), error: null };
    }
  }
  return {
    t, calls,
    from: (name) => new Q(name),
    rpc: async (name, args) => { calls.push([name, args]); return name === 'bot_create_admin_key' ? { data: 'ABCD-EFGH-JKLM', error: null } : { data: null, error: { message: 'no rpc' } }; }
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
  event_teams: [], bot_messages: [], mvp_votes: [], discord_link_requests: []
});

// ── 가짜 디스코드
function setup(rng = () => 0.99) {
  const db = fakeDb(seed());
  const service = createService(db, { siteUrl: 'https://mumei.test', rng, now: () => NOW });
  const sent = [], edits = [];
  let gone = new Set();
  const router = createRouter({
    service, guildId: 'G', siteUrl: 'https://mumei.test', log: { warn() {}, info() {} },
    sendMessage: async (channelId, payload) => { const m = { id: `M${sent.length + 1}`, channelId }; sent.push({ ...m, payload }); return m; },
    editMessage: async (channelId, id, payload) => { if (gone.has(id)) throw Object.assign(new Error('Unknown Message'), { code: 10008 }); edits.push({ channelId, id, payload }); }
  });
  const run = async (o) => {
    const replies = [];
    const i = {
      guildId: o.guild ?? 'G', channelId: 'C1', user: { id: o.user ?? 'D1', username: 'user' }, member: { displayName: o.nick ?? '디코닉' },
      memberPermissions: { has: (bit) => !!o.admin && bit === 8n },
      commandName: o.cmd, customId: o.custom, values: o.values,
      options: { getString: (k) => o.opts?.[k] ?? null, getSubcommand: () => o.sub, getFocused: () => o.focus ?? '' },
      isAutocomplete: () => o.kind === 'auto', isButton: () => o.kind === 'button', isStringSelectMenu: () => o.kind === 'select', isChatInputCommand: () => (o.kind ?? 'cmd') === 'cmd',
      deferReply: async (x) => { replies.push({ defer: x }); },
      editReply: async (x) => { replies.push(x); }, reply: async (x) => { replies.push(x); }, respond: async (x) => { replies.push({ choices: x }); }
    };
    await router.handle(i);
    return replies;
  };
  const last = (r) => r[r.length - 1]?.content ?? '';
  return { db, service, router, run, last, sent, edits, gone };
}

test('명령어 목록: 이름 · 설명 길이가 디스코드 규칙에 맞아요', () => {
  const ok = /^[-_\p{L}\p{N}]{1,32}$/u;
  for (const c of commands) {
    assert.match(c.name, ok); assert.ok(c.description.length <= 100, c.name);
    for (const o of c.options ?? []) { assert.match(o.name, ok); assert.ok(o.description.length <= 100); for (const s of o.options ?? []) assert.ok(s.description.length <= 100); }
  }
  assert.deepEqual(commands.filter((c) => c.default_member_permissions).map((c) => c.name), ['내전공지', 'mvp', '관리자키']);
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
});

test('/내전공지 → 버튼으로 참가 · 취소, 인원 메시지가 바로 바뀌어요', async () => {
  const s = setup();
  s.db.t.player_private.push({ player_id: 'P1', discord_id: 'D1' });
  assert.match(s.last(await s.run({ cmd: '내전공지' })), /서버 관리자만/);
  assert.match(s.last(await s.run({ cmd: '내전공지', admin: true })), /공지를 올렸어요/);
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
  assert.match(s.last(await s.run({ cmd: 'mvp', sub: '시작', admin: true, opts: { 내전: 'E0' } })), /MVP 투표를 열었어요/);
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
  assert.match(s.last(await s.run({ cmd: '관리자키', user: 'D7' })), /서버 관리자만/);
  const r = s.last(await s.run({ cmd: '관리자키', user: 'D7', admin: true, nick: '새 운영진' }));
  assert.match(r, /ABCD-EFGH-JKLM/);
  assert.match(r, /https:\/\/mumei\.test\/login/);
  assert.deepEqual(s.db.calls, [['bot_create_admin_key', { p_discord_id: 'D7', p_discord_name: '새 운영진' }]]);
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
