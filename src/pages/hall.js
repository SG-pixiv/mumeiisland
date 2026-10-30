import { startPublic, lockedNotice } from '../components/shell.js';
import { html, mount, on } from '../lib/dom.js';
import { loadRecords } from '../lib/api.js';
import { dateKo, score, medalClass, tierChip, STAR_PINK } from '../lib/fmt.js';
import { winRanking } from '../lib/records.js';
import { memberChips, memberNames, episodeSticker, standingsTable } from '../components/records-ui.js';

const PER_PAGE = 10;

startPublic('hall', async (main, { vis }) => {
  if (!vis.hall) { mount(main, lockedNotice('우승 기록')); return; }
  const { results, records, byId } = await loadRecords({ from: vis.from });
  const done = results.filter((r) => r.finished && r.episode >= vis.from);
  const top = winRanking(records, 10).filter((r) => byId.get(r.id));
  let page = 1;

  const card = (r, first) => html`<li><details class="card" style="gap: 14px; padding: 0; border-radius: 26px; ${first ? 'border-color: var(--pink); box-shadow: 0 6px 0 var(--pink)' : ''}">
    <summary style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 18px 22px; cursor: pointer; list-style: none">
      <span style="flex: none; display: grid; justify-items: center; gap: 4px; width: 92px">
        ${episodeSticker(r.event)}
        <span class="muted" style="font-size: 12px; font-weight: 700">${dateKo(r.event.starts_at, false)}</span>
      </span>
      <span style="flex: 1 1 260px; min-width: 0; display: grid; gap: 6px">
        ${r.winners.map((w) => html`<span class="flex" style="gap: 10px"><span class="medal m1" style="width: 36px; height: 36px; font-size: 16px">1</span><span style="font-family: var(--head); font-size: 19px">팀 ${w.team_no}${r.winners.length > 1 ? ' · 공동 1위' : ''}</span><span class="muted" style="font-size: 14px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${memberNames(w.members, byId)}</span></span>`)}
      </span>
      <span style="flex: none; text-align: right; display: grid">
        <span class="num" style="font-size: 26px; line-height: 1.1">${score(r.winners[0]?.total)}<small style="font-size: 14px"> 점</small></span>
        <span class="muted" style="font-size: 12px; font-weight: 700">${r.rounds}라운드 · ${r.teams.length}팀 · 눌러서 전체 순위</span>
      </span>
    </summary>
    <div style="display: grid; gap: 12px; padding: 0 22px 20px">
      ${r.winners.map((w) => html`<div class="flex" style="gap: 8px"><b style="font-size: 14px">우승 팀 ${w.team_no}</b>${memberChips(w.members, byId)}</div>`)}
      ${standingsTable(r.teams, byId)}
      ${vis.results ? html`<a href="/match?id=${r.event.id}" style="font-size: 14px; font-weight: 700; justify-self: start">라운드별 기록 보기 →</a>` : ''}
    </div>
  </details></li>`;

  const draw = () => {
    const pages = Math.max(1, Math.ceil(done.length / PER_PAGE));
    page = Math.min(page, pages);
    const shown = done.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    const champ = top[0] ? byId.get(top[0].id) : null;
    mount(main, html`
      <div class="page-head">
        <div><h1>우승 기록 ${STAR_PINK}</h1><p class="lead">회차마다 최종 1위 팀을 모아 뒀어요! 카드를 누르면 그 회차 전체 순위가 펼쳐져요.${vis.from > 1 ? ` (${vis.from}회차부터 세요)` : ''}</p></div>
      </div>
      <div class="tiles">
        <div class="tile"><span class="label">끝난 회차</span><span class="value">${done.length}회</span><span class="sub">${done.length ? `${done[done.length - 1].episode}회차 ~ ${done[0].episode}회차` : '아직 없어요'}</span></div>
        <div class="tile"><span class="label">최다 우승</span><span class="value" style="font-size: 22px">${champ ? champ.name : '-'}</span><span class="sub">${top[0] ? `우승 ${top[0].wins}회 · ${top[0].episodes}회 출전` : ''}</span></div>
        <div class="tile"><span class="label">지난 우승 팀</span><span class="value" style="font-size: 22px">${done[0] ? `팀 ${done[0].winners[0].team_no}` : '-'}</span><span class="sub">${done[0] ? `${done[0].episode}회차 · ${score(done[0].winners[0].total)}점` : ''}</span></div>
      </div>
      <div class="row" style="align-items: flex-start">
        <section class="grow stack" style="gap: 14px; flex-basis: 560px" aria-labelledby="list-title">
          <h2 id="list-title" style="font-family: var(--head); font-size: 26px">역대 우승</h2>
          ${shown.length
            ? html`<ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 14px">${shown.map((r, i) => card(r, page === 1 && i === 0))}</ol>
              ${pages > 1 ? html`<div class="flex" style="justify-content: center; gap: 12px"><button class="btn" type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>이전</button><span class="num">${page} / ${pages}</span><button class="btn" type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''}>다음</button></div>` : ''}`
            : html`<p class="empty">끝난 회차가 아직 없어요. 첫 우승 팀을 기다리는 중이에요!</p>`}
        </section>
        <section class="card side" style="flex-basis: 340px" aria-labelledby="top-title">
          <div class="card-head"><h2 id="top-title">최다 우승 Top 10</h2></div>
          ${top.length
            ? html`<div class="table-wrap"><table class="data" style="min-width: 300px"><thead><tr><th style="width: 52px">순위</th><th>선수</th><th class="r">우승</th></tr></thead><tbody>
                ${top.map((r) => { const p = byId.get(r.id); return html`<tr><td><span class="medal sm ${medalClass(r.rank)}">${r.rank}</span></td><td><a href="/player?id=${p.id}" class="flex" style="color: var(--ink); text-decoration: none; flex-wrap: nowrap">${tierChip(p.tier)}<b>${p.name}</b></a></td><td class="r"><span class="num">${r.wins}회</span><br><small class="muted">${r.episodes}회 출전</small></td></tr>`; })}
              </tbody></table></div>`
            : html`<p class="empty">아직 우승한 선수가 없어요.</p>`}
        </section>
      </div>`);
  };

  on(main, 'click', '[data-page]', (_e, b) => { page = Number(b.dataset.page); draw(); main.scrollIntoView({ behavior: 'smooth' }); });
  draw();
});
