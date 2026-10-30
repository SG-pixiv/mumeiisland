import { startPublic } from '../components/shell.js';
import { html, mount, on, safeUrl } from '../lib/dom.js';
import { loadPlayers, loadRecords } from '../lib/api.js';
import { avatar, tierChip, liveBadge, pct, num, chzzkUrl, STAR } from '../lib/fmt.js';
import { emptyRecord } from '../lib/records.js';

startPublic('players', async (main, { vis }) => {
  const data = vis.personal ? await loadRecords({ from: vis.from }) : await loadPlayers();
  const list = data.list.filter((p) => p.active);
  const recOf = (id) => (vis.personal ? data.recordOf(id) : emptyRecord(id));
  const state = { tier: 0, liveOnly: false };

  const card = (p) => {
    const rank = p.rank;
    const rankWin = rank && rank.games ? pct(rank.wins, rank.games) : '기록 없음';
    const most = rank?.top?.length ? rank.top : [];
    const r = recOf(p.id);
    return html`<article class="player-card">
      <a class="who" href="/player?id=${p.id}">
        ${avatar(p)}
        <span style="display: grid; min-width: 0; gap: 4px">
          <span class="name-line"><span class="name">${p.name}</span>${p.isLive ? liveBadge(true) : ''}</span>
          <span class="meta">${tierChip(p.tier, 'rot')}${vis.mvp && vis.personal && r.mvp ? html`<span class="chip warn plain" style="font-size: 12px; padding: 0 8px" title="디스코드 라운드 MVP 투표로 뽑힌 횟수">MVP ${r.mvp}회</span>` : ''}<span class="role">${p.role}</span></span>
        </span>
      </a>
      ${most.length ? html`<div class="most">${most.map((m) => html`<span>${m}</span>`)}</div>` : ''}
      ${vis.personal
        ? html`<div class="stat4">
            <span><small>랭크 승률</small><b>${rankWin}</b></span>
            <span><small>내전 출전</small><b>${r.episodes}회</b></span>
            <span><small>우승</small><b>${r.wins}회</b></span>
            ${vis.tk ? html`<span><small>평균 TK</small><b>${num(r.avgTk, 1)}</b></span>` : html`<span><small>평균 순위</small><b>${r.avgStanding === null ? '-' : num(r.avgStanding, 1) + '위'}</b></span>`}
          </div>`
        : html`<div class="stat4" style="grid-template-columns: repeat(3, minmax(0, 1fr))">
            <span><small>랭크 점수</small><b>${rank?.score != null ? rank.score.toLocaleString('ko-KR') : '-'}</b></span>
            <span><small>랭크 승률</small><b>${rank?.games ? rankWin : '-'}</b></span>
            <span><small>랭크 판수</small><b>${rank?.games ? rank.games + '판' : '-'}</b></span>
          </div>`}
      ${p.chzzkId || p.youtubeUrl
        ? html`<div class="channels">
            ${p.chzzkId ? html`<a class="chzzk" href="${chzzkUrl(p.chzzkId)}" target="_blank" rel="noopener">치지직 방송</a>` : ''}
            ${safeUrl(p.youtubeUrl) ? html`<a class="youtube" href="${safeUrl(p.youtubeUrl)}" target="_blank" rel="noopener">유튜브</a>` : ''}
          </div>`
        : ''}
    </article>`;
  };

  const draw = () => {
    const shown = list.filter((p) => (!state.tier || p.tier === state.tier) && (!state.liveOnly || p.isLive));
    mount(main, html`
      <div class="page-head">
        <div><h1>선수 ${STAR}</h1><p class="lead">생존자 ${list.length}명의 데이터를 정리해 뒀어요! 랭크는 이터널 리턴 이번 시즌 솔로 랭크${vis.personal ? `, 나머지는 ${vis.from > 1 ? vis.from + '회차부터의 ' : ''}무명섬 내전 기록이랍니다` : '예요'}.</p></div>
        <div class="pills" role="group" aria-label="선수 필터">
          ${[0, 1, 2, 3].map((t) => html`<button type="button" data-tier="${t}" aria-pressed="${state.tier === t}">${t ? t + '티어' : '전체'}</button>`)}
          <button type="button" class="live-filter" data-live aria-pressed="${state.liveOnly}">LIVE ON</button>
        </div>
      </div>
      ${shown.length ? html`<div class="grid" style="--min: 270px">${shown.map(card)}</div>` : html`<p class="empty">${list.length ? '앗, 조건에 맞는 생존자가 없어요. 필터를 바꿔 볼까요?' : '아직 등록된 선수가 없어요. 운영진이 곧 추가할 거예요!'}</p>`}
    `);
  };

  on(main, 'click', '[data-tier]', (_e, b) => { state.tier = Number(b.dataset.tier); draw(); });
  on(main, 'click', '[data-live]', () => { state.liveOnly = !state.liveOnly; draw(); });
  draw();
});
