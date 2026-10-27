import '../styles/main.css';
import { html, mount, on, qs, errorText } from '../lib/dom.js';
import { isDemo } from '../lib/supabase.js';
import { auth, rpc } from '../lib/db.js';

const app = document.getElementById('app');
const nextRaw = qs('next') || '';
const next = /^\/admin(\/[\w-]*)?(\?.*)?$/.test(nextRaw) ? nextRaw : '/admin';

const state = { step: 'loading', user: null, key: '', error: '', busy: false };

const STEPS = [['start', '디스코드 로그인'], ['key', '관리자 키'], ['done', '완료']];

function stepper() {
  const idx = state.step === 'owner' ? 1 : Math.max(0, STEPS.findIndex(([s]) => s === state.step));
  return html`<ol aria-label="로그인 단계" style="list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; font-size: 13px; font-weight: 700">
    ${STEPS.map(([, label], i) => html`<li class="flex" style="gap: 6px; color: ${i <= idx ? 'var(--ink)' : 'var(--muted)'}"><span aria-hidden="true" style="width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; font-family: var(--num); font-weight: 800; font-size: 12px; background: ${i < idx ? 'var(--sky)' : i === idx ? 'var(--pink)' : 'var(--card)'}; border: 2px solid ${i <= idx ? 'var(--ink)' : 'var(--line)'}">${i + 1}</span>${label}${i < 2 ? html`<span aria-hidden="true" style="color: var(--line)">›</span>` : ''}</li>`)}
  </ol>`;
}

function body() {
  const who = state.user ? auth.displayName(state.user) : '';
  if (state.step === 'loading') return html`<p class="loading">확인하는 중…</p>`;
  if (state.step === 'start') {
    return html`<div class="stack" style="width: 100%; gap: 14px">
      <p class="muted" style="margin: 0; font-weight: 600">여기는 운영진 전용 구역이에요! 등록된 디스코드 계정만 들어올 수 있고, 처음이면 로그인한 다음 관리자 키를 넣어 주세요.</p>
      ${isDemo ? html`<p class="notice" style="margin: 0; text-align: left">지금은 Supabase 연결 전이라 예시 데이터로 보여요. 버튼을 누르면 바로 관리자 화면으로 들어가요.</p>` : ''}
      <button type="button" class="btn sky big" data-login style="width: 100%; min-height: 58px; font-size: 20px; border-width: 3px">디스코드로 로그인</button>
    </div>`;
  }
  if (state.step === 'key' || state.step === 'owner') {
    const owner = state.step === 'owner';
    return html`<form class="stack" style="width: 100%; gap: 12px; text-align: left" data-key-form>
      <div class="flex" style="flex-wrap: nowrap; background: var(--sky-soft); border-radius: 18px; padding: 10px 14px">
        ${auth.avatarUrl(state.user) ? html`<img src="${auth.avatarUrl(state.user)}" alt="" style="width: 36px; height: 36px; border-radius: 50%; border: 2px solid var(--sky-ink)">` : ''}
        <span style="display: grid; min-width: 0"><b>${who} 으로 로그인했어요</b><small class="muted" style="font-weight: 600">${owner ? '아직 소유자가 없어요. 처음 한 번만 소유자 키를 넣어 주세요.' : '아직 관리자로 등록되지 않은 계정이에요'}</small></span>
      </div>
      <label class="field">${owner ? '소유자 설정 키' : '관리자 키'}
        <input name="key" autocomplete="off" spellcheck="false" maxlength="64" required value="${state.key}" placeholder="${owner ? 'Supabase 에 넣어 둔 소유자 키' : 'XXXX-XXXX-XXXX'}" style="font-family: Consolas, 'D2Coding', monospace; font-size: 20px; letter-spacing: 0.06em; text-transform: uppercase; text-align: center; border-width: 3px; border-color: ${state.error ? 'var(--pink-ink)' : 'var(--line)'}; min-height: 56px">
      </label>
      ${state.error ? html`<p role="alert" class="notice pink" style="margin: 0; color: var(--pink-ink)">${state.error}</p>` : ''}
      <button type="submit" class="btn pink big" style="width: 100%" ${state.busy ? 'disabled' : ''}>${state.busy ? '확인하는 중…' : '키 확인'}</button>
      <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">${owner ? '소유자 키는 한 번 쓰면 사라져요. 그 뒤로는 관리자 키를 만들어서 운영진에게 나눠 주면 돼요.' : '키는 소유자나 관리자에게 받아요. 한 번 쓰면 사라지고, 등록한 뒤에는 디스코드 로그인만 하면 돼요.'}</p>
      <button type="button" class="btn text" data-other style="justify-self: center">다른 계정으로 로그인</button>
    </form>`;
  }
  return html`<div class="stack" style="width: 100%; justify-items: center; gap: 12px">
    <span aria-hidden="true" style="width: 64px; height: 64px; border-radius: 50%; display: grid; place-items: center; background: var(--sky); border: 3px solid var(--ink); box-shadow: 0 4px 0 var(--ink)"><svg width="30" height="30" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" fill="none" stroke="#3A2440" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    <h2 role="status" style="font-family: var(--head); font-size: 24px">와아! 관리자로 등록됐어요</h2>
    <p class="muted" style="margin: 0; font-weight: 600">다음부터는 디스코드 로그인만 하면 바로 들어와요.</p>
    <a class="btn pink big" href="${next}" style="width: 100%">관리자 페이지로</a>
  </div>`;
}

function draw() {
  mount(app, html`<div style="min-height: 100vh; display: grid; place-items: center; padding: 48px 16px">
    <main style="position: relative; width: 100%; max-width: 480px; display: grid; justify-items: center; gap: 16px; text-align: center; background: var(--card); border: 3px solid var(--ink); border-radius: 40px; padding: 40px 32px 30px; box-shadow: 10px 12px 0 var(--pink)">
      <span class="brand-badge" style="width: 140px; height: 140px; border-radius: 42px; border-width: 3px; box-shadow: 6px 8px 0 var(--sky)"><img src="/logo-character.png" alt=""></span>
      <h1 class="wordmark big" style="margin-top: 6px"><span>무</span><span>명</span><span>섬</span></h1>
      <p style="margin: 0; font-family: var(--head); font-size: 20px">운영진 로그인</p>
      ${stepper()}
      ${body()}
      <ul style="list-style: none; margin: 4px 0 0; padding: 14px 16px; width: 100%; display: grid; gap: 8px; text-align: left; background: var(--soft); border-radius: 22px; font-size: 14px; font-weight: 600">
        <li>· 선수, 내전 기록, 일정, 규정은 로그인 없이 누구나 볼 수 있어요.</li>
        <li>· 디스코드에서는 닉네임과 사용자 ID만 받아요. 서버 목록이나 메시지는 보지 않아요.</li>
        <li>· 키를 5번 틀리면 10분 동안 입력이 막혀요.</li>
      </ul>
      <a href="/" class="btn text">← 공개 페이지로 돌아가기</a>
    </main>
  </div>`);
  if (state.step === 'key' || state.step === 'owner') app.querySelector('input[name="key"]')?.focus();
}

const REASON = {
  invalid: (r) => `앗, 키가 맞지 않거나 이미 쓴 키, 아니면 만료된 키예요. (${r.fails || 1} / 5)`,
  locked: () => '5번 틀려서 10분 동안 입력이 막혔어요. 잠시 후 다시 시도해 주세요.',
  login: () => '로그인이 풀렸어요. 다시 로그인해 주세요.',
  owner_exists: () => '이미 소유자가 있어요. 소유자에게 관리자 키를 받아 주세요.',
  no_setup_key: () => '소유자 설정 키가 아직 등록되지 않았어요. README 의 "소유자 등록" 순서를 먼저 해 주세요.'
};

on(app, 'click', '[data-login]', async () => {
  if (isDemo) { location.href = next; return; }
  try {
    await auth.signInDiscord(location.origin + '/login' + (nextRaw ? '?next=' + encodeURIComponent(next) : ''));
  } catch (e) {
    state.error = errorText(e);
    draw();
  }
});

on(app, 'click', '[data-other]', async () => {
  await auth.signOut();
  Object.assign(state, { step: 'start', user: null, key: '', error: '' });
  draw();
});

on(app, 'submit', '[data-key-form]', async (e, form) => {
  e.preventDefault();
  state.key = form.key.value.trim();
  state.busy = true; state.error = '';
  draw();
  try {
    const r = await rpc(state.step === 'owner' ? 'claim_owner' : 'redeem_admin_key', { p_key: state.key });
    if (r?.ok) { state.step = 'done'; state.key = ''; }
    else state.error = (REASON[r?.reason] || REASON.invalid)(r || {});
  } catch (err) {
    state.error = errorText(err);
  }
  state.busy = false;
  draw();
});

(async () => {
  draw();
  const err = new URLSearchParams(location.hash.slice(1)).get('error_description') || qs('error_description');
  try {
    const session = await auth.session();
    if (!session || isDemo) {
      state.step = 'start';
      if (err) state.error = err;
    } else {
      state.user = session.user;
      if (await rpc('is_admin')) { location.replace(next); return; }
      state.step = (await rpc('owner_exists')) ? 'key' : 'owner';
    }
  } catch (e) {
    state.step = 'start';
    state.error = errorText(e);
  }
  draw();
  if (state.error && state.step === 'start') {
    app.querySelector('[data-login]')?.insertAdjacentHTML('afterend', `<p role="alert" class="notice pink" style="margin: 0">${state.error.replace(/[<>&]/g, '')}</p>`);
  }
})();
