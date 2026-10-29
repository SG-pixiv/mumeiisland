import { startPublic } from '../components/shell.js';
import { html, mount, on } from '../lib/dom.js';
import { loadMatchList } from '../lib/api.js';
import { FORMAT_LABEL, score, STAR_PINK } from '../lib/fmt.js';

const DOW = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

startPublic('matches', async (main) => {
  const matches = await loadMatchList();
  const seasons = [...new Set(matches.map((m) => m.season))].sort((a, b) => b - a);
  let season = seasons[0];

  const draw = () => {
    const list = matches.filter((m) => m.season === season);
    const rounds = list.reduce((s, m) => s + m.rounds, 0);
    const wins = new Map();
    list.forEach((m) => m.winnerMembers.forEach((w) => wins.set(w.name, (wins.get(w.name) || 0) + 1)));
    const top = [...wins.entries()].sort((a, b) => b[1] - a[1])[0];
    mount(main, html`
      <div class="page-head">
        <div><h1>내전 기록 ${STAR_PINK}</h1><p class="lead">게임에서 저장한 결과 데이터가 자동으로 기록된답니다! 카드를 누르면 라운드별 순위랑 선수 기록까지 볼 수 있어요.</p></div>
        ${seasons.length > 1 ? html`<div class="seg" role="group" aria-label="시즌 선택">${seasons.map((s) => html`<button type="button" data-season="${s}" aria-pressed="${s === season}">시즌 ${s}</button>`)}</div>` : ''}
      </div>
      ${list.length
        ? html`
          <div class="tiles">
            <div class="tile"><span class="label">내전 횟수</span><span class="value">${list.length}회</span><span class="sub">시즌 ${season}</span></div>
            <div class="tile"><span class="label">총 라운드</span><span class="value">${rounds}판</span><span class="sub">1회 평균 ${(rounds / list.length).toFixed(1)}판</span></div>
            <div class="tile"><span class="label">최다 우승</span><span class="value" style="font-size: 22px">${top ? top[0] : '-'}</span><span class="sub">${top ? `우승 ${top[1]}회` : ''}</span></div>
          </div>
          <ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 16px">
            ${list.map((m, i) => {
              const d = new Date(m.starts_at);
              const first = i === 0;
              return html`<li><a href="/match?id=${m.id}" class="card" style="display: flex; flex-wrap: wrap; align-items: center; gap: 18px 24px; padding: 18px 22px; border-radius: 26px; color: var(--ink); text-decoration: none; ${first ? 'border-color: var(--pink); box-shadow: 0 6px 0 var(--pink)' : ''}">
                <span style="flex: none; width: 86px; display: grid; justify-items: center; background: ${first ? 'var(--pink)' : i % 2 ? 'var(--sky-soft)' : 'var(--soft)'}; border: 2px solid var(--ink); border-radius: 22px; padding: 8px 0; transform: rotate(-2deg)">
                  <span style="font-size: 12px; font-weight: 700">${d.getMonth() + 1}월</span><span style="font-family: var(--logo); font-size: 32px; line-height: 1.1">${d.getDate()}</span><span style="font-size: 12px; font-weight: 700">${DOW[d.getDay()]}</span>
                </span>
                <span style="flex: 1 1 240px; min-width: 0; display: grid; gap: 6px">
                  <span class="flex"><span style="font-family: var(--head); font-size: 21px">${m.title}</span><span class="chip soft plain">${FORMAT_LABEL[m.format]}</span></span>
                  <span class="muted" style="font-size: 14px; font-weight: 600">${m.rounds}라운드 · ${m.teams}팀</span>
                </span>
                ${m.winner
                  ? html`<span style="flex: 2 1 340px; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; background: var(--soft); border-radius: 20px; padding: 10px 14px">
                      <span class="medal m1" style="width: 40px; height: 40px; font-size: 18px">1</span>
                      <span style="flex: 1 1 180px; min-width: 0; display: grid"><span style="font-family: var(--head); font-size: 17px">우승 팀 ${m.winner.team_no} · <span class="num">${score(m.winner.total)}점</span></span><span class="muted" style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${m.winnerMembers.map((w) => w.name).join(' · ')}</span></span>
                    </span>`
                  : ''}
                <span aria-hidden="true" style="flex: none; font-family: var(--head); font-size: 22px; color: var(--pink-ink)">→</span>
              </a></li>`;
            })}
          </ol>`
        : html`<p class="empty">아직 확정된 내전 기록이 없어요. 첫 내전이 끝나면 여기에 쌓일 거예요!</p>`}
    `);
  };
  on(main, 'click', '[data-season]', (_e, b) => { season = Number(b.dataset.season); draw(); });
  draw();
});
