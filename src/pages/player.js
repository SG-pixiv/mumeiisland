import { startPublic } from '../components/shell.js';
import { html, mount, on, qs, safeUrl } from '../lib/dom.js';
import { loadPlayerDetail } from '../lib/api.js';
import { loadRecords } from '../lib/api.js';
import { avatar, liveBadge, pct, num, score, chzzkUrl, medalClass, shortDate, liveHref, PLATFORM_LABEL } from '../lib/fmt.js';
import { historyRow } from '../components/records-ui.js';

startPublic('players', async (main, { vis }) => {
  const id = qs('id');
  const [data, recs] = await Promise.all([id ? loadPlayerDetail(id) : null, id && vis.personal ? loadRecords({ from: vis.from }) : null]);
  if (!data) {
    mount(main, html`<a class="btn ghost" href="/players" style="justify-self: start">← 선수 목록</a><p class="empty">앗, 이 선수를 찾지 못했어요.</p>`);
    return;
  }
  const { player: p, history } = data;
  document.title = `무명섬 · ${p.name}`;
  // 내전 기록 (개인 기록을 공개할 때만 · 집계 시작 회차부터)
  const epOf = new Map((recs?.events || []).map((e) => [e.id, e.episode]));
  const rounds = recs ? data.rounds.filter((g) => (epOf.get(g.event_id) || 0) >= vis.from) : [];
  const rec = recs ? recs.recordOf(p.id) : null;
  const chars = new Map();
  for (const g of rounds) {
    const k = g.character_name || '알 수 없음';
    const c = chars.get(k) || { name: k, games: 0, wins: 0, rankSum: 0, totalSum: 0 };
    c.games++; if (g.team_rank === 1) c.wins++; c.rankSum += g.team_rank; c.totalSum += Number(g.total) || 0;
    chars.set(k, c);
  }
  const characters = [...chars.values()].sort((a, b) => b.games - a.games).map((c) => ({ ...c, avgRank: c.rankSum / c.games, avgTotal: c.totalSum / c.games }));

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
      ${p.isLive && p.liveTitle ? html`<p style="margin: 0; font-weight: 700">지금 ${PLATFORM_LABEL[p.livePlatform] || ''}에서 방송 중 · ${p.liveTitle}</p>` : ''}
    </div>
    <div class="flex" style="flex: 1 1 200px; justify-content: flex-end; gap: 10px">
      ${p.isLive && liveHref(p) ? html`<a class="btn pink big" href="${liveHref(p)}" target="_blank" rel="noopener">방송 보러 가기</a>` : ''}
      ${p.chzzkId ? html`<a class="btn sky big" href="${chzzkUrl(p.chzzkId)}" target="_blank" rel="noopener">치지직 방송</a>` : ''}
      ${safeUrl(p.youtubeUrl) ? html`<a class="btn big" href="${safeUrl(p.youtubeUrl)}" target="_blank" rel="noopener">유튜브</a>` : ''}
    </div>
  </section>`;

  const tiles = () => html`<div class="tiles">
      <div class="tile"><span class="label">출전</span><span class="value">${rec.episodes}회</span><span class="sub">끝난 회차${vis.from > 1 ? ` · ${vis.from}회차부터` : ''}</span></div>
      <div class="tile"><span class="label">우승</span><span class="value">${rec.wins}회</span><span class="sub">우승률 ${rec.winRate === null ? '-' : Math.round(rec.winRate * 100) + '%'}</span></div>
      <div class="tile"><span class="label">평균 순위</span><span class="value">${rec.avgStanding === null ? '-' : num(rec.avgStanding, 1) + '위'}</span><span class="sub">회차 최종 순위 · 3위 안 ${rec.podiums}회</span></div>
      <div class="tile"><span class="label">판수</span><span class="value">${rec.roundGames}판</span><span class="sub">판 1위 ${rec.roundWins}번</span></div>
      ${vis.tk ? html`<div class="tile"><span class="label">평균 TK</span><span class="value">${num(rec.avgTk, 1)}</span><span class="sub">판마다 팀 킬</span></div>` : ''}
      <div class="tile"><span class="label">판 평균 점수</span><span class="value">${rec.avgTotal === null ? '-' : score(rec.avgTotal)}</span><span class="sub">팀 라운드 점수</span></div>
      ${vis.mvp ? html`<div class="tile"><span class="label">라운드 MVP</span><span class="value">${rec.mvp}회</span><span class="sub">디스코드 투표</span></div>` : ''}
    </div>`;

  const maxGames = Math.max(1, ...characters.map((c) => c.games));
  const charTable = characters.length
    ? html`<div class="table-wrap"><table class="data" style="min-width: 460px"><thead><tr><th>실험체</th><th>판수</th><th class="r">1위 비율</th><th class="r">평균 순위</th><th class="r">평균 점수</th></tr></thead><tbody>
        ${characters.map((c) => html`<tr><td style="font-family: var(--head); font-size: 16px">${c.name}</td><td><span class="flex" style="flex-wrap: nowrap"><b class="num" style="width: 24px">${c.games}</b><span aria-hidden="true" style="height: 12px; border-radius: 999px; background: var(--sky); border: 2px solid var(--ink); width: ${Math.max(16, Math.round((c.games / maxGames) * 130))}px"></span></span></td><td class="r">${pct(c.wins, c.games)}</td><td class="r">${num(c.avgRank, 1)}</td><td class="r">${score(c.avgTotal)}</td></tr>`)}
      </tbody></table></div>`
    : html`<p class="empty">아직 내전 기록이 없어요.</p>`;

  const recentGames = rounds.slice(0, 8);
  const gameList = recentGames.length
    ? html`<ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px">${recentGames.map((g) => html`<li style="display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 12px; align-items: center; background: var(--soft); border-radius: 20px; padding: 10px 14px">
        <span class="medal ${medalClass(g.team_rank)}" style="width: 48px; height: 48px; font-size: 17px">${g.team_rank}위</span>
        <span style="display: grid; min-width: 0"><span style="font-family: var(--head); font-size: 17px">${g.character_name || '실험체 미상'} <span class="muted" style="font-family: var(--body); font-weight: 600; font-size: 13px">· ${epOf.get(g.event_id) ? epOf.get(g.event_id) + '회차 ' : shortDate(g.played_at) + ' '}${g.round_no}R</span></span>
        <span class="muted" style="font-size: 13px">킬 <b class="num" style="color: var(--ink)">${g.kills}</b> · 어시 <b class="num" style="color: var(--ink)">${g.assists}</b>${vis.tk ? html` · TK <b class="num" style="color: var(--ink)">${g.team_kills}</b>` : ''}</span></span>
        <span style="text-align: right; display: grid"><span class="num" style="font-size: 20px">${score(g.total)}점</span><span class="muted" style="font-size: 12px">순위 ${score(g.rs)} · 킬 ${score(g.ks)}</span></span>
      </li>`)}</ol>`
    : html`<p class="empty">첫 내전을 기다리는 중이에요!</p>`;

  const historyList = history.length
    ? html`<ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 14px">${history.map((h, i) => html`<li class="flex" style="gap: 6px 14px"><span aria-hidden="true" style="width: 14px; height: 14px; border-radius: 50%; background: ${i ? 'var(--sky)' : 'var(--pink)'}; border: 2px solid var(--ink)"></span><span class="num muted" style="font-weight: 700">${new Date(h.changed_at).toLocaleDateString('ko-KR')}</span><b>${h.from_tier ? `${h.from_tier}티어 → ` : '첫 등록 '}<span style="font-family: var(--head); font-weight: 400; color: var(--t${h.to_tier})">${h.to_tier}티어</span></b><span class="muted">운영진 변경${h.memo ? ' · ' + h.memo : ''}</span></li>`)}</ul>`
    : html`<p class="muted" style="margin: 0">티어 기록이 아직 없어요.</p>`;

  const draw = () => mount(main, html`
    <a class="btn ghost" href="/players" style="justify-self: start">← 선수 목록</a>
    ${header}
    ${rec
      ? html`<div class="page-head" style="align-items: center"><h2 style="font-family: var(--head); font-size: 26px">내전 성적</h2><span class="muted" style="font-size: 13px; font-weight: 700">회차 기준 · <a href="/records" style="font-weight: 700">개인 기록 전체</a></span></div>
        ${tiles()}
        <section class="card" aria-labelledby="ep-title"><div class="card-head"><h2 id="ep-title">회차 기록</h2><span class="muted" style="font-size: 12px; font-weight: 600">끝난 회차의 최종 순위예요</span></div>
          ${rec.history.length ? html`<ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px">${rec.history.slice(0, 10).map((h) => historyRow(h, recs.byId))}</ol>` : html`<p class="empty">아직 끝난 회차 기록이 없어요.</p>`}
        </section>
        <div class="row">
          <section class="card grow" aria-labelledby="char-title"><div class="card-head"><h2 id="char-title">실험체별 내전 성적</h2><span class="muted" style="font-size: 12px; font-weight: 600">판 기준 · 무명섬 내전에서 플레이한 실험체예요</span></div>${charTable}</section>
          <section class="card" style="flex: 1 1 420px" aria-labelledby="games-title"><h2 id="games-title">최근 경기</h2>${gameList}</section>
        </div>`
      : ''}
    <section class="card" aria-labelledby="tier-title"><div class="card-head"><h2 id="tier-title">밸런스 티어 기록</h2><span class="muted" style="font-size: 12px; font-weight: 600">밸런스 티어는 운영진이 직접 정해요</span></div>${historyList}</section>
  `);
  draw();
});
