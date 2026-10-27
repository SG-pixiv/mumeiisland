import { startPublic } from '../components/shell.js';
import { html, mount, on, qs } from '../lib/dom.js';
import { loadEventDetail } from '../lib/api.js';
import { dateKo, FORMAT_LABEL, score, num, medalClass, tierDot } from '../lib/fmt.js';

startPublic('matches', async (main) => {
  const id = qs('id');
  const d = id ? await loadEventDetail(id) : null;
  if (!d) {
    mount(main, html`<a class="btn ghost" href="/matches" style="justify-self: start">← 내전 기록 목록</a><p class="empty">앗, 이 내전 기록을 찾지 못했어요.</p>`);
    return;
  }
  const { event: ev, scores, standings, prounds, roundNos, members, byId } = d;
  document.title = `무명섬 · ${ev.title}`;
  let tab = 0; // 0 = 누적

  const memberChips = (teamNo) => html`<span class="flex" style="gap: 6px">${(members.get(teamNo) || []).map((m) => m.id
    ? html`<a href="/player?id=${m.id}" class="chip" style="color: var(--ink); text-decoration: none; padding: 1px 10px 1px 3px">${tierDot(m.tier)}${m.name}</a>`
    : html`<span class="chip" style="padding: 1px 10px 1px 3px">${tierDot(m.tier)}${m.name}</span>`)}</span>`;

  const standingRows = () => {
    if (tab === 0) {
      return standings.slice().sort((a, b) => a.standing - b.standing).map((s) => ({ rank: s.standing, team: s.team_no, rs: s.rs, ks: s.ks, pen: s.pen, total: s.total }));
    }
    return scores.filter((s) => s.round_no === tab).sort((a, b) => a.team_rank - b.team_rank).map((s) => ({ rank: s.team_rank, team: s.team_no, rs: s.rs, ks: s.ks, pen: s.pen, total: s.total }));
  };

  const awards = () => {
    const per = new Map();
    prounds.forEach((r) => {
      const k = r.player_id || r.csv_nickname;
      const a = per.get(k) || { name: r.player_id ? byId.get(r.player_id)?.name || r.csv_nickname : r.csv_nickname, kills: 0, dmg: 0, games: 0 };
      a.kills += r.kills; a.dmg += r.damage; a.games++;
      per.set(k, a);
    });
    const list = [...per.values()];
    if (!list.length) return '';
    const topKill = list.slice().sort((a, b) => b.kills - a.kills)[0];
    const topDmg = list.slice().sort((a, b) => b.dmg / b.games - a.dmg / a.games)[0];
    const topKs = standings.slice().sort((a, b) => b.ks - a.ks)[0];
    const mvp = ev.mvp_player_id ? byId.get(ev.mvp_player_id) : null;
    const card = (label, who, value, bg, fg) => html`<div style="display: flex; align-items: center; gap: 14px; background: ${bg}; border: 2px solid var(--ink); border-radius: 24px; padding: 18px; box-shadow: 0 5px 0 var(--ink)">
      <span style="display: grid; min-width: 0"><span style="font-size: 13px; font-weight: 700">${label}</span><span style="font-family: var(--head); font-size: 22px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${who}</span><span class="num" style="color: ${fg}">${value}</span></span></div>`;
    return html`<div class="grid" style="--min: 230px">
      ${mvp ? card('MVP', mvp.name, '디스코드 투표', 'var(--t3s)', 'var(--t3)') : ''}
      ${card('최다 킬', topKill.name, `${topKill.kills}킬 · ${roundNos.length}라운드 합계`, 'var(--soft)', 'var(--pink-ink)')}
      ${card('최고 평균 딜량', topDmg.name, `${num(topDmg.dmg / topDmg.games)} / 판`, 'var(--sky-soft)', 'var(--sky-ink)')}
      ${topKs ? card('최다 킬 점수 팀', '팀 ' + topKs.team_no, 'KS ' + score(topKs.ks), 'var(--t1s)', 'var(--t1)') : ''}
    </div>`;
  };

  const playersTable = () => {
    const rows = prounds.filter((r) => r.round_no === tab).sort((a, b) => a.team_rank - b.team_rank || a.team_no - b.team_no);
    return html`<section class="card"><div class="card-head"><h2>선수별 기록</h2><span class="muted" style="font-size: 12px; font-weight: 600">게임에서 저장한 결과 데이터로 자동 입력됐어요</span></div>
      <div class="table-wrap"><table class="data pink" style="min-width: 660px"><thead><tr><th>선수</th><th>팀</th><th>실험체</th><th class="r">킬</th><th class="r">어시</th><th class="r">TK</th><th class="r">딜량</th></tr></thead><tbody>
        ${rows.map((r) => {
          const p = r.player_id ? byId.get(r.player_id) : null;
          return html`<tr><td><span class="flex" style="flex-wrap: nowrap">${tierDot(p?.tier || 3)}<b>${p?.name || r.csv_nickname}</b></span></td><td class="muted" style="font-weight: 600">팀 ${r.team_no} · ${r.team_rank}위</td><td style="font-family: var(--head)">${r.character_name || '-'}</td><td class="r">${r.kills}</td><td class="r">${r.assists}</td><td class="r">${r.team_kills}</td><td class="r">${num(r.damage)}</td></tr>`;
        })}
      </tbody></table></div></section>`;
  };

  const draw = () => mount(main, html`
    <a class="btn ghost" href="/matches" style="justify-self: start">← 내전 기록 목록</a>
    <div class="page-head">
      <div style="display: grid; gap: 8px">
        <span class="chip sky" style="justify-self: start; font-family: var(--head); font-size: 15px; transform: rotate(-2deg)">시즌 ${ev.season}</span>
        <h1>${ev.title}</h1>
        <p class="lead" style="margin: 0">${dateKo(ev.starts_at)} · ${roundNos.length}라운드 · ${standings.length}팀 · ${FORMAT_LABEL[ev.format]} · 합계 = 순위 점수(RS) + 킬 점수(KS) − 처치자 불명 감점 · <a href="/rules" style="font-weight: 700">점수 규정 보기</a></p>
      </div>
      <div class="seg" role="group" aria-label="라운드 선택">
        <button type="button" data-tab="0" aria-pressed="${tab === 0}">누적</button>
        ${roundNos.map((n) => html`<button type="button" data-tab="${n}" aria-pressed="${tab === n}">${n}R</button>`)}
      </div>
    </div>
    ${tab === 0 ? awards() : ''}
    <section class="card"><h2>${tab === 0 ? '누적 순위' : tab + '라운드 순위'}</h2>
      ${standings.length
        ? html`<div class="table-wrap"><table class="data" style="min-width: 700px"><thead><tr><th style="width: 64px">순위</th><th>팀</th><th class="r">순위 점수 (RS)</th><th class="r">킬 점수 (KS)</th><th class="r">감점</th><th class="r">합계</th></tr></thead><tbody>
            ${standingRows().map((s) => html`<tr><td><span class="medal ${medalClass(s.rank)}">${s.rank}</span></td><td><span style="display: grid; gap: 6px"><span style="font-family: var(--head); font-size: 17px">팀 ${s.team}</span>${memberChips(s.team)}</span></td><td class="r">${score(s.rs)}</td><td class="r">${score(s.ks)}</td><td class="r" style="color: ${Number(s.pen) ? 'var(--t3)' : 'var(--muted)'}">${Number(s.pen) ? '−' + score(s.pen) : '0'}</td><td class="r"><span class="num" style="font-size: 18px; background: ${s.rank === 1 ? 'var(--soft)' : s.rank === 2 ? 'var(--sky-soft)' : 'transparent'}; border-radius: 999px; padding: 2px 12px">${score(s.total)}</span></td></tr>`)}
          </tbody></table></div>`
        : html`<p class="empty">아직 확정된 라운드가 없어요.</p>`}
    </section>
    ${tab !== 0 ? playersTable() : ''}
  `);
  on(main, 'click', '[data-tab]', (_e, b) => { tab = Number(b.dataset.tab); draw(); });
  draw();
});
