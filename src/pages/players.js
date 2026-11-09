import { startPublic } from '../components/shell.js';
import { html, mount, on, safeUrl } from '../lib/dom.js';
import { select } from '../lib/db.js';
import { loadPlayers, loadRecords, loadEvents, nextEvent } from '../lib/api.js';
import { avatar, tierChip, liveBadge, pct, num, chzzkUrl, dateKo, timeKo, STATUS_LABEL, STAR } from '../lib/fmt.js';
import { emptyRecord } from '../lib/records.js';

// /players?event=<내전 id 또는 next> → 그 내전 참가자만 (참가 명단)
const eventParam = new URLSearchParams(location.search).get('event');

startPublic('players', async (main, { vis }) => {
  const [data, entry] = await Promise.all([
    vis.personal ? loadRecords({ from: vis.from }) : loadPlayers({ includeInactive: !!eventParam, stats: false }),
    eventParam ? loadEntry(eventParam) : null
  ]);
  const recOf = (id) => (vis.personal ? data.recordOf(id) : emptyRecord(id));
  const state = { tier: 0, liveOnly: false };
  // 참가 명단: 이번 내전 자리(이번만 티어)로 나눠요. 디스코드 공지와 같은 순서 (티어 → 이름)
  const slotOf = new Map((entry?.parts || []).map((pt) => [pt.player_id, pt.slot_tier]));
  const tierOf = (p) => (entry ? slotOf.get(p.id) || p.tier : p.tier);
  const list = entry
    ? data.list.filter((p) => slotOf.has(p.id)).sort((a, b) => tierOf(a) - tierOf(b) || a.name.localeCompare(b.name, 'ko'))
    : data.list.filter((p) => p.active);
  if (entry) document.title = '무명섬 · 참가 명단';

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
          <span class="meta">${tierChip(p.tier, 'rot')}${entry && tierOf(p) !== p.tier ? html`<span class="chip sky plain" style="font-size: 12px; padding: 0 8px" title="이번 내전에서만 바뀐 자리">이번만 ${tierOf(p)}티어</span>` : ''}${vis.mvp && vis.personal && r.mvp ? html`<span class="chip warn plain" style="font-size: 12px; padding: 0 8px" title="디스코드 라운드 MVP 투표로 뽑힌 횟수">MVP ${r.mvp}회</span>` : ''}<span class="role">${p.role}</span></span>
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

  const filters = () => html`<div class="pills" role="group" aria-label="선수 필터">
      ${[0, 1, 2, 3].map((t) => html`<button type="button" data-tier="${t}" aria-pressed="${state.tier === t}">${t ? t + '티어' : '전체'}</button>`)}
      <button type="button" class="live-filter" data-live aria-pressed="${state.liveOnly}">LIVE ON</button>
    </div>`;

  // 참가 명단 화면
  const drawEntry = () => {
    const ev = entry.event;
    const shown = list.filter((p) => (!state.tier || tierOf(p) === state.tier) && (!state.liveOnly || p.isLive));
    const head = ev
      ? html`<p class="lead">${ev.episode ? ev.episode + '회차 · ' : ''}${ev.title} · ${dateKo(ev.starts_at)} ${timeKo(ev.starts_at)} · <b>${list.length} / ${ev.max_players}명</b> 참가했어요!${ev.status === 'open' ? ' 참가 신청은 디스코드 공지의 [참가하기]나 /참가 로 해 주세요.' : ` (${STATUS_LABEL[ev.status] || ev.status})`}</p>`
      : html`<p class="lead">${entry.missing ? '앗, 그 내전을 찾지 못했어요.' : '아직 잡힌 내전이 없어요. 일정이 정해지면 여기에 참가 명단이 보여요!'}</p>`;
    const sections = [1, 2, 3].map((t) => [t, shown.filter((p) => tierOf(p) === t)]).filter(([, ps]) => ps.length);
    mount(main, html`
      <div class="page-head">
        <div>
          <h1>참가 명단 ${STAR}</h1>
          ${head}
          <p style="margin: 6px 0 0; font-size: 14px; font-weight: 700"><a href="/players">전체 선수 보기</a>${ev ? html` · <a href="/schedule">전체 일정</a>` : ''}</p>
        </div>
        ${list.length ? filters() : ''}
      </div>
      ${!ev ? ''
        : !list.length ? html`<p class="empty">아직 참가한 생존자가 없어요.${ev.status === 'open' ? ' 디스코드 공지에서 [참가하기]를 눌러 주세요!' : ''}</p>`
        : !sections.length ? html`<p class="empty">앗, 조건에 맞는 생존자가 없어요. 필터를 바꿔 볼까요?</p>`
        : sections.map(([t, ps]) => html`<section class="stack" style="gap: 12px" aria-labelledby="entry-t${t}">
            <h2 id="entry-t${t}" class="flex" style="gap: 10px; font-family: var(--head); font-size: 22px">${tierChip(t)}<span class="num">${ps.length}명</span></h2>
            <div class="grid" style="--min: 270px">${ps.map(card)}</div>
          </section>`)}
    `);
  };

  const draw = () => {
    if (entry) return drawEntry();
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

/** 참가 명단에 쓸 내전과 참가자 (참가자는 선수 id · 이번만 티어만 받아요) */
async function loadEntry(param) {
  const events = await loadEvents();
  const event = param === 'next' ? nextEvent(events) : events.find((e) => String(e.id) === param) || null;
  const parts = event ? await select('event_participants', { eq: { event_id: event.id }, columns: 'player_id, slot_tier' }) : [];
  return { event, parts, missing: param !== 'next' && !event };
}
