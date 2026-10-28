// OBS 조종판: OBS 의 "사용자 지정 브라우저 도크"에 붙여 두고 방송하면서 누르는 좁은 화면
import { startAdminBare, brand } from '../../components/shell.js';
import { mountLiveControl } from '../../components/live-control.js';
import { html, mount, on, toast } from '../../lib/dom.js';

const SIZES = [100, 80, 70, 60, 50];

startAdminBare(async (main) => {
  document.title = '무명섬 · OBS 조종판';
  let size = 100;
  const base = location.origin;
  const withSize = (path) => (size === 100 ? base + path : `${base}${path}?size=${size}`);
  const box = (w, h) => `${Math.ceil(w * size / 100)} × ${Math.ceil(h * size / 100)}`;
  const urlRow = (title, url, note) => html`<div class="url-row">
      <b>${title}</b>
      <span class="flex"><input readonly value="${url}" aria-label="${title} 주소" data-url><button type="button" class="btn sm" data-copy>복사</button></span>
      <small class="muted" style="font-weight: 600">${note}</small>
    </div>`;
  const urls = () => html`<details class="card" style="gap: 10px" open>
      <summary style="font-family: var(--head); font-size: 18px; cursor: pointer">오버레이 주소 (OBS 브라우저 소스)</summary>
      <label class="field">LIVE 배지 · 누적 순위 크기
        <select data-size>${SIZES.map((s) => html`<option value="${s}" ${s === size ? 'selected' : ''}>${s}%</option>`)}</select>
      </label>
      ${urlRow('① LIVE 배지', withSize('/overlay/live'), `소스 크기 ${box(560, 90)} · 화면 왼쪽 위에 두기`)}
      ${urlRow('② 누적 순위', withSize('/overlay/standings'), `소스 크기 ${box(600, 800)} · 오른쪽, 가운데보다 조금 위`)}
      ${urlRow('③ 라운드 결과 + MVP', base + '/overlay/result', '소스 크기 1920 × 1080 · 판 사이 장면에 꽉 차게')}
      <small class="muted" style="font-weight: 600">배경이 투명해서 소스를 조금 크게 잡아도 괜찮아요. 위치는 OBS 화면에서 끌어서 옮기면 돼요.</small>
    </details>`;
  const howTo = html`<details class="card" style="gap: 8px">
      <summary style="font-family: var(--head); font-size: 18px; cursor: pointer">OBS 에 이 조종판 붙이는 법</summary>
      <ol style="margin: 0; padding-left: 20px; display: grid; gap: 4px; font-weight: 600">
        <li>OBS 위쪽 메뉴 <b>도크(Docks)</b> → <b>사용자 지정 브라우저 도크(Custom Browser Docks)</b></li>
        <li>이름 <b>무명섬</b>, 주소에 <b>${base}/admin/live</b> 넣고 적용</li>
        <li>생긴 창에서 처음 한 번만 디스코드 로그인</li>
        <li>창을 OBS 옆에 끌어다 붙이면 끝</li>
      </ol>
    </details>`;
  mount(main, html`<div class="bare-head">${brand}<span style="display: grid; justify-items: end"><b>OBS 조종판</b><a href="/admin" target="_blank" rel="noopener" style="font-size: 13px; font-weight: 700">관리자 페이지 열기</a></span></div>
    <div data-live-control></div>
    <div data-urls>${urls()}</div>
    ${howTo}`);
  await mountLiveControl(main.querySelector('[data-live-control]'), { compact: true, every: 10000 });
  on(main, 'change', '[data-size]', (_e, s) => { size = Number(s.value); mount(main.querySelector('[data-urls]'), urls()); });
  on(main, 'click', '[data-copy]', async (_e, b) => {
    const input = b.parentElement.querySelector('[data-url]');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    toast('주소를 복사했어요');
  });
});
