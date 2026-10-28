import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText } from '../../lib/dom.js';
import { select, rpc } from '../../lib/db.js';
import { isDemo } from '../../lib/supabase.js';
import { dateTimeShort } from '../../lib/fmt.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://<프로젝트 ID>.supabase.co';
const ENDPOINT = `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1/upload-result`;

startAdmin('devices', async (main) => {
  const state = { fresh: null, freshName: '', folder: '', copied: false, busy: false };
  let devices = [];

  const reload = async () => { devices = await select('upload_devices', { order: 'created_at', asc: false }); };

  const configText = () => JSON.stringify({
    endpoint: ENDPOINT,
    deviceKey: state.fresh,
    folder: state.folder.trim()
  }, null, 2) + '\n';

  const step = (n, title, body) => html`<li style="display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; align-items: start">
    <span class="medal sm" style="width: 34px; height: 34px">${n}</span><span style="display: grid; gap: 4px"><b style="font-family: var(--head); font-size: 17px">${title}</b>${body}</span></li>`;

  const draw = () => {
    const live = devices.filter((d) => !d.revoked_at);
    mount(main, html`
      <div><h1>업로드 장치</h1><p class="lead">게임 PC 에 작은 프로그램을 켜 두면, 결과 화면에서 "데이터 저장"을 누를 때마다 결과 검토로 바로 올라와요!</p></div>
      <div class="row">
        <div class="grow stack" style="gap: 18px">
          <section class="card ink"><h2>처음 한 번 설정하기</h2>
            <ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 16px">
              ${step(1, '장치 키 만들기', html`<span class="muted" style="font-weight: 600">아래 "장치 키 만들기"에서 이름을 적고 만들어요. 키는 만든 직후 한 번만 보여요.</span>`)}
              ${step(2, '파일 3개 내려받기', html`<span class="muted" style="font-weight: 600">게임 PC 에 폴더를 하나 만들고 (예: <code>C:\\mumei-uploader</code>) 세 파일을 같이 넣어요.</span>
                <span class="flex" style="gap: 8px; margin-top: 4px">
                  <a class="btn sm sky" href="/uploader/mumei-uploader.mjs" download="mumei-uploader.mjs">프로그램 받기</a>
                  <a class="btn sm sky" href="/uploader/start-mumei-uploader.bat" download="start-mumei-uploader.bat">실행 파일 받기</a>
                </span>
                <small class="muted" style="font-weight: 600">프로그램 <code>mumei-uploader.mjs</code> · 실행 파일 <code>start-mumei-uploader.bat</code> · 설정 파일 <code>uploader.config.json</code> (1번에서 키를 만들면 받아요)</small>`)}
              ${step(3, '켜 두고 게임하기', html`<span class="muted" style="font-weight: 600"><code>start-mumei-uploader.bat</code> 을 더블클릭하면 검은 창이 떠요. 창을 켜 둔 채로 게임하고, 판이 끝나면 결과 화면에서 <b style="color: var(--ink)">데이터 저장</b>만 누르면 돼요. 창에 "올림 ✓" 이 뜨면 성공이에요.</span>
                <span class="muted" style="font-size: 13px; font-weight: 600">Node.js 18 이상이 필요해요 (https://nodejs.org). 이터널 리턴 폴더는 Steam 라이브러리에서 자동으로 찾아요.</span>`)}
            </ol>
          </section>

          <section class="card"><h2>장치 키 만들기</h2>
            <form data-make class="stack" style="gap: 12px">
              <div class="form-grid">
                <label class="field">장치 이름 <input name="deviceName" maxlength="40" required placeholder="예: SG 게임 PC"></label>
                <label class="field">이터널 리턴 폴더 (선택) <input name="folder" value="${state.folder}" placeholder="비우면 자동으로 찾아요"><span class="hint">Steam → Eternal Return 우클릭 → 관리 → 로컬 파일 보기 로 연 폴더 주소</span></label>
              </div>
              <div class="flex"><span class="spacer"></span><button class="btn pink" type="submit" ${state.busy ? 'disabled' : ''}>장치 키 만들기</button></div>
            </form>
            ${state.fresh ? html`<div role="status" class="stack" style="justify-items: center; text-align: center; gap: 10px; background: var(--sky-soft); border: 3px solid var(--ink); border-radius: 24px; padding: 18px">
              <span style="font-size: 13px; font-weight: 700">${state.freshName} 장치 키</span>
              <span style="font-family: Consolas, 'D2Coding', monospace; font-weight: 700; font-size: 26px; letter-spacing: 0.08em; background: var(--card); border: 2px solid var(--ink); border-radius: 16px; padding: 6px 18px; word-break: break-all">${state.fresh}</span>
              <span class="flex" style="justify-content: center"><button class="btn pink" type="button" data-config>설정 파일 내려받기 (uploader.config.json)</button><button class="btn sky" type="button" data-copy>${state.copied ? '복사했어요' : '키 복사'}</button><button class="btn ghost" type="button" data-close>닫기</button></span>
              <span style="font-size: 12px; font-weight: 700; color: var(--pink-ink)">키와 설정 파일은 지금 한 번만 받을 수 있어요. 잃어버리면 새로 만들고 예전 키는 해제해 주세요.</span>
              ${isDemo ? html`<span class="muted" style="font-size: 12px; font-weight: 600">지금은 예시 데이터라 진짜로 올라가지는 않아요.</span>` : ''}
            </div>` : ''}
          </section>
        </div>

        <div class="side stack" style="gap: 18px">
          <section class="card"><h2>이렇게 동작해요</h2><ul style="margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: 13px; font-weight: 600">
            <li>2초마다 게임 폴더의 <code>GameResult_*.csv</code> 를 확인해요</li>
            <li>새로 생기거나 바뀐 파일만 보내요. 같은 판(gameId)은 한 번만 들어가요</li>
            <li>지금 시간 기준 진행 중인 내전의 다음 라운드로 들어가요. 못 찾으면 "내전 미지정"으로 들어가고, 결과 검토에서 고르면 돼요</li>
            <li>인터넷이 끊기면 잠시 뒤 다시 보내요</li>
            <li>올라온 판은 관리자가 결과 검토에서 <b>확정</b>해야 공개돼요</li>
          </ul></section>
          <section class="card"><h2>안전장치</h2><ul style="margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: 13px; font-weight: 600">
            <li>장치 키로는 결과 파일을 올리는 것만 할 수 있어요</li>
            <li>키 원문은 저장하지 않고 암호화한 값만 남겨요</li>
            <li>PC 를 바꾸거나 키가 새어 나가면 아래에서 해제하면 바로 막혀요</li>
          </ul></section>
        </div>
      </div>

      <section class="card"><h2>등록된 장치 ${live.length}개</h2>
        ${devices.length ? html`<div class="table-wrap"><table class="data" style="min-width: 640px"><thead><tr><th>장치</th><th>키</th><th>마지막 업로드</th><th>마지막 파일</th><th><span class="sr-only">관리</span></th></tr></thead><tbody>
          ${devices.map((d) => html`<tr style="${d.revoked_at ? 'opacity: 0.55' : ''}">
            <td><b>${d.name}</b><br><small class="muted" style="font-weight: 600">만든 날 ${dateTimeShort(d.created_at)}</small></td>
            <td><b style="font-family: Consolas, monospace">${d.prefix}-••••-••••-••••</b></td>
            <td style="font-weight: 600">${d.last_seen_at ? dateTimeShort(d.last_seen_at) : html`<span class="muted">아직 없음</span>`}</td>
            <td style="font-weight: 600; word-break: break-all">${d.last_file || '-'}</td>
            <td class="r">${d.revoked_at ? html`<small class="muted" style="font-weight: 700">해제됨</small>` : html`<button class="btn sm ghost danger" type="button" data-revoke="${d.id}">해제</button>`}</td>
          </tr>`)}
        </tbody></table></div>` : html`<p class="empty">아직 등록된 장치가 없어요.</p>`}
      </section>`);
  };

  on(main, 'input', '[data-make] input[name="folder"]', (_e, el) => { state.folder = el.value; });
  on(main, 'submit', '[data-make]', async (e, f) => {
    e.preventDefault();
    const name = f.elements.deviceName.value.trim();
    state.folder = f.elements.folder.value;
    state.busy = true; draw();
    try {
      state.fresh = await rpc('create_device_key', { p_name: name });
      state.freshName = name;
      state.copied = false;
      await reload();
    } catch (err) { toast('키를 만들지 못했어요: ' + errorText(err), true); }
    state.busy = false; draw();
  });
  on(main, 'click', '[data-config]', () => {
    const blob = new Blob([configText()], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'uploader.config.json' });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('설정 파일을 받았어요. 프로그램이랑 같은 폴더에 넣어 주세요.');
  });
  on(main, 'click', '[data-copy]', async () => { try { await navigator.clipboard.writeText(state.fresh); } catch { /* 직접 복사 */ } state.copied = true; draw(); });
  on(main, 'click', '[data-close]', () => {
    if (!confirm('닫으면 이 키와 설정 파일을 다시 받을 수 없어요. 설정 파일을 받았나요?')) return;
    state.fresh = null; draw();
  });
  on(main, 'click', '[data-revoke]', async (_e, b) => {
    if (!confirm('이 장치를 해제할까요? 그 PC 의 업로드가 바로 막혀요.')) return;
    try { await rpc('revoke_device', { p_id: b.dataset.revoke }); await reload(); draw(); toast('해제했어요.'); } catch (err) { toast(errorText(err), true); }
  });

  await reload();
  draw();
});
