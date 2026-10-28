// 슬래시 명령어를 디스코드 서버에 등록해요: npm run register
// 명령어를 바꿨을 때만 다시 실행하면 돼요. (서버 전용 등록이라 바로 보여요)

import { loadConfig } from './config.js';
import { commands } from './commands.js';

const cfg = loadConfig({ forRegister: true });
const url = `https://discord.com/api/v10/applications/${cfg.appId}/guilds/${cfg.guildId}/commands`;
const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bot ${cfg.token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(commands)
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`명령어 등록 실패 (${res.status})`, JSON.stringify(body, null, 2));
  if (res.status === 401) console.error('→ DISCORD_TOKEN 이 틀렸어요. 개발자 포털 → Bot → Reset Token 으로 새로 받아 주세요.');
  if (res.status === 403 || body.code === 50001) console.error('→ 봇이 그 서버에 없어요. README 의 초대 링크로 먼저 초대해 주세요.');
  process.exit(1);
}
console.log(`명령어 ${body.length}개를 등록했어요: ${body.map((c) => '/' + c.name).join(' ')}`);
