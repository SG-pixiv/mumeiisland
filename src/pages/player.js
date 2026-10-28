import { startPublic } from '../components/shell.js';
import { html, mount, on, qs, safeUrl } from '../lib/dom.js';
import { loadPlayerDetail } from '../lib/api.js';
import { avatar, liveBadge, pct, num, score, chzzkUrl, medalClass, shortDate, liveHref, PLATFORM_LABEL } from '../lib/fmt.js';

startPublic('players', async (main) => {
  const id = qs('id');
  const data = id ? await loadPlayerDetail(id) : null;
  if (!data) {
    mount(main, html`<a class="btn ghost" href="/players" style="justify-self: start">← 선수 목록</a><p class="empty">앗, 이 선수를 찾지 못했어요.</p>`);
    return;
  }
  const { player: p, season, rounds, characters, history } = data;
  document.title = `무명섬 · ${p.name}`;
  let period = 'recent';

  const header = html`<section class="hero sky" style="background-color: var(--soft); background-image: radial-gradient(var(--line) 2px, transparent 2.5px); background-size: 18px 18px; box-shadow: 8px 10px 0 var(--pink); align-items: center; padding: 32px">
    ${avatar(p, 'lg')}
    <div style="flex: 999 1 320px; min-width: 0; display: grid; gap: 10px">
      <div class="flex" style="gap: 12px"><h1 style="font-size: 44px; line-height: 1.1">${p.name}</h1>${p.isLive ? liveBadge() : ''}</div>
      <div class="flex">
        <span class="tier t${p.tier}" style="font-size: 15px; padding: 3px 14px; border: 2px solid currentColor">밸런스 ${p.tier}티어</span>
        ${p.role ? html`<span class="chip">${p.role}</span>` : ''}
        <span class="chip">랭크 승률 <b class="num">${p.rank?.games ? pct(p.rank.wins, p.rank.games) : '기록 없음'}</b>${p.rank?.games ? html` <span class="muted" style="font-size: 12px">이번 시즌 · ${p.rank.games}판</span>` : ''}</span>
        ${p.rank?.top?.length ? html`<span class="chip sky">모스트 ${p.rank.top.join(' · ')}</span>` : ''}
      </div>
      ${p.note ? html`<p style="margin: 0; font-weight: 600" class="muted">장점: ${p.note}</p>` : ''}
      ${p.isLive && p.liveTitle ? html`<p style="margin: 0; font-weight: 700">지금 ${PLATFORM_LABEL[p.livePlatform] || ''}에서 방송 중 · ${p.liveTitle}${p.liveViewers ? html` <span class="muted">· 시청자 <b class="num">${num(p.liveViewers)}</b></span>` : ''}</p>` : ''}
    </div>
    <div class="flex" style="flex: 1 1 200px; justify-content: flex-end; gap: 10px">
      ${p.isLive && liveHref(p) ? html`<a class="btn pink big" href="${liveHref(p)}" target="_blank" rel="noopener">방송 보러 가기</a>` : ''}
      ${p.chzzkId ? html`<a class="btn sky big" href="${chzzkUrl(p.chzzkId)}" target="_blank" rel="noopener">치지직 방송</a>` : ''}
      ${safeUrl(p.youtubeUrl) ? html`<a class="btn big" href="${safeUrl(p.youtubeUrl)}" target="_blank" rel="noopener">유튜브</a>` : ''}
    </div>
  </section>`;

  const tiles = () => {
    const s = period === 'recent' ? p.recent : p.season;
    return html`<div class="tiles">
      <div class="tile"><span class="label">내전 경기</span><span class="value">${s.games}</span><span class="sub">${period === 'recent' ? '최근 30일' : '시즌 ' + season}</span></div>
      <div class="tile"><span class="label">내전 승률</span><span class="value">${pct(s.wins, s.games)}</span><span class="sub">우승 ${s.wins}번</span></div>
      <div class="tile"><span class="label">평균 순위</span><span class="value">${num(s.avgRank, 1)}</span><span class="sub">팀 순위 기준</span></div>
      <div class="tile"><span class="label">평균 TK</span><span class="value">${num(s.avgTk, 1)}</span><span class="sub">팀 킬</span></div>
      <div class="tile"><span class="label">평균 합계점수</span><span class="value">${score(s.avgTotal)}</span><span class="sub">팀 라운드 점수</span></div>
    </div>`;
  };

  const maxGames = Math.max(1, ...characters.map((c) => c.games));
  const charTable = characters.length
    ? html`<div class="table-wrap"><table class="data" style="min-width: 460px"><thead><tr><th>실험체</th><th>판수</th><th class="r">내전 승률</th><th class="r">평균 순위</th><th class="r">평균 점수</th></tr></thead><tbody>
        ${characters.map((c) => html`<tr><td style="font-family: var(--head); font-size: 16px">${c.name}</td><td><span class="flex" style="flex-wrap: nowrap"><b class="num" style="width: 24px">${c.games}</b><span aria-hidden="true" style="height: 12px; border-radius: 999px; background: var(--sky); border: 2px solid var(--ink); width: ${Math.max(16, Math.round((c.games / maxGames) * 130))}px"></span></span></td><td class="r">${pct(c.wins, c.games)}</td><td class="r">${num(c.avgRank, 1)}</td><td class="r">${score(c.avgTotal)}</td></tr>`)}
      </tbody></table></div>`
    : html`<p class="empty">아직 내전 기록이 없어요.</p>`;

  const recentGames = rounds.slice(0, 8);
  const gameList = recentGames.length
    ? html`<ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px">${recentGames.map((g) => html`<li style="display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 12px; align-items: center; background: var(--soft); border-radius: 20px; padding: 10px 14px">
        <span class="medal ${medalClass(g.team_rank)}" style="width: 48px; height: 48px; font-size: 17px">${g.team_rank}위</span>
        <span style="display: grid; min-width: 0"><span style="font-family: var(--head); font-size: 17px">${g.character_name || '실험체 미상'} <span class="muted" style="font-family: var(--body); font-weight: 600; font-size: 13px">· ${shortDate(g.played_at)} R${g.round_no}</span></span>
        <span class="muted" style="font-size: 13px">킬 <b class="num" style="color: var(--ink)">${g.kills}</b> · 어시 <b class="num" style="color: var(--ink)">${g.assists}</b> · TK <b class="num" style="color: var(--ink)">${g.team_kills}</b></span></span>
        <span style="text-align: right; display: grid"><span class="num" style="font-size: 20px">${score(g.total)}점</span><span class="muted" style="font-size: 12px">순위 ${score(g.rs)} · 킬 ${score(g.ks)}</span></span>
      </li>`)}</ol>`
    : html`<p class="empty">첫 내전을 기다리는 중이에요!</p>`;

  const historyList = history.length
    ? html`<ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 14px">${history.map((h, i) => html`<li class="flex" style="gap: 6px 14px"><span aria-hidden="true" style="width: 14px; height: 14px; border-radius: 50%; background: ${i ? 'var(--sky)' : 'var(--pink)'}; border: 2px solid var(--ink)"></span><span class="num muted" style="font-weight: 700">${new Date(h.changed_at).toLocaleDateString('ko-KR')}</span><b>${h.from_tier ? `${h.from_tier}티어 → ` : '첫 등록 '}<span style="font-family: var(--head); font-weight: 400; color: var(--t${h.to_tier})">${h.to_tier}티어</span></b><span class="muted">운영진 변경${h.memo ? ' · ' + h.memo : ''}</span></li>`)}</ul>`
    : html`<p class="muted" style="margin: 0">티어 기록이 아직 없어요.</p>`;

  const draw = () => mount(main, html`
    <a class="btn ghost" href="/players" style="justify-self: start">← 선수 목록</a>
    ${header}
    <div class="page-head" style="align-items: center"><h2 style="font-family: var(--head); font-size: 26px">내전 성적</h2>
      <div class="seg" role="group" aria-label="기간"><button type="button" data-period="recent" aria-pressed="${period === 'recent'}">최근 30일</button><button type="button" data-period="season" aria-pressed="${period === 'season'}">시즌 ${season}</button></div></div>
    ${tiles()}
    <div class="row">
      <section class="card grow" aria-labelledby="char-title"><div class="card-head"><h2 id="char-title">실험체별 내전 성적</h2><span class="muted" style="font-size: 12px; font-weight: 600">무명섬 내전에서 플레이한 실험체 데이터예요</span></div>${charTable}</section>
      <section class="card" style="flex: 1 1 420px" aria-labelledby="games-title"><h2 id="games-title">최근 경기</h2>${gameList}</section>
    </div>
    <section class="card" aria-labelledby="tier-title"><div class="card-head"><h2 id="tier-title">밸런스 티어 기록</h2><span class="muted" style="font-size: 12px; font-weight: 600">밸런스 티어는 운영진이 직접 정해요</span></div>${historyList}</section>
  `);
  on(main, 'click', '[data-period]', (_e, b) => { period = b.dataset.period; draw(); });
  draw();
});
