// 무명섬 디스코드 봇: DB(Supabase) 와 주고받는 일. 디스코드 쪽은 index.js 가 맡아요.
// db = Supabase 클라이언트 (비밀 키 · service_role). 테스트에서는 가짜 DB 를 넣어요.

import {
  shortKst, pickSignupEvent, pickAnnounceEvent, pickMvpEvent, eventChoices,
  joinProblem, leaveProblem, roundVoteProblem, tally, signupMessage, roundResultMessage,
  roundVoteMessage, roundMvpResultMessage, ROUND_VOTE_MINUTES
} from './logic.js';

/** 관리자 추가 · 해제를 할 수 있는 권한 (소유자 · 공동 소유자, DB 11단계) */
const OWNER_ROLES = ['owner', 'co_owner'];

export function createService(db, { siteUrl = '', rng = Math.random, now = () => Date.now() } = {}) {
  const must = ({ data, error }) => {
    if (error) throw new Error(error.message || String(error));
    return data;
  };
  const id = (v) => String(v ?? '').trim();
  /** 9단계 SQL(라운드 MVP 칸) 전이면 그 칸이 없다는 오류가 와요 → 투표 기능만 조용히 쉬어요 */
  const missingColumn = (error) => !!error && (error.code === '42703' || /mvp_vote_status|mvp_vote_closes_at|round_mvp_votes|does not exist/.test(error.message ?? ''));

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
  /** 팀 이름: 드래프트 내전이면 팀장 이름 (예: 새벽사냥꾼 팀), 아니면 팀 N */
  const teamLabel = async (event) => {
    const evTeams = must(await db.from('event_teams').select('player_id, team_no, slot_tier').eq('event_id', event.id)) ?? [];
    const captains = evTeams.filter((t) => t.slot_tier === 1);
    const names = await playersByIds(captains.map((t) => t.player_id));
    const captainOf = new Map(captains.map((t) => [t.team_no, names.get(t.player_id)?.display_name]));
    return (no) => (event.format === 'draft' && captainOf.get(no) ? `${captainOf.get(no)} 팀` : `팀 ${no}`);
  };

  // ── 라운드 MVP 투표
  const ROUND_COLS = 'id, event_id, round_no, status, confirmed_at, mvp_player_id, mvp_vote_status, mvp_vote_closes_at, mvp_vote_result, mvp_channel_id, mvp_message_id';
  const roundById = async (roundId) => (roundId ? must(await db.from('rounds').select(ROUND_COLS).eq('id', roundId).maybeSingle()) : null);
  /** 후보 = 그 라운드에 뛴 무명섬 선수 [{ id, name, team, kills, assists, damage }] */
  const roundCandidates = async (round) => {
    const rows = (must(await db.from('round_players').select('player_id, team_no, kills, assists, damage').eq('round_id', round.id)) ?? []).filter((r) => r.player_id);
    const names = await playersByIds([...new Set(rows.map((r) => r.player_id))]);
    const seen = new Set();
    return rows.filter((r) => names.has(r.player_id) && !seen.has(r.player_id) && seen.add(r.player_id))
      .map((r) => ({ id: r.player_id, name: names.get(r.player_id).display_name, team: r.team_no, kills: r.kills ?? 0, assists: r.assists ?? 0, damage: r.damage ?? 0 }))
      .sort((a, b) => a.team - b.team || a.name.localeCompare(b.name, 'ko'));
  };
  /** 투표할 수 있는 사람 = 내전 참가자 + 그 라운드에 뛴 선수 */
  const roundVoters = async (round, cands) => new Set([...(await participantRows(round.event_id)).map((p) => p.player_id), ...cands.map((c) => c.id)]);
  const roundVotePayload = async (round, event = null) => {
    const ev = event ?? (await eventById(round.event_id));
    const cands = await roundCandidates(round);
    const [voters, votes, label] = await Promise.all([
      roundVoters(round, cands),
      db.from('round_mvp_votes').select('voter_player_id').eq('round_id', round.id).then(must),
      teamLabel(ev)
    ]);
    return roundVoteMessage({ event: ev, round, candidates: cands, votes: (votes ?? []).length, eligible: voters.size, label });
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
    webAdmin, allEvents, eventById, playerByDiscord, participants, getMessage, saveMessage, dropMessage, signupPayload,

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

    /** 라운드 MVP 투표 열기 (확정되면 자동 · /mvp 시작). reopen: 마감된 투표도 다시 (이전 표는 그대로) */
    async openRoundVote(roundId, { reopen = false } = {}) {
      const res = await db.from('rounds').select(ROUND_COLS).eq('id', roundId).maybeSingle();
      if (missingColumn(res.error)) return { ok: false, text: '아직 DB 9단계를 안 했어요. Supabase SQL Editor 에서 20261029020000_round_mvp.sql 을 실행해 주세요.' };
      const round = must(res);
      if (!round || round.status !== 'confirmed' || !round.event_id || !round.round_no) return { ok: false, text: '확정된 라운드만 MVP 투표를 열 수 있어요.' };
      const event = await eventById(round.event_id);
      if (!event) return { ok: false, text: '그 라운드의 내전을 찾지 못했어요.' };
      if (round.mvp_vote_status === 'open') return { ok: false, already: true, round, event, text: `**${event.title} ${round.round_no}라운드** MVP 투표는 이미 열려 있어요.` };
      if (round.mvp_vote_status === 'closed' && !reopen) return { ok: false, round, event, text: `**${event.title} ${round.round_no}라운드** MVP 투표는 이미 끝났어요.` };
      const cands = await roundCandidates(round);
      if (cands.length < 2) return { ok: false, round, event, text: `**${event.title} ${round.round_no}라운드** 기록에 무명섬 선수가 2명 이상 있어야 투표할 수 있어요. 결과 검토에서 닉네임을 선수와 연결해 주세요.` };
      const reopened = round.mvp_vote_status === 'closed';
      const closesAt = new Date(now() + ROUND_VOTE_MINUTES * 60_000).toISOString();
      must(await db.from('rounds').update({ mvp_vote_status: 'open', mvp_vote_closes_at: closesAt }).eq('id', round.id));
      Object.assign(round, { mvp_vote_status: 'open', mvp_vote_closes_at: closesAt });
      return { ok: true, event, round, reopened, payload: await roundVotePayload(round, event) };
    },
    async saveRoundVoteMessage(roundId, channelId, messageId) {
      must(await db.from('rounds').update({ mvp_channel_id: channelId ? id(channelId) : null, mvp_message_id: messageId ? id(messageId) : null }).eq('id', roundId));
    },
    roundById, roundVotePayload,

    /** 라운드 MVP 투표 (선택 메뉴) */
    async voteRound({ discordId, roundId, candidateId }) {
      const [round, voter] = await Promise.all([roundById(roundId), playerByDiscord(discordId)]);
      const cands = round ? await roundCandidates(round) : [];
      const voters = round ? await roundVoters(round, cands) : new Set();
      const why = roundVoteProblem({ round, voter: voter?.id, candidate: candidateId, voters, candidates: new Set(cands.map((c) => c.id)), now: now() });
      if (why) return { ok: false, text: why };
      must(await db.from('round_mvp_votes').upsert({ round_id: round.id, voter_player_id: voter.id, candidate_player_id: candidateId, voted_at: new Date(now()).toISOString() }, { onConflict: 'round_id,voter_player_id' }));
      const name = cands.find((c) => c.id === candidateId)?.name ?? '그 선수';
      return { ok: true, text: `**${name}** 님에게 투표했어요! 마감 전까지 다시 고르면 바꿀 수 있어요.`, round };
    },

    /**
     * 라운드 MVP 투표 마감: 최다 득표가 그 라운드 MVP, 공동 1위는 추첨
     * → { ok, round, event, announce?, empty?, cancelled? }   (투표 메시지 지우기는 router)
     */
    async closeRoundVote(roundId) {
      const round = await roundById(roundId);
      if (!round || round.mvp_vote_status !== 'open') return { ok: false, round, text: '지금 투표 중인 라운드가 아니에요.' };
      const event = await eventById(round.event_id);
      if (round.status !== 'confirmed' || !event) {   // 투표 중에 확정을 취소했거나 내전이 없어졌어요 → 투표만 접어요
        must(await db.from('rounds').update({ mvp_vote_status: 'none', mvp_vote_closes_at: null }).eq('id', round.id));
        return { ok: true, cancelled: true, round, event };
      }
      const votes = must(await db.from('round_mvp_votes').select('candidate_player_id').eq('round_id', round.id)) ?? [];
      const result = tally(votes, rng);
      const saved = { counts: result.counts, tied: result.tied, picked: result.picked, drawn: result.drawn, votes: result.votes, closed_at: new Date(now()).toISOString() };
      must(await db.from('rounds').update({ mvp_vote_status: 'closed', mvp_player_id: result.picked ?? null, mvp_vote_result: saved }).eq('id', round.id));
      round.mvp_vote_status = 'closed';
      if (!result.picked) return { ok: true, empty: true, round, event };
      const names = await playersByIds(Object.keys(result.counts));
      const nameOf = (pid) => names.get(pid)?.display_name ?? '알 수 없음';
      return { ok: true, round, event, result, mvpName: nameOf(result.picked), announce: roundMvpResultMessage({ event, round, result, nameOf, siteUrl }) };
    },

    /** 마감 시각이 지난 투표들 */
    async dueRoundVotes() {
      const res = await db.from('rounds').select(ROUND_COLS).eq('mvp_vote_status', 'open');
      if (missingColumn(res.error)) return [];
      return (must(res) ?? []).filter((r) => !r.mvp_vote_closes_at || Date.parse(r.mvp_vote_closes_at) <= now());
    },

    /** /mvp 시작 · 마감 이 다룰 라운드 (내전 · 라운드 번호를 안 고르면 알아서) */
    async pickVoteRound({ eventId = null, roundNo = null, open = false } = {}) {
      const probe = await db.from('rounds').select('mvp_vote_status').limit(1);
      if (missingColumn(probe.error)) throw new Error('아직 DB 9단계를 안 했어요. Supabase SQL Editor 에서 20261029020000_round_mvp.sql 을 실행해 주세요.');
      if (!eventId && !roundNo && open) {   // 마감: 열려 있는 투표 중 가장 먼저 마감될 것
        const list = must(await db.from('rounds').select(ROUND_COLS).eq('mvp_vote_status', 'open')) ?? [];
        return list.sort((a, b) => Date.parse(a.mvp_vote_closes_at ?? 0) - Date.parse(b.mvp_vote_closes_at ?? 0))[0] ?? null;
      }
      const event = await resolveEvent(eventId, pickMvpEvent);
      if (!event) return null;
      const rounds = (must(await db.from('rounds').select(ROUND_COLS).eq('event_id', event.id)) ?? []).filter((r) => r.status === 'confirmed');
      if (roundNo) return rounds.find((r) => r.round_no === roundNo) ?? null;
      const pool = open ? rounds.filter((r) => r.mvp_vote_status === 'open') : rounds;
      return pool.sort((a, b) => b.round_no - a.round_no)[0] ?? null;
    },

    /** 내전 끝 정리용: 최근 3일 안에 시작한 내전과 그 라운드 */
    async recentEventsWithRounds() {
      const events = (await allEvents()).filter((e) => {
        const t = Date.parse(e.starts_at);
        return t <= now() && t >= now() - 3 * 24 * 3600_000;
      });
      if (!events.length) return { events, rounds: [] };
      const ids = events.map((e) => e.id);
      let res = await db.from('rounds').select('id, event_id, round_no, status, mvp_vote_status').in('event_id', ids);
      if (missingColumn(res.error)) res = await db.from('rounds').select('id, event_id, round_no, status').in('event_id', ids);   // 9단계 전
      return { events, rounds: must(res) ?? [] };
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
      const rank = { owner: 0, co_owner: 1 };
      const sorted = [...active].sort((a, b) => (rank[a.role] ?? 2) - (rank[b.role] ?? 2));
      const badge = (r) => (r === 'owner' ? '👑' : r === 'co_owner' ? '🌟' : '🛡️');
      const tag = (r) => (r === 'owner' ? ' (소유자)' : r === 'co_owner' ? ' (공동 소유자)' : '');
      const lines = sorted.map((a) => `${badge(a.role)} **${a.discord_name || '이름 없음'}**${tag(a.role)} · ${a.registered_via}${a.last_seen_at ? ` · 마지막 접속 ${shortKst(a.last_seen_at)}` : ''}`);
      const waitLines = waiting.map((g) => `⏳ **${g.discord_name || `<@${g.discord_id}>`}** · 사이트 로그인 전 (${g.created_via === 'bot' ? '봇' : '웹'}에서 추가 · 운영진 명령어는 지금도 돼요)`);
      const head = `무명섬 관리자 ${active.length}명${waiting.length ? ` (+ 로그인 전 ${waiting.length}명)` : ''} · 안 쓴 키 ${unused}개`;
      return { ok: true, text: [head, ...lines, ...waitLines, siteUrl ? `자세히: ${siteUrl}/admin/access` : ''].filter(Boolean).join('\n') };
    },

    /** /관리자추가 @유저: 무명섬 소유자 · 공동 소유자만. 사이트에 로그인한 적 있으면 바로, 없으면 그 계정으로 처음 로그인할 때 관리자가 돼요 */
    async grantAdmin({ byDiscordId, targetDiscordId, targetName }) {
      const me = await webAdmin(byDiscordId);
      if (!OWNER_ROLES.includes(me?.role)) return { ok: false, text: '관리자 추가는 무명섬 소유자 · 공동 소유자만 할 수 있어요.' };
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

    /** /관리자해제 유저: 무명섬 소유자 · 공동 소유자만 (공동 소유자를 빼는 건 소유자만). 그 사람 앞으로 남은 키도 취소 */
    async revokeAdmin({ byDiscordId, targetDiscordId, targetName }) {
      const me = await webAdmin(byDiscordId);
      if (!OWNER_ROLES.includes(me?.role)) return { ok: false, text: '관리자 해제는 무명섬 소유자 · 공동 소유자만 할 수 있어요.' };
      const rows = (must(await db.from('admins').select('user_id, discord_name, role, revoked_at').eq('discord_id', id(targetDiscordId))) ?? []).filter((r) => !r.revoked_at);
      if (rows.some((r) => r.role === 'owner')) return { ok: false, text: '소유자는 해제할 수 없어요.' };
      if (rows.some((r) => r.role === 'co_owner') && me.role !== 'owner') return { ok: false, text: '공동 소유자는 소유자만 뺄 수 있어요.' };
      const keys = (must(await db.from('admin_keys').select('id, used_at, revoked_at').eq('target_discord', id(targetDiscordId).toLowerCase())) ?? []).filter((k) => !k.used_at && !k.revoked_at);
      const stamp = new Date(now()).toISOString();
      for (const k of keys) must(await db.from('admin_keys').update({ revoked_at: stamp }).eq('id', k.id));
      const grants = await pendingGrants(targetDiscordId);
      for (const g of grants) must(await db.from('admin_grants').update({ revoked_at: stamp }).eq('discord_id', g.discord_id));
      const keyNote = (keys.length ? ` 안 쓴 키 ${keys.length}개도 취소했어요.` : '') + (grants.length && rows.length ? ' 로그인 전 추가 예약도 취소했어요.' : '');
      if (!rows.length && grants.length) return { ok: true, text: `${targetName || grants[0].discord_name || '그 사람'} 님의 관리자 추가(로그인 전)를 취소했어요.${keyNote}` };
      if (!rows.length) return { ok: !!keys.length, text: `${targetName || '그 사람'} 님은 무명섬 관리자가 아니에요.${keyNote}` };
      // 공동 소유자를 빼면 관리자로 내려가요 (되돌려도 관리자)
      for (const r of rows) must(await db.from('admins').update(r.role === 'co_owner' ? { revoked_at: stamp, role: 'admin' } : { revoked_at: stamp }).eq('user_id', r.user_id));
      return { ok: true, text: `${targetName || rows[0].discord_name || '그 사람'} 님을 무명섬 관리자에서 뺐어요. 이제 관리자 화면에 못 들어가요.${keyNote}` };
    },

    /** 메시지 정리용: 지금 있는 내전 id 들 · DB 에 기록된 공지 · 투표 메시지 */
    async eventIds() { return (must(await db.from('events').select('id')) ?? []).map((e) => e.id); },
    async trackedMessages() { return must(await db.from('bot_messages').select('event_id, kind, channel_id, message_id, created_at')) ?? []; },

    /** 참가 공지 자동 게시용: 아직 안 끝난 · 시작 전 내전과 마지막 참가 공지 시각 */
    async autoAnnounceState() {
      const events = (await allEvents()).filter((e) => e.status !== 'done' && Date.parse(e.starts_at) > now());
      if (!events.length) return { events, posted: new Map() };
      const rows = must(await db.from('bot_messages').select('event_id, created_at').eq('kind', 'signup').in('event_id', events.map((e) => e.id))) ?? [];
      return { events, posted: new Map(rows.map((r) => [r.event_id, r.created_at])) };
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
      const label = await teamLabel(event);
      return { event, round, payload: roundResultMessage({ event, round, teams: teams ?? [], standings: standings ?? [], members, label, siteUrl, edited }) };
    },

    /** 주기적으로 다시 그릴 메시지: 끝나지 않은 내전의 참가 공지 (라운드 투표는 표가 들어올 때마다 바로 고쳐요) */
    async liveMessages() {
      const rows = (must(await db.from('bot_messages').select('*')) ?? []).filter((r) => r.kind === 'signup');
      if (!rows.length) return [];
      const evs = new Map((await allEvents()).map((e) => [e.id, e]));
      return rows.map((r) => ({ ...r, event: evs.get(r.event_id) }))
        .filter((r) => r.event && r.event.status !== 'done');
    }
  };
}
