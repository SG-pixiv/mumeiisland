import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText } from '../../lib/dom.js';
import { rpc } from '../../lib/db.js';
import { loadPlayers } from '../../lib/api.js';
import { num, pct, score } from '../../lib/fmt.js';

startAdmin('tiers', async (main) => {
  let players = [];
  let changes = new Map();
  let memo = '';
  let saving = false;

  const reload = async () => { players = (await loadPlayers()).list; changes = new Map(); };

  const draw = () => {
    const counts = [1, 2, 3].map((t) => players.filter((p) => (changes.get(p.id) ?? p.tier) === t).length);
    mount(main, html`
      <div><h1>티어 관리</h1><p class="lead">1~3티어는 운영진만 정할 수 있어요! 시스템이 알아서 바꾸는 일은 없고, 바꾼 티어는 다음 편성이랑 드래프트부터 적용된답니다.</p></div>
      <div class="flex">
        <span class="chip soft">티어 결정 · 운영진 직접</span>
        <span class="chip sky">자동 편성 밸런스 · 솔로 랭크 점수</span>
        <span class="chip">1티어 <b class="num">${counts[0]}</b> · 2티어 <b class="num">${counts[1]}</b> · 3티어 <b class="num">${counts[2]}</b></span>
      </div>
      <section class="card"><div class="card-head"><h2>티어 정할 때 참고할 데이터</h2><span class="muted" style="font-size: 12px; font-weight: 600">솔로 랭크 점수는 이리 API · 내전 지표는 최근 30일</span></div>
        ${players.length ? html`<div class="table-wrap"><table class="data" style="min-width: 840px"><thead><tr><th>선수</th><th>밸런스 티어</th><th class="r">솔로 랭크 점수</th><th class="r">내전 경기</th><th class="r">내전 승률</th><th class="r">평균 순위</th><th class="r">평균 TK</th><th class="r">평균 점수</th></tr></thead><tbody>
          ${players.map((p) => {
            const cur = changes.get(p.id) ?? p.tier;
            const changed = cur !== p.tier;
            const s = p.recent.games ? p.recent : p.all;
            return html`<tr class="${changed ? 'changed' : ''}">
              <td><span style="display: grid"><b>${p.name}</b><small style="font-weight: 700; color: ${changed ? 'var(--pink-ink)' : 'var(--muted)'}">${changed ? p.tier + '티어에서 변경' : p.rank?.score == null ? '솔로 랭크 기록 없음' : ''}</small></span></td>
              <td><span role="group" aria-label="${p.name} 밸런스 티어" class="flex" style="gap: 6px; flex-wrap: nowrap">${[1, 2, 3].map((t) => html`<button type="button" data-tier="${t}" data-player="${p.id}" aria-pressed="${cur === t}" aria-label="${t}티어" class="tier t${t}" style="width: 44px; height: 38px; font-size: 16px; cursor: pointer; border: 2px solid ${cur === t ? 'currentColor' : 'var(--line)'}; ${cur === t ? 'box-shadow: 0 3px 0 currentColor' : 'background: var(--card); color: var(--muted)'}">${t}</button>`)}</span></td>
              <td class="r" style="color: ${p.rank?.score == null ? 'var(--muted)' : 'var(--ink)'}">${p.rank?.score == null ? '기록 없음' : num(p.rank.score)}</td>
              <td class="r">${s.games}</td><td class="r">${pct(s.wins, s.games)}</td><td class="r">${num(s.avgRank, 1)}</td><td class="r">${num(s.avgTk, 1)}</td><td class="r">${s.games ? score(s.avgTotal) : '-'}</td>
            </tr>`;
          })}
        </tbody></table></div>` : html`<p class="empty">선수 관리에서 선수를 먼저 추가해 주세요.</p>`}
        <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">솔로 랭크 기록이 없는 생존자는 자동 편성 때 같은 티어 평균 점수로 계산해요. 점수가 바뀌어도 티어는 그대로랍니다.</p>
      </section>
      <section class="card ink" style="grid-template-columns: minmax(0, 1fr) auto auto; align-items: end; gap: 12px">
        <label class="field"><span style="font-family: var(--head); font-size: 18px; font-weight: 400">${changes.size ? changes.size + '명의 티어를 바꿨어요' : '바뀐 티어가 없어요'}</span>
          <span class="muted">변경 메모 (선수 상세의 티어 기록에 남아요)</span><input data-memo value="${memo}" placeholder="예: 최근 내전 활약 반영"></label>
        <button class="btn" type="button" data-reset>되돌리기</button>
        <button class="btn pink" type="button" data-save ${!changes.size || saving ? 'disabled' : ''}>${saving ? '저장 중…' : '변경 저장'}</button>
      </section>`);
  };

  on(main, 'click', '[data-tier]', (_e, b) => {
    const p = players.find((x) => x.id === b.dataset.player);
    const t = Number(b.dataset.tier);
    if (t === p.tier) changes.delete(p.id); else changes.set(p.id, t);
    draw();
  });
  on(main, 'input', '[data-memo]', (e) => { memo = e.target.value; });
  on(main, 'click', '[data-reset]', () => { changes = new Map(); draw(); });
  on(main, 'click', '[data-save]', async () => {
    saving = true; draw();
    try {
      for (const [id, t] of changes) await rpc('set_player_tier', { p_player: id, p_tier: t, p_memo: memo });
      toast('저장 완료! 다음 편성부터 적용돼요.');
      memo = '';
      await reload();
    } catch (e) {
      toast('저장하지 못했어요: ' + errorText(e), true);
    }
    saving = false;
    draw();
  });

  await reload();
  draw();
});
