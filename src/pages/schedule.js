import { startPublic } from '../components/shell.js';
import { html, mount, on } from '../lib/dom.js';
import { loadEvents } from '../lib/api.js';
import { dateKo, timeKo, FORMAT_LABEL, STATUS_LABEL, STAR } from '../lib/fmt.js';

const EV_STYLE = { done: ['var(--soft)', 'var(--line)'], fixed: ['var(--pink)', 'var(--ink)'], open: ['var(--sky)', 'var(--ink)'], plan: ['var(--card)', 'var(--muted)'] };

startPublic('schedule', async (main) => {
  const events = await loadEvents();
  const today = new Date();
  let view = new Date(today.getFullYear(), today.getMonth(), 1);

  const byDay = new Map();
  events.forEach((e) => {
    const d = new Date(e.starts_at);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  });

  const calendar = () => {
    const y = view.getFullYear(), m = view.getMonth();
    const startDow = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push(html`<div></div>`);
    for (let d = 1; d <= days; d++) {
      const evs = byDay.get(`${y}-${m}-${d}`) || [];
      const isToday = y === today.getFullYear() && m === today.getMonth() && d === today.getDate();
      const dow = (startDow + d - 1) % 7;
      cells.push(html`<div style="min-height: 92px; border-radius: 18px; padding: 6px 8px; background: ${isToday ? 'var(--sky-soft)' : 'var(--card)'}; border: 2px solid ${isToday ? 'var(--sky-ink)' : 'var(--line)'}; display: grid; align-content: start; gap: 4px">
        <span class="num" style="font-size: 14px; color: ${dow === 0 ? 'var(--pink-ink)' : dow === 6 ? 'var(--sky-ink)' : 'var(--ink)'}">${d}${isToday ? ' 오늘' : ''}</span>
        ${evs.map((e) => html`<span style="justify-self: start; font-family: var(--head); font-size: 12px; line-height: 1.3; background: ${EV_STYLE[e.status][0]}; border: 2px solid ${EV_STYLE[e.status][1]}; border-radius: 10px; padding: 2px 6px">${String(new Date(e.starts_at).getHours()).padStart(2, '0')}:${String(new Date(e.starts_at).getMinutes()).padStart(2, '0')} ${e.episode ? e.episode + '회차' : e.title.replace(/^\d+월 \d+일 /, '')}</span>`)}
      </div>`);
    }
    return cells;
  };

  const draw = () => {
    const upcoming = events.filter((e) => e.status !== 'done' && new Date(e.starts_at) >= new Date(Date.now() - 6 * 3600000)).slice(0, 5);
    mount(main, html`
      <div class="page-head"><div><h1>일정 ${STAR}</h1><p class="lead">다가오는 내전이랑 지난 내전을 한눈에 정리했어요! 참가 신청은 디스코드에서 받고 있답니다.</p></div></div>
      <div class="row">
        <section class="card grow" aria-labelledby="cal-title">
          <div class="card-head" style="align-items: center">
            <h2 id="cal-title" style="font-size: 26px">${view.getFullYear()}년 ${view.getMonth() + 1}월</h2>
            <span class="flex"><button class="btn sm" type="button" data-move="-1" aria-label="이전 달">←</button><button class="btn sm" type="button" data-move="0">이번 달</button><button class="btn sm" type="button" data-move="1" aria-label="다음 달">→</button></span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px">
            ${['일', '월', '화', '수', '목', '금', '토'].map((d, i) => html`<span style="text-align: center; font-size: 12px; font-weight: 700; color: ${i === 0 ? 'var(--pink-ink)' : i === 6 ? 'var(--sky-ink)' : 'var(--muted)'}">${d}</span>`)}
            ${calendar()}
          </div>
          <div class="flex muted" style="gap: 14px; font-size: 13px; font-weight: 700">
            ${['fixed', 'open', 'plan', 'done'].map((s) => html`<span class="flex" style="gap: 6px"><span aria-hidden="true" style="width: 14px; height: 14px; border-radius: 5px; background: ${EV_STYLE[s][0]}; border: 2px ${s === 'plan' ? 'dashed' : 'solid'} ${EV_STYLE[s][1]}"></span>${STATUS_LABEL[s]}</span>`)}
          </div>
        </section>
        <section class="side stack" style="gap: 14px" aria-labelledby="up-title">
          <h2 id="up-title" style="font-family: var(--head); font-size: 24px">다가오는 내전</h2>
          ${upcoming.length ? upcoming.map((e) => html`<article class="card" style="gap: 10px; padding: 18px; border-radius: 24px; border-color: ${e.status === 'fixed' ? 'var(--pink)' : e.status === 'open' ? 'var(--sky)' : 'var(--line)'}">
            <div class="card-head" style="align-items: center"><span style="font-family: var(--head); font-size: 20px">${dateKo(e.starts_at)}</span><span style="font-family: var(--head); font-size: 14px; background: ${EV_STYLE[e.status][0]}; border: 2px solid ${EV_STYLE[e.status][1]}; border-radius: 999px; padding: 1px 12px">${STATUS_LABEL[e.status]}</span></div>
            <span class="muted" style="font-size: 14px; font-weight: 600">${e.episode ? e.episode + '회차 · ' : ''}${timeKo(e.starts_at)} · ${FORMAT_LABEL[e.format]} · ${e.planned_rounds}라운드</span>
            <div class="stack" style="gap: 6px"><div class="flex" style="justify-content: space-between; font-size: 13px; font-weight: 700"><span>참가 인원</span><span class="num">${e.joined} / ${e.max_players}</span></div>
              <div role="img" aria-label="${e.max_players}명 중 ${e.joined}명 참가" style="height: 12px; border-radius: 999px; background: var(--soft); border: 2px solid var(--ink); overflow: hidden"><div style="height: 100%; background: var(--sky); width: ${Math.min(100, Math.round((e.joined / e.max_players) * 100))}%"></div></div></div>
            ${e.setting_code ? html`<span class="chip sky" style="justify-self: start">설정 코드 <b class="num">${e.setting_code}</b></span>` : ''}
            ${e.memo ? html`<span class="muted" style="font-size: 13px">${e.memo}</span>` : ''}
          </article>`) : html`<p class="empty">아직 잡힌 내전이 없어요.</p>`}
        </section>
      </div>`);
  };
  on(main, 'click', '[data-move]', (_e, b) => {
    const mv = Number(b.dataset.move);
    view = mv === 0 ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(view.getFullYear(), view.getMonth() + mv, 1);
    draw();
  });
  draw();
});
