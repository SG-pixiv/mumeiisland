// ③ 라운드 결과 + MVP (OBS 소스 1920 × 1080, 판 사이 장면)
// 주소 옵션: ?round=3 (그 라운드 고정) · ?bg=0 (배경 투명) · ?event=내전ID
import { html } from '../../lib/dom.js';
import { loadOverlay } from '../../lib/live-api.js';
import { buildRoundResult, mvpInfo, pts } from '../../lib/live.js';
import { runOverlay } from './run.js';

const medal = (rank) => (rank <= 3 ? `m${rank}` : '');
const TROPHY = html`<svg aria-hidden="true" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#9A5B00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3"/><path d="M7 5H4v2a3 3 0 0 0 3 3"/></svg>`;

function mvpCard(m) {
  if (m.kind === 'done') {
    return html`<div class="ov-card mvp" aria-label="오늘의 MVP"><span class="trophy">${TROPHY}</span>
      <span style="display: flex; flex-direction: column; gap: 2px"><small>오늘의 MVP</small><strong>${m.name}</strong>${m.note ? html`<span class="sub">${m.note}</span>` : ''}</span></div>`;
  }
  if (m.kind === 'voting') {
    return html`<div class="ov-card vote" aria-label="MVP 투표 중"><small><span class="ov-dot" aria-hidden="true"></span>MVP 투표 중</small>
      <strong>${m.count === null ? '투표 받는 중' : `${m.voters}명 중 ${m.count}명 투표`}</strong>
      ${m.count === null ? '' : html`<span class="ov-bar"><span style="width: ${m.pct}%"></span></span>`}
      <span class="sub" style="font-size: 16px">디스코드 공지의 투표 버튼으로 뽑아요</span></div>`;
  }
  return '';
}

runOverlay(
  (params) => loadOverlay({ eventId: params.get('event'), withRounds: true }),
  (d, params) => {
    const bg = params.get('bg') === '0' ? '' : ' dots';
    if (!d.event) return html`<div class="ov-scene${bg}"><span class="ov-logo">무명섬</span><div class="ov-wait">다음 내전을 기다리는 중이에요</div></div>`;
    const played = [...new Set(d.scores.map((s) => s.round_no))].sort((a, b) => a - b);
    const want = Number(params.get('round')) || played.at(-1) || 0;
    const res = want ? buildRoundResult({ scores: d.scores, roundNo: want, members: d.membersOfRound(want), label: d.label }) : null;
    const mvp = mvpInfo(d.event, { names: d.names, teamOf: d.teamOf, voteCount: d.voteCount, voters: d.voters });
    return html`<div class="ov-scene${bg}">
      <div class="ov-scene-top">
        <div style="display: flex; flex-direction: column; gap: 6px">
          <div style="display: flex; align-items: center; gap: 16px"><span class="ov-logo">무명섬</span><span class="ov-date">${d.event.title}</span></div>
          <h1>${res ? `${want}라운드 결과` : '라운드 결과'}</h1>
        </div>
        <div class="ov-cards">
          ${mvpCard(mvp)}
          ${res?.leader ? html`<div class="ov-card leader"><small>지금 누적 1위</small><strong>${res.leader.name} · ${pts(res.leader.total)}점</strong></div>` : ''}
        </div>
      </div>
      ${res ? html`<section class="ov-table" aria-label="${want}라운드 팀 순위">
        <div class="ov-rgrid head"><span>순위</span><span>팀</span><span>팀원</span><span class="r">킬</span><span class="r">순위 점수</span><span class="r">킬 점수</span><span class="r">감점</span><span class="r">합계</span><span class="r">누적</span></div>
        ${res.rows.map((r) => html`<div class="ov-rgrid">
          <span class="ov-medal ov-num ${medal(r.rank)}">${r.rank}</span>
          <span class="name">${r.name}</span>
          <span class="ov-members">${r.members.map((m) => html`<span class="ov-member"><span class="ov-tier t${m.tier}">${m.tier}</span>${m.name}${mvp.kind === 'done' && m.id && m.id === mvp.id ? html`<span class="ov-mvp-tag">MVP</span>` : ''}</span>`)}</span>
          <span class="r ov-num big">${r.kills}</span>
          <span class="r ov-num big dim">${pts(r.rs)}</span>
          <span class="r ov-num big dim">${pts(r.ks)}</span>
          <span class="r ov-num big pen">${r.pen ? '−' + pts(r.pen) : '—'}</span>
          <span class="r ov-num total">${pts(r.total)}</span>
          <span class="r ov-num cum">${pts(r.cumTotal)} · ${r.cumRank}위</span>
        </div>`)}
      </section>
      <span class="ov-note">합계 = 순위 점수 + 킬 점수 − 처치자 불명 감점 · 결과 검토에서 확정하면 자동으로 떠요</span>`
      : html`<div class="ov-wait">첫 라운드 결과를 기다리는 중이에요</div>`}
    </div>`;
  }
);
