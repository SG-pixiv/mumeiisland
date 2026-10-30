import '../styles/main.css';
import { html, mount, raw, on, errorText, qs } from '../lib/dom.js';
import { isDemo } from '../lib/supabase.js';
import { auth, rpc, select } from '../lib/db.js';
import { visibility, DEFAULT_SETTINGS } from '../lib/records.js';

// [id, 주소, 이름, 기록 공개 항목 (꺼져 있으면 메뉴에서 숨겨요)]
const PUBLIC_NAV = [
  ['home', '/', '대시보드'],
  ['players', '/players', '선수'],
  ['matches', '/matches', '내전 기록', 'results'],
  ['hall', '/hall', '우승 기록', 'hall'],
  ['records', '/records', '개인 기록', 'personal'],
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
  ['records', '/admin/records', '기록 공개'],
  ['access', '/admin/access', '권한 관리'],
  ['live', '/admin/live', 'OBS 조종판']
];

export const brand = html`<a class="brand" href="/" aria-label="무명섬 홈">
  <span class="brand-badge"><img src="/logo-character.png" alt=""></span>
  <span class="wordmark"><span>무</span><span>명</span><span>섬</span></span>
</a>`;

const demoChip = isDemo ? html`<span class="demo-chip" title="Supabase 를 연결하면 진짜 데이터로 바뀌어요">예시 데이터</span>` : '';

/** 지금 주소에 ?preview=1 을 붙인 것 (선수 · 내전 페이지의 id 는 그대로) */
function previewHref() {
  const u = new URL(location.href);
  u.searchParams.set('preview', '1');
  return u.pathname + u.search;
}

function publicHeader(active, vis, me) {
  const link = (href) => (vis.preview ? href + '?preview=1' : href);
  // 관리자로 로그인해 있으면 다시 로그인하지 않고 관리자 화면으로 (로그인은 이 브라우저에 계속 남아요)
  const right = me?.admin
    ? html`<span class="me">${auth.avatarUrl(me.user) ? html`<img src="${auth.avatarUrl(me.user)}" alt="">` : html`<span class="initial" aria-hidden="true">${auth.displayName(me.user).charAt(0)}</span>`}${auth.displayName(me.user)}</span>
      ${!vis.public && !vis.preview ? html`<a class="btn ghost" href="${previewHref()}" title="공개 전인 기록을 관리자만 미리 봐요">기록 미리보기</a>` : ''}
      <a class="btn sky" href="/admin">관리자 화면</a>`
    : html`<a class="btn pink" href="/login">디스코드 로그인</a>`;
  return html`<header class="site-header">
    ${brand}
    <nav class="nav" aria-label="주요 메뉴">
      ${PUBLIC_NAV.filter(([, , , item]) => !item || vis[item]).map(([id, href, label]) => html`<a href="${link(href)}"${id === active ? raw(' aria-current="page"') : ''}>${label}</a>`)}
    </nav>
    <span class="header-right">${demoChip}${right}</span>
  </header>`;
}

export function errorBox(e) {
  return html`<div class="notice warn" role="alert"><span aria-hidden="true">!</span><span>앗, 데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.<br><small class="muted">${errorText(e)}</small></span></div>`;
}

/** 기록 공개 설정 (12단계 SQL 전이거나 못 읽으면 비공개로 봐요) */
export async function loadSiteSettings() {
  const rows = await select('site_settings', { eq: { id: 1 } }).catch(() => []);
  return rows[0] || DEFAULT_SETTINGS;
}

/** 이 브라우저에 로그인돼 있는지 · 관리자인지 (로그인 안 했으면 서버에 묻지 않아요) */
async function whoAmI() {
  try {
    const session = await auth.session();
    if (!session) return null;
    return { user: session.user, admin: !!(await rpc('is_admin')) };
  } catch { return null; }
}

/** 공개 설정에서 꺼 둔 기록 자리에 보여 줄 안내 */
export function lockedNotice(what = '이 기록') {
  return html`<section class="card" style="justify-items: center; text-align: center; gap: 10px; padding: 40px 24px">
    <span aria-hidden="true" style="width: 64px; height: 64px; border-radius: 22px; display: grid; place-items: center; background: var(--soft); border: 2px solid var(--ink); transform: rotate(-4deg)"><svg width="30" height="30" viewBox="0 0 24 24"><path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z" fill="none" stroke="#3A2440" stroke-width="2.2" stroke-linejoin="round"/></svg></span>
    <h2 style="font-family: var(--head); font-size: 24px">${what}은 아직 비공개예요</h2>
    <p class="muted" style="margin: 0; font-weight: 600">기록은 차곡차곡 쌓이는 중이에요. 운영진이 공개하면 여기에서 볼 수 있어요!</p>
    <a class="btn" href="/">대시보드로</a>
  </section>`;
}

export async function startPublic(active, render) {
  const app = document.getElementById('app');
  const [settings, me] = await Promise.all([loadSiteSettings(), whoAmI()]);
  // ?preview=1 + 관리자면 비공개 기록도 미리 보여 줘요
  const vis = visibility(settings, { preview: qs('preview') === '1' && !!me?.admin });
  const banner = vis.preview ? html`<div class="notice" role="status" style="margin: 0 auto; max-width: 1180px; width: calc(100% - 32px)"><b>관리자 미리보기</b>&nbsp;· 공개 설정과 상관없이 모든 기록을 보여 주고 있어요. 다른 사람에게는 ${vis.public ? '기록 공개 설정대로' : '경쟁 기록이 안'} 보여요.</div>` : '';
  mount(app, html`${publicHeader(active, vis, me)}${banner}<main id="main" class="page"><p class="loading">데이터 불러오는 중…</p></main>`);
  const main = document.getElementById('main');
  try {
    await render(main, { vis, settings });
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
    if (!session) { location.replace('/login?next=' + back); return null; }
    // 소유자가 바로 추가한 디스코드 계정이면 여기서 관리자가 돼요 (8단계 SQL 전이면 그냥 넘어가요)
    const ok = (await rpc('is_admin')) || (await rpc('claim_admin_grant').catch(() => false));
    if (!ok) { location.replace('/login?next=' + back); return null; }
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
