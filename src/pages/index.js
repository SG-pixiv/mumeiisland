import { startPublic } from '../components/shell.js';
import { html, mount, raw } from '../lib/dom.js';
import { select } from '../lib/db.js';
import { loadEvents, nextEvent, loadPlayers, loadRecords } from '../lib/api.js';
import { dateKo, timeKo, FORMAT_LABEL, num, score, avatar, tierChip, liveBadge, medalClass, liveHref, PLATFORM_LABEL } from '../lib/fmt.js';
import { leaders, rankOrder, withGap } from '../lib/records.js';
import { leaderCard, memberChips, memberNames, episodeSticker, standingsTable } from '../components/records-ui.js';

startPublic('home', async (main, { vis }) => {
  const [events, data] = await Promise.all([loadEvents(), vis.any ? loadRecords({ from: vis.from }) : loadPlayers({ includeInactive: true })]);
  const { byId } = data;
  const list = (data.list || []).filter((p) => p.active);
  const next = nextEvent(events);
  const parts = next ? await select('event_participants', { eq: { event_id: next.id } }) : [];
  const partPlayers = parts.map((p) => byId.get(p.player_id)).filter(Boolean);
  const live = list.filter((p) => p.isLive);
  const results = vis.any ? data.results : [];
  const records = vis.any ? data.records : new Map();

  const tierCount = (t) => partPlayers.filter((p) => p.tier === t).length;
  // 드래프트 순서 안내: 지난 회차 꼴찌 팀장 (내전 기록을 공개할 때만)
  const lastDone = results.find((r) => r.finished && r.episode >= vis.from);
  const lastPlace = vis.results && lastDone ? lastDone.teams[lastDone.teams.length - 1] : null;
  const lastCaptain = lastPlace ? lastPlace.members.map((m) => m.id && byId.get(m.id)).filter(Boolean).find((p) => p.tier === 1) : null;

  const hero = next
    ? html`<section class="hero" aria-labelledby="next-title">
        <div style="flex: 999 1 420px; min-width: 0; display: grid; gap: 14px; align-content: start">
          <span class="sticker">다음 내전${next.episode ? ' · ' + next.episode + '회차' : ''}</span>
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
          ${next.format === 'draft' && lastCaptain ? html`<p class="muted" style="margin: 0; font-size: 14px">드래프트는 지난 회차 꼴찌 팀장 <b style="color: var(--ink)">${lastCaptain.name}</b>부터 시작한답니다!</p>` : ''}
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

  // ── 경쟁 기록 (기록 공개 설정에서 대시보드에 띄우기로 한 것만)
  const onAir = events.filter((e) => (e.live_state === 'playing' || e.live_state === 'ended') && Date.now() - Date.parse(e.live_changed_at) < 12 * 3600000)
    .sort((a, b) => Date.parse(b.live_changed_at) - Date.parse(a.live_changed_at))[0];
  const liveResult = vis.dash.results && onAir ? results.find((r) => r.event.id === onAir.id) : null;
  const liveCard = liveResult
    ? html`<section class="card" style="border-color: var(--pink); box-shadow: 0 6px 0 var(--pink)" aria-labelledby="live-rank-title">
        <div class="card-head"><h2 id="live-rank-title" class="flex" style="gap: 10px">${episodeSticker(liveResult.event)}실시간 팀 순위 <span class="live sm">${onAir.live_state === 'playing' ? `${onAir.live_round || liveResult.rounds + 1}라운드 진행 중` : `${onAir.live_round || liveResult.rounds}라운드 끝`}</span></h2>
          <a href="/match?id=${liveResult.event.id}" style="font-size: 14px; font-weight: 700">라운드별 기록</a></div>
        ${standingsTable(withGap(liveResult.teams), byId, { gap: true, compact: true })}
      </section>`
    : '';

  const L = leaders(records);
  const pl = (r) => (r ? byId.get(r.id) : null);
  const leaderRow = vis.dash.hall || vis.dash.personal
    ? html`<div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))">
        ${vis.dash.hall ? leaderCard({ label: '최다 우승', player: pl(L.mostWins), value: L.mostWins ? `${L.mostWins.wins}회 우승` : '', sub: L.mostWins ? `${L.mostWins.episodes}회 출전` : '', bg: 'var(--soft)', fg: 'var(--pink-ink)' }) : ''}
        ${vis.dash.personal ? leaderCard({ label: '최다 출전', player: pl(L.mostGames), value: L.mostGames ? `${L.mostGames.episodes}회 출전` : '', bg: 'var(--sky-soft)', fg: 'var(--sky-ink)' }) : ''}
        ${vis.dash.personal ? leaderCard({ label: `평균 순위 1위 (${L.minGames}회차 이상)`, player: pl(L.bestAvg), value: L.bestAvg ? `평균 ${num(L.bestAvg.avgStanding, 1)}위` : '', sub: L.bestAvg ? `${L.bestAvg.episodes}회 출전` : '', bg: 'var(--t1s)', fg: 'var(--t1)', empty: `${L.minGames}회차 이상 뛴 선수가 아직 없어요` }) : ''}
      </div>`
    : '';

  const winnerCard = vis.dash.hall
    ? html`<section class="card" style="flex: 1 1 340px; border-color: var(--t3); box-shadow: 0 6px 0 var(--t3s)" aria-labelledby="winner-title">
        <div class="card-head"><h2 id="winner-title">지난 회차 우승</h2>${lastDone ? html`<a href="/hall" style="font-size: 14px; font-weight: 700">우승 기록 전체</a>` : ''}</div>
        ${lastDone
          ? html`<div class="stack" style="gap: 12px; justify-items: start">
              <span class="flex" style="gap: 10px">${episodeSticker(lastDone.event)}<span class="muted" style="font-weight: 700; font-size: 14px">${dateKo(lastDone.event.starts_at, false)} · ${lastDone.rounds}라운드 · ${lastDone.teams.length}팀</span></span>
              ${lastDone.winners.map((w) => html`<div style="display: grid; gap: 8px; width: 100%; background: var(--t3s); border-radius: 20px; padding: 14px 16px">
                <span class="flex" style="justify-content: space-between"><span style="font-family: var(--head); font-size: 20px">팀 ${w.team_no}${lastDone.winners.length > 1 ? ' (공동 1위)' : ''}</span><span class="num" style="font-size: 22px">${score(w.total)}점</span></span>
                ${memberChips(w.members, byId)}</div>`)}
            </div>`
          : html`<p class="empty">${vis.from > 1 ? `${vis.from}회차부터 세요. ` : ''}끝난 회차가 아직 없어요.</p>`}
      </section>`
    : '';

  const recent = results[0] || null;
  const recentCard = vis.dash.results
    ? html`<section class="card" style="flex: 1 1 400px" aria-labelledby="recent-title">
        <div class="card-head"><h2 id="recent-title" class="flex" style="gap: 10px">${recent ? episodeSticker(recent.event) : ''}최근 결과</h2>${recent ? html`<span class="muted" style="font-size: 13px; font-weight: 600">${dateKo(recent.event.starts_at, false)} · ${recent.rounds}라운드 누적${recent.finished ? '' : ' · 진행 중'}</span>` : ''}</div>
        ${recent
          ? html`<ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px">
              ${recent.teams.slice(0, 3).map((t) => html`<li style="display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 14px; align-items: center; background: var(--soft); border-radius: 20px; padding: 12px 16px">
                <span class="medal ${medalClass(t.standing)}">${t.standing}</span>
                <span style="display: grid; min-width: 0"><span style="font-family: var(--head); font-size: 18px">팀 ${t.team_no}</span><span class="muted" style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${memberNames(t.members, byId)}</span></span>
                <span style="text-align: right; display: grid"><span class="num" style="font-size: 22px">${score(t.total)}점</span><span class="muted" style="font-size: 12px">순위 ${score(t.rs)} · 킬 ${score(t.ks)}${t.pen ? ` · 감점 ${score(t.pen)}` : ''}</span></span>
              </li>`)}
            </ol>
            <a href="/match?id=${recent.event.id}" style="font-size: 14px; font-weight: 700">전체 순위와 라운드별 기록 보기</a>`
          : html`<p class="empty">아직 확정된 기록이 없어요.</p>`}
      </section>`
    : '';

  const ranked = [...records.values()].filter((r) => r.episodes > 0 && byId.get(r.id)).sort(rankOrder).slice(0, 5);
  const rankingCard = vis.dash.personal
    ? html`<section class="card" style="flex: 1 1 520px" aria-labelledby="rank-title">
        <div class="card-head"><h2 id="rank-title">랭킹 Top 5</h2><span class="muted" style="font-size: 13px; font-weight: 600">${vis.from > 1 ? `${vis.from}회차부터 · ` : ''}우승 많은 순 → 평균 순위 · <a href="/records" style="font-weight: 700">개인 기록 전체</a></span></div>
        ${ranked.length
          ? html`<div class="table-wrap"><table class="data" style="min-width: 520px">
              <thead><tr><th>#</th><th>선수</th><th class="r">출전</th><th class="r">우승</th><th class="r">평균 순위</th>${vis.tk ? html`<th class="r">평균 TK</th>` : ''}${vis.mvp ? html`<th class="r">라운드 MVP</th>` : ''}</tr></thead>
              <tbody>${ranked.map((r, i) => {
                const p = byId.get(r.id);
                return html`<tr>
                  <td><span class="medal sm ${medalClass(i + 1)}">${i + 1}</span></td>
                  <td><a href="/player?id=${p.id}" class="flex" style="color: var(--ink); text-decoration: none; flex-wrap: nowrap">${tierChip(p.tier)}<b>${p.name}</b></a></td>
                  <td class="r">${r.episodes}회</td><td class="r">${r.wins}회</td><td class="r">${r.avgStanding === null ? '-' : num(r.avgStanding, 1) + '위'}</td>
                  ${vis.tk ? html`<td class="r">${num(r.avgTk, 1)}</td>` : ''}${vis.mvp ? html`<td class="r">${r.mvp ? html`<span class="chip warn plain" style="font-size: 12px; padding: 0 8px">${r.mvp}회</span>` : html`<span class="muted">-</span>`}</td>` : ''}
                </tr>`;
              })}</tbody></table></div>`
          : html`<p class="empty">회차가 끝나면 랭킹이 생겨요!</p>`}
      </section>`
    : '';

  // 솔로 랭크 점수 (공개 설정과 상관없이 보여요)
  const solo = list.filter((p) => p.rank?.score != null).sort((a, b) => b.rank.score - a.rank.score).slice(0, 5);
  const soloCard = html`<section class="card" style="flex: 1 1 340px" aria-labelledby="solo-title">
    <div class="card-head"><h2 id="solo-title">솔로 랭크 Top 5</h2><span class="muted" style="font-size: 13px; font-weight: 600">이터널 리턴 랭크 점수 · 이번 시즌</span></div>
    ${solo.length
      ? html`<ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 8px">${solo.map((p, i) => html`<li><a href="/player?id=${p.id}" style="display: grid; grid-template-columns: 34px auto minmax(0, 1fr) auto; gap: 10px; align-items: center; background: var(--sky-soft); border-radius: 18px; padding: 8px 14px; color: var(--ink); text-decoration: none">
          <span class="medal sm ${medalClass(i + 1)}">${i + 1}</span>${avatar(p, 'sm')}<b style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${p.name}</b><span class="num">${p.rank.score.toLocaleString('ko-KR')}점</span></a></li>`)}</ol>`
      : html`<p class="empty">랭크 점수가 아직 없어요.</p>`}
  </section>`;

  const rows = [liveCard, leaderRow, [winnerCard, recentCard].some(Boolean) ? html`<div class="row">${winnerCard}${recentCard}</div>` : '', html`<div class="row">${rankingCard}${soloCard}</div>`];
  mount(main, html`${hero}${liveSection}${rows}`);

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
