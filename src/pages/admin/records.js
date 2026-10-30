import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText } from '../../lib/dom.js';
import { select, update } from '../../lib/db.js';
import { loadEvents } from '../../lib/api.js';
import { dateKo, dateTimeShort } from '../../lib/fmt.js';
import { RECORD_ITEMS, DEFAULT_ITEMS, visibility } from '../../lib/records.js';

const NEED_12 = 'Supabase SQL Editor 에서 20261030000000_records_privacy.sql (12단계)을 먼저 실행해 주세요.';

startAdmin('records', async (main) => {
  const [rows, events] = await Promise.all([select('site_settings', { eq: { id: 1 } }).catch(() => null), loadEvents()]);
  if (!rows?.length) {
    mount(main, html`<div><h1>기록 공개</h1><p class="lead">경쟁 기록을 공개 사이트에 보여 줄지 정하는 곳이에요.</p></div>
      <p class="notice warn">${NEED_12} 그 전까지 공개 사이트는 경쟁 기록을 숨기고, 솔로 랭크 점수만 보여요.</p>`);
    return;
  }
  const saved = rows[0];
  const copy = (s) => ({ on: !!s.records_public, from: Number(s.records_from_episode) || 1, items: JSON.parse(JSON.stringify({ ...DEFAULT_ITEMS, ...(s.records_items || {}) })) });
  let st = copy(saved);
  let base = JSON.stringify(st);
  let lastSaved = saved.updated_at;
  let busy = false;
  const dirty = () => JSON.stringify(st) !== base;
  const episodes = events.filter((e) => e.episode).sort((a, b) => a.episode - b.episode);

  const save = async (next, msg) => {
    busy = true; draw();
    try {
      const res = await update('site_settings', { records_public: next.on, records_from_episode: next.from, records_items: next.items }, { id: 1 });
      if (!res.length) throw new Error('저장되지 않았어요. 관리자 권한을 확인해 주세요');
      st = copy(res[0]); base = JSON.stringify(st); lastSaved = res[0].updated_at;
      toast(msg);
    } catch (e) { toast('저장하지 못했어요: ' + errorText(e), true); }
    busy = false; draw();
  };

  const check = (key, field, label) => html`<label class="flex" style="gap: 8px; font-weight: 700; flex-wrap: nowrap; white-space: nowrap; min-height: 44px; cursor: pointer">
    <input type="checkbox" data-item="${key}" data-field="${field}" ${st.items[key]?.[field] !== false ? 'checked' : ''} style="width: 22px; height: 22px; accent-color: var(--pink-ink)">${label}</label>`;

  const draw = () => {
    const v = visibility({ records_public: st.on, records_from_episode: st.from, records_items: st.items });
    const fromEv = episodes.find((e) => e.episode === st.from);
    mount(main, html`
      <div><h1>기록 공개</h1><p class="lead">경쟁 기록(내전 결과 · 우승 기록 · 개인 기록 · TK · 라운드 MVP)을 공개 사이트에 보여 줄지 정해요. 기록은 공개 여부와 상관없이 계속 쌓이고, 솔로 랭크 점수는 늘 보여요.</p></div>

      <section class="card ${st.on ? '' : 'ink'}" style="${st.on ? 'border-color: var(--good); box-shadow: 0 6px 0 var(--t2s)' : ''}">
        <div class="flex" style="gap: 18px; justify-content: space-between">
          <span style="display: grid; gap: 4px; flex: 1 1 320px">
            <span class="flex" style="gap: 10px"><h2 style="margin: 0">전체 공개</h2><span class="chip ${JSON.parse(base).on ? 'ok' : 'warn'}">${JSON.parse(base).on ? '지금 공개 중' : '지금 비공개'}</span></span>
            <span class="muted" style="font-weight: 600">한 번에 켜고 꺼요. 켜면 아래 세부 항목에서 고른 것만 보여요. 끄면 전부 숨기고, 로그인 안 한 사람은 라운드 기록을 아예 못 읽어요.</span>
          </span>
          <button class="btn big ${JSON.parse(base).on ? '' : 'pink'}" type="button" data-master ${busy ? 'disabled' : ''}>${JSON.parse(base).on ? '비공개로 바꾸기' : '공개하기'}</button>
        </div>
        ${dirty() ? html`<p class="notice warn" style="margin: 0">아래에서 바꾼 설정이 아직 저장 안 됐어요. 전체 공개 버튼을 누르면 바꾼 설정도 같이 저장돼요.</p>` : ''}
      </section>

      <div class="row" style="align-items: stretch">
        <section class="card side" style="flex-basis: 340px"><h2>몇 회차부터 셀까요</h2>
          <label class="field">집계 시작 회차
            <span class="flex" style="flex-wrap: nowrap; gap: 8px"><input type="number" data-from min="1" max="9999" value="${st.from}" style="width: 120px; font-family: var(--num); font-weight: 800; font-size: 20px; text-align: center"><b>회차부터</b></span>
            <span class="hint">${fromEv ? `${st.from}회차 = ${fromEv.title} (${dateKo(fromEv.starts_at, false)})` : episodes.length ? `${st.from}회차는 아직 없어요` : '아직 내전이 없어요'}</span>
          </label>
          <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">이 회차 전 기록은 우승 기록 · 개인 기록 · 랭킹 · 대시보드에서 빠져요. 내전 기록 목록에는 "집계 전"으로 남아요. 테스트로 한 회차를 빼고 싶을 때 써요.</p>
          ${episodes.length ? html`<div class="flex" style="gap: 6px">${episodes.slice(-8).map((e) => html`<button type="button" class="btn sm ${e.episode === st.from ? 'sky' : 'ghost'}" data-pick-from="${e.episode}" title="${e.title}">${e.episode}회차</button>`)}</div>` : ''}
        </section>

        <section class="card grow" style="flex-basis: 520px"><h2>세부 항목</h2>
          <div class="table-wrap"><table class="data" style="min-width: 600px"><thead><tr><th>항목</th><th>공개하면 보이는 것</th><th>공개</th><th>대시보드</th></tr></thead><tbody>
            ${RECORD_ITEMS.map((i) => html`<tr>
              <td style="white-space: nowrap"><b>${i.label}</b></td>
              <td style="font-size: 13px; font-weight: 600">${i.what}${i.dash ? html`<br><span class="muted">대시보드: ${i.dash}</span>` : ''}</td>
              <td>${check(i.key, 'on', '보이기')}</td>
              <td>${i.dash ? check(i.key, 'dash', '띄우기') : html`<span class="muted" style="font-size: 12px">-</span>`}</td>
            </tr>`)}
          </tbody></table></div>
          <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">디스코드: 비공개거나 내전 기록을 끄면 라운드 결과 공지가, 라운드 MVP 를 끄면 MVP 투표 · 발표가 쉬어요. 다시 켜도 그동안 확정한 판이 한꺼번에 올라가지는 않아요.</p>
        </section>
      </div>

      <section class="card" style="gap: 12px">
        <div class="flex" style="gap: 12px; justify-content: space-between">
          <span style="display: grid; gap: 2px"><b>저장하면 공개 사이트에 이렇게 보여요</b>
            <span class="muted" style="font-size: 13px; font-weight: 600">${st.on
              ? (v.any ? ['results', 'hall', 'personal', 'tk', 'mvp'].filter((k) => v[k]).map((k) => RECORD_ITEMS.find((i) => i.key === k).label).join(' · ') + ` 공개 · ${v.from}회차부터` : '전체 공개는 켜져 있지만 고른 항목이 없어요')
              : '경쟁 기록 전부 비공개 (솔로 랭크 · 일정 · 팀 편성 · 규정은 그대로)'}</span></span>
          <span class="flex" style="gap: 8px"><a class="btn ghost" href="/?preview=1" target="_blank" rel="noopener">관리자 미리보기</a><button class="btn pink" type="button" data-save ${busy || !dirty() ? 'disabled' : ''}>설정 저장</button></span>
        </div>
        <small class="muted" style="font-weight: 600">마지막 저장 ${lastSaved ? dateTimeShort(lastSaved) : '-'} · 미리보기는 공개 설정과 상관없이 관리자에게만 모든 기록을 보여 줘요</small>
      </section>`);
  };

  on(main, 'change', '[data-item]', (_e, el) => {
    const k = el.dataset.item;
    st.items[k] = { ...(st.items[k] || {}), [el.dataset.field]: el.checked };
    draw();
  });
  on(main, 'change', '[data-from]', (_e, el) => { st.from = Math.max(1, Math.floor(Number(el.value)) || 1); draw(); });
  on(main, 'click', '[data-pick-from]', (_e, b) => { st.from = Number(b.dataset.pickFrom); draw(); });
  on(main, 'click', '[data-save]', () => save(st, '기록 공개 설정을 저장했어요.'));
  on(main, 'click', '[data-master]', () => {
    const turnOn = !JSON.parse(base).on;
    save({ ...st, on: turnOn }, turnOn ? `경쟁 기록을 공개했어요! ${st.from > 1 ? st.from + '회차부터 세요.' : ''}` : '경쟁 기록을 비공개로 바꿨어요.');
  });
  draw();
});
