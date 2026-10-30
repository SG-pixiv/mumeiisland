import { startPublic, lockedNotice } from '../components/shell.js';
import { html, mount } from '../lib/dom.js';
import { loadRecords } from '../lib/api.js';
import { FORMAT_LABEL, score, STAR_PINK } from '../lib/fmt.js';
import { memberNames } from '../components/records-ui.js';

const DOW = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

startPublic('matches', async (main, { vis }) => {
  if (!vis.results) { mount(main, lockedNotice('내전 기록')); return; }
  const { results, byId } = await loadRecords({ from: vis.from });
  const counted = results.filter((r) => r.episode >= vis.from);
  const rounds = counted.reduce((s, r) => s + r.rounds, 0);
  const wins = new Map();
  counted.filter((r) => r.finished).forEach((r) => r.winners.forEach((w) => w.members.forEach((m) => { if (m.id) wins.set(m.id, (wins.get(m.id) || 0) + 1); })));
  const top = [...wins.entries()].sort((a, b) => b[1] - a[1])[0];

  mount(main, html`
    <div class="page-head">
      <div><h1>내전 기록 ${STAR_PINK}</h1><p class="lead">게임에서 저장한 결과 데이터가 자동으로 기록된답니다! 카드를 누르면 라운드별 순위랑 선수 기록까지 볼 수 있어요.</p></div>
    </div>
    ${results.length
      ? html`
        <div class="tiles">
          <div class="tile"><span class="label">회차</span><span class="value">${counted.length}회</span><span class="sub">${vis.from > 1 ? `${vis.from}회차부터` : '전체'}</span></div>
          <div class="tile"><span class="label">총 라운드</span><span class="value">${rounds}판</span><span class="sub">${counted.length ? `1회 평균 ${(rounds / counted.length).toFixed(1)}판` : ''}</span></div>
          ${vis.hall ? html`<div class="tile"><span class="label">최다 우승</span><span class="value" style="font-size: 22px">${top ? byId.get(top[0])?.name || '-' : '-'}</span><span class="sub">${top ? `우승 ${top[1]}회` : ''}</span></div>` : ''}
        </div>
        <ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 16px">
          ${results.map((r, i) => {
            const d = new Date(r.event.starts_at);
            const first = i === 0;
            const early = r.episode < vis.from;
            return html`<li><a href="/match?id=${r.event.id}" class="card" style="display: flex; flex-wrap: wrap; align-items: center; gap: 18px 24px; padding: 18px 22px; border-radius: 26px; color: var(--ink); text-decoration: none; ${first ? 'border-color: var(--pink); box-shadow: 0 6px 0 var(--pink)' : ''}${early ? 'opacity: 0.7' : ''}">
              <span style="flex: none; width: 86px; display: grid; justify-items: center; background: ${first ? 'var(--pink)' : i % 2 ? 'var(--sky-soft)' : 'var(--soft)'}; border: 2px solid var(--ink); border-radius: 22px; padding: 8px 0; transform: rotate(-2deg)">
                <span style="font-size: 12px; font-weight: 700">${d.getMonth() + 1}월</span><span style="font-family: var(--logo); font-size: 32px; line-height: 1.1">${d.getDate()}</span><span style="font-size: 12px; font-weight: 700">${DOW[d.getDay()]}</span>
              </span>
              <span style="flex: 1 1 240px; min-width: 0; display: grid; gap: 6px">
                <span class="flex"><span style="font-family: var(--head); font-size: 21px">${r.episode ? r.episode + '회차' : r.event.title}</span><span class="chip soft plain">${FORMAT_LABEL[r.event.format]}</span>${r.finished ? '' : html`<span class="chip sky plain">진행 중</span>`}${early ? html`<span class="chip plain" title="기록 공개 설정의 집계 시작 회차 전이에요">집계 전</span>` : ''}</span>
                <span class="muted" style="font-size: 14px; font-weight: 600">${r.event.title} · ${r.rounds}라운드 · ${r.teams.length}팀</span>
              </span>
              ${r.winners[0]
                ? html`<span style="flex: 2 1 340px; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; background: var(--soft); border-radius: 20px; padding: 10px 14px">
                    <span class="medal m1" style="width: 40px; height: 40px; font-size: 18px">1</span>
                    <span style="flex: 1 1 180px; min-width: 0; display: grid"><span style="font-family: var(--head); font-size: 17px">${r.finished ? '우승' : '지금 1위'} 팀 ${r.winners.map((w) => w.team_no).join(' · ')} · <span class="num">${score(r.winners[0].total)}점</span></span><span class="muted" style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${r.winners.map((w) => memberNames(w.members, byId)).join(' / ')}</span></span>
                  </span>`
                : ''}
              <span aria-hidden="true" style="flex: none; font-family: var(--head); font-size: 22px; color: var(--pink-ink)">→</span>
            </a></li>`;
          })}
        </ol>`
      : html`<p class="empty">아직 확정된 내전 기록이 없어요. 첫 내전이 끝나면 여기에 쌓일 거예요!</p>`}
  `);
});
