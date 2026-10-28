// 디스코드에서 온 명령어 · 버튼 · 선택 메뉴를 처리해요.
// discord.js 에 묶이지 않게 메시지 보내기 · 고치기는 바깥(index.js)에서 넣어 줘요 → 가짜로 테스트할 수 있어요.

import { parseId } from './logic.js';

export const EPHEMERAL = 64;            // 나만 보이는 답장 (MessageFlags.Ephemeral)
const ADMINISTRATOR = 1n << 3n;         // 서버 관리자 권한
const GONE = new Set([10003, 10008]);   // 채널 · 메시지가 지워졌어요

export function createRouter({ service, guildId, siteUrl, sendMessage, editMessage, sendDM = async () => { throw new Error('DM 을 보낼 수 없어요'); }, log = console }) {
  const isAdmin = (i) => !!i.memberPermissions?.has?.(ADMINISTRATOR);
  const displayName = (i) => i.member?.displayName || i.user?.globalName || i.user?.username || '';
  const eph = (content) => ({ content, flags: EPHEMERAL });

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

  /** 새 공지 · 투표를 이 채널에 올리고, 예전 메시지는 버튼을 떼요 */
  async function post(i, eventId, kind, payload, old) {
    const msg = await sendMessage(i.channelId, payload);
    await service.saveMessage(eventId, kind, msg.channelId ?? i.channelId, msg.id);
    if (old && old.message_id !== msg.id) {
      try { await editMessage(old.channel_id, old.message_id, { components: [] }); } catch { /* 예전 메시지가 없어도 괜찮아요 */ }
    }
  }

  async function adminOnly(i) {
    if (isAdmin(i)) return true;
    await i.reply(eph('서버 관리자만 쓸 수 있는 명령어예요.'));
    return false;
  }
  /** 서버 관리자 또는 무명섬 웹 관리자 */
  async function staffOnly(i) {
    if (isAdmin(i) || (await service.webAdmin(i.user.id))) return true;
    await i.reply(eph('서버 관리자나 무명섬 관리자만 쓸 수 있는 명령어예요.'));
    return false;
  }
  const keyText = (key, forName) => [
    `🔑 무명섬 관리자 키: \`${key}\``,
    `• 24시간 동안, **${forName ? `${forName} 님의 디스코드 계정` : '지금 이 디스코드 계정'}으로 로그인했을 때만** 쓸 수 있어요. 한 번 쓰면 사라져요.`,
    `• ${siteUrl}/login 에서 디스코드로 로그인 → "관리자 키" 칸에 붙여 넣으면 끝!`,
    '• 다른 사람에게 보여 주지 마세요.'
  ].join('\n');
  const userName = (i, opt) => i.options.getMember?.(opt)?.displayName || i.options.getUser(opt)?.globalName || i.options.getUser(opt)?.username || '그 사람';

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

    if (!i.isChatInputCommand()) return;
    const eventId = i.options.getString('내전') || null;

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
        if (!(await adminOnly(i))) return;
        await i.deferReply({ flags: EPHEMERAL });
        const r = await service.announce({ eventId });
        if (!r.ok) return i.editReply({ content: r.text });
        await post(i, r.event.id, 'signup', r.payload, r.old);
        return i.editReply({ content: `**${r.event.title}** 공지를 올렸어요! 참가자가 버튼을 누를 때마다 인원이 바뀌어요.${r.old ? ' (예전 공지의 버튼은 뗐어요)' : ''}` });
      }
      case 'mvp': {
        if (!(await adminOnly(i))) return;
        await i.deferReply({ flags: EPHEMERAL });
        if (i.options.getSubcommand() === '시작') {
          const r = await service.mvpStart({ eventId });
          if (!r.ok) return i.editReply({ content: r.text });
          await post(i, r.event.id, 'mvp', r.payload, r.old);
          return i.editReply({ content: `**${r.event.title}** MVP 투표를 열었어요!${r.reopened ? ' (마감했던 투표를 다시 열었어요. 이전 표는 그대로예요)' : ''} 마감은 \`/mvp 마감\`.` });
        }
        const r = await service.mvpClose({ eventId });
        if (!r.ok) return i.editReply({ content: r.text });
        await sendMessage(i.channelId, r.announce);
        if (r.old) {
          try { await editMessage(r.old.channel_id, r.old.message_id, r.payload); } catch { /* 투표 메시지가 지워졌어도 괜찮아요 */ }
        }
        return i.editReply({ content: `발표했어요! MVP는 **${r.mvpName}**${r.result.drawn ? ' (공동 1위 추첨)' : ''}. 무명섬 내전 기록에도 저장됐어요.` });
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

  return { handle, refresh, refreshAll };
}
