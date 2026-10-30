// 경쟁 기록 화면 조각 (대시보드 · 우승 기록 · 개인 기록 · 내전 기록이 같이 써요)
import { html } from '../lib/dom.js';
import { avatar, tierDot, medalClass, score, num, shortDate } from '../lib/fmt.js';
import { episodeLabel } from '../lib/records.js';

/** 팀원 칩 (선수면 선수 페이지로) */
export function memberChips(members, byId) {
  return html`<span class="flex" style="gap: 6px">${members.map((m) => {
    const p = m.id ? byId.get(m.id) : null;
    const inner = html`${tierDot(p?.tier || 3)}${p?.name || m.name}`;
    return p
      ? html`<a href="/player?id=${p.id}" class="chip" style="color: var(--ink); text-decoration: none; padding: 1px 10px 1px 3px">${inner}</a>`
      : html`<span class="chip" style="padding: 1px 10px 1px 3px">${inner}</span>`;
  })}</span>`;
}

/** 팀원 이름만 "에이 · 비 · 씨" */
export const memberNames = (members, byId) => members.map((m) => (m.id && byId.get(m.id)?.name) || m.name).join(' · ');

/** 회차 스티커 */
export function episodeSticker(ev, extra = '') {
  const label = episodeLabel(ev);
  return label ? html`<span class="chip sky" style="font-family: var(--head); font-size: 15px; transform: rotate(-2deg); ${extra}">${label}</span>` : '';
}

/** 대시보드 1등 카드 (사진 · 이름 · 값) */
export function leaderCard({ label, player, value, sub, bg = 'var(--soft)', fg = 'var(--pink-ink)', empty = '아직 기록이 없어요' }) {
  return html`<article style="display: flex; align-items: center; gap: 14px; min-width: 0; background: ${bg}; border: 2px solid var(--ink); border-radius: 24px; padding: 16px 18px; box-shadow: 0 5px 0 var(--ink)">
    ${player ? avatar(player) : html`<span class="avatar" aria-hidden="true" style="background: var(--card)">?</span>`}
    <span style="display: grid; min-width: 0; gap: 2px">
      <span style="font-size: 13px; font-weight: 700">${label}</span>
      ${player
        ? html`<a href="/player?id=${player.id}" style="font-family: var(--head); font-size: 22px; color: var(--ink); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${player.name}</a>
          <span class="num" style="color: ${fg}">${value}${sub ? html` <span class="muted" style="font-family: var(--body); font-size: 12px; font-weight: 700">${sub}</span>` : ''}</span>`
        : html`<span class="muted" style="font-weight: 700; font-size: 14px">${empty}</span>`}
    </span>
  </article>`;
}

/** 회차 최종 순위 표 (gap: 1위와의 점수 차 칸) */
export function standingsTable(teams, byId, { gap = false, compact = false } = {}) {
  return html`<div class="table-wrap"><table class="data" style="min-width: ${compact ? 460 : 640}px"><thead><tr>
      <th style="width: 60px">순위</th><th>팀</th><th class="r">합계</th>${compact ? '' : html`<th class="r">RS</th><th class="r">KS</th>`}${gap ? html`<th class="r">1위와 차이</th>` : ''}
    </tr></thead><tbody>
    ${teams.map((t) => html`<tr>
      <td><span class="medal ${medalClass(t.standing)}">${t.standing}</span></td>
      <td><span style="display: grid; gap: 6px"><span style="font-family: var(--head); font-size: 17px">팀 ${t.team_no}${t.rounds ? html` <span class="muted" style="font-family: var(--body); font-size: 12px; font-weight: 700">${t.rounds}판</span>` : ''}</span>${memberChips(t.members, byId)}</span></td>
      <td class="r"><span class="num" style="font-size: 18px; background: ${t.standing === 1 ? 'var(--soft)' : t.standing === 2 ? 'var(--sky-soft)' : 'transparent'}; border-radius: 999px; padding: 2px 12px">${score(t.total)}</span></td>
      ${compact ? '' : html`<td class="r">${score(t.rs)}</td><td class="r">${score(t.ks)}</td>`}
      ${gap ? html`<td class="r" style="font-weight: 700; color: ${t.gap ? 'var(--pink-ink)' : 'var(--muted)'}">${t.gap === null ? '-' : t.gap === 0 ? '동점' : '−' + score(t.gap)}</td>` : ''}
    </tr>`)}
  </tbody></table></div>`;
}

/** 선수 기록 표 (개인 기록 · 대시보드 랭킹) */
export function recordColumns(vis) {
  return [
    ['episodes', '출전', (r) => html`${r.episodes}<small class="muted">회</small>`, 'desc'],
    ['wins', '우승', (r) => (r.wins ? html`<span class="chip soft plain" style="font-size: 13px; padding: 0 10px">${r.wins}회</span>` : html`<span class="muted">0</span>`), 'desc'],
    ['winRate', '우승률', (r) => (r.winRate === null ? '-' : Math.round(r.winRate * 100) + '%'), 'desc'],
    ['avgStanding', '평균 순위', (r) => (r.avgStanding === null ? '-' : num(r.avgStanding, 1) + '위'), 'asc'],
    ['podiums', '3위 안', (r) => `${r.podiums}회`, 'desc'],
    ['roundGames', '판수', (r) => r.roundGames, 'desc'],
    ...(vis.tk ? [['avgTk', '평균 TK', (r) => num(r.avgTk, 1), 'desc']] : []),
    ['avgTotal', '판 평균 점수', (r) => (r.avgTotal === null ? '-' : score(r.avgTotal)), 'desc'],
    ...(vis.mvp ? [['mvp', '라운드 MVP', (r) => (r.mvp ? html`<span class="chip warn plain" style="font-size: 12px; padding: 0 8px">${r.mvp}회</span>` : html`<span class="muted">0</span>`), 'desc']] : [])
  ];
}

/** 선수의 회차 기록 한 줄 */
export function historyRow(h, byId) {
  return html`<li style="display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 12px; align-items: center; background: ${h.standing === 1 ? 'var(--soft)' : 'var(--bg)'}; border-radius: 20px; padding: 10px 14px">
    <span class="medal ${medalClass(h.standing)}" style="width: 48px; height: 48px; font-size: 17px">${h.standing}위</span>
    <span style="display: grid; min-width: 0"><a href="/match?id=${h.eventId}" style="font-family: var(--head); font-size: 17px; color: var(--ink); text-decoration: none">${h.episode ? h.episode + '회차' : h.title} <span class="muted" style="font-family: var(--body); font-weight: 600; font-size: 13px">· ${shortDate(h.startsAt)} · ${h.teams}팀 중</span></a>
      <span class="muted" style="font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">팀 ${h.teamNo}${h.mates.length ? ' · 같이 뛴 사람 ' + memberNames(h.mates, byId) : ''}</span></span>
    <span class="num" style="font-size: 18px">${score(h.total)}점</span>
  </li>`;
}
