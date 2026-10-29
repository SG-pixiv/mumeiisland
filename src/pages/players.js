import { startPublic } from '../components/shell.js';
import { html, mount, on, safeUrl } from '../lib/dom.js';
import { loadPlayers } from '../lib/api.js';
import { avatar, tierChip, liveBadge, pct, num, score, chzzkUrl, STAR } from '../lib/fmt.js';

startPublic('players', async (main) => {
  const { list } = await loadPlayers();
  const state = { tier: 0, liveOnly: false };

  const card = (p) => {
    const rank = p.rank;
    const rankWin = rank && rank.games ? pct(rank.wins, rank.games) : '기록 없음';
    const most = rank?.top?.length ? rank.top : [];
    const s = p.recent.games ? p.recent : p.all;
    return html`<article class="player-card">
      <a class="who" href="/player?id=${p.id}">
        ${avatar(p)}
        <span style="display: grid; min-width: 0; gap: 4px">
          <span class="name-line"><span class="name">${p.name}</span>${p.isLive ? liveBadge(true) : ''}</span>
          <span class="meta">${tierChip(p.tier, 'rot')}${p.roundMvp ? html`<span class="chip warn plain" style="font-size: 12px; padding: 0 8px" title="디스코드 라운드 MVP 투표로 뽑힌 횟수">MVP ${p.roundMvp}회</span>` : ''}<span class="role">${p.role}</span></span>
        </span>
      </a>
      ${most.length ? html`<div class="most">${most.map((m) => html`<span>${m}</span>`)}</div>` : ''}
      <div class="stat4">
        <span><small>랭크 승률</small><b>${rankWin}</b></span>
        <span><small>내전 경기</small><b>${s.games}</b></span>
        <span><small>평균 TK</small><b>${num(s.avgTk, 1)}</b></span>
        <span><small>평균 점수</small><b>${s.games ? score(s.avgTotal) : '-'}</b></span>
      </div>
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
        <div><h1>선수 ${STAR}</h1><p class="lead">생존자 ${list.length}명의 데이터를 정리해 뒀어요! 랭크 승률은 이번 시즌 랭크, 나머지는 최근 30일 내전 기록이랍니다.</p></div>
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
