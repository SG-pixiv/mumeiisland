// 디스코드에서 온 명령어 · 버튼 · 선택 메뉴를 처리해요.
// discord.js 에 묶이지 않게 메시지 보내기 · 고치기는 바깥(index.js)에서 넣어 줘요 → 가짜로 테스트할 수 있어요.

import { parseId, autoAnnouncePlan, autoAnnounceText, INTRO_MODAL_ID, introDefaults, introModal, introMessage } from './logic.js';
import { memoryStore, channelsOf, setChannels } from './store.js';

export const EPHEMERAL = 64;            // 나만 보이는 답장 (MessageFlags.Ephemeral)
const ADMINISTRATOR = 1n << 3n;         // 서버 관리자 권한
const GONE = new Set([10003, 10008]);   // 채널 · 메시지가 지워졌어요

// 명령어 채널을 정해 두면 이 명령어들은 그 채널에서만 받아요 (관리자 명령어는 어디서나)
const MEMBER_COMMANDS = new Set(['연결', '연결해제', '내정보', '참가', '참가취소']);

export function createRouter({
  service, guildId, siteUrl, sendMessage, editMessage, log = console,
  sendDM = async () => { throw new Error('DM 을 보낼 수 없어요'); },
  canPost = async () => true,          // 봇이 그 채널에 글을 쓸 수 있는지 (index.js 가 권한을 봐요)
  store = memoryStore(),               // 채널 설정 · 이미 올린 결과 (bot/data/settings.json)
  now = () => Date.now()
}) {
  const isAdmin = (i) => !!i.memberPermissions?.has?.(ADMINISTRATOR);
  const displayName = (i) => i.member?.displayName || i.user?.globalName || i.user?.username || '';
  const eph = (content) => ({ content, flags: EPHEMERAL });
  let manualPosts = 0;   // /내전공지 처리 중인 개수

  /** 봇이 올린 공지 · 투표 메시지를 지금 상태로 다시 그려요 */
  async function refresh(eventId, kind) {
    if (!eventId) return;
    const m = await service.getMessage(eventId, kind);
    if (!m) return;
    const event = await service.eventById(eventId);
    if (!event) return;
    const payload = kind === 'signup' ? await service.signupPayload(event) : await service.mvpPayload(event);
    try {
      await editMessage(m.channel_id, m.message_id, payload);
    } catch (e) {
      if (GONE.has(e?.code)) await service.dropMessage(eventId, kind);
      else log.warn(`[갱신] ${kind} 메시지를 고치지 못했어요: ${e?.message ?? e}`);
    }
  }
  async function refreshAll() {
    for (const m of await service.liveMessages()) await refresh(m.event_id, m.kind);
  }

  /** 공지 · 투표 · 발표가 올라갈 채널: /채널설정 공지 로 정한 곳, 없으면 명령어를 친 채널 */
  const announceChannel = (i) => channelsOf(store, i.guildId ?? guildId).announce || i.channelId;
  const where = (channelId, i) => (channelId === i.channelId ? '이 채널' : `<#${channelId}>`);

  /** 새 공지 · 투표를 공지 채널에 올리고, 예전 메시지는 버튼을 떼요 */
  async function post(channelId, eventId, kind, payload, old) {
    const msg = await sendMessage(channelId, payload);
    await service.saveMessage(eventId, kind, msg.channelId ?? channelId, msg.id);
    if (old && old.message_id !== msg.id) {
      try { await editMessage(old.channel_id, old.message_id, { components: [] }); } catch { /* 예전 메시지가 없어도 괜찮아요 */ }
    }
  }

  /** 운영진: 디스코드 서버 관리자 또는 무명섬 관리자 (소유자가 추가한 사람 포함 · 서버 권한이 없어도 돼요) */
  async function staffOnly(i) {
    if (isAdmin(i) || (await service.webAdmin(i.user.id))) return true;
    await i.reply(eph('운영진(디스코드 서버 관리자 · 무명섬 관리자)만 쓸 수 있는 명령어예요.'));
    return false;
  }
  const keyText = (key, forName) => [
    `🔑 무명섬 관리자 키: \`${key}\``,
    `• 24시간 동안, **${forName ? `${forName} 님의 디스코드 계정` : '지금 이 디스코드 계정'}으로 로그인했을 때만** 쓸 수 있어요. 한 번 쓰면 사라져요.`,
    `• ${siteUrl}/login 에서 디스코드로 로그인 → "관리자 키" 칸에 붙여 넣으면 끝!`,
    '• 다른 사람에게 보여 주지 마세요.'
  ].join('\n');
  const userName = (i, opt) => i.options.getMember?.(opt)?.displayName || i.options.getUser(opt)?.globalName || i.options.getUser(opt)?.username || '그 사람';

  /**
   * 라운드 결과 자동 공지: 웹에서 확정한 판을 공지 채널에 올려요 (index.js 가 30초마다 불러요)
   * 처음 켰을 때 이미 확정돼 있던 판은 올리지 않고, 확정 취소 후 다시 확정하면 "(수정됨)"으로 다시 올려요
   */
  async function announceResults() {
    const rounds = await service.recentConfirmed();
    const st = store.get();
    const done = { ...(st.announced ?? {}) };
    if (!st.resultsReady) {
      for (const r of rounds) done[r.id] = r.confirmed_at;
      store.update({ announced: done, resultsReady: true });
      return 0;
    }
    const channel = channelsOf(store, guildId).announce;
    let posted = 0;
    for (const r of rounds.filter((x) => done[x.id] !== x.confirmed_at).sort((a, b) => Date.parse(a.confirmed_at) - Date.parse(b.confirmed_at))) {
      if (channel) {
        const res = await service.roundResult(r.id, { edited: !!done[r.id] });
        if (res) {
          try { await sendMessage(channel, res.payload); posted++; }
          catch (e) { log.warn(`[결과 공지] ${res.event.title} ${r.round_no}라운드를 올리지 못했어요: ${e?.message ?? e}`); if (!GONE.has(e?.code)) return posted; }
        }
      }
      done[r.id] = r.confirmed_at;   // 공지 채널이 없을 때도 표시해 둬요 (나중에 채널을 정해도 예전 판이 한꺼번에 올라가지 않게)
    }
    const keep = Object.fromEntries(Object.entries(done).sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, 300));
    store.update({ announced: keep });
    return posted;
  }

  async function handle(i) {
    if (guildId && i.guildId && i.guildId !== guildId) {
      if (!i.isAutocomplete()) await i.reply(eph('이 서버에서는 무명섬 봇을 쓸 수 없어요.'));
      return;
    }

    if (i.isAutocomplete()) {
      return i.respond(await service.eventChoices(i.options.getFocused()));
    }

    if (i.isButton()) {
      const join = parseId(i.customId, 'join');
      const leave = parseId(i.customId, 'leave');
      if (!join && !leave) return;
      await i.deferReply({ flags: EPHEMERAL });
      const r = join ? await service.join({ discordId: i.user.id, eventId: join }) : await service.leave({ discordId: i.user.id, eventId: leave });
      await i.editReply({ content: r.text });
      if (r.ok) await refresh(r.eventId, 'signup');
      return;
    }

    if (i.isStringSelectMenu()) {
      const eventId = parseId(i.customId, 'mvp');
      if (!eventId) return;
      await i.deferReply({ flags: EPHEMERAL });
      const r = await service.vote({ discordId: i.user.id, eventId, candidateId: i.values?.[0] });
      await i.editReply({ content: r.text });
      if (r.ok) await refresh(eventId, 'mvp');
      return;
    }

    // /소개공지 창에서 [보내기]
    if (i.isModalSubmit?.()) {
      if (i.customId !== INTRO_MODAL_ID) return;
      if (!(await staffOnly(i))) return;
      await i.deferReply({ flags: EPHEMERAL });
      if (!(await canPost(i.channelId))) return i.editReply({ content: '봇이 이 채널에 글을 쓸 수 없어요. 채널 설정 → 권한에서 무명섬 봇에게 "채널 보기 · 메시지 보내기 · 링크 첨부"를 허용해 주세요.' });
      await sendMessage(i.channelId, introMessage({ title: i.fields.getTextInputValue('title'), body: i.fields.getTextInputValue('body'), siteUrl }));
      return i.editReply({ content: '소개 공지를 이 채널에 올렸어요! 그림은 디스코드 규칙상 눌러도 이동하지 않고, 제목과 아래 버튼을 누르면 무명섬 사이트로 가요. 고치고 싶으면 그 메시지를 지우고 다시 /소개공지 를 해 주세요.' });
    }

    if (!i.isChatInputCommand()) return;
    const eventId = i.options.getString('내전') || null;
    const cmdChannel = channelsOf(store, i.guildId ?? guildId).commands;
    if (cmdChannel && i.channelId !== cmdChannel && MEMBER_COMMANDS.has(i.commandName)) {
      return i.reply(eph(`명령어는 <#${cmdChannel}> 채널에서 써 주세요!`));
    }

    switch (i.commandName) {
      case '연결': {
        await i.deferReply({ flags: EPHEMERAL });
        const r = await service.requestLink({ discordId: i.user.id, discordName: displayName(i), nickname: i.options.getString('게임닉네임') });
        return i.editReply({ content: r.text });
      }
      case '연결해제': {
        await i.deferReply({ flags: EPHEMERAL });
        return i.editReply({ content: (await service.unlink({ discordId: i.user.id })).text });
      }
      case '내정보': {
        await i.deferReply({ flags: EPHEMERAL });
        return i.editReply({ content: (await service.myInfo(i.user.id)).text });
      }
      case '참가':
      case '참가취소': {
        await i.deferReply({ flags: EPHEMERAL });
        const r = i.commandName === '참가' ? await service.join({ discordId: i.user.id, eventId }) : await service.leave({ discordId: i.user.id, eventId });
        await i.editReply({ content: r.text });
        if (r.ok) await refresh(r.eventId, 'signup');
        return;
      }
      case '내전공지': {
        if (!(await staffOnly(i))) return;
        await i.deferReply({ flags: EPHEMERAL });
        manualPosts++;   // 그동안 자동 공지는 쉬어요 (예정 → 모집 중으로 바뀌는 순간 두 번 올라가지 않게)
        try {
          const r = await service.announce({ eventId });
          if (!r.ok) return i.editReply({ content: r.text });
          const ch = announceChannel(i);
          await post(ch, r.event.id, 'signup', r.payload, r.old);
          return i.editReply({ content: `**${r.event.title}** 공지를 ${where(ch, i)}에 올렸어요! 참가자가 버튼을 누를 때마다 인원이 바뀌어요.${r.old ? ' (예전 공지의 버튼은 뗐어요)' : ''}` });
        } finally {
          manualPosts--;
        }
      }
      case '소개공지': {
        if (!(await staffOnly(i))) return;
        return i.showModal(introModal(introDefaults({ commandsChannel: channelsOf(store, i.guildId ?? guildId).commands })));
      }
      case 'mvp': {
        if (!(await staffOnly(i))) return;
        await i.deferReply({ flags: EPHEMERAL });
        if (i.options.getSubcommand() === '시작') {
          const r = await service.mvpStart({ eventId });
          if (!r.ok) return i.editReply({ content: r.text });
          const ch = announceChannel(i);
          await post(ch, r.event.id, 'mvp', r.payload, r.old);
          return i.editReply({ content: `**${r.event.title}** MVP 투표를 ${where(ch, i)}에 열었어요!${r.reopened ? ' (마감했던 투표를 다시 열었어요. 이전 표는 그대로예요)' : ''} 마감은 \`/mvp 마감\`.` });
        }
        const r = await service.mvpClose({ eventId });
        if (!r.ok) return i.editReply({ content: r.text });
        const ch = announceChannel(i);
        await sendMessage(ch, r.announce);
        if (r.old) {
          try { await editMessage(r.old.channel_id, r.old.message_id, r.payload); } catch { /* 투표 메시지가 지워졌어도 괜찮아요 */ }
        }
        return i.editReply({ content: `${where(ch, i)}에 발표했어요! MVP는 **${r.mvpName}**${r.result.drawn ? ' (공동 1위 추첨)' : ''}. 무명섬 내전 기록에도 저장됐어요.` });
      }
      case '채널설정': {
        if (!(await staffOnly(i))) return;
        const sub = i.options.getSubcommand();
        const gid = i.guildId ?? guildId;
        const cur = channelsOf(store, gid);
        if (sub === '보기') {
          return i.reply(eph([
            `📢 공지 · 알림 채널: ${cur.announce ? `<#${cur.announce}> (참가 공지 · 라운드 결과 자동 게시 켜짐)` : '아직 없어요 (명령어를 친 채널에 올라가요 · 참가 공지 · 라운드 결과 자동 게시는 꺼져 있어요)'}`,
            `⌨️ 명령어 채널: ${cur.commands ? `<#${cur.commands}>` : '정하지 않았어요 (어디서나 쓸 수 있어요)'}`,
            '바꾸기: `/채널설정 공지` · `/채널설정 명령어` (채널을 안 고르면 지금 채널)'
          ].join('\n')));
        }
        if (sub === '명령어해제') {
          setChannels(store, gid, { commands: null });
          return i.reply(eph('명령어 채널 제한을 풀었어요. 이제 어느 채널에서나 명령어를 쓸 수 있어요.'));
        }
        const ch = i.options.getChannel?.('채널')?.id || i.channelId;
        if (sub === '공지') {
          if (!(await canPost(ch))) return i.reply(eph(`봇이 <#${ch}> 에 글을 쓸 수 없어요. 그 채널 설정 → 권한에서 무명섬 봇에게 "채널 보기 · 메시지 보내기 · 링크 첨부"를 허용해 주세요.`));
          setChannels(store, gid, { announce: ch });
          return i.reply(eph(`이제 내전 공지 · MVP 투표 · MVP 발표 · **라운드 결과**가 <#${ch}> 에 올라가요! 참가 공지는 일정이 모집 중이 되면 바로, 시작 24시간 전에 한 번 더 자동으로 올라가요. 참가자는 이 채널에서 버튼만 누르면 돼서, 글쓰기는 막아 둬도 괜찮아요.`));
        }
        setChannels(store, gid, { commands: ch });
        return i.reply(eph(`이제 /연결 · /연결해제 · /내정보 · /참가 · /참가취소 는 <#${ch}> 에서만 받아요. (관리자 명령어는 어디서나 돼요)`));
      }
      case '관리자키': {
        if (!(await staffOnly(i))) return;
        await i.deferReply({ flags: EPHEMERAL });
        const target = i.options.getUser('유저');
        if (target?.bot) return i.editReply({ content: '봇에게는 관리자 키를 줄 수 없어요.' });
        const other = target && target.id !== i.user.id;
        const name = other ? userName(i, '유저') : displayName(i);
        const r = await service.adminKey({ discordId: other ? target.id : i.user.id, discordName: name });
        if (!r.ok) return i.editReply({ content: r.text });
        if (!other) return i.editReply({ content: keyText(r.key) + '\n• 이 메시지는 나만 보여요.' });
        try {
          await sendDM(target.id, `${displayName(i)} 님이 무명섬 관리자 키를 보냈어요!\n` + keyText(r.key));
          return i.editReply({ content: `${name} 님에게 DM 으로 관리자 키를 보냈어요. (24시간 · 그 계정으로만 쓸 수 있어요)` });
        } catch {
          return i.editReply({ content: `${name} 님의 DM 이 막혀 있어서 대신 보여 드려요. 이 키를 전해 주세요.\n` + keyText(r.key, name) });
        }
      }
      case '관리자목록': {
        if (!(await staffOnly(i))) return;
        await i.deferReply({ flags: EPHEMERAL });
        return i.editReply({ content: (await service.adminList()).text });
      }
      case '관리자추가': {
        await i.deferReply({ flags: EPHEMERAL });
        const target = i.options.getUser('유저');
        if (!target) return i.editReply({ content: '관리자로 추가할 사람을 골라 주세요.' });
        if (target.bot) return i.editReply({ content: '봇은 관리자로 추가할 수 없어요.' });
        const name = userName(i, '유저');
        const r = await service.grantAdmin({ byDiscordId: i.user.id, targetDiscordId: target.id, targetName: name });
        if (r.ok && r.state !== 'already' && target.id !== i.user.id) {
          try {
            await sendDM(target.id, [
              `${displayName(i)} 님이 무명섬 관리자로 추가했어요! 🛡️`,
              `• ${siteUrl}/login 에서 이 디스코드 계정으로 로그인하면 바로 관리자 화면이 열려요. (키는 필요 없어요)`,
              '• 디스코드에서 /내전공지 · /mvp · /채널설정 같은 운영진 명령어도 쓸 수 있어요.'
            ].join('\n'));
          } catch { /* DM 이 막혀 있어도 추가는 됐어요 */ }
        }
        return i.editReply({ content: r.text });
      }
      case '관리자해제': {
        await i.deferReply({ flags: EPHEMERAL });
        const target = i.options.getUser('유저');
        if (!target) return i.editReply({ content: '관리자에서 뺄 사람을 골라 주세요.' });
        const r = await service.revokeAdmin({ byDiscordId: i.user.id, targetDiscordId: target.id, targetName: userName(i, '유저') });
        return i.editReply({ content: r.text });
      }
      default:
        return i.reply(eph('모르는 명령어예요.'));
    }
  }

  /**
   * 참가 공지 자동 게시 (30초마다): 모집 중이 되면 바로 · 시작 24시간 전에 한 번 더
   * 공지 채널이 없으면 아무것도 안 해요 (채널을 정하면 그때 올라가요)
   */
  let autoBusy = false;
  async function autoAnnounce() {
    const channel = channelsOf(store, guildId).announce;
    if (!channel || autoBusy || manualPosts) return 0;
    autoBusy = true;
    try {
      const prev = store.get().autoAnnounce ?? {};
      const { events, posted } = await service.autoAnnounceState();
      const { posts, marks } = autoAnnouncePlan(events, posted, prev, now());
      let done = 0;
      for (const [k, p] of posts.entries()) {
        try {
          const payload = { content: autoAnnounceText(p, now()), ...(await service.signupPayload(p.event)) };
          await post(channel, p.event.id, 'signup', payload, await service.getMessage(p.event.id, 'signup'));
          done++;
        } catch (e) {
          log.warn(`[자동 공지] ${p.event.title} 참가 공지를 올리지 못했어요: ${e?.message ?? e}`);
          // 못 올린 것부터는 기록을 되돌려서 다음 번에 다시 해요
          for (const q of posts.slice(k)) { if (prev[q.event.id]) marks[q.event.id] = prev[q.event.id]; else delete marks[q.event.id]; }
          break;
        }
      }
      store.update({ autoAnnounce: marks });
      return done;
    } finally {
      autoBusy = false;
    }
  }

  return { handle, refresh, refreshAll, announceResults, autoAnnounce };
}
