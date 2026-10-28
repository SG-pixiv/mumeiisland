// DB 접근은 전부 여기를 거쳐요. Supabase 가 연결돼 있으면 진짜 DB, 아니면 demo.js 예시 데이터.
import { supabase, isDemo } from './supabase.js';
import { tables, views } from './demo.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

function applyFilters(rows, { eq = {}, inn = {}, gte = {}, lte = {}, neq = {}, isNull = [], notNull = [] }) {
  return rows.filter((r) =>
    Object.entries(eq).every(([k, v]) => r[k] === v) &&
    Object.entries(neq).every(([k, v]) => r[k] !== v) &&
    Object.entries(inn).every(([k, v]) => v.includes(r[k])) &&
    Object.entries(gte).every(([k, v]) => r[k] >= v) &&
    Object.entries(lte).every(([k, v]) => r[k] <= v) &&
    isNull.every((k) => r[k] === null || r[k] === undefined) &&
    notNull.every((k) => r[k] !== null && r[k] !== undefined)
  );
}

function check({ data, error }) {
  if (error) throw error;
  return data;
}

/**
 * select('players', { eq: { active: true }, order: 'display_name', asc: true, limit: 10 })
 */
export async function select(table, opts = {}) {
  const { order, asc = true, limit, columns = '*' } = opts;
  if (isDemo) {
    const base = views[table] ? views[table]() : tables[table] || [];
    let rows = applyFilters(base, opts);
    if (order) rows = rows.slice().sort((a, b) => (a[order] > b[order] ? 1 : a[order] < b[order] ? -1 : 0) * (asc ? 1 : -1));
    if (limit) rows = rows.slice(0, limit);
    return clone(rows);
  }
  let q = supabase.from(table).select(columns);
  for (const [k, v] of Object.entries(opts.eq || {})) q = q.eq(k, v);
  for (const [k, v] of Object.entries(opts.neq || {})) q = q.neq(k, v);
  for (const [k, v] of Object.entries(opts.inn || {})) q = q.in(k, v);
  for (const [k, v] of Object.entries(opts.gte || {})) q = q.gte(k, v);
  for (const [k, v] of Object.entries(opts.lte || {})) q = q.lte(k, v);
  for (const k of opts.isNull || []) q = q.is(k, null);
  for (const k of opts.notNull || []) q = q.not(k, 'is', null);
  if (order) q = q.order(order, { ascending: asc });
  if (limit) q = q.limit(limit);
  return check(await q) || [];
}

export async function insert(table, rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (isDemo) {
    const made = list.map((r) => ({ id: r.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
    (tables[table] ||= []).push(...made);
    return clone(made);
  }
  return check(await supabase.from(table).insert(list).select()) || [];
}

export async function update(table, values, eq) {
  if (isDemo) {
    const rows = applyFilters(tables[table] || [], { eq });
    rows.forEach((r) => Object.assign(r, values));
    return clone(rows);
  }
  let q = supabase.from(table).update(values);
  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  return check(await q.select()) || [];
}

export async function upsert(table, rows, keys = ['id']) {
  const list = Array.isArray(rows) ? rows : [rows];
  if (isDemo) {
    const t = (tables[table] ||= []);
    for (const r of list) {
      const hit = t.find((x) => keys.every((k) => x[k] === r[k]));
      if (hit) Object.assign(hit, r); else t.push({ ...r });
    }
    return clone(list);
  }
  return check(await supabase.from(table).upsert(list, { onConflict: keys.join(',') }).select()) || [];
}

export async function remove(table, eq) {
  if (isDemo) {
    const t = tables[table] || [];
    const keep = t.filter((r) => !Object.entries(eq).every(([k, v]) => r[k] === v));
    tables[table] = keep;
    return;
  }
  let q = supabase.from(table).delete();
  for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  check(await q);
}

// ── 서버 함수 (SQL 함수 · Edge Function)
const demoRpc = {
  is_admin: () => true,
  is_owner: () => true,
  owner_exists: () => true,
  touch_admin: () => null,
  claim_owner: () => ({ ok: true }),
  redeem_admin_key: () => ({ ok: true }),
  set_player_tier: ({ p_player, p_tier, p_memo }) => {
    const p = tables.players.find((x) => x.id === p_player);
    if (!p || p.balance_tier === p_tier) return null;
    tables.tier_history.push({ id: Date.now(), player_id: p_player, from_tier: p.balance_tier, to_tier: p_tier, memo: p_memo || null, changed_by: 'demo-owner', changed_at: new Date().toISOString() });
    p.balance_tier = p_tier;
    return null;
  },
  create_admin_key: ({ p_memo, p_target, p_ttl_hours }) => {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const k = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => abc[b % 32]).join('');
    tables.admin_keys.push({ id: crypto.randomUUID(), key_hash: 'demo', prefix: k.slice(0, 4), memo: p_memo || null, target_discord: (p_target || '').replace(/^@/, '').toLowerCase() || null, expires_at: new Date(Date.now() + p_ttl_hours * 3600000).toISOString(), created_by: 'demo-owner', created_via: 'web', created_at: new Date().toISOString(), used_at: null, used_by: null, revoked_at: null });
    return `${k.slice(0, 4)}-${k.slice(4, 8)}-${k.slice(8)}`;
  },
  revoke_admin_key: ({ p_id }) => { const k = tables.admin_keys.find((x) => x.id === p_id); if (k) k.revoked_at = new Date().toISOString(); return null; },
  grant_admin: ({ p_discord_id, p_name }) => {
    const did = String(p_discord_id || '').trim();
    if (!/^[0-9]{15,21}$/.test(did)) throw new Error('디스코드 사용자 ID(숫자 17~19자리)를 확인해 주세요');
    const cur = tables.admins.find((a) => a.discord_id === did);
    if (cur && !cur.revoked_at) return { ok: true, state: 'already', name: cur.discord_name };
    if (cur) { cur.revoked_at = null; cur.registered_via = '소유자가 웹에서 추가'; return { ok: true, state: 'added', name: cur.discord_name }; }
    tables.admin_grants = (tables.admin_grants || []).filter((g) => g.discord_id !== did);
    tables.admin_grants.push({ discord_id: did, discord_name: (p_name || '').trim() || null, created_by: 'demo-owner', created_via: 'web', created_at: new Date().toISOString(), used_at: null, used_by: null, revoked_at: null });
    return { ok: true, state: 'pending', name: (p_name || '').trim() || null };
  },
  revoke_admin_grant: ({ p_discord_id }) => { const g = (tables.admin_grants || []).find((x) => x.discord_id === p_discord_id && !x.used_at); if (g) g.revoked_at = new Date().toISOString(); return null; },
  claim_admin_grant: () => true,
  set_admin_revoked: ({ p_user, p_revoked }) => { const a = tables.admins.find((x) => x.user_id === p_user && x.role !== 'owner'); if (a) a.revoked_at = p_revoked ? new Date().toISOString() : null; return null; },
  decide_discord_link: ({ p_id, p_ok }) => {
    const r = (tables.discord_link_requests || []).find((x) => x.id === p_id);
    if (!r || r.status !== 'pending') throw new Error('이미 처리된 요청이에요');
    if (p_ok) {
      tables.player_private.forEach((x) => { if (x.discord_id === r.discord_id && x.player_id !== r.player_id) x.discord_id = null; });
      const pp = tables.player_private.find((x) => x.player_id === r.player_id);
      if (pp) pp.discord_id = r.discord_id; else tables.player_private.push({ player_id: r.player_id, discord_id: r.discord_id, memo: null });
    }
    r.status = p_ok ? 'approved' : 'rejected'; r.decided_at = new Date().toISOString();
    return null;
  },
  create_device_key: ({ p_name }) => {
    if (!String(p_name || '').trim()) throw new Error('장치 이름을 적어 주세요');
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const k = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => abc[b % 32]).join('');
    tables.upload_devices.push({ id: crypto.randomUUID(), name: p_name.trim(), key_hash: 'demo', prefix: k.slice(0, 4), created_by: 'demo-owner', created_at: new Date().toISOString(), last_seen_at: null, last_file: null, revoked_at: null });
    return k.match(/.{4}/g).join('-');
  },
  set_live: ({ p_event, p_state, p_round }) => {
    const ev = tables.events.find((e) => e.id === p_event);
    if (!ev) throw new Error('내전을 찾지 못했어요');
    const now = new Date().toISOString();
    if (p_state !== 'idle') tables.events.forEach((e) => { if (e.id !== p_event && e.live_state !== 'idle') Object.assign(e, { live_state: 'idle', live_changed_at: now }); });
    Object.assign(ev, { live_state: p_state, live_round: p_state === 'idle' ? ev.live_round : p_round, live_changed_at: now });
    return null;
  },
  mvp_vote_count: ({ p_event }) => (tables.mvp_votes || []).filter((v) => v.event_id === p_event).length,
  revoke_device: ({ p_id }) => { const d = tables.upload_devices.find((x) => x.id === p_id); if (d) d.revoked_at = new Date().toISOString(); return null; },
  confirm_round: ({ p_round, p_event, p_round_no, p_teams, p_players }) => {
    const r = tables.rounds.find((x) => x.id === p_round);
    if (!r) throw new Error('라운드를 찾지 못했어요');
    if (tables.rounds.some((x) => x.id !== p_round && x.event_id === p_event && x.round_no === p_round_no)) throw new Error(`이 내전에 이미 ${p_round_no}라운드가 있어요. 라운드 번호를 바꿔 주세요`);
    Object.assign(r, { event_id: p_event, round_no: p_round_no, status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: 'demo-owner' });
    tables.round_teams = tables.round_teams.filter((t) => t.round_id !== p_round).concat(p_teams.map((t) => ({ round_id: p_round, ...t })));
    tables.round_players = tables.round_players.filter((x) => x.round_id !== p_round).concat(p_players.map((x, i) => ({ id: Date.now() + i, round_id: p_round, damage: 0, ...x })));
    return null;
  }
};

export async function rpc(fn, args = {}) {
  if (isDemo) return clone(demoRpc[fn] ? demoRpc[fn](args) ?? null : null);
  return check(await supabase.rpc(fn, args));
}

export async function invokeFunction(name, body = {}) {
  if (isDemo) {
    if (name === 'er-sync') {
      const list = tables.players.filter((p) => p.active && (!body.player_id || p.id === body.player_id));
      const now = new Date().toISOString();
      list.forEach((p) => { const s = tables.player_rank_stats.find((x) => x.player_id === p.id); if (s) { s.synced_at = now; s.sync_error = null; } });
      return { season_id: 33, total: list.length, done: list.length, next_offset: null, demo: true, results: list.map((p) => ({ player_id: p.id, name: p.display_name, ok: true })) };
    }
    if (name === 'live-sync') return { demo: true, checked: 0, live: [], errors: [] };
    return { demo: true };
  }
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    // 함수가 보낸 오류 메시지를 꺼내요
    let msg = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* 그대로 */ }
    throw new Error(msg);
  }
  return data;
}

// ── 로그인 (디스코드)
const demoUser = { id: 'demo-owner', user_metadata: { full_name: 'demo', custom_claims: { global_name: 'SG (데모)' }, avatar_url: null } };

export const auth = {
  async session() {
    if (isDemo) return { user: demoUser };
    const { data } = await supabase.auth.getSession();
    return data.session;
  },
  async signInDiscord(redirectTo) {
    if (isDemo) { location.href = redirectTo; return; }
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'discord', options: { redirectTo, scopes: 'identify' } });
    if (error) throw error;
  },
  async signOut() {
    if (isDemo) return;
    await supabase.auth.signOut();
  },
  displayName(user) {
    const m = user?.user_metadata || {};
    return m.custom_claims?.global_name || m.full_name || m.name || '운영진';
  },
  avatarUrl(user) {
    return user?.user_metadata?.avatar_url || '';
  }
};
