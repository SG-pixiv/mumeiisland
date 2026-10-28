// 무명섬 결과 자동 업로드 프로그램
// 게임에서 "데이터 저장"을 누르면 생기는 GameResult_*.csv 를 찾아서 무명섬 결과 검토로 보내요.
//
// 쓰는 법
//   1. 이 파일, start-mumei-uploader.bat, uploader.config.json 을 같은 폴더에 둬요 (예: C:\mumei-uploader)
//   2. start-mumei-uploader.bat 을 더블클릭해서 켜 두고 게임을 해요
//   3. 판이 끝나면 결과 화면에서 "데이터 저장" → 몇 초 안에 무명섬 관리자 → 결과 검토에 들어가요
// 필요한 것: Node.js 18 이상 (https://nodejs.org)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = process.env.MUMEI_UPLOADER_CONFIG || path.join(HERE, 'uploader.config.json');
const STATE_FILE = path.join(path.dirname(CONFIG_FILE), 'uploader.state.json');
const PATTERN = /^GameResult_.*\.csv$/i;
const POLL_MS = Number(process.env.MUMEI_POLL_MS || 2000);
const SETTLE_MS = Number(process.env.MUMEI_SETTLE_MS || 1500);   // 파일 쓰기가 끝날 때까지 기다리는 시간
const CATCH_UP_MS = 6 * 3600_000;                                // 켜기 전 6시간 안에 생긴 파일은 올려요

const time = () => { const d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':'); };
const log = (msg) => console.log(`[${time()}] ${msg}`);

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; }
}

// ── 설정
const config = readJson(CONFIG_FILE, null);
if (!config) {
  log(`설정 파일을 찾지 못했어요: ${CONFIG_FILE}`);
  log('무명섬 관리자 → 업로드 장치에서 "설정 파일 내려받기"로 받은 uploader.config.json 을 이 폴더에 넣어 주세요.');
  process.exit(1);
}
if (!config.endpoint || !config.deviceKey) {
  log('설정 파일에 endpoint 나 deviceKey 가 비어 있어요. 업로드 장치 화면에서 설정 파일을 다시 받아 주세요.');
  process.exit(1);
}

// ── 게임 폴더 찾기 (설정의 folder 가 비어 있으면 Steam 라이브러리를 뒤져요)
function candidates() {
  const list = [];
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const steamRoots = [path.join(pf86, 'Steam'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam')];
  for (const root of steamRoots) {
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) list.push(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', 'Eternal Return'));
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
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const folder = config.folder && String(config.folder).trim() ? String(config.folder).trim() : candidates().find(isDir);
if (!folder || !isDir(folder)) {
  log(`이터널 리턴 폴더를 찾지 못했어요${config.folder ? `: ${config.folder}` : ''}`);
  log('Steam → 라이브러리 → Eternal Return 우클릭 → 관리 → 로컬 파일 보기 로 연 폴더 주소를');
  log('uploader.config.json 의 "folder" 에 넣어 주세요. (역슬래시는 두 번: "E:\\\\Program Files (x86)\\\\...")');
  process.exit(1);
}

// ── 이미 보낸 파일 기록 (파일 이름 → 수정 시각:크기)
const state = readJson(STATE_FILE, { sent: {} });
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) { log(`기록 파일을 저장하지 못했어요: ${e.message}`); } };
const sig = (st) => `${Math.round(st.mtimeMs)}:${st.size}`;

const watching = new Map();   // 이름 → { sig, since }
const failures = new Map();   // 이름 → { sig, count, next }

async function send(name, st) {
  const file = path.join(folder, name);
  const text = fs.readFileSync(file, 'utf8');
  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'x-device-key': config.deviceKey,
      'x-file-name': encodeURIComponent(name),
      'x-file-mtime': new Date(st.mtimeMs).toISOString()
    },
    body: text
  });
  let body = {};
  try { body = await res.json(); } catch { /* 빈 응답 */ }
  return { status: res.status, body };
}

async function handle(name, st) {
  const s = sig(st);
  const fail = failures.get(name);
  if (fail && fail.sig === s && Date.now() < fail.next) return;
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
    const count = (fail && fail.sig === s ? fail.count : 0) + 1;
    const wait = Math.min(300_000, 5000 * 2 ** (count - 1));
    failures.set(name, { sig: s, count, next: Date.now() + wait });
    log(`${name} 올리지 못했어요 (${count}번째): ${e.message} → ${Math.round(wait / 1000)}초 뒤 다시 해요`);
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

log('무명섬 결과 업로드를 시작했어요!');
log(`지켜보는 폴더: ${folder}`);
log('게임 결과 화면에서 "데이터 저장"을 누르면 자동으로 올라가요. 끝내려면 이 창을 닫거나 Ctrl + C.');
await tick(true);
setInterval(() => { tick(); }, POLL_MS);
