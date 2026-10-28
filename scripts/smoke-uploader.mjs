// 업로드 프로그램 실제 동작 확인: 가짜 서버를 띄우고, 게임 폴더에 GameResult_*.csv 를 만든 뒤 올라오는지 봐요
//   node scripts/smoke-uploader.mjs dist-uploader/mumei-uploader.exe   (exe)
//   node scripts/smoke-uploader.mjs                                     (node 로 public/uploader/mumei-uploader.cjs)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const KEY = 'TEST-SMOK-E000-0001';
const CSV = '﻿Rank, Team, Nickname\n1, 1, 테스트유저\n';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mumei-smoke-'));
const game = path.join(dir, 'Eternal Return');
fs.mkdirSync(game);

let output = '';
let child;
const finish = (ok, msg) => {
  try { child?.kill(); } catch { /* 이미 끝났어요 */ }
  server.close();
  console.log(`\n${ok ? '통과' : '실패'}: ${msg}`);
  if (!ok) console.log('--- 프로그램 출력 ---\n' + output);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
};

const server = http.createServer((req, res) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, message: '스모크 테스트로 받았어요' }));
    const name = decodeURIComponent(req.headers['x-file-name'] || '');
    if (req.headers['x-device-key'] !== KEY) return finish(false, `장치 키가 달라요: ${req.headers['x-device-key']}`);
    if (name !== 'GameResult_777.csv') return finish(false, `파일 이름이 달라요: ${name}`);
    if (body !== CSV) return finish(false, 'CSV 내용이 달라요');
    // 프로그램이 "올림 ✓" 을 찍을 시간을 조금 줘요
    setTimeout(() => (/올림 ✓/.test(output) ? finish(true, '업로드 · 응답 처리 모두 됐어요') : finish(false, '서버는 받았는데 프로그램이 성공을 찍지 않았어요')), 1500);
  });
});

server.listen(0, '127.0.0.1', () => {
  const config = path.join(dir, 'uploader.config.json');
  fs.writeFileSync(config, JSON.stringify({ endpoint: `http://127.0.0.1:${server.address().port}/functions/v1/upload-result`, deviceKey: KEY, folder: game }));
  fs.writeFileSync(path.join(game, 'GameResult_777.csv'), CSV);
  const [cmd, args] = target ? [path.resolve(target), []] : [process.execPath, [path.join(ROOT, 'public', 'uploader', 'mumei-uploader.cjs')]];
  child = spawn(cmd, args, { env: { ...process.env, MUMEI_UPLOADER_CONFIG: config, MUMEI_NO_PROMPT: '1', MUMEI_POLL_MS: '400', MUMEI_SETTLE_MS: '500' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => { output += d; process.stdout.write(d); });
  child.stderr.on('data', (d) => { output += d; process.stderr.write(d); });
  child.on('exit', (code) => finish(false, `프로그램이 먼저 끝났어요 (종료 코드 ${code})`));
  setTimeout(() => finish(false, '30초 안에 업로드가 오지 않았어요'), 30_000);
});
