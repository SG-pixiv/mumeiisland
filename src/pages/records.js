import { startPublic, lockedNotice } from '../components/shell.js';
import { html, mount, on } from '../lib/dom.js';
import { loadRecords } from '../lib/api.js';
import { avatar, tierDot, STAR } from '../lib/fmt.js';
import { rankOrder } from '../lib/records.js';
import { recordColumns } from '../components/records-ui.js';

startPublic('records', async (main, { vis }) => {
  if (!vis.personal) { mount(main, lockedNotice('개인 기록')); return; }
  const { list, recordOf } = await loadRecords({ from: vis.from });
  const cols = recordColumns(vis);
  // 기록이 있는 선수 + 지금 활동 중인 선수
  const rows = list.map((p) => ({ p, r: recordOf(p.id) })).filter(({ p, r }) => p.active || r.episodes || r.roundGames);
  const state = { q: '', tier: 0, key: 'rank', dir: 'desc' };

  const sorted = () => {
    const q = state.q.trim().toLowerCase();
    const shown = rows.filter(({ p }) => (!state.tier || p.tier === state.tier) && (!q || p.name.toLowerCase().includes(q) || String(p.erNickname || '').toLowerCase().includes(q)));
    const base = shown.slice().sort((a, b) => (b.r.episodes > 0) - (a.r.episodes > 0) || rankOrder(a.r, b.r) || a.p.name.localeCompare(b.p.name, 'ko'));
    if (state.key === 'rank') return state.dir === 'desc' ? base : base.reverse();
    const sign = state.dir === 'asc' ? 1 : -1;
    const val = (x) => (x.r[state.key] === null || x.r[state.key] === undefined ? null : Number(x.r[state.key]));
    return base.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;   // 기록 없는 칸은 늘 아래로
      if (vb === null) return -1;
      return (va - vb) * sign;
    });
  };
  const rankOf = new Map(rows.filter(({ r }) => r.episodes).sort((a, b) => rankOrder(a.r, b.r)).map(({ p }, i) => [p.id, i + 1]));

  const th = (key, label, dir) => {
    const on = state.key === key;
    const arrow = on ? (state.dir === 'asc' ? '▲' : '▼') : '';
    return html`<th class="${key === 'rank' ? '' : 'r'}" style="white-space: nowrap" aria-sort="${on ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${key}" data-dir="${dir}" style="all: unset; cursor: pointer; font: inherit; display: inline-flex; gap: 4px; align-items: center">${label}<span aria-hidden="true" style="font-size: 10px; color: var(--pink-ink); min-width: 8px">${arrow}</span></button></th>`;
  };

  const draw = () => {
    const shown = sorted();
    mount(main, html`
      <div class="page-head">
        <div><h1>개인 기록 ${STAR}</h1><p class="lead">회차 기준이에요. 출전 = 뛴 회차 수, 우승 = 그 회차 최종 1위 팀, 평균 순위 = 회차 최종 순위 평균. 칸 이름을 누르면 정렬돼요!${vis.from > 1 ? ` (${vis.from}회차부터 세요)` : ''}</p></div>
      </div>
      <div class="flex" style="gap: 12px">
        <label class="field" style="flex: 1 1 260px; max-width: 420px"><span class="sr-only">선수 검색</span><input type="search" data-q value="${state.q}" placeholder="선수 이름 · 게임 닉네임 검색" autocomplete="off"></label>
        <div class="pills" role="group" aria-label="티어">${[0, 1, 2, 3].map((t) => html`<button type="button" data-tier="${t}" aria-pressed="${state.tier === t}">${t ? t + '티어' : '전체'}</button>`)}</div>
      </div>
      <section class="card" style="padding: 18px">
        ${shown.length
          ? html`<div class="table-wrap"><table class="data" style="min-width: ${340 + cols.length * 74}px"><thead><tr>
              ${th('rank', '#', 'desc')}<th>선수</th>${cols.map(([key, label, , dir]) => th(key, label, dir))}
            </tr></thead><tbody>
              ${shown.map(({ p, r }) => html`<tr>
                <td>${rankOf.get(p.id) ? html`<span class="num">${rankOf.get(p.id)}</span>` : html`<span class="muted">-</span>`}</td>
                <td><a href="/player?id=${p.id}" class="flex" style="color: var(--ink); text-decoration: none; flex-wrap: nowrap; gap: 10px">${avatar(p, 'sm')}<span style="display: grid; min-width: 0"><span class="flex" style="gap: 6px; flex-wrap: nowrap">${tierDot(p.tier)}<b style="white-space: nowrap">${p.name}</b></span><small class="muted" style="font-weight: 600">${p.erNickname}</small></span></a></td>
                ${cols.map(([, , cell]) => html`<td class="r">${cell(r)}</td>`)}
              </tr>`)}
            </tbody></table></div>`
          : html`<p class="empty">${rows.length ? '조건에 맞는 선수가 없어요.' : '아직 기록이 없어요. 첫 회차가 끝나면 쌓일 거예요!'}</p>`}
      </section>`);
  };

  on(main, 'click', '[data-sort]', (_e, b) => {
    const key = b.dataset.sort;
    state.dir = state.key === key ? (state.dir === 'asc' ? 'desc' : 'asc') : b.dataset.dir;
    state.key = key;
    draw();
  });
  on(main, 'click', '[data-tier]', (_e, b) => { state.tier = Number(b.dataset.tier); draw(); });
  on(main, 'input', '[data-q]', (_e, el) => {
    state.q = el.value;
    const pos = el.selectionStart;
    draw();
    const again = main.querySelector('[data-q]');
    again.focus();
    again.setSelectionRange(pos, pos);
  });
  draw();
});
