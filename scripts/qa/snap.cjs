// 검수용 페이지 스냅샷: 글자 · 요소 수 · 콘솔 오류 · DB 에서 받은 양(예시 모드 계량기 window.__mumeiNet)
// 쓰는 법 (Supabase 연결 없이 예시 데이터로):
//   npm run build && npx vite preview --port 4179      ← 다른 창에서 켜 두기
//   node scripts/qa/snap.cjs before                     ← 고치기 전
//   (코드 고치고 다시 build · preview)
//   node scripts/qa/snap.cjs after && node scripts/qa/diff.cjs before.json after.json
// playwright 가 필요해요 (npm i -D playwright && npx playwright install chromium)
const { chromium } = require('playwright');
const fs = require('fs');
const T = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const E = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const PAGES = [
  '/', '/players', `/players?event=${E(4)}`, '/players?event=next', `/player?id=${T(1)}`, `/player?id=${T(13)}`, '/matches', `/match?id=${E(1)}`, `/match?id=${E(2)}`,
  '/hall', '/records', '/schedule', '/draft', `/draft?id=${E(3)}`, '/rules', '/?preview=1', '/hall?preview=1',
  '/overlay/live', '/overlay/standings', '/overlay/result', `/overlay/standings?event=${E(2)}`,
  '/admin', '/admin/players', '/admin/tiers', '/admin/teams', '/admin/review', '/admin/schedule', '/admin/scoring',
  '/admin/records', '/admin/access', '/admin/devices', '/admin/live',
  '/rogue', '/admin/rogue', '/admin/rogue?tab=teams', '/admin/rogue?tab=scores', '/admin/rogue?tab=news', '/admin/rogue?tab=feedback'
];
const POLL = new Set(['/draft', `/draft?id=${E(3)}`, '/overlay/live', '/overlay/standings', '/overlay/result', '/admin', '/admin/live']);
(async () => {
  const label = process.argv[2] || 'snap';
  const only = process.argv[3] ? process.argv[3].split(',') : null;
  const b = await chromium.launch();
  const out = {};
  for (const path of only || PAGES) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource|fonts\.g/.test(m.text())) errors.push(m.text()); });
    await p.goto((process.env.QA_URL || 'http://localhost:4179') + path, { waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const read = () => p.evaluate(() => {
      document.getElementById('countdown')?.replaceChildren();
      const app = document.getElementById('app');
      if (!app) return { text: '(페이지 없음)', elements: 0, net: null };
      return { text: app.innerText.replace(/[ \t]+/g, ' ').trim(), elements: app.querySelectorAll('*').length, net: window.__mumeiNet ? JSON.parse(JSON.stringify(window.__mumeiNet)) : null };
    });
    const first = await read();
    let poll = null;
    if (POLL.has(path)) {
      await p.waitForTimeout(path.startsWith('/admin') ? 15600 : 10600);
      const second = await read();
      poll = { textSame: second.text === first.text, net: second.net && first.net ? { queries: second.net.queries - first.net.queries, bytes: second.net.bytes - first.net.bytes } : null };
    }
    out[path] = { text: first.text, elements: first.elements, errors, net: first.net, poll };
    console.log(path.padEnd(48), 'elements', String(first.elements).padStart(4), 'errors', errors.length, first.net ? `q ${first.net.queries} bytes ${first.net.bytes}` : '', poll ? `| poll q ${poll.net?.queries} bytes ${poll.net?.bytes} same ${poll.textSame}` : '');
    await p.close();
  }
  fs.writeFileSync(require('path').join(__dirname, `${label}.json`), JSON.stringify(out, null, 1));   // scripts/qa/<이름>.json
  await b.close();
})();
