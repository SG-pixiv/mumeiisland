'use strict';
// 무명섬 결과 자동 업로드 프로그램
// 게임에서 "데이터 저장"을 누르면 생기는 GameResult_*.csv 를 찾아서 무명섬 결과 검토로 보내요.
//
// 쓰는 법 (exe)
//   1. mumei-uploader.exe 를 아무 폴더에 둬요 (예: 바탕 화면\무명섬 업로드)
//   2. 더블클릭 → 처음 한 번은 "설정 코드"를 붙여 넣어요 (관리자 → 업로드 장치에서 받아요)
//      설정 파일 uploader.config.json 을 exe 옆이나 다운로드 폴더에 두면 그걸 써요
//   3. 창을 켜 둔 채로 게임 → 결과 화면에서 "데이터 저장" → 몇 초 안에 결과 검토에 들어가요
// Node.js 로 직접 돌릴 때: node mumei-uploader.cjs (Node.js 18 이상)
//
// exe 만들기: npm run build:uploader (scripts/build-uploader.mjs)

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');

const VERSION = '1.0.0';
const RELEASES_API = 'https://api.github.com/repos/SG-pixiv/mumeiisland/releases/latest';
const DOWNLOAD_PAGE = 'https://github.com/SG-pixiv/mumeiisland/releases/latest';
const CONFIG_NAME = 'uploader.config.json';
const CONFIG_PATTERN = /^uploader\.config.*\.json$/i;   // 브라우저가 "uploader.config (1).json" 처럼 바꿔 저장해도 찾아요
const CODE_PREFIX = 'mumei:';
const PATTERN = /^GameResult_.*\.csv$/i;
const POLL_MS = Number(process.env.MUMEI_POLL_MS || 2000);
const SETTLE_MS = Number(process.env.MUMEI_SETTLE_MS || 1500);   // 파일 쓰기가 끝날 때까지 기다리는 시간
const CATCH_UP_MS = 6 * 3600_000;                                // 켜기 전 6시간 안에 생긴 파일은 올려요

const time = () => { const d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':'); };
const log = (msg) => console.log(`[${time()}] ${msg}`);

function isExe() {
  try { return require('node:sea').isSea(); } catch { return false; }
}
const baseDir = () => (isExe() ? path.dirname(process.execPath) : __dirname);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

// ── 설정

/** 설정 확인: 문제 없으면 '' , 있으면 이유 */
function configProblem(c) {
  if (!c || typeof c !== 'object') return '설정 내용을 읽지 못했어요';
  if (!/^https?:\/\/\S+$/i.test(String(c.endpoint || ''))) return '설정에 서버 주소(endpoint)가 없어요';
  if (!String(c.deviceKey || '').trim()) return '설정에 장치 키(deviceKey)가 없어요';
  return '';
}

/** 관리자 화면의 "설정 코드"(mumei:…) 나 설정 파일 내용(JSON) → 설정. 못 읽으면 null */
function parseConfigCode(input) {
  let s = String(input ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (!s) return null;
  if (s.startsWith('{')) {
    try { const c = JSON.parse(s); return configProblem(c) ? null : c; } catch { return null; }
  }
  if (s.toLowerCase().startsWith(CODE_PREFIX)) s = s.slice(CODE_PREFIX.length);
  s = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+=*$/.test(s)) return null;
  try {
    const c = JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
    if (configProblem(c)) return null;
    return { endpoint: String(c.endpoint), deviceKey: String(c.deviceKey), folder: c.folder ? String(c.folder) : '' };
  } catch { return null; }
}

/** 폴더 안에서 가장 최근 uploader.config*.json */
function newestConfigIn(dir) {
  let best = null;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!CONFIG_PATTERN.test(name)) continue;
      const file = path.join(dir, name);
      let st; try { st = fs.statSync(file); } catch { continue; }
      if (!st.isFile()) continue;
      if (!best || st.mtimeMs > best.mtimeMs) best = { file, mtimeMs: st.mtimeMs };
    }
  } catch { /* 폴더가 없어요 */ }
  return best?.file ?? null;
}

/**
 * 설정 파일 찾기
 *   1) 환경 변수 MUMEI_UPLOADER_CONFIG  2) exe 에 끌어다 놓은 .json  3) 프로그램 옆 uploader.config.json
 *   4) 프로그램 옆 uploader.config (1).json 같은 것  5) 다운로드 폴더 (찾으면 프로그램 옆으로 복사해요)
 * → { file, config, from, problems[] }  (못 찾으면 file 없음)
 */
function findConfig({ dir, args = [], home = os.homedir(), env = process.env } = {}) {
  const target = path.join(dir, CONFIG_NAME);
  const problems = [];
  const tryFile = (file, copy) => {
    if (!file || !isFile(file)) return null;
    const config = readJson(file, null);
    const why = configProblem(config);
    if (why) { problems.push(`${file}: ${why}`); return null; }
    if (copy && path.resolve(file) !== path.resolve(target)) {
      try { fs.copyFileSync(file, target); return { file: target, config, from: file }; } catch { /* 복사 못 하면 그 자리 파일을 써요 */ }
    }
    return { file, config, from: null };
  };
  if (env.MUMEI_UPLOADER_CONFIG) {
    const r = tryFile(path.resolve(env.MUMEI_UPLOADER_CONFIG), false);
    if (r) return { ...r, problems };
  }
  for (const a of args) {
    if (/\.json$/i.test(a)) { const r = tryFile(path.resolve(a), true); if (r) return { ...r, problems }; }
  }
  for (const [file, copy] of [[target, false], [newestConfigIn(dir), true], [newestConfigIn(path.join(home, 'Downloads')), true]]) {
    const r = tryFile(file, copy);
    if (r) return { ...r, problems };
  }
  return { file: null, config: null, from: null, problems };
}

// ── 게임 폴더 찾기 (설정의 folder 가 비어 있으면 Steam 라이브러리를 뒤져요)

/** libraryfolders.vdf 글 → 라이브러리 폴더들 */
function steamLibraries(vdf) {
  return [...String(vdf).matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'));
}

function candidates(env = process.env) {
  const list = [];
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const steamRoots = [path.join(pf86, 'Steam'), path.join(env.ProgramFiles || 'C:\\Program Files', 'Steam')];
  for (const root of steamRoots) {
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const lib of steamLibraries(vdf)) list.push(path.join(lib, 'steamapps', 'common', 'Eternal Return'));
    } catch { /* Steam 이 여기 없어요 */ }
    list.push(path.join(root, 'steamapps', 'common', 'Eternal Return'));
  }
  for (const d of 'CDEFGHIJK') {
    for (const sub of ['Program Files (x86)\\Steam', 'Program Files\\Steam', 'SteamLibrary', 'Steam', 'Games\\Steam', 'Games\\SteamLibrary']) {
      list.push(`${d}:\\${sub}\\steamapps\\common\\Eternal Return`);
    }
  }
  return [...new Set(list)];
}

/** 붙여 넣은 폴더 주소 정리: 따옴표 · 파일 주소 · 끝의 역슬래시 */
function cleanFolderInput(input) {
  let s = String(input ?? '').trim().replace(/^["']|["']$/g, '').trim();
  if (/\.(csv|exe)$/i.test(s)) s = path.win32.dirname(s);
  return s.replace(/[\\/]+$/, '');
}

// ── 새 버전 알림

/** "uploader-v1.2.3" · "v1.2.3" → [1,2,3] */
function parseVersion(tag) {
  const m = String(tag ?? '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1, 4).map(Number) : null;
}
function isNewer(tag, current = VERSION) {
  const a = parseVersion(tag); const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
async function checkUpdate() {
  try {
    const res = await fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json', 'user-agent': `mumei-uploader/${VERSION}` }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;
    const rel = await res.json();
    if (isNewer(rel.tag_name)) log(`새 버전 ${String(rel.tag_name).replace(/^uploader-/, '')} 이 나왔어요. 여기서 받아 바꿔 주세요: ${DOWNLOAD_PAGE}`);
  } catch { /* 확인 못 해도 괜찮아요 */ }
}

// ── 창 띄운 채로 묻기 · 기다리기

const interactive = () => !!process.stdin.isTTY && !process.env.MUMEI_NO_PROMPT;

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let done = false;
    rl.on('close', () => { if (!done) resolve(null); });   // Ctrl + C · 창 닫기
    rl.question(question, (answer) => { done = true; rl.close(); resolve(answer); });
  });
}

async function fail(...lines) {
  for (const l of lines) log(l);
  if (interactive()) await ask('\nEnter 를 누르면 창이 닫혀요. ');
  process.exit(1);
}

// ── 업로드

function startWatching(config, folder, stateFile) {
  const state = readJson(stateFile, { sent: {} });
  if (!state.sent || typeof state.sent !== 'object') state.sent = {};
  const saveState = () => { try { fs.writeFileSync(stateFile, JSON.stringify(state, null, 2)); } catch (e) { log(`기록 파일을 저장하지 못했어요: ${e.message}`); } };
  const sig = (st) => `${Math.round(st.mtimeMs)}:${st.size}`;

  const watching = new Map();   // 이름 → { sig, since }
  const failures = new Map();   // 이름 → { sig, count, next }

  async function send(name, st) {
    const text = fs.readFileSync(path.join(folder, name), 'utf8');
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'x-device-key': config.deviceKey,
        'x-file-name': encodeURIComponent(name),
        'x-file-mtime': new Date(st.mtimeMs).toISOString()
      },
      body: text,
      signal: AbortSignal.timeout(30_000)
    });
    let body = {};
    try { body = await res.json(); } catch { /* 빈 응답 */ }
    return { status: res.status, body };
  }

  async function handle(name, st) {
    const s = sig(st);
    const prev = failures.get(name);
    if (prev && prev.sig === s && Date.now() < prev.next) return;
    try {
      const { status, body } = await send(name, st);
      if (body.ok) {
        log(body.duplicate ? `${name} · ${body.message}` : `${name} 올림 ✓ ${body.message}`);
        state.sent[name] = s; saveState(); failures.delete(name);
        return;
      }
      const msg = body.error || `서버 응답 ${status}`;
      if (status === 422) {           // 게임 결과 CSV 가 아니에요 → 이 파일은 다시 안 보내요
        log(`${name} 건너뜀: ${msg}`);
        state.sent[name] = s; saveState(); failures.delete(name);
        return;
      }
      throw new Error(msg);
    } catch (e) {
      const count = (prev && prev.sig === s ? prev.count : 0) + 1;
      const wait = Math.min(300_000, 5000 * 2 ** (count - 1));
      failures.set(name, { sig: s, count, next: Date.now() + wait });
      const why = e?.name === 'TimeoutError' ? '서버가 응답하지 않아요' : e.message;
      log(`${name} 올리지 못했어요 (${count}번째): ${why} → ${Math.round(wait / 1000)}초 뒤 다시 해요`);
    }
  }

  let busy = false;
  async function tick(first = false) {
    if (busy) return;
    busy = true;
    try {
      const names = fs.readdirSync(folder).filter((n) => PATTERN.test(n));
      for (const name of names) {
        let st;
        try { st = fs.statSync(path.join(folder, name)); } catch { continue; }
        const s = sig(st);
        if (state.sent[name] === s || st.size === 0) continue;
        if (first && Date.now() - st.mtimeMs > CATCH_UP_MS) { state.sent[name] = s; continue; }   // 오래된 파일은 건너뛰어요
        const w = watching.get(name);
        if (!w || w.sig !== s) { watching.set(name, { sig: s, since: Date.now() }); continue; }   // 아직 쓰는 중일 수 있어요
        if (Date.now() - w.since < SETTLE_MS) continue;
        watching.delete(name);
        await handle(name, st);
      }
      if (first) saveState();
    } catch (e) {
      log(`폴더를 읽지 못했어요: ${e.message}`);
    } finally {
      busy = false;
    }
  }

  return tick(true).then(() => setInterval(() => { tick(); }, POLL_MS));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) { console.log(VERSION); return; }
  try { process.title = '무명섬 결과 업로드'; } catch { /* 제목은 못 바꿔도 괜찮아요 */ }

  const dir = baseDir();
  log(`무명섬 결과 업로드 v${VERSION}`);
  const update = checkUpdate();

  // 1. 설정
  const found = findConfig({ dir, args });
  let configFile = found.file;
  let config = found.config;
  if (config && found.from) log(`설정 파일을 가져왔어요: ${found.from}`);
  if (!config) {
    for (const p of found.problems) log(`설정 파일을 쓸 수 없어요 → ${p}`);
    if (!interactive()) {
      return fail(`설정 파일을 찾지 못했어요: ${path.join(dir, CONFIG_NAME)}`,
        '무명섬 관리자 → 업로드 장치에서 받은 uploader.config.json 을 이 프로그램 옆에 넣어 주세요.');
    }
    console.log('\n처음 한 번만 설정하면 돼요.');
    console.log('무명섬 관리자 → 업로드 장치에서 장치 키를 만들 때 나온 "설정 코드"를 붙여 넣고 Enter 를 눌러 주세요.');
    console.log('(붙여 넣기: 마우스 오른쪽 클릭 또는 Ctrl + V · 설정 파일 uploader.config.json 을 이 프로그램 옆에 넣고 다시 켜도 돼요)\n');
    while (!config) {
      const answer = await ask('설정 코드: ');
      if (answer === null || !answer.trim()) return fail('설정 없이 끝냈어요.');
      config = parseConfigCode(answer);
      if (!config) console.log('설정 코드를 읽지 못했어요. "mumei:" 로 시작하는 코드를 통째로 붙여 넣어 주세요.\n');
    }
    configFile = path.join(dir, CONFIG_NAME);
    try { fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n'); log(`설정을 저장했어요: ${configFile}`); }
    catch (e) { log(`설정을 저장하지 못했어요 (${e.message}). 다음에 켤 때 다시 물어볼게요.`); }
  }

  // 2. 게임 폴더
  let folder = config.folder && String(config.folder).trim() ? String(config.folder).trim() : candidates().find(isDir);
  if (!folder || !isDir(folder)) {
    log(`이터널 리턴 폴더를 찾지 못했어요${config.folder ? `: ${config.folder}` : ''}`);
    if (!interactive()) {
      return fail('Steam → 라이브러리 → Eternal Return 우클릭 → 관리 → 로컬 파일 보기 로 연 폴더 주소를',
        `${configFile} 의 "folder" 에 넣어 주세요. (역슬래시는 두 번: "E:\\\\Program Files (x86)\\\\...")`);
    }
    console.log('\nSteam → 라이브러리 → Eternal Return 우클릭 → 관리 → 로컬 파일 보기 로 폴더를 열고,');
    console.log('위쪽 주소창을 클릭해서 나온 주소를 복사해 붙여 넣어 주세요.\n');
    for (;;) {
      const answer = await ask('이터널 리턴 폴더: ');
      if (answer === null || !answer.trim()) return fail('폴더 없이 끝냈어요.');
      const f = cleanFolderInput(answer);
      if (isDir(f)) { folder = f; break; }
      console.log(`그 폴더를 찾지 못했어요: ${f}\n`);
    }
    config.folder = folder;
    try { fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n'); } catch { /* 다음에 다시 물어봐요 */ }
  }

  // 3. 시작
  log('결과 업로드를 시작했어요!');
  log(`지켜보는 폴더: ${folder}`);
  log('게임 결과 화면에서 "데이터 저장"을 누르면 자동으로 올라가요. 끝내려면 이 창을 닫거나 Ctrl + C.');
  await startWatching(config, folder, path.join(path.dirname(configFile), 'uploader.state.json'));
  await update;
}

module.exports = { VERSION, CODE_PREFIX, configProblem, parseConfigCode, findConfig, newestConfigIn, steamLibraries, candidates, cleanFolderInput, parseVersion, isNewer };

if (isExe() || require.main === module) {
  main().catch((e) => fail(`예상하지 못한 오류가 났어요: ${e?.stack || e}`));
}
