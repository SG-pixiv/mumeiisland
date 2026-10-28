import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeConfigCode } from '../src/lib/uploader-code.js';

const require = createRequire(import.meta.url);
const up = require('../public/uploader/mumei-uploader.cjs');

const CONF = { endpoint: 'https://abc.supabase.co/functions/v1/upload-result', deviceKey: 'ABCD-EFGH-JKLM-NPQR', folder: '' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mumei-up-'));
const write = (file, obj, mtime) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
  if (mtime) fs.utimesSync(file, mtime, mtime);
};

test('설정 코드: 웹에서 만든 코드를 프로그램이 읽어요', () => {
  const code = makeConfigCode({ ...CONF, folder: 'E:\\게임\\Eternal Return' });
  assert.ok(code.startsWith('mumei:'));
  assert.doesNotMatch(code, /[+/=]/);
  assert.deepEqual(up.parseConfigCode(code), { ...CONF, folder: 'E:\\게임\\Eternal Return' });
  assert.deepEqual(up.parseConfigCode(`  "${code}"  `), { ...CONF, folder: 'E:\\게임\\Eternal Return' });   // 따옴표 · 공백
  assert.deepEqual(up.parseConfigCode(code.slice(6)), { ...CONF, folder: 'E:\\게임\\Eternal Return' });    // mumei: 빠져도
  assert.deepEqual(up.parseConfigCode(JSON.stringify(CONF)), CONF);                                         // 설정 파일 내용 그대로
  assert.equal(up.parseConfigCode('mumei:이상한값'), null);
  assert.equal(up.parseConfigCode(makeConfigCode({ endpoint: 'nope', deviceKey: 'A' })), null);
  assert.equal(up.parseConfigCode(''), null);
});

test('설정 파일 찾기: 프로그램 옆 → (1) 붙은 파일 → 다운로드 폴더', () => {
  const root = tmp();
  const dir = path.join(root, 'app'); const home = path.join(root, 'home');
  fs.mkdirSync(dir, { recursive: true });
  const env = {};

  assert.equal(up.findConfig({ dir, home, env }).file, null);

  // 다운로드 폴더: 가장 최근 것을 프로그램 옆으로 복사해요
  write(path.join(home, 'Downloads', 'uploader.config.json'), { ...CONF, deviceKey: 'OLD1-OLD1-OLD1-OLD1' }, new Date(Date.now() - 60_000));
  write(path.join(home, 'Downloads', 'uploader.config (1).json'), CONF);
  let r = up.findConfig({ dir, home, env });
  assert.equal(r.file, path.join(dir, 'uploader.config.json'));
  assert.equal(r.from, path.join(home, 'Downloads', 'uploader.config (1).json'));
  assert.equal(r.config.deviceKey, CONF.deviceKey);
  assert.ok(fs.existsSync(path.join(dir, 'uploader.config.json')));

  // 이제는 프로그램 옆 파일을 그대로 써요
  r = up.findConfig({ dir, home, env });
  assert.equal(r.from, null);

  // 망가진 파일은 이유를 알려 주고 다음 후보로
  write(path.join(dir, 'uploader.config.json'), '{ 망가짐');
  r = up.findConfig({ dir, home, env });
  assert.equal(r.config.deviceKey, CONF.deviceKey);
  assert.match(r.problems[0], /설정 내용을 읽지 못했어요/);

  // exe 에 끌어다 놓은 파일이 먼저예요
  const dropped = path.join(root, 'elsewhere', 'mine.json');
  write(dropped, { ...CONF, deviceKey: 'DROP-DROP-DROP-DROP' });
  r = up.findConfig({ dir, home, env, args: [dropped] });
  assert.equal(r.config.deviceKey, 'DROP-DROP-DROP-DROP');
  assert.equal(r.file, path.join(dir, 'uploader.config.json'));
});

test('게임 폴더: Steam 라이브러리 · 붙여 넣은 주소 정리', () => {
  const vdf = '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"E:\\\\SteamLibrary"\n\t}\n}';
  assert.deepEqual(up.steamLibraries(vdf), ['C:\\Program Files (x86)\\Steam', 'E:\\SteamLibrary']);
  assert.equal(up.cleanFolderInput('  "E:\\Program Files (x86)\\Steam\\steamapps\\common\\Eternal Return\\"  '), 'E:\\Program Files (x86)\\Steam\\steamapps\\common\\Eternal Return');
  assert.equal(up.cleanFolderInput('E:\\Games\\Eternal Return\\GameResult_123.csv'), 'E:\\Games\\Eternal Return');
  assert.ok(up.candidates({}).includes('E:\\Program Files (x86)\\Steam\\steamapps\\common\\Eternal Return'));
});

test('새 버전 비교', () => {
  assert.deepEqual(up.parseVersion('uploader-v1.2.3'), [1, 2, 3]);
  assert.equal(up.isNewer('uploader-v1.0.1', '1.0.0'), true);
  assert.equal(up.isNewer('uploader-v1.0.0', '1.0.0'), false);
  assert.equal(up.isNewer('v0.9.9', '1.0.0'), false);
  assert.equal(up.isNewer('uploader-v2.0.0', '1.10.0'), true);
  assert.equal(up.isNewer('latest', '1.0.0'), false);
});
