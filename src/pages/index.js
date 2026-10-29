import { startPublic } from '../components/shell.js';
import { html, mount, raw } from '../lib/dom.js';
import { select } from '../lib/db.js';
import { loadEvents, nextEvent, loadPlayers, loadMatchList, loadEventDetail } from '../lib/api.js';
import { dateKo, timeKo, FORMAT_LABEL, num, pct, score, avatar, tierChip, liveBadge, medalClass, liveHref, PLATFORM_LABEL } from '../lib/fmt.js';

startPublic('home', async (main) => {
  const [events, { list, byId, season }, matches] = await Promise.all([loadEvents(), loadPlayers(), loadMatchList()]);
  const next = nextEvent(events);
  const parts = next ? await select('event_participants', { eq: { event_id: next.id } }) : [];
  const partPlayers = parts.map((p) => byId.get(p.player_id)).filter(Boolean);
  const recent = matches[0] ? await loadEventDetail(matches[0].id) : null;
  const live = list.filter((p) => p.isLive);

  // 시즌 랭킹: 평균 합계점수 순 (판수가 적은 초반엔 기준을 낮춰요)
  let minGames = 10;
  let ranked = list.filter((p) => p.season.games >= minGames);
  if (ranked.length < 3) { minGames = 1; ranked = list.filter((p) => p.season.games >= 1); }
  ranked = ranked.sort((a, b) => b.season.avgTotal - a.season.avgTotal).slice(0, 5);

  const tierCount = (t) => partPlayers.filter((p) => p.tier === t).length;
  const lastPlace = recent ? recent.standings.slice().sort((a, b) => b.standing - a.standing)[0] : null;
  const lastCaptain = lastPlace ? (recent.members.get(lastPlace.team_no) || []).find((m) => m.tier === 1) : null;

  const hero = next
    ? html`<section class="hero" aria-labelledby="next-title">
        <div style="flex: 999 1 420px; min-width: 0; display: grid; gap: 14px; align-content: start">
          <span class="sticker">다음 내전</span>
          <h1 id="next-title">${dateKo(next.starts_at)} ${timeKo(next.starts_at)}</h1>
          <p style="margin: 0; font-weight: 700">사용자 설정 대전 · ${FORMAT_LABEL[next.format]} 방식 · ${next.planned_rounds}라운드${next.setting_code ? ` · 설정 코드 ${next.setting_code}` : ''}</p>
          <p style="margin: 0; font-weight: 600">생존자 여러분, 다음 내전까지 얼마 안 남았어요! 참가 명단이랑 팀 편성 미리 확인해 두세요.</p>
          <div class="flex" id="countdown" aria-label="남은 시간"></div>
          <div class="flex" style="gap: 12px; margin-top: 6px">
            <a class="btn big" href="/players">참가 명단 보기</a>
            <a class="btn big sky" href="/schedule">전체 일정</a>
            <a class="btn big" href="/draft">팀 편성 보기</a>
          </div>
        </div>
        <div class="card" style="flex: 1 1 300px; border: 2px solid var(--ink); box-shadow: none; border-radius: 26px">
          <div class="card-head"><span style="font-family: var(--head); font-size: 20px">참가 확정</span><span class="num" style="font-size: 28px">${next.joined} / ${next.max_players}</span></div>
          <div role="img" aria-label="${next.max_players}명 중 ${next.joined}명" style="height: 16px; border-radius: 999px; background: var(--soft); border: 2px solid var(--ink); overflow: hidden"><div style="width: ${Math.min(100, Math.round((next.joined / next.max_players) * 100))}%; height: 100%; background: var(--sky)"></div></div>
          <div class="flex">${[1, 2, 3].map((t) => html`<span class="tier t${t}" style="font-size: 15px; padding: 5px 14px">${t}티어 <b class="num" style="margin-left: 4px">${tierCount(t)}</b></span>`)}</div>
          ${next.format === 'draft' && lastCaptain ? html`<p class="muted" style="margin: 0; font-size: 14px">드래프트는 지난 내전 꼴찌 팀장 <b style="color: var(--ink)">${lastCaptain.name}</b>부터 시작한답니다!</p>` : ''}
        </div>
      </section>`
    : html`<section class="hero"><div style="display: grid; gap: 10px"><span class="sticker">다음 내전</span><h1>아직 잡힌 내전이 없어요</h1><p style="margin: 0; font-weight: 600">일정이 정해지면 여기에 바로 보여 드릴게요!</p></div></section>`;

  const liveSection = live.length
    ? html`<section aria-labelledby="live-title" class="stack" style="gap: 16px">
        <div class="flex" style="gap: 12px"><span aria-hidden="true" style="width: 12px; height: 12px; border-radius: 50%; background: var(--red); box-shadow: 0 0 0 5px #FDE2E3"></span><h2 id="live-title" style="font-family: var(--head); font-size: 26px">지금 방송 중</h2><span class="chip soft plain num">${live.length}명</span></div>
        <div class="grid" style="--min: 250px">
          ${live.map((p) => html`<a class="card" style="gap: 12px; padding: 16px; color: var(--ink); text-decoration: none; border-radius: 24px" href="${liveHref(p) || '/player?id=' + p.id}"${liveHref(p) ? raw(' target="_blank" rel="noopener"') : ''}>
            <span class="flex" style="gap: 12px; flex-wrap: nowrap; min-width: 0">${avatar(p, 'sm')}<span style="display: grid; min-width: 0"><span class="flex" style="gap: 6px; flex-wrap: nowrap; min-width: 0"><span style="font-family: var(--head); font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${p.name}</span>${liveBadge(true)}</span><span class="muted" style="font-size: 13px; font-weight: 600">${p.tier}티어 · ${PLATFORM_LABEL[p.livePlatform] || '방송'}</span></span></span>
            ${p.liveTitle ? html`<span style="font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${p.liveTitle}</span>` : ''}
            <span class="muted" style="font-size: 13px">눌러서 놀러 가기!</span>
          </a>`)}
        </div>
      </section>`
    : '';

  const recentTop = recent ? recent.standings.slice().sort((a, b) => a.standing - b.standing).slice(0, 3) : [];
  const recentCard = html`<section class="card" style="flex: 1 1 460px" aria-labelledby="recent-title">
    <div class="card-head"><h2 id="recent-title">최근 내전 결과</h2>${recent ? html`<span class="muted" style="font-size: 13px; font-weight: 600">${dateKo(recent.event.starts_at, false)} · ${recent.roundNos.length}라운드 누적</span>` : ''}</div>
    ${recent
      ? html`<ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px">
          ${recentTop.map((s) => html`<li style="display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 14px; align-items: center; background: var(--soft); border-radius: 20px; padding: 12px 16px">
            <span class="medal ${medalClass(s.standing)}">${s.standing}</span>
            <span style="display: grid; min-width: 0"><span style="font-family: var(--head); font-size: 18px">팀 ${s.team_no}</span><span class="muted" style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${(recent.members.get(s.team_no) || []).map((m) => m.name).join(' · ')}</span></span>
            <span style="text-align: right; display: grid"><span class="num" style="font-size: 22px">${score(s.total)}점</span><span class="muted" style="font-size: 12px">순위 ${score(s.rs)} · 킬 ${score(s.ks)}${Number(s.pen) ? ` · 감점 ${score(s.pen)}` : ''}</span></span>
          </li>`)}
        </ol>
        <a href="/match?id=${recent.event.id}" style="font-size: 14px; font-weight: 700">전체 순위와 라운드별 기록 보기</a>`
      : html`<p class="empty">아직 확정된 내전 기록이 없어요.</p>`}
  </section>`;

  const rankingCard = html`<section class="card" style="flex: 1 1 520px" aria-labelledby="rank-title">
    <div class="card-head"><h2 id="rank-title">시즌 ${season} 내전 랭킹</h2><span class="muted" style="font-size: 13px; font-weight: 600">평균 합계점수 순 · ${minGames}판 이상</span></div>
    ${ranked.length
      ? html`<div class="table-wrap"><table class="data" style="min-width: 600px">
          <thead><tr><th>#</th><th>선수</th><th class="r">내전 경기</th><th class="r">내전 승률</th><th class="r">평균 TK</th><th class="r">라운드 MVP</th><th class="r">평균 점수</th></tr></thead>
          <tbody>${ranked.map((p, i) => html`<tr>
            <td><span class="medal sm ${medalClass(i + 1)}">${i + 1}</span></td>
            <td><a href="/player?id=${p.id}" class="flex" style="color: var(--ink); text-decoration: none; flex-wrap: nowrap">${tierChip(p.tier)}<b>${p.name}</b></a></td>
            <td class="r">${p.season.games}</td><td class="r">${pct(p.season.wins, p.season.games)}</td>
            <td class="r">${num(p.season.avgTk, 1)}</td><td class="r">${p.roundMvp ? html`<span class="chip warn plain" style="font-size: 12px; padding: 0 8px">${p.roundMvp}회</span>` : html`<span class="muted">-</span>`}</td><td class="r">${score(p.season.avgTotal)}</td>
          </tr>`)}</tbody></table></div>`
      : html`<p class="empty">내전 기록이 쌓이면 랭킹이 생겨요!</p>`}
  </section>`;

  mount(main, html`${hero}${liveSection}<div class="row">${recentCard}${rankingCard}</div>`);

  // 카운트다운
  const box = document.getElementById('countdown');
  if (box && next) {
    const tick = () => {
      const left = Math.max(0, new Date(next.starts_at).getTime() - Date.now());
      const d = Math.floor(left / 86400000), h = Math.floor(left / 3600000) % 24, m = Math.floor(left / 60000) % 60, s = Math.floor(left / 1000) % 60;
      mount(box, [[d, '일'], [h, '시간'], [m, '분'], [s, '초']].map(([v, l]) => html`<span style="display: grid; justify-items: center; min-width: 76px; background: var(--card); border: 2px solid var(--ink); border-radius: 20px; padding: 8px 12px; box-shadow: 0 4px 0 var(--ink)"><span class="num" style="font-size: 32px; line-height: 1.1">${String(v).padStart(2, '0')}</span><span class="muted" style="font-size: 12px; font-weight: 700">${l}</span></span>`));
    };
    tick();
    setInterval(tick, 1000);
  }
});
