// 무명섬 디스코드 봇: DB(Supabase) 와 주고받는 일. 디스코드 쪽은 index.js 가 맡아요.
// db = Supabase 클라이언트 (비밀 키 · service_role). 테스트에서는 가짜 DB 를 넣어요.

import {
  shortKst, pickSignupEvent, pickAnnounceEvent, pickMvpEvent, pickOpenVoteEvent, eventChoices,
  joinProblem, leaveProblem, voteProblem, tally, signupMessage, mvpMessage, mvpResultMessage, roundResultMessage
} from './logic.js';

export function createService(db, { siteUrl = '', rng = Math.random, now = () => Date.now() } = {}) {
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message || String(error));
    return data;
  };
  const id = (v) => String(v ?? '').trim();

  // ── 읽기
  const allEvents = async () => must(await db.from('events').select('*').order('starts_at', { ascending: true })) ?? [];
  const eventById = async (eventId) => (eventId ? must(await db.from('events').select('*').eq('id', eventId).maybeSingle()) : null);
  const playersByIds = async (ids) => {
    if (!ids.length) return new Map();
    const rows = must(await db.from('players').select('id, display_name, er_nickname, balance_tier, active').in('id', ids)) ?? [];
    return new Map(rows.map((p) => [p.id, p]));
  };
  /** 디스코드 계정에 연결된 선수 */
  const playerByDiscord = async (discordId) => {
    const link = must(await db.from('player_private').select('player_id').eq('discord_id', id(discordId)).maybeSingle());
    if (!link) return null;
    return must(await db.from('players').select('id, display_name, er_nickname, balance_tier, active').eq('id', link.player_id).maybeSingle());
  };
  const participantRows = async (eventId) => must(await db.from('event_participants').select('*').eq('event_id', eventId)) ?? [];
  /** 참가자 [{ id, name, tier }] (tier = 이번 내전 자리) */
  const participants = async (eventId) => {
    const parts = await participantRows(eventId);
    const byId = await playersByIds(parts.map((p) => p.player_id));
    return parts.map((p) => {
      const pl = byId.get(p.player_id);
      return pl ? { id: pl.id, name: pl.display_name, tier: p.slot_tier || pl.balance_tier } : null;
    }).filter(Boolean).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, 'ko'));
  };
  const resolveEvent = async (eventId, pick) => (eventId ? eventById(eventId) : pick(await allEvents(), now()));

  // ── 봇이 올린 메시지
  const getMessage = async (eventId, kind) => must(await db.from('bot_messages').select('*').eq('event_id', eventId).eq('kind', kind).maybeSingle());
  const saveMessage = async (eventId, kind, channelId, messageId) => {
    must(await db.from('bot_messages').upsert({ event_id: eventId, kind, channel_id: id(channelId), message_id: id(messageId), created_at: new Date(now()).toISOString() }, { onConflict: 'event_id,kind' }));
  };
  const dropMessage = async (eventId, kind) => { must(await db.from('bot_messages').delete().eq('event_id', eventId).eq('kind', kind)); };

  const signupPayload = async (event) => signupMessage(event, await participants(event.id), siteUrl);
  const candidates = async (eventId) => {
    const [list, teams] = await Promise.all([participants(eventId), db.from('event_teams').select('player_id, team_no').eq('event_id', eventId).then(must)]);
    const teamOf = new Map((teams ?? []).map((t) => [t.player_id, t.team_no]));
    return list.map((p) => ({ ...p, team: teamOf.get(p.id) ?? null }));
  };
  const mvpPayload = async (event) => {
    const [cands, votes] = await Promise.all([candidates(event.id), db.from('mvp_votes').select('voter_player_id').eq('event_id', event.id).then(must)]);
    return mvpMessage(event, cands, (votes ?? []).length, cands.length);
  };

  /** 소유자가 추가했지만 아직 사이트에 로그인하지 않은 사람 (8단계 SQL 전이면 없음) */
  const pendingGrants = async (discordId = null) => {
    let q = db.from('admin_grants').select('discord_id, discord_name, created_via, created_at, used_at, revoked_at');
    if (discordId) q = q.eq('discord_id', id(discordId));
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []).filter((g) => !g.used_at && !g.revoked_at);
  };

  /** 무명섬 관리자인 디스코드 계정인지 (해제된 사람 빼고, 로그인 전 예약 포함) */
  const webAdmin = async (discordId) => {
    const rows = must(await db.from('admins').select('user_id, discord_id, discord_name, role, revoked_at').eq('discord_id', id(discordId))) ?? [];
    const admin = rows.find((r) => !r.revoked_at);
    if (admin) return admin;
    const [grant] = await pendingGrants(discordId);
    return grant ? { user_id: null, discord_id: grant.discord_id, discord_name: grant.discord_name, role: 'admin', pending: true } : null;
  };

  return {
    webAdmin, allEvents, eventById, playerByDiscord, participants, getMessage, saveMessage, dropMessage, signupPayload, mvpPayload,

    /** 내전 자동완성 */
    async eventChoices(query) { return eventChoices(await allEvents(), query, now()); },

    /** /연결 게임닉네임 → 관리자 승인 대기 */
    async requestLink({ discordId, discordName, nickname }) {
      const nick = String(nickname ?? '').trim();
      if (!nick) return { ok: false, text: '게임 닉네임을 적어 주세요.' };
      const players = must(await db.from('players').select('id, display_name, er_nickname, active')) ?? [];
      const hit = players.find((p) => String(p.er_nickname).trim().toLowerCase() === nick.toLowerCase());
      if (!hit) return { ok: false, text: `'${nick}' 닉네임의 선수가 무명섬에 없어요. 운영진에게 선수 등록을 부탁해 주세요! (닉네임을 바꿨다면 새 닉네임으로 등록돼 있어야 해요)` };
      const cur = await playerByDiscord(discordId);
      if (cur?.id === hit.id) return { ok: true, text: `이미 '${hit.display_name}' 선수와 연결돼 있어요!` };
      must(await db.from('discord_link_requests').delete().eq('discord_id', id(discordId)).eq('status', 'pending'));
      must(await db.from('discord_link_requests').insert({ discord_id: id(discordId), discord_name: discordName || null, player_id: hit.id }));
      return { ok: true, text: `'${hit.display_name}' 선수로 연결 요청을 보냈어요! 운영진이 무명섬 관리자 화면에서 승인하면 연결돼요.${cur ? ` (지금은 '${cur.display_name}' 선수와 연결돼 있어요)` : ''}` };
    },

    /** /연결해제: 내 연결을 풀고, 대기 중인 요청도 취소 */
    async unlink({ discordId }) {
      const p = await playerByDiscord(discordId);
      const pending = must(await db.from('discord_link_requests').select('id').eq('discord_id', id(discordId)).eq('status', 'pending')) ?? [];
      if (pending.length) must(await db.from('discord_link_requests').delete().eq('discord_id', id(discordId)).eq('status', 'pending'));
      if (p) must(await db.from('player_private').update({ discord_id: null }).eq('discord_id', id(discordId)));
      if (!p && !pending.length) return { ok: false, text: '연결된 선수가 없어요.' };
      return {
        ok: true,
        text: p
          ? `'${p.display_name}' 선수와의 연결을 풀었어요. 다시 연결하려면 \`/연결 게임닉네임\` 을 입력해 주세요. (이미 신청한 내전 · 투표 기록은 그대로예요)`
          : '대기 중이던 연결 요청을 취소했어요.'
      };
    },

    /** /내정보 */
    async myInfo(discordId) {
      const p = await playerByDiscord(discordId);
      if (!p) {
        const pending = must(await db.from('discord_link_requests').select('player_id').eq('discord_id', id(discordId)).eq('status', 'pending').maybeSingle());
        if (pending) {
          const name = (await playersByIds([pending.player_id])).get(pending.player_id)?.display_name ?? '선수';
          return { ok: true, text: `'${name}' 선수로 연결 요청을 보냈고, 운영진 승인을 기다리는 중이에요!` };
        }
        return { ok: false, text: '아직 연결된 선수가 없어요. `/연결 게임닉네임` 으로 연결 요청을 보내 주세요!' };
      }
      const [rank, mine] = await Promise.all([
        db.from('player_rank_stats').select('rank_score, rank_games, sync_error').eq('player_id', p.id).maybeSingle().then(must),
        db.from('event_participants').select('event_id').eq('player_id', p.id).then(must)
      ]);
      const evs = (await allEvents()).filter((e) => e.status !== 'done' && (mine ?? []).some((m) => m.event_id === e.id));
      const lines = [
        `**${p.display_name}** · ${p.balance_tier}티어 · 게임 닉네임 \`${p.er_nickname}\``,
        rank?.rank_score != null ? `솔로 랭크 점수 ${rank.rank_score.toLocaleString('ko-KR')}점 (${rank.rank_games}판)` : '이번 시즌 솔로 랭크 기록이 없어요',
        evs.length ? `신청한 내전: ${evs.map((e) => e.title).join(', ')}` : '신청한 내전이 없어요',
        siteUrl ? `${siteUrl}/player?id=${p.id}` : ''
      ];
      return { ok: true, text: lines.filter(Boolean).join('\n') };
    },

    /** 참가 신청 (버튼 · /참가) */
    async join({ discordId, eventId }) {
      const player = await playerByDiscord(discordId);
      const event = await resolveEvent(eventId, pickSignupEvent);
      const parts = event ? await participantRows(event.id) : [];
      const already = !!player && parts.some((x) => x.player_id === player.id);
      const why = joinProblem({ event, count: parts.length, already, linked: !!player });
      if (why) return { ok: false, text: why, eventId: event?.id ?? null };
      const { error } = await db.from('event_participants').insert({ event_id: event.id, player_id: player.id });
      if (error) {
        if (error.code === '23505') return { ok: false, text: '이미 신청했어요!', eventId: event.id };
        throw new Error(error.message);
      }
      return { ok: true, text: `**${event.title}** 참가 신청 완료! (${parts.length + 1} / ${event.max_players}명) 🎉`, eventId: event.id };
    },

    /** 참가 취소 (버튼 · /참가취소). 내전을 안 고르면 내가 신청한 가장 가까운 내전 */
    async leave({ discordId, eventId }) {
      const player = await playerByDiscord(discordId);
      let event = eventId ? await eventById(eventId) : null;
      if (!eventId && player) {
        const mine = new Set((must(await db.from('event_participants').select('event_id').eq('player_id', player.id)) ?? []).map((m) => m.event_id));
        event = (await allEvents()).filter((e) => e.status !== 'done' && mine.has(e.id)).sort((a, b) => Math.abs(Date.parse(a.starts_at) - now()) - Math.abs(Date.parse(b.starts_at) - now()))[0] ?? null;
      }
      const parts = event ? await participantRows(event.id) : [];
      const already = !!player && parts.some((x) => x.player_id === player.id);
      const inTeam = already ? !!must(await db.from('event_teams').select('player_id').eq('event_id', event.id).eq('player_id', player.id).maybeSingle()) : false;
      const why = leaveProblem({ event, already, linked: !!player, inTeam });
      if (why) return { ok: false, text: why, eventId: event?.id ?? null };
      must(await db.from('event_participants').delete().eq('event_id', event.id).eq('player_id', player.id));
      return { ok: true, text: `**${event.title}** 참가를 취소했어요. (${parts.length - 1} / ${event.max_players}명)`, eventId: event.id };
    },

    /** /내전공지: 예정 상태면 "참가 모집 중"으로 바꾸고 공지 메시지를 만들어요 */
    async announce({ eventId }) {
      const event = await resolveEvent(eventId, pickAnnounceEvent);
      if (!event) return { ok: false, text: '공지할 내전이 없어요. 무명섬 관리자 → 일정 관리에서 먼저 만들어 주세요.' };
      if (event.status === 'done') return { ok: false, text: '이미 끝난 내전은 공지할 수 없어요.' };
      if (event.status === 'plan') {
        must(await db.from('events').update({ status: 'open' }).eq('id', event.id));
        event.status = 'open';
      }
      return { ok: true, event, old: await getMessage(event.id, 'signup'), payload: await signupPayload(event) };
    },

    /** /mvp 시작 */
    async mvpStart({ eventId }) {
      const event = await resolveEvent(eventId, pickMvpEvent);
      if (!event) return { ok: false, text: 'MVP 투표를 열 내전이 없어요.' };
      const cands = await candidates(event.id);
      if (cands.length < 2) return { ok: false, text: `**${event.title}** 참가자가 2명 이상이어야 투표할 수 있어요.` };
      const reopened = event.mvp_vote_status === 'closed';
      if (event.mvp_vote_status !== 'open') {
        must(await db.from('events').update({ mvp_vote_status: 'open' }).eq('id', event.id));
        event.mvp_vote_status = 'open';
      }
      return { ok: true, event, reopened, old: await getMessage(event.id, 'mvp'), payload: await mvpPayload(event) };
    },

    /** 투표 (선택 메뉴) */
    async vote({ discordId, eventId, candidateId }) {
      const [event, voter] = await Promise.all([eventById(eventId), playerByDiscord(discordId)]);
      const ids = new Set((event ? await participantRows(event.id) : []).map((p) => p.player_id));
      const why = voteProblem({ event, voter: voter?.id, candidate: candidateId, isParticipant: !!voter && ids.has(voter.id), candidateIsParticipant: ids.has(candidateId) });
      if (why) return { ok: false, text: why };
      must(await db.from('mvp_votes').upsert({ event_id: event.id, voter_player_id: voter.id, candidate_player_id: candidateId, voted_at: new Date(now()).toISOString() }, { onConflict: 'event_id,voter_player_id' }));
      const name = (await playersByIds([candidateId])).get(candidateId)?.display_name ?? '그 선수';
      return { ok: true, text: `**${name}** 님에게 투표했어요! 마감 전까지 다시 고르면 바꿀 수 있어요.`, event };
    },

    /** /mvp 마감: 최다 득표가 MVP, 공동 1위는 추첨 → 내전의 MVP 로 저장 */
    async mvpClose({ eventId }) {
      const event = eventId ? await eventById(eventId) : pickOpenVoteEvent(await allEvents());
      if (!event) return { ok: false, text: '지금 투표 중인 내전이 없어요.' };
      if (event.mvp_vote_status !== 'open') return { ok: false, text: `**${event.title}** 은(는) 투표 중이 아니에요.` };
      const votes = must(await db.from('mvp_votes').select('candidate_player_id').eq('event_id', event.id)) ?? [];
      const result = tally(votes, rng);
      if (!result.picked) return { ok: false, text: '아직 투표가 하나도 없어요. 조금만 더 기다려 주세요!' };
      const saved = { counts: result.counts, tied: result.tied, picked: result.picked, drawn: result.drawn, votes: result.votes, closed_at: new Date(now()).toISOString() };
      must(await db.from('events').update({ mvp_vote_status: 'closed', mvp_player_id: result.picked, mvp_vote_result: saved }).eq('id', event.id));
      event.mvp_vote_status = 'closed';
      const names = await playersByIds(Object.keys(result.counts));
      const nameOf = (pid) => names.get(pid)?.display_name ?? '알 수 없음';
      return { ok: true, event, result, announce: mvpResultMessage(event, result, nameOf), old: await getMessage(event.id, 'mvp'), payload: await mvpPayload(event), mvpName: nameOf(result.picked) };
    },

    /** /관리자키 [유저]: 그 디스코드 계정만 쓸 수 있는 24시간 키 (권한 확인은 router) */
    async adminKey({ discordId, discordName }) {
      const already = await webAdmin(discordId);
      if (already) return { ok: false, text: `${discordName || '그 사람'} 님은 이미 무명섬 관리자예요. ${siteUrl ? siteUrl + '/login' : '무명섬 사이트'} 에서 디스코드로 로그인만 하면 돼요.` };
      const key = must(await db.rpc('bot_create_admin_key', { p_discord_id: id(discordId), p_discord_name: discordName || '' }));
      return { ok: true, key };
    },

    /** /관리자목록: 지금 관리자 · 안 쓴 키 */
    async adminList() {
      const [admins, keys] = await Promise.all([
        db.from('admins').select('discord_id, discord_name, role, registered_via, last_seen_at, revoked_at, created_at').order('created_at', { ascending: true }).then(must),
        db.from('admin_keys').select('id, expires_at, used_at, revoked_at').then(must)
      ]);
      const active = (admins ?? []).filter((a) => !a.revoked_at);
      const waiting = (await pendingGrants()).filter((g) => !active.some((a) => a.discord_id === g.discord_id));
      const unused = (keys ?? []).filter((k) => !k.used_at && !k.revoked_at && Date.parse(k.expires_at) > now()).length;
      const lines = active.map((a) => `${a.role === 'owner' ? '👑' : '🛡️'} **${a.discord_name || '이름 없음'}**${a.role === 'owner' ? ' (소유자)' : ''} · ${a.registered_via}${a.last_seen_at ? ` · 마지막 접속 ${shortKst(a.last_seen_at)}` : ''}`);
      const waitLines = waiting.map((g) => `⏳ **${g.discord_name || `<@${g.discord_id}>`}** · 사이트 로그인 전 (${g.created_via === 'bot' ? '봇' : '웹'}에서 추가 · 운영진 명령어는 지금도 돼요)`);
      const head = `무명섬 관리자 ${active.length}명${waiting.length ? ` (+ 로그인 전 ${waiting.length}명)` : ''} · 안 쓴 키 ${unused}개`;
      return { ok: true, text: [head, ...lines, ...waitLines, siteUrl ? `자세히: ${siteUrl}/admin/access` : ''].filter(Boolean).join('\n') };
    },

    /** /관리자추가 @유저: 무명섬 소유자만. 사이트에 로그인한 적 있으면 바로, 없으면 그 계정으로 처음 로그인할 때 관리자가 돼요 */
    async grantAdmin({ byDiscordId, targetDiscordId, targetName }) {
      const me = await webAdmin(byDiscordId);
      if (me?.role !== 'owner') return { ok: false, text: '관리자 추가는 무명섬 소유자만 할 수 있어요.' };
      const { data, error } = await db.rpc('bot_grant_admin', { p_by_discord: id(byDiscordId), p_discord_id: id(targetDiscordId), p_name: targetName || '' });
      if (error) {
        if (error.code === 'PGRST202' || /bot_grant_admin/.test(error.message ?? '')) {
          return { ok: false, text: '아직 DB 8단계를 안 했어요. Supabase SQL Editor 에서 20261029000000_admin_grants.sql 을 실행해 주세요.' };
        }
        throw new Error(error.message);
      }
      const who = targetName || data?.name || '그 사람';
      const login = siteUrl ? `${siteUrl}/login` : '무명섬 사이트';
      if (data?.state === 'already') return { ok: true, state: 'already', text: `${who} 님은 이미 무명섬 관리자예요.` };
      if (data?.state === 'added') return { ok: true, state: 'added', text: `${who} 님을 무명섬 관리자로 추가했어요! 바로 관리자 화면(${login})에 들어갈 수 있고, 디스코드 운영진 명령어도 서버 관리자처럼 쓸 수 있어요.` };
      return { ok: true, state: 'pending', text: `${who} 님을 무명섬 관리자로 추가했어요! 디스코드 운영진 명령어는 지금부터 쓸 수 있고, ${login} 에서 디스코드로 처음 로그인하면 바로 관리자 화면이 열려요.` };
    },

    /** /관리자해제 유저: 무명섬 소유자만. 그 사람 앞으로 남은 키도 취소 */
    async revokeAdmin({ byDiscordId, targetDiscordId, targetName }) {
      const me = await webAdmin(byDiscordId);
      if (me?.role !== 'owner') return { ok: false, text: '관리자 해제는 무명섬 소유자만 할 수 있어요.' };
      const rows = (must(await db.from('admins').select('user_id, discord_name, role, revoked_at').eq('discord_id', id(targetDiscordId))) ?? []).filter((r) => !r.revoked_at);
      if (rows.some((r) => r.role === 'owner')) return { ok: false, text: '소유자는 해제할 수 없어요.' };
      const keys = (must(await db.from('admin_keys').select('id, used_at, revoked_at').eq('target_discord', id(targetDiscordId).toLowerCase())) ?? []).filter((k) => !k.used_at && !k.revoked_at);
      const stamp = new Date(now()).toISOString();
      for (const k of keys) must(await db.from('admin_keys').update({ revoked_at: stamp }).eq('id', k.id));
      const grants = await pendingGrants(targetDiscordId);
      for (const g of grants) must(await db.from('admin_grants').update({ revoked_at: stamp }).eq('discord_id', g.discord_id));
      const keyNote = (keys.length ? ` 안 쓴 키 ${keys.length}개도 취소했어요.` : '') + (grants.length && rows.length ? ' 로그인 전 추가 예약도 취소했어요.' : '');
      if (!rows.length && grants.length) return { ok: true, text: `${targetName || grants[0].discord_name || '그 사람'} 님의 관리자 추가(로그인 전)를 취소했어요.${keyNote}` };
      if (!rows.length) return { ok: !!keys.length, text: `${targetName || '그 사람'} 님은 무명섬 관리자가 아니에요.${keyNote}` };
      for (const r of rows) must(await db.from('admins').update({ revoked_at: stamp }).eq('user_id', r.user_id));
      return { ok: true, text: `${targetName || rows[0].discord_name || '그 사람'} 님을 무명섬 관리자에서 뺐어요. 이제 관리자 화면에 못 들어가요.${keyNote}` };
    },

    /** 최근 확정된 라운드 (결과 자동 공지용) */
    async recentConfirmed(limit = 30) {
      return must(await db.from('rounds').select('id, event_id, round_no, confirmed_at').eq('status', 'confirmed').order('confirmed_at', { ascending: false }).limit(limit)) ?? [];
    },

    /** 라운드 결과 공지 메시지 (확정된 판만) */
    async roundResult(roundId, { edited = false } = {}) {
      const round = must(await db.from('rounds').select('id, event_id, round_no, status, confirmed_at').eq('id', roundId).maybeSingle());
      if (!round || round.status !== 'confirmed') return null;
      const event = await eventById(round.event_id);
      if (!event) return null;
      const [teams, standings, rows, evTeams] = await Promise.all([
        db.from('v_round_team_scores').select('team_no, team_rank, team_kills, rs, ks, pen, total').eq('round_id', roundId).then(must),
        db.from('v_event_standings').select('team_no, standing, total, rounds').eq('event_id', event.id).then(must),
        db.from('round_players').select('player_id, csv_nickname, team_no').eq('round_id', roundId).then(must),
        db.from('event_teams').select('player_id, team_no, slot_tier').eq('event_id', event.id).then(must)
      ]);
      const names = await playersByIds([...new Set([...(rows ?? []), ...(evTeams ?? [])].map((p) => p.player_id).filter(Boolean))]);
      const members = new Map();
      for (const p of rows ?? []) {
        const list = members.get(p.team_no) || [];
        list.push(names.get(p.player_id)?.display_name || p.csv_nickname);
        members.set(p.team_no, list);
      }
      // 드래프트 내전이면 팀장 이름으로 불러요 (예: 새벽사냥꾼 팀)
      const captainOf = new Map((evTeams ?? []).filter((t) => t.slot_tier === 1).map((t) => [t.team_no, names.get(t.player_id)?.display_name]));
      const label = (no) => (event.format === 'draft' && captainOf.get(no) ? `${captainOf.get(no)} 팀` : `팀 ${no}`);
      return { event, round, payload: roundResultMessage({ event, round, teams: teams ?? [], standings: standings ?? [], members, label, siteUrl, edited }) };
    },

    /** 주기적으로 다시 그릴 메시지: 끝나지 않은 내전의 공지 · 투표 중인 MVP */
    async liveMessages() {
      const rows = must(await db.from('bot_messages').select('*')) ?? [];
      if (!rows.length) return [];
      const evs = new Map((await allEvents()).map((e) => [e.id, e]));
      return rows.map((r) => ({ ...r, event: evs.get(r.event_id) }))
        .filter((r) => r.event && (r.kind === 'signup' ? r.event.status !== 'done' : r.event.mvp_vote_status === 'open'));
    }
  };
}
