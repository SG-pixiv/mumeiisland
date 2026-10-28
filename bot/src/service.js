// 무명섬 디스코드 봇: DB(Supabase) 와 주고받는 일. 디스코드 쪽은 index.js 가 맡아요.
// db = Supabase 클라이언트 (비밀 키 · service_role). 테스트에서는 가짜 DB 를 넣어요.

import {
  pickSignupEvent, pickAnnounceEvent, pickMvpEvent, pickOpenVoteEvent, eventChoices,
  joinProblem, leaveProblem, voteProblem, tally, signupMessage, mvpMessage, mvpResultMessage
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

  return {
    allEvents, eventById, playerByDiscord, participants, getMessage, saveMessage, dropMessage, signupPayload, mvpPayload,

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

    /** /관리자키 (서버 관리자만 — 권한 확인은 index.js) */
    async adminKey({ discordId, discordName }) {
      const key = must(await db.rpc('bot_create_admin_key', { p_discord_id: id(discordId), p_discord_name: discordName || '' }));
      return { ok: true, key };
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
