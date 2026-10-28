import '../styles/main.css';
import { html, mount, raw, on, errorText } from '../lib/dom.js';
import { isDemo } from '../lib/supabase.js';
import { auth, rpc, select } from '../lib/db.js';

const PUBLIC_NAV = [
  ['home', '/', '홈'],
  ['players', '/players', '선수'],
  ['matches', '/matches', '내전 기록'],
  ['schedule', '/schedule', '일정'],
  ['draft', '/draft', '팀 편성'],
  ['rules', '/rules', '규정']
];

const ADMIN_NAV = [
  ['home', '/admin', '대시보드'],
  ['review', '/admin/review', '결과 검토'],
  ['teams', '/admin/teams', '팀 편성 · 드래프트'],
  ['tiers', '/admin/tiers', '티어 관리'],
  ['players', '/admin/players', '선수 관리'],
  ['schedule', '/admin/schedule', '일정 관리'],
  ['devices', '/admin/devices', '업로드 장치'],
  ['scoring', '/admin/scoring', '점수 규칙'],
  ['access', '/admin/access', '권한 관리']
];

export const brand = html`<a class="brand" href="/" aria-label="무명섬 홈">
  <span class="brand-badge"><img src="/logo-character.png" alt=""></span>
  <span class="wordmark"><span>무</span><span>명</span><span>섬</span></span>
</a>`;

const demoChip = isDemo ? html`<span class="demo-chip" title="Supabase 를 연결하면 진짜 데이터로 바뀌어요">예시 데이터</span>` : '';

function publicHeader(active) {
  return html`<header class="site-header">
    ${brand}
    <nav class="nav" aria-label="주요 메뉴">
      ${PUBLIC_NAV.map(([id, href, label]) => html`<a href="${href}"${id === active ? raw(' aria-current="page"') : ''}>${label}</a>`)}
    </nav>
    <span class="header-right">${demoChip}<a class="btn pink" href="/login">디스코드 로그인</a></span>
  </header>`;
}

export function errorBox(e) {
  return html`<div class="notice warn" role="alert"><span aria-hidden="true">!</span><span>앗, 데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.<br><small class="muted">${errorText(e)}</small></span></div>`;
}

export async function startPublic(active, render) {
  const app = document.getElementById('app');
  mount(app, html`${publicHeader(active)}<main id="main" class="page"><p class="loading">데이터 불러오는 중…</p></main>`);
  const main = document.getElementById('main');
  try {
    await render(main);
  } catch (e) {
    console.error(e);
    mount(main, errorBox(e));
  }
}

function adminHeader(user) {
  const name = auth.displayName(user);
  const avatar = auth.avatarUrl(user);
  return html`<header class="site-header admin">
    ${brand}
    <span class="admin-chip">관리자</span>
    <span class="header-right">
      ${demoChip}
      <span class="me">${avatar ? html`<img src="${avatar}" alt="">` : html`<span class="initial" aria-hidden="true">${name.charAt(0)}</span>`}${name}</span>
      <a class="btn" href="/">공개 페이지로</a>
      <button class="btn text" type="button" data-logout>로그아웃</button>
    </span>
  </header>`;
}

function sideNav(active, pending) {
  return html`<nav class="side-nav" aria-label="관리 메뉴">
    ${ADMIN_NAV.map(([id, href, label]) => html`<a href="${href}"${id === active ? raw(' aria-current="page"') : ''}>${label}${id === 'review' && pending ? html` <span class="badge">${pending}</span>` : ''}</a>`)}
  </nav>`;
}

// 로그인 + 관리자 등록 여부 확인 (아니면 로그인 화면으로 보내고 null)
async function adminSession(app) {
  const back = encodeURIComponent(location.pathname + location.search);
  try {
    const session = await auth.session();
    if (!session || !(await rpc('is_admin'))) { location.replace('/login?next=' + back); return null; }
    rpc('touch_admin').catch(() => {});
    return session;
  } catch (e) {
    mount(app, html`<main class="page">${errorBox(e)}</main>`);
    return null;
  }
}

// 메뉴 없는 좁은 관리자 화면 (OBS 조종판)
export async function startAdminBare(render) {
  const app = document.getElementById('app');
  const session = await adminSession(app);
  if (!session) return;
  mount(app, html`<main id="main" class="bare-main"><p class="loading">불러오는 중…</p></main>`);
  const main = document.getElementById('main');
  try {
    await render(main, { user: session.user });
  } catch (e) {
    console.error(e);
    mount(main, errorBox(e));
  }
}

// 관리자 페이지: 로그인 + 관리자 등록 여부를 확인하고 들어가요
export async function startAdmin(active, render) {
  const app = document.getElementById('app');
  const session = await adminSession(app);
  if (!session) return;
  const [isOwner, pendingRows] = await Promise.all([
    rpc('is_owner').catch(() => false),
    select('rounds', { eq: { status: 'pending' }, columns: 'id' }).catch(() => [])
  ]);
  mount(app, html`${adminHeader(session.user)}
    <div class="admin-wrap">${sideNav(active, pendingRows.length)}<main id="main" class="admin-main"><p class="loading">불러오는 중…</p></main></div>`);
  on(app, 'click', '[data-logout]', async () => { await auth.signOut(); location.href = '/'; });
  const main = document.getElementById('main');
  try {
    await render(main, { user: session.user, isOwner: !!isOwner });
  } catch (e) {
    console.error(e);
    mount(main, errorBox(e));
  }
}
