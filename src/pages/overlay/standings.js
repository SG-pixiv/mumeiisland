// ② 게임 중 누적 순위 (OBS 소스 600 × 800, 오른쪽 · 가운데보다 조금 위)
// 주소 옵션: ?size=60 (크기 %) · ?members=0 (팀원 이름 숨기기) · ?event=내전ID
import { html } from '../../lib/dom.js';
import { loadOverlay } from '../../lib/live-api.js';
import { buildStandings, pts } from '../../lib/live.js';
import { runOverlay } from './run.js';

const medal = (rank) => (rank <= 3 ? `m${rank}` : '');

runOverlay(
  (params) => loadOverlay({ eventId: params.get('event') }),
  (d, params) => {
    if (!d.event) return html`<div class="ov-fit"></div>`;
    const showMembers = params.get('members') !== '0';
    const { cols, rows, played, planned } = buildStandings({ event: d.event, scores: d.scores, members: d.members, label: d.label });
    return html`<div class="ov-fit"><section class="ov-board" aria-label="누적 순위" style="--cols: ${cols.length}">
      <div class="ov-board-top"><span class="ov-logo">무명섬</span><span class="ov-chip">${played} / ${planned} 라운드</span></div>
      <span class="ov-board-title">${d.event.title} 누적 순위</span>
      ${rows.length ? html`
        <div class="ov-grid head"><span>순위</span><span>팀</span>${cols.map((c) => html`<span class="r">${c}R</span>`)}<span class="r">합계</span></div>
        ${rows.map((r) => html`<div class="ov-grid">
          <span class="ov-medal ov-num ${medal(r.rank)}">${r.rank}</span>
          <span class="ov-team"><b>${r.name}</b>${showMembers && r.members.length ? html`<small>${r.members.map((m) => m.name).join(' · ')}</small>` : ''}</span>
          ${r.rounds.map((v) => html`<span class="r ov-num ov-round">${v === null ? '' : pts(v)}</span>`)}
          <span class="r ov-num ov-total">${pts(r.total)}</span>
        </div>`)}` : html`<p class="ov-empty">팀 편성이 공개되면 여기에 떠요</p>`}
      <span class="ov-foot">순위 점수 + 킬 점수 − 처치자 불명 감점 · 확정된 라운드만 더해요</span>
    </section></div>`;
  }
);
