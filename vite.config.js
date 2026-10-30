import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// 사이트에 있는 모든 페이지 (html 파일 하나 = 페이지 하나)
export const pages = [
  'index', 'players', 'player', 'matches', 'match', 'hall', 'records', 'schedule', 'draft', 'rules', 'login',
  'admin/index', 'admin/players', 'admin/tiers', 'admin/teams', 'admin/review',
  'admin/schedule', 'admin/scoring', 'admin/records', 'admin/access', 'admin/devices', 'admin/live',
  'overlay/live', 'overlay/standings', 'overlay/result'
];

// 개발 서버에서도 /players 처럼 .html 없이 열리게 (배포 후에는 vercel.json 의 cleanUrls 가 처리)
function cleanUrls() {
  const rewrite = (dir) => (req, _res, next) => {
    const [path, query] = (req.url || '/').split('?');
    if (!path.includes('.') && path !== '/') {
      const base = path.replace(/\/$/, '');
      const candidates = [base + '.html', base + '/index.html'];
      const hit = candidates.find((c) => existsSync(resolve(dir, '.' + c)));
      if (hit) req.url = hit + (query ? '?' + query : '');
    }
    next();
  };
  return {
    name: 'mumeiisland-clean-urls',
    configureServer(server) { server.middlewares.use(rewrite(root)); },
    configurePreviewServer(server) { server.middlewares.use(rewrite(resolve(root, 'dist'))); }
  };
}

export default defineConfig({
  appType: 'mpa',
  plugins: [cleanUrls()],
  build: {
    rollupOptions: {
      input: Object.fromEntries(pages.map((p) => [p.replace('/', '-'), resolve(root, p + '.html')]))
    }
  }
});
