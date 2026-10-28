// 업로드 프로그램을 Windows exe 하나로 묶어요 (Node.js 단일 실행 파일, SEA)
//   npm run build:uploader  →  dist-uploader/mumei-uploader.exe
//
// Windows 에서는 지금 쓰는 node.exe 를, 다른 OS 에서는 같은 버전의 Windows 용 node.exe(npm 의 node-win-x64)를 받아서 써요.
// 순서: 프로그램(public/uploader/mumei-uploader.cjs) → SEA 블롭 → node.exe 복사 → 아이콘 · 파일 설명 바꾸기 → 블롭 넣기

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as ResEdit from 'resedit';
import { inject } from 'postject';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'uploader', 'mumei-uploader.cjs');
const ICON = path.join(ROOT, 'scripts', 'uploader-icon.ico');
const OUT_DIR = path.join(ROOT, 'dist-uploader');
const CACHE = path.join(ROOT, '.cache', 'uploader');
const EXE = path.join(OUT_DIR, 'mumei-uploader.exe');
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const NODE_VERSION = process.versions.node;

const step = (msg) => console.log(`• ${msg}`);
const { VERSION } = createRequire(import.meta.url)(SRC);

/** 블롭을 만드는 node 와 같은 버전의 Windows node.exe */
function windowsNode() {
  if (process.platform === 'win32') return { exe: process.execPath, license: path.join(path.dirname(process.execPath), 'LICENSE') };
  if (process.env.NODE_WIN_EXE) return { exe: process.env.NODE_WIN_EXE, license: null };
  const dir = path.join(CACHE, `node-win-x64-${NODE_VERSION}`);
  const exe = path.join(dir, 'package', 'bin', 'node.exe');
  if (!fs.existsSync(exe)) {
    step(`Windows 용 Node.js ${NODE_VERSION} 받는 중 (npm: node-win-x64)`);
    fs.mkdirSync(dir, { recursive: true });
    const out = execFileSync('npm', ['pack', `node-win-x64@${NODE_VERSION}`, '--pack-destination', dir, '--silent'], { encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['-xzf', path.join(dir, out), '-C', dir]);
    fs.rmSync(path.join(dir, out));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package', 'package.json'), 'utf8'));
  if (pkg.version !== NODE_VERSION) throw new Error(`node.exe 버전(${pkg.version})이 지금 Node.js(${NODE_VERSION})와 달라요`);
  const license = ['LICENSE', 'LICENSE.md'].map((n) => path.join(dir, 'package', n)).find((f) => fs.existsSync(f)) ?? null;
  return { exe, license };
}

/** 아이콘 · 파일 설명(작업 관리자에 보이는 이름) 바꾸기. 원래 서명은 지워요 (바꾼 뒤에는 어차피 맞지 않아요) */
function brand(buf) {
  const exe = ResEdit.NtExecutable.from(buf, { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);

  const icon = ResEdit.Data.IconFile.from(fs.readFileSync(ICON));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] ?? { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, icon.icons.map((i) => i.data));

  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const [major, minor, patch] = VERSION.split('.').map(Number);
  const lang = vi.getAllLanguagesForStringValues()[0] ?? { lang: 1033, codepage: 1200 };
  vi.setFileVersion(major, minor, patch, 0, lang.lang);
  vi.setProductVersion(major, minor, patch, 0, lang.lang);
  vi.setStringValues(lang, {
    FileDescription: '무명섬 결과 업로드',
    ProductName: '무명섬 결과 업로드',
    CompanyName: 'mumeiisland',
    InternalName: 'mumei-uploader',
    OriginalFilename: 'mumei-uploader.exe',
    FileVersion: VERSION,
    ProductVersion: VERSION,
    LegalCopyright: `무명섬 · Node.js ${NODE_VERSION} (MIT, Node.js contributors)`
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  return Buffer.from(exe.generate());
}

async function main() {
  console.log(`무명섬 업로드 프로그램 v${VERSION} exe 만들기 (Node.js ${NODE_VERSION})`);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const node = windowsNode();

  step('SEA 블롭 만드는 중');
  const blob = path.join(OUT_DIR, 'sea-prep.blob');
  const seaConfig = path.join(OUT_DIR, 'sea-config.json');
  fs.writeFileSync(seaConfig, JSON.stringify({
    main: SRC, output: blob,
    disableExperimentalSEAWarning: true,
    useSnapshot: false, useCodeCache: false   // 둘 다 끄면 다른 OS 에서 만든 블롭도 Windows 에서 돌아가요
  }, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

  // 순서가 중요해요: 원본 node.exe 에 먼저 블롭을 넣고(Node.js 문서 방식), 그다음 리소스만 바꿔요
  step('프로그램 넣는 중');
  fs.copyFileSync(node.exe, EXE);
  await inject(EXE, 'NODE_SEA_BLOB', fs.readFileSync(blob), { sentinelFuse: SEA_FUSE, overwrite: false });

  step('아이콘 · 파일 설명 넣는 중');
  fs.writeFileSync(EXE, brand(fs.readFileSync(EXE)));

  fs.rmSync(blob); fs.rmSync(seaConfig);
  const licenseOut = path.join(OUT_DIR, 'NODE-LICENSE.txt');
  if (node.license && fs.existsSync(node.license)) fs.copyFileSync(node.license, licenseOut);
  else fs.writeFileSync(licenseOut, `mumei-uploader.exe contains Node.js ${NODE_VERSION} (https://nodejs.org).\nNode.js is licensed under the MIT license. Its full license text, including bundled third-party components, is at:\nhttps://github.com/nodejs/node/blob/v${NODE_VERSION}/LICENSE\n`);
  const size = fs.statSync(EXE).size;
  console.log(`\n완성: ${path.relative(ROOT, EXE)} (${(size / 1048576).toFixed(1)} MB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
