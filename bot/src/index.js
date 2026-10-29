// 무명섬 디스코드 봇 시작: npm start  (bot/.env 필요, README 참고)

import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config.js';
import { createService } from './service.js';
import { createRouter, EPHEMERAL } from './router.js';
import { fileStore, channelsOf } from './store.js';

const cfg = loadConfig();
const time = () => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul' });
const log = {
  info: (...a) => console.log(`[${time()}]`, ...a),
  warn: (...a) => console.warn(`[${time()}]`, ...a)
};

const db = createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
const service = createService(db, { siteUrl: cfg.siteUrl });
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const store = fileStore(fileURLToPath(new URL('../data/settings.json', import.meta.url)));

const channelOf = async (id) => {
  const ch = await client.channels.fetch(id);
  if (!ch?.isTextBased?.()) throw Object.assign(new Error('글을 쓸 수 없는 채널이에요'), { code: 10003 });
  return ch;
};
const router = createRouter({
  service, guildId: cfg.guildId, siteUrl: cfg.siteUrl, log,
  sendMessage: async (channelId, payload) => {
    const m = await (await channelOf(channelId)).send(payload);
    return { id: m.id, channelId: m.channelId };
  },
  editMessage: async (channelId, messageId, payload) => {
    await (await channelOf(channelId)).messages.edit(messageId, payload);
  },
  deleteMessage: async (channelId, messageId) => {   // 봇이 올린 메시지라 따로 권한이 필요 없어요
    await (await channelOf(channelId)).messages.delete(messageId);
  },
  sendDM: async (userId, content) => {
    await (await client.users.fetch(userId)).send({ content });
  },
  canPost: async (channelId) => {
    try {
      const ch = await channelOf(channelId);
      const p = ch.permissionsFor?.(client.user);
      return !p || p.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
    } catch { return false; }
  },
  store
});

client.once(Events.ClientReady, async (c) => {
  log.info(`무명섬 봇 켜짐: ${c.user.tag} · 서버 ${cfg.guildId}`);
  try {
    const { count, error } = await db.from('players').select('id', { count: 'exact', head: true });
    if (error) throw error;
    log.info(`무명섬 DB 연결 OK (선수 ${count}명)`);
  } catch (e) {
    log.warn(`무명섬 DB 에 연결하지 못했어요. SUPABASE_URL · SUPABASE_SECRET_KEY 를 확인해 주세요: ${e?.message ?? e}`);
  }
  // 웹에서 참가자를 바꿔도 공지 인원이 맞게 몇 분마다 다시 그리고, 대시보드에 "켜짐" 신호를 남겨요
  const beat = () => db.from('bot_status').upsert({ id: 1, bot_tag: c.user.tag, guild_id: cfg.guildId, last_seen_at: new Date().toISOString() })
    .then(({ error }) => {
      if (!error) return;
      const hint = /row-level security/i.test(error.message)
        ? 'SUPABASE_SECRET_KEY 가 비밀 키(sb_secret_...)가 아니에요. 지금 키로는 참가 신청 · 투표가 막혀요'
        : '6단계 SQL 을 실행했는지 확인해 주세요';
      log.warn(`[신호] ${error.message} → ${hint}`);
    });
  const tick = () => Promise.all([router.refreshAll(), beat()]).catch((e) => log.warn(`[갱신] ${e?.message ?? e}`));
  tick();
  setInterval(tick, cfg.refreshMinutes * 60_000);

  // 30초마다: 라운드 결과 자동 공지(웹에서 확정하면) · 참가 공지 자동 게시 · 지운 내전의 메시지 정리
  if (!channelsOf(store, cfg.guildId).announce) log.warn('공지 채널이 아직 없어요. 디스코드에서 /채널설정 공지 를 해 주세요 (참가 공지 · 라운드 결과 자동 게시가 꺼져 있어요)');
  let busy = false;
  const results = async () => {
    if (busy) return;
    busy = true;
    try { const n = await router.announceResults(); if (n) log.info(`라운드 결과 ${n}개를 공지했어요`); }
    catch (e) { log.warn(`[결과 공지] ${e?.message ?? e}`); }
    // 참가 공지 자동 게시: 모집 중이 되면 바로 · 시작 24시간 전에 한 번 더
    try { const n = await router.autoAnnounce(); if (n) log.info(`참가 공지 ${n}개를 자동으로 올렸어요`); }
    catch (e) { log.warn(`[자동 공지] ${e?.message ?? e}`); }
    // 웹에서 지운 내전의 디스코드 메시지도 지우기
    try { const n = await router.cleanupDeleted(); if (n) log.info(`지운 내전의 디스코드 메시지 ${n}개를 지웠어요`); }
    catch (e) { log.warn(`[메시지 정리] ${e?.message ?? e}`); }
    finally { busy = false; }
  };
  results();
  setInterval(results, 30_000);
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    await router.handle(i);
  } catch (e) {
    log.warn(`[처리 실패] ${i.isChatInputCommand?.() ? '/' + i.commandName : i.customId ?? i.type}: ${e?.stack ?? e}`);
    const msg = e?.code === 50013 ? '봇에게 이 채널에 글을 쓸 권한이 없어요. 채널 권한을 확인해 주세요.' : `처리하다가 문제가 생겼어요: ${e?.message ?? e}`;
    try {
      if (i.isAutocomplete?.()) return;
      if (i.deferred || i.replied) await i.editReply({ content: msg });
      else await i.reply({ content: msg, flags: EPHEMERAL });
    } catch { /* 답장도 못 하면 로그만 남겨요 */ }
  }
});

process.on('unhandledRejection', (e) => log.warn('[처리 못 한 오류]', e?.message ?? e));
client.login(cfg.token).catch((e) => {
  const hint = e?.code === 'TokenInvalid' ? 'DISCORD_TOKEN 이 틀렸어요. 개발자 포털 → Bot → Reset Token 으로 새로 받아 .env 에 넣어 주세요.'
    : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT/.test(String(e?.code ?? e)) ? '인터넷(디스코드 서버)에 연결하지 못했어요. 서버의 네트워크를 확인해 주세요.'
      : String(e?.message ?? e);
  log.warn(`디스코드 로그인 실패: ${hint}`);
  process.exit(1);
});
