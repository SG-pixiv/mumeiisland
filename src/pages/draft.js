import { startPublic } from '../components/shell.js';
import { html, mount, qs } from '../lib/dom.js';
import { loadTeamsBoard } from '../lib/api.js';
import { dateKo, timeKo, FORMAT_LABEL, tierDot, lockIcon } from '../lib/fmt.js';

startPublic('draft', async (main) => {
  const eventId = qs('id');

  const render = async () => {
    const b = await loadTeamsBoard(eventId);
    const ev = b.event;
    if (!ev) {
      mount(main, html`<div class="page-head"><div><h1>팀 편성</h1><p class="lead">아직 잡힌 내전이 없어요. 일정이 생기면 여기서 팀 편성을 볼 수 있어요!</p></div></div>`);
      return null;
    }
    const head = html`<div class="page-head"><div>
      <h1>팀 편성 <span class="chip sky" style="font-family: var(--head); font-size: 17px">${ev.title}</span></h1>
      <p class="lead">운영진이 팀을 짜면 여기에 바로바로 떠요! 새로고침 안 해도 된답니다.</p></div>
      <span class="chip soft" style="font-family: var(--head); font-size: 15px">${FORMAT_LABEL[ev.format]} 방식</span></div>`;

    if (!ev.teams_public || !b.teams.length) {
      mount(main, html`${head}<section class="hero sky"><div style="display: grid; gap: 10px">
        <span class="sticker">준비 중</span><h2 class="big">${dateKo(ev.starts_at)} ${timeKo(ev.starts_at)}</h2>
        <p style="margin: 0; font-weight: 700">아직 팀을 공개하지 않았어요. 운영진이 ${ev.format === 'draft' ? '드래프트를 시작하면' : '편성을 확정하면'} 여기에 바로 뜰 거예요!</p></div></section>`);
      return null;
    }
    const P = b.byId;
    const memberRow = (id, tier, extra = '') => {
      const p = P.get(id);
      return html`<span class="member ${extra}">${tierDot(tier)}<span class="info"><b>${p?.name || '알 수 없음'}</b><small>${p?.rank?.top?.slice(0, 2).join(' · ') || p?.role || ''}</small></span></span>`;
    };

    if (ev.format === 'auto') {
      const teams = new Map();
      b.teams.forEach((t) => { if (!teams.has(t.team_no)) teams.set(t.team_no, []); teams.get(t.team_no).push(t); });
      const locked = b.teams.filter((t) => t.locked).length;
      mount(main, html`${head}
        <section class="hero sky" aria-live="polite">
          <div style="flex: 999 1 380px; display: grid; gap: 10px"><span class="sticker">자동 편성 완료</span><h2 class="big">팀 밸런스 맞추기 완료!</h2><p style="margin: 0; font-weight: 700">솔로 랭크 점수를 기준으로, 같은 티어끼리만 섞어서 밸런스를 맞췄답니다!</p></div>
          <div class="card" style="flex: 1 1 240px; border: 2px solid var(--ink); box-shadow: none; gap: 8px">
            <span class="flex" style="justify-content: space-between; font-weight: 700"><span class="flex"><span class="lock on" aria-hidden="true" style="width: 26px; height: 26px">${lockIcon(true)}</span>잠김 · 자리 고정</span><b class="num" style="font-size: 20px">${locked}명</b></span>
            <span class="flex" style="justify-content: space-between; font-weight: 700"><span class="flex"><span class="lock" aria-hidden="true" style="width: 26px; height: 26px">${lockIcon(false)}</span>풀림 · 자동 배정</span><b class="num" style="font-size: 20px">${b.teams.length - locked}명</b></span>
          </div>
        </section>
        <p class="muted" style="margin: 0; font-weight: 600">1~3티어는 운영진이 정하고, 밸런스는 솔로 랭크 점수로 맞춰요. 팀마다 1·2·3티어가 한 명씩 들어가고, 자물쇠가 잠긴 생존자는 운영진이 자리를 정해 둔 거랍니다.</p>
        <div class="grid">${[...teams.entries()].sort((a, c) => a[0] - c[0]).map(([no, list]) => html`<article class="team-card"><div class="head"><b>팀 ${no}</b></div>
          ${list.sort((x, y) => x.slot_tier - y.slot_tier).map((t) => {
            const p = P.get(t.player_id);
            return html`<span class="member ${t.locked ? 'locked' : ''}">${tierDot(t.slot_tier)}<span class="info"><b>${p?.name || '알 수 없음'}</b><small>${p?.rank?.top?.slice(0, 2).join(' · ') || p?.role || ''}</small></span><span class="lock ${t.locked ? 'on' : ''}" role="img" aria-label="${t.locked ? '잠김 · 자리 고정' : '풀림 · 자동 배정'}" title="${t.locked ? '잠김 · 자리 고정' : '풀림 · 자동 배정'}">${lockIcon(t.locked)}</span></span>`;
          })}</article>`)}</div>`);
      return null;
    }

    // ── 드래프트
    const captains = b.draft?.captain_order?.length ? b.draft.captain_order : b.teams.filter((t) => t.slot_tier === 1).sort((x, y) => x.team_no - y.team_no).map((t) => t.player_id);
    const seq = captains.map((c) => ({ c, tier: 2 })).concat(captains.slice().reverse().map((c) => ({ c, tier: 3 })));
    const picks = b.teams.filter((t) => t.pick_no).sort((x, y) => x.pick_no - y.pick_no);
    const status = b.draft?.status || (picks.length >= seq.length ? 'done' : picks.length ? 'live' : 'before');
    const cur = status === 'live' ? seq[picks.length] : null;
    const teamOf = new Map(b.teams.filter((t) => t.slot_tier === 1).map((t) => [t.player_id, t.team_no]));
    const pickFor = new Map(picks.map((t) => [`${captains.find((c) => teamOf.get(c) === t.team_no)}-${t.slot_tier}`, t]));
    const taken = new Set(b.teams.map((t) => t.player_id));
    const last = picks[picks.length - 1];
    const nameOf = (id) => P.get(id)?.name || '알 수 없음';

    const heroTitle = status === 'done' ? '와아! 모든 팀이 정해졌어요' : status === 'live' && cur ? `${nameOf(cur.c)} 팀장 차례예요!` : `${dateKo(ev.starts_at)} ${timeKo(ev.starts_at)} 시작!`;
    const heroSub = status === 'done' ? `${dateKo(ev.starts_at)} ${timeKo(ev.starts_at)}에 1라운드 시작! 팀 구성은 아래에서 확인해 주세요.`
      : status === 'live' && cur ? `${cur.tier}티어에서 한 명 고르는 중 · ${picks.length + 1} / ${seq.length}번째 지명`
      : `팀장 ${captains.length}명 · 지명 ${seq.length}번${captains[0] ? ` · 첫 지명은 지난 내전 꼴찌 팀장 ${nameOf(captains[0])}부터예요.` : ''}`;
    const slotView = (j) => {
      const s = seq[j];
      const done = j < picks.length, now = status === 'live' && j === picks.length;
      return html`<span class="chip" style="font-size: 12px; padding: 1px 10px; background: ${now ? 'var(--pink)' : done ? 'var(--soft)' : 'var(--card)'}; border-color: ${now ? 'var(--ink)' : 'var(--line)'}; color: ${done ? 'var(--muted)' : 'var(--ink)'}"><b class="num">${j + 1}</b> ${nameOf(s.c)}${done ? ' → ' + nameOf(picks[j].player_id) : ''}</span>`;
    };
    const pool = (tier) => b.participants.filter((p) => p.tier === tier && !taken.has(p.id));

    mount(main, html`${head}
      <section class="hero ${status === 'live' ? '' : 'sky'}" aria-live="polite">
        <div style="flex: 999 1 380px; display: grid; gap: 10px">
          <span class="sticker">${status === 'live' ? html`<span class="live" style="border: none; padding: 0">드래프트 진행 중</span>` : status === 'done' ? '편성 완료' : '시작 전'}</span>
          <h2 class="big" style="font-size: 38px">${heroTitle}</h2><p style="margin: 0; font-weight: 700">${heroSub}</p>
        </div>
        ${last ? html`<div class="card" style="flex: 1 1 260px; border: 2px solid var(--ink); box-shadow: none; gap: 4px"><span class="muted" style="font-size: 12px; font-weight: 700">방금 지명</span><span style="font-family: var(--head); font-size: 20px">${nameOf(captains.find((c) => teamOf.get(c) === last.team_no))} → ${nameOf(last.player_id)}</span><span class="muted" style="font-size: 13px; font-weight: 600">${last.slot_tier}티어${last.auto_pick ? ' · 밸런스 자동' : ''}</span></div>` : ''}
      </section>
      <section class="card"><div class="card-head"><h2>지명 순서</h2><span class="muted" style="font-size: 13px; font-weight: 600">팀장은 1티어 · 2티어는 지난 내전 꼴찌 팀장부터 · 3티어는 1등 팀장부터</span></div>
        <div class="flex"><span style="width: 82px; font-family: var(--head); color: var(--t2)">2티어 지명</span>${captains.map((_, j) => slotView(j))}</div>
        <div class="flex"><span style="width: 82px; font-family: var(--head); color: var(--t3)">3티어 지명</span>${captains.map((_, j) => slotView(captains.length + j))}</div>
      </section>
      <div class="grid">${captains.map((c) => {
        const isCur = cur && cur.c === c;
        const t2 = pickFor.get(`${c}-2`), t3 = pickFor.get(`${c}-3`);
        return html`<article class="team-card ${isCur ? 'current' : ''}"><div class="head"><b>${nameOf(c)} 팀</b><small class="muted" style="font-weight: 700; color: ${isCur ? 'var(--pink-ink)' : ''}">${isCur ? '지금 고르는 중!' : '팀 ' + (teamOf.get(c) || '')}</small></div>
          ${memberRow(c, 1, 'locked')}
          ${t2 ? memberRow(t2.player_id, 2) : html`<span class="member waiting">${tierDot(2)}<span class="info"><b class="muted">대기 중</b><small>2티어 지명 전</small></span></span>`}
          ${t3 ? memberRow(t3.player_id, 3) : html`<span class="member waiting">${tierDot(3)}<span class="info"><b class="muted">대기 중</b><small>3티어 지명 전</small></span></span>`}
        </article>`;
      })}</div>
      <div class="row">
        <section class="card grow"><h2>아직 안 뽑힌 생존자</h2>
          ${[2, 3].map((t) => { const list = pool(t); return html`<div class="stack" style="gap: 8px"><span style="font-family: var(--head); font-size: 16px; color: var(--t${t})">${t}티어 <b class="num">${list.length}</b>명</span>
            ${list.length ? html`<div class="flex" style="gap: 6px">${list.map((p) => html`<a href="/player?id=${p.id}" style="display: grid; text-decoration: none; color: var(--ink); background: var(--t${t}s); border-radius: 16px; padding: 4px 12px"><b style="font-size: 14px">${p.name}</b><small class="muted" style="font-size: 11px; font-weight: 600">${p.rank?.top?.slice(0, 2).join(' · ') || p.role}</small></a>`)}</div>` : html`<span class="muted" style="font-size: 13px; font-weight: 600">전부 뽑혔어요!</span>`}</div>`; })}
        </section>
        <section class="card side"><h2>지명 로그</h2>
          ${picks.length ? html`<ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 6px">${picks.slice().reverse().slice(0, 8).map((t) => html`<li class="flex" style="flex-wrap: nowrap; background: var(--bg); border-radius: 14px; padding: 6px 10px; font-size: 14px"><span class="medal sm">${t.pick_no}</span><span class="spacer" style="flex: 1 1 auto"><b>${nameOf(captains.find((c) => teamOf.get(c) === t.team_no))}</b> 팀장 → <b style="color: var(--t${t.slot_tier})">${nameOf(t.player_id)}</b></span>${t.auto_pick ? html`<span class="chip sky plain" style="font-size: 11px">밸런스 자동</span>` : ''}</li>`)}</ol>`
            : html`<p class="muted" style="margin: 0; font-weight: 600">아직 로그가 비어 있어요. 시작하면 여기에 차곡차곡 쌓일 거예요!</p>`}
        </section>
      </div>`);
    return status;
  };

  const status = await render();
  // 드래프트가 진행 중이면 10초마다 새로 불러와요
  if (status === 'live' || status === 'before') {
    setInterval(() => { render().catch(() => {}); }, 10000);
  }
});
