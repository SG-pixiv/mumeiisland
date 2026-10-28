// 봇 설정 저장 (bot/data/settings.json): 서버별 공지 · 명령어 채널, 이미 올린 라운드 결과
// DB 를 바꾸지 않으려고 봇 폴더에 저장해요. 지워지면 /채널설정 을 다시 하면 돼요.

import fs from 'node:fs';
import path from 'node:path';

export function fileStore(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 처음이거나 없어요 */ }
  return {
    get: () => data,
    update(patch) {
      data = { ...data, ...patch };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
      return data;
    }
  };
}

export function memoryStore(init = {}) {
  let data = structuredClone(init);
  return { get: () => data, update(patch) { data = { ...data, ...patch }; return data; } };
}

/** 이 서버의 채널 설정 { announce, commands } */
export const channelsOf = (store, guildId) => store.get().guilds?.[guildId] ?? {};
export function setChannels(store, guildId, patch) {
  const guilds = { ...(store.get().guilds ?? {}) };
  guilds[guildId] = { ...(guilds[guildId] ?? {}), ...patch };
  for (const k of Object.keys(guilds[guildId])) if (guilds[guildId][k] == null) delete guilds[guildId][k];
  return store.update({ guilds });
}
