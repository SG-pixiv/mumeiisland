import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText, qs } from '../../lib/dom.js';
import { select, insert, update, upsert, remove } from '../../lib/db.js';
import { loadEvents, loadPlayers, nextEvent } from '../../lib/api.js';
import { num, dateKo, timeKo, FORMAT_LABEL, tierDot, lockIcon } from '../../lib/fmt.js';
import {
  TIERS, MAX_TEAMS, scoreTable, teamPlan, emptyTeams, teamStats, balance, poolFrom, signature,
  draftSequence, draftTeams, recommendPicks, autoFillDraft, captainOrderFromPrev
} from '../../lib/balance.js';

const DRAFT_STATUS = { before: '시작 전', live: '진행 중', done: '완료' };

startAdmin('teams', async (main) => {
  let events = [], players = new Map(), standings = [], prounds = [];
  let parts = [], teamRows = [], draftRow = null;
  const state = {
    eventId: qs('id') || '', busy: false,
    arr: null, locks: new Set(), dirty: false, sel: null, options: 0,   // 자동 편성
    order: [], publicOnStart: true                                       // 드래프트 시작 전 팀장 순서
  };

  // ── 데이터
  const reloadBase = async () => {
    let pl;
    [events, pl, standings, prounds] = await Promise.all([
      loadEvents(), loadPlayers({ includeInactive: true }), select('v_event_standings'),
      select('v_player_rounds', { columns: 'player_id,event_id,team_no' })
    ]);
    players = pl.byId;
    const ids = new Set(events.map((e) => e.id));
    if (!ids.has(state.eventId)) {
      const open = events.filter((e) => e.status !== 'done');
      state.eventId = (nextEvent(events) || open[open.length - 1] || events[events.length - 1])?.id || '';
    }
  };
  const reloadEvent = async () => {
    if (!state.eventId) { parts = []; teamRows = []; draftRow = null; return; }
    let drafts;
    [parts, teamRows, drafts] = await Promise.all([
      select('event_participants', { eq: { event_id: state.eventId } }),
      select('event_teams', { eq: { event_id: state.eventId } }),
      select('drafts', { eq: { event_id: state.eventId } })
    ]);
    draftRow = drafts[0] || null;
  };

  const ev = () => events.find((e) => e.id === state.eventId) || null;
  // 이번 내전 참가자: tier = 이번 내전에서 들어가는 자리 (slot_tier 가 있으면 그것)
  const entrants = () => parts.map((pp) => {
    const p = players.get(pp.player_id);
    if (!p) return null;
    return { id: p.id, p, base: p.tier, tier: pp.slot_tier || p.tier, override: pp.slot_tier || null, score: p.rank?.score ?? null };
  }).filter(Boolean).sort((a, b) => a.tier - b.tier || (b.score ?? -1) - (a.score ?? -1) || a.p.name.localeCompare(b.p.name, 'ko'));
  const scores = () => scoreTable(entrants());
  const valueFn = () => { const t = scores(); return (id) => t.get(id)?.value ?? 0; };
  const nameOf = (id) => players.get(id)?.name || '알 수 없음';

  // 지난 내전(이 내전보다 앞, 확정 기록이 있는 것)에서 각 선수의 팀 순위
  const prevInfo = () => {
    const cur = ev();
    if (!cur) return { event: null, standing: new Map() };
    const played = new Set(standings.map((s) => s.event_id));
    const prev = events.filter((e) => e.id !== cur.id && played.has(e.id) && Date.parse(e.starts_at) < Date.parse(cur.starts_at))
      .sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at))[0];
    if (!prev) return { event: null, standing: new Map() };
    const teamStanding = new Map(standings.filter((s) => s.event_id === prev.id).map((s) => [s.team_no, Number(s.standing)]));
    const votes = new Map();
    prounds.filter((r) => r.event_id === prev.id && r.player_id).forEach((r) => {
      const m = votes.get(r.player_id) || new Map();
      m.set(r.team_no, (m.get(r.team_no) || 0) + 1);
      votes.set(r.player_id, m);
    });
    const standing = new Map();
    votes.forEach((m, pid) => {
      const team = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
      if (teamStanding.has(team)) standing.set(pid, teamStanding.get(team));
    });
    return { event: prev, standing };
  };

  // ── 자동 편성: 저장된 팀 → 화면 배치
  const loadArrangement = () => {
    state.sel = null; state.dirty = false; state.options = 0;
    const list = entrants();
    const plan = teamPlan(list);
    const tierOf = new Map(list.map((x) => [x.id, x.tier]));
    const rows = teamRows.filter((r) => tierOf.get(r.player_id) === r.slot_tier && r.team_no >= 1 && r.team_no <= Math.max(plan.teams, 1));
    if (!rows.length || !plan.teams) { state.arr = null; state.locks = new Set(); return; }
    const arr = emptyTeams(plan.teams);
    rows.forEach((r) => { if (!arr[r.team_no - 1][r.slot_tier]) arr[r.team_no - 1][r.slot_tier] = r.player_id; });
    state.arr = arr;
    state.locks = new Set(rows.filter((r) => r.locked).map((r) => r.player_id));
  };
  // 참가자가 바뀌면 배치에서 맞지 않는 자리를 비워요
  const fitArrangement = () => {
    if (!state.arr) return;
    const list = entrants();
    const plan = teamPlan(list);
    const tierOf = new Map(list.map((x) => [x.id, x.tier]));
    const arr = emptyTeams(plan.teams);
    state.arr.forEach((t, i) => { if (i < plan.teams) TIERS.forEach((k) => { if (t[k] && tierOf.get(t[k]) === k) arr[i][k] = t[k]; }); });
    state.arr = plan.teams ? arr : null;
    const placed = new Set(arr.flatMap((t) => TIERS.map((k) => t[k]).filter(Boolean)));
    state.locks = new Set([...state.locks].filter((id) => placed.has(id)));
  };

  // ── 드래프트 상태
  const draftInfo = () => {
    const list = entrants();
    const captains = (draftRow?.captain_order || []).filter(Boolean);
    const picks = teamRows.filter((r) => r.pick_no).sort((a, b) => a.pick_no - b.pick_no);
    const seq = draftSequence(captains);
    const status = !draftRow || draftRow.status === 'before' || !captains.length ? 'before' : picks.length >= seq.length ? 'done' : 'live';
    const fixed = draftTeams(captains, picks);
    const pool = poolFrom(list, fixed);
    return { captains, picks, seq, status, fixed, pool, cur: status === 'live' ? seq[picks.length] : null };
  };

  // ── 화면 조각
  const memberLine = (id, tier, { lock = null, selectable = false, extra = '' } = {}) => {
    const sc = scores().get(id);
    const p = players.get(id);
    const sel = state.sel === id;
    const body = html`${tierDot(tier)}<span class="info"><b>${p?.name || '알 수 없음'}</b><small>${sc ? `${sc.estimated ? '≈ ' : ''}${num(sc.value)}점${sc.estimated ? ' (기록 없음 · 티어 평균)' : ''}` : ''}${extra ? ` · ${extra}` : ''}</small></span>`;
    return html`<span class="member ${lock ? 'locked' : ''}" style="${sel ? 'outline: 3px solid var(--sky-ink); outline-offset: 1px;' : ''}">
      ${selectable ? html`<button type="button" data-swap="${id}" aria-pressed="${sel}" title="눌러서 고르고, 같은 티어의 다른 선수를 누르면 자리를 맞바꿔요" style="all: unset; display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0; cursor: pointer">${body}</button>` : body}
      ${lock !== null ? html`<button type="button" class="lock ${lock ? 'on' : ''}" data-lock="${id}" aria-pressed="${lock}" aria-label="${p?.name} ${lock ? '잠김 · 눌러서 풀기' : '풀림 · 눌러서 잠그기'}" title="${lock ? '잠김: 다시 돌려도 이 팀에 남아요' : '풀림: 다시 돌리면 자리가 바뀔 수 있어요'}">${lockIcon(lock)}</button>` : ''}
    </span>`;
  };

  const statsLine = (teams) => {
    const st = teamStats(teams, valueFn());
    const full = teams.every((t) => t[1] && t[2] && t[3]);
    return html`<div class="flex" style="gap: 8px">
      <span class="chip ${st.spread <= Math.max(150, st.mean * 0.02) ? 'ok' : 'warn'}">팀 점수 최대 차이 <b class="num">${num(st.spread)}</b>점${full ? '' : ' (빈자리 빼고)'}</span>
      <span class="chip plain">팀 평균 <b class="num">${num(st.mean)}</b>점</span>
    </div>`;
  };

  const participantsCard = (list, plan, lockedIds, collapsed) => {
    const teamOf = new Map(teamRows.map((r) => [r.player_id, r.team_no]));
    const others = [...players.values()].filter((p) => p.active && !parts.some((x) => x.player_id === p.id)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return html`<section class="card"><div class="card-head"><h2>참가자 ${list.length}명</h2>
        <span class="flex" style="gap: 6px">${TIERS.map((t) => html`<span class="tier t${t}" style="padding: 2px 10px; font-size: 13px">${t}티어 <b class="num">${plan.count[t]}</b></span>`)}</span></div>
      ${plan.ok
        ? html`<p class="notice" style="margin: 0">${plan.teams}팀(팀마다 1 · 2 · 3티어 한 명씩)을 만들 수 있어요.</p>`
        : html`<p class="notice warn" style="margin: 0">${plan.problems.join(' · ')}. 참가자를 더하거나 빼고, 필요하면 아래에서 "이번 자리"를 바꿔 주세요.</p>`}
      ${collapsed ? html`<details><summary class="muted" style="cursor: pointer; font-weight: 700">참가자 목록 보기 · 고치기</summary><div class="stack" style="gap: 10px; margin-top: 10px">` : ''}
      <div class="grid" style="--min: 250px; gap: 8px">${list.map((x) => {
        const fixedHere = lockedIds.has(x.id);
        return html`<span class="member" style="gap: 6px">${tierDot(x.tier)}<span class="info"><b>${x.p.name}</b><small>${x.score == null ? '솔로 랭크 기록 없음' : num(x.score) + '점'}${x.override ? ` · 원래 ${x.base}티어` : ''}</small></span>
          ${fixedHere ? html`<small class="chip plain" style="font-size: 12px">팀 ${teamOf.get(x.id)}</small>` : html`<select class="input" data-slot="${x.id}" aria-label="${x.p.name} 이번 내전 티어 자리" style="min-height: 32px; padding: 2px 6px; width: auto; font-size: 13px">
            <option value="">${x.base}티어 (기본)</option>${TIERS.filter((t) => t !== x.base).map((t) => html`<option value="${t}" ${x.override === t ? 'selected' : ''}>이번만 ${t}티어</option>`)}
          </select>
          <button type="button" class="btn sm ghost danger" data-out="${x.id}" aria-label="${x.p.name} 빼기" style="padding: 2px 10px">빼기</button>`}</span>`;
      })}</div>
      <div class="flex" style="gap: 8px">
        <select class="input" data-add-select aria-label="추가할 선수" style="max-width: 280px"><option value="">참가자 추가…</option>${others.map((p) => html`<option value="${p.id}">${p.name} · ${p.tier}티어${p.rank?.score != null ? ` · ${num(p.rank.score)}점` : ''}</option>`)}</select>
        <button type="button" class="btn sm sky" data-add>추가</button>
        <button type="button" class="btn sm ghost" data-add-all ${others.length && !state.busy ? '' : 'disabled'} title="쉬는 중(비활성)인 선수는 빼고 넣어요">활성 선수 전체 추가 (${others.length}명)</button>
        <span class="spacer"></span>
        <small class="muted" style="font-weight: 600">"이번 자리"는 이 내전에서만 바뀌고 선수 티어는 그대로예요.${lockedIds.size ? ' 팀에 들어간 선수는 드래프트를 되돌린 뒤 바꿀 수 있어요.' : ''}</small>
      </div>
      ${collapsed ? html`</div></details>` : ''}
    </section>`;
  };

  const autoView = (list, plan) => {
    const arr = state.arr;
    const placed = new Set(arr ? arr.flatMap((t) => TIERS.map((k) => t[k]).filter(Boolean)) : []);
    const waiting = list.filter((x) => !placed.has(x.id));
    return html`<section class="card ink stack" style="gap: 14px">
      <div class="card-head"><h2>자동 편성</h2>${state.dirty ? html`<span class="chip warn">저장 안 한 변경이 있어요</span>` : arr ? html`<span class="chip ok">저장됨</span>` : ''}</div>
      <p class="muted" style="margin: 0; font-weight: 600">솔로 랭크 점수로 팀 점수(세 명 합)가 가장 고르게 되도록 같은 티어끼리 섞어요. 자물쇠를 잠근 선수는 다시 돌려도 그 팀에 남아요. 선수 이름을 누르고 같은 티어의 다른 선수를 누르면 자리를 맞바꿔요.</p>
      <div class="flex" style="gap: 8px">
        <button type="button" class="btn pink big" data-roll ${plan.ok && !state.busy ? '' : 'disabled'}>${arr ? '다시 돌리기' : '자동 편성 돌리기'}</button>
        ${arr ? html`<button type="button" class="btn sky" data-save-auto ${state.busy ? 'disabled' : ''}>${state.busy ? '저장 중…' : '저장'}</button>
          <button type="button" class="btn ghost" data-unlock-all>자물쇠 모두 풀기</button>
          <span class="spacer"></span><button type="button" class="btn ghost danger" data-clear-auto>편성 비우기</button>` : ''}
      </div>
      ${state.options > 1 ? html`<small class="muted" style="font-weight: 600; margin-top: -6px">비슷하게 고른 배치 ${state.options}가지 중 하나예요. 다시 돌리면 다른 조합이 나와요.</small>` : ''}
      ${arr ? html`${statsLine(arr)}
        ${waiting.length ? html`<p class="notice warn" style="margin: 0">아직 팀에 없는 선수 ${waiting.length}명 (${waiting.slice(0, 4).map((x) => x.p.name).join(', ')}${waiting.length > 4 ? ' …' : ''}). 다시 돌리면 빈자리에 들어가요.</p>` : ''}
        <div class="grid" style="--min: 240px">${arr.map((t, i) => html`<article class="team-card"><div class="head"><b>팀 ${i + 1}</b><span class="num" style="font-size: 18px">${num(teamStats([t], valueFn()).sums[0])}점</span></div>
          ${TIERS.map((k) => (t[k]
            ? memberLine(t[k], k, { lock: state.locks.has(t[k]), selectable: true })
            : html`<span class="member waiting">${tierDot(k)}<span class="info"><b class="muted">빈자리</b><small>${k}티어</small></span></span>`))}
        </article>`)}</div>`
        : html`<p class="empty">${plan.ok ? '"자동 편성 돌리기"를 누르면 팀이 나와요!' : '먼저 위에서 참가자 티어 인원을 맞춰 주세요.'}</p>`}
    </section>`;
  };

  const draftView = (list, plan, d, prev) => {
    const e = ev();
    if (d.status === 'before') {
      const caps = list.filter((x) => x.tier === 1).map((x) => x.id);
      if (state.order.length !== caps.length || state.order.some((id) => !caps.includes(id))) state.order = captainOrderFromPrev(caps, prev.standing);
      return html`<section class="card ink stack" style="gap: 14px">
        <div class="card-head"><h2>드래프트 준비</h2><span class="chip">${DRAFT_STATUS.before}</span></div>
        <p class="muted" style="margin: 0; font-weight: 600">팀장은 1티어예요. 2티어는 위에서부터(지난 내전 꼴찌 팀장부터), 3티어는 아래에서부터(1등 팀장부터) 지명해요. ${prev.event ? `"${prev.event.title}" 순위로 정렬했어요.` : '지난 내전 기록이 없어서 이름 순서예요. 화살표로 바꿔 주세요.'}</p>
        ${state.order.length ? html`<ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 8px">${state.order.map((id, i) => {
          const s = prev.standing.get(id);
          return html`<li class="flex" style="flex-wrap: nowrap; gap: 10px; background: var(--bg); border-radius: 16px; padding: 6px 10px">
            <span class="medal sm">${i + 1}</span>${memberLine(id, 1, { extra: s ? `지난 내전 ${s}위 팀` : '지난 내전 기록 없음' })}
            <span class="flex" style="gap: 4px; flex-wrap: nowrap"><button type="button" class="btn sm ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="${nameOf(id)} 위로">▲</button><button type="button" class="btn sm ghost" data-down="${i}" ${i === state.order.length - 1 ? 'disabled' : ''} aria-label="${nameOf(id)} 아래로">▼</button></span>
          </li>`;
        })}</ol>` : html`<p class="empty">1티어 참가자가 없어요.</p>`}
        <div class="flex" style="gap: 10px">
          <label class="flex" style="gap: 6px; font-weight: 700; font-size: 14px"><input type="checkbox" data-public-start ${state.publicOnStart ? 'checked' : ''}> 공개 페이지에 실시간으로 보여주기</label>
          <span class="spacer"></span>
          ${prev.event ? html`<button type="button" class="btn ghost" data-reset-order>지난 내전 순서로</button>` : ''}
          <button type="button" class="btn pink big" data-start ${plan.ok && !state.busy ? '' : 'disabled'}>드래프트 시작</button>
        </div>
        ${plan.ok ? '' : html`<small class="muted" style="font-weight: 600">참가자 티어 인원을 먼저 맞춰 주세요.</small>`}
      </section>`;
    }

    const value = valueFn();
    const rec = d.cur ? recommendPicks({ fixed: d.fixed, pool: d.pool, value, team: d.cur.team, tier: d.cur.tier }) : [];
    const recBy = new Map(rec.map((r, i) => [r.id, { ...r, rank: i }]));
    const last = d.picks[d.picks.length - 1];
    return html`<section class="card ink stack" style="gap: 14px">
      <div class="card-head"><h2>드래프트</h2><span class="chip ${d.status === 'live' ? 'soft' : 'ok'}">${DRAFT_STATUS[d.status]} · ${d.picks.length} / ${d.seq.length}</span></div>
      ${d.cur ? html`<div class="hero" style="padding: 18px 20px; gap: 12px">
          <div style="display: grid; gap: 6px; flex: 999 1 320px"><span class="sticker">${d.picks.length + 1}번째 지명</span>
            <h2 class="big" style="font-size: 30px">${nameOf(d.cur.captain)} 팀장 · ${d.cur.tier}티어</h2>
            <span style="font-weight: 700">아래에서 고른 선수를 누르면 바로 들어가요. 실수하면 "되돌리기"를 눌러요.</span></div>
        </div>
        <div class="stack" style="gap: 8px"><b style="font-family: var(--head); font-size: 17px; color: var(--t${d.cur.tier})">${d.cur.tier}티어 남은 선수 ${d.pool[d.cur.tier].length}명</b>
          <div class="grid" style="--min: 220px; gap: 8px">${d.pool[d.cur.tier].map((id) => {
            const r = recBy.get(id);
            const sc = scores().get(id);
            return html`<button type="button" class="member" data-pick="${id}" ${state.busy ? 'disabled' : ''} style="cursor: pointer; border: 2px solid ${r?.rank === 0 ? 'var(--sky-ink)' : 'transparent'}; text-align: left; font: inherit">
              ${tierDot(d.cur.tier)}<span class="info"><b>${nameOf(id)}</b><small>${sc?.estimated ? '≈ ' : ''}${num(sc?.value)}점 · 예상 차이 ${num(r?.spread)}</small></span>
              ${r?.rank === 0 ? html`<span class="chip sky" style="font-size: 11px; padding: 0 8px">밸런스 추천</span>` : ''}</button>`;
          })}</div>
          <small class="muted" style="font-weight: 600">"예상 차이"는 이 선수를 뽑고 남은 지명을 가장 고르게 채웠을 때 팀 점수(세 명 합)의 최대 차이예요. 팀장이 고르는 데 참고만 해요.</small>
        </div>` : html`<p class="notice" style="margin: 0">모든 지명이 끝났어요! 공개 페이지에 팀이 떠 있어요.</p>`}
      <div class="flex" style="gap: 8px">
        ${d.cur ? html`<button type="button" class="btn sky" data-pick-rec ${rec.length && !state.busy ? '' : 'disabled'}>추천 선수로 뽑기</button>
          <button type="button" class="btn" data-autofill ${state.busy ? 'disabled' : ''}>남은 지명 자동 채우기</button>` : ''}
        <button type="button" class="btn ghost" data-undo ${last && !state.busy ? '' : 'disabled'}>되돌리기${last ? ` (${nameOf(last.player_id)})` : ''}</button>
        <span class="spacer"></span>
        <button type="button" class="btn ghost danger" data-reset-draft ${state.busy ? 'disabled' : ''}>드래프트 초기화</button>
      </div>
      ${d.cur
        ? html`<div class="flex" style="gap: 8px"><span class="chip sky">추천대로 채우면 예상 최대 차이 <b class="num">${num(rec[0]?.spread)}</b>점</span><span class="chip plain">팀 점수 = 세 명의 솔로 랭크 점수 합</span></div>`
        : statsLine(d.fixed)}
      <div class="grid" style="--min: 240px">${d.captains.map((c, i) => {
        const t = d.fixed[i];
        const isCur = d.cur && d.cur.team === i;
        const pickOf = (k) => d.picks.find((p) => p.team_no === i + 1 && p.slot_tier === k);
        return html`<article class="team-card ${isCur ? 'current' : ''}"><div class="head"><b>${nameOf(c)} 팀</b><small class="muted" style="font-weight: 700">팀 ${i + 1} · <span class="num">${num(teamStats([t], value).sums[0])}</span>점</small></div>
          ${memberLine(c, 1, { extra: '팀장' })}
          ${[2, 3].map((k) => (t[k]
            ? memberLine(t[k], k, { extra: `${pickOf(k)?.pick_no}번 지명${pickOf(k)?.auto_pick ? ' · 자동' : ''}` })
            : html`<span class="member waiting">${tierDot(k)}<span class="info"><b class="muted">대기 중</b><small>${k}티어 지명 전</small></span></span>`))}
        </article>`;
      })}</div>
      ${e && !e.teams_public ? html`<p class="notice warn" style="margin: 0">공개 페이지에 아직 안 보여요. 위의 "공개 페이지에 보여주기"를 켜 주세요.</p>` : ''}
    </section>`;
  };

  const draw = () => {
    const e = ev();
    const sorted = events.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || Date.parse(a.starts_at) - Date.parse(b.starts_at));
    const head = html`<div class="page-head"><div><h1>팀 편성 · 드래프트</h1><p class="lead">자동 편성이나 드래프트로 팀을 짜요. 공개를 켜 두면 공개 팀 편성 페이지에 바로 떠요!</p></div></div>`;
    if (!e) { mount(main, html`${head}<p class="empty">먼저 일정 관리에서 내전을 만들어 주세요.</p>`); return; }
    const list = entrants();
    const plan = teamPlan(list);
    const d = e.format === 'draft' ? draftInfo() : null;
    const lockedIds = new Set(d && d.status !== 'before' ? teamRows.map((r) => r.player_id) : []);
    mount(main, html`${head}
      <section class="card" style="gap: 12px">
        <div class="form-grid" style="align-items: end">
          <label class="field">내전 <select data-event>${sorted.map((x) => html`<option value="${x.id}" ${x.id === e.id ? 'selected' : ''}>${x.status === 'done' ? '(지난) ' : ''}${x.title} · ${FORMAT_LABEL[x.format]}</option>`)}</select></label>
          <span class="field">편성 방식 <span class="flex" style="gap: 6px" role="group" aria-label="편성 방식">${['auto', 'draft'].map((f) => html`<button type="button" class="btn sm ${e.format === f ? 'pink' : 'ghost'}" data-format="${f}" aria-pressed="${e.format === f}">${FORMAT_LABEL[f]}</button>`)}</span></span>
          <label class="flex" style="gap: 8px; font-weight: 700; font-size: 14px; min-height: 44px"><input type="checkbox" data-public ${e.teams_public ? 'checked' : ''}> 공개 페이지에 보여주기</label>
        </div>
        <span class="flex" style="gap: 8px"><small class="muted" style="font-weight: 600">${dateKo(e.starts_at)} ${timeKo(e.starts_at)} · 최대 ${e.max_players}명 · 팀은 ${MAX_TEAMS}개까지</small><span class="spacer"></span><a href="/draft?id=${e.id}" target="_blank" rel="noopener" style="font-size: 14px; font-weight: 700">공개 팀 편성 페이지 보기</a></span>
      </section>
      ${participantsCard(list, plan, lockedIds, !!d && d.status !== 'before')}
      ${e.format === 'draft' ? draftView(list, plan, d, prevInfo()) : autoView(list, plan)}`);
  };

  const run = async (fn, okMsg) => {
    state.busy = true; draw();
    try { await fn(); if (okMsg) toast(okMsg); } catch (err) { toast(errorText(err), true); }
    state.busy = false;
    await reloadEvent();
    draw();
  };
  const switchEvent = async (id) => {
    state.eventId = id; state.order = [];
    history.replaceState(null, '', `/admin/teams?id=${encodeURIComponent(id)}`);
    await reloadEvent(); loadArrangement(); draw();
  };

  // ── 내전 · 방식 · 공개
  on(main, 'change', '[data-event]', async (_e, el) => {
    if (state.dirty && !confirm('저장 안 한 편성이 있어요. 다른 내전으로 갈까요?')) { el.value = state.eventId; return; }
    await switchEvent(el.value);
  });
  on(main, 'click', '[data-format]', async (_e, b) => {
    const e = ev();
    if (!e || e.format === b.dataset.format) return;
    if (teamRows.length && !confirm('이미 저장된 팀이 있어요. 방식을 바꾸면 다시 짜야 할 수 있어요. 바꿀까요?')) return;
    try { await update('events', { format: b.dataset.format }, { id: e.id }); e.format = b.dataset.format; loadArrangement(); draw(); toast(`${FORMAT_LABEL[e.format]} 방식으로 바꿨어요.`); } catch (err) { toast(errorText(err), true); }
  });
  on(main, 'change', '[data-public]', async (_e, el) => {
    const e = ev();
    try { await update('events', { teams_public: el.checked }, { id: e.id }); e.teams_public = el.checked; draw(); toast(el.checked ? '공개 팀 편성 페이지에 보여요.' : '공개 페이지에서 숨겼어요.'); } catch (err) { el.checked = !el.checked; toast(errorText(err), true); }
  });

  // ── 참가자
  on(main, 'click', '[data-add]', async () => {
    const id = main.querySelector('[data-add-select]')?.value;
    if (!id) return toast('추가할 선수를 골라 주세요.', true);
    await run(async () => { await insert('event_participants', { event_id: state.eventId, player_id: id }); }, `${nameOf(id)} 님을 넣었어요.`);
    fitArrangement(); draw();
  });
  on(main, 'click', '[data-add-all]', async () => {
    const e = ev();
    const others = [...players.values()].filter((p) => p.active && !parts.some((x) => x.player_id === p.id));
    if (!others.length) return toast('더 넣을 활성 선수가 없어요.');
    const total = parts.length + others.length;
    const msg = total > e.max_players
      ? `${others.length}명을 넣으면 ${total}명이 돼서 최대 인원(${e.max_players}명)을 넘어요. 그래도 다 넣을까요?`
      : `활성 선수 ${others.length}명을 모두 참가자로 넣을까요? (모두 ${total}명)`;
    if (!confirm(msg)) return;
    await run(async () => {
      await insert('event_participants', others.map((p) => ({ event_id: state.eventId, player_id: p.id })));
    }, `${others.length}명을 넣었어요. 이제 ${total}명이에요.`);
    fitArrangement(); draw();
  });
  on(main, 'click', '[data-out]', async (_e, b) => {
    const id = b.dataset.out;
    await run(async () => {
      await remove('event_participants', { event_id: state.eventId, player_id: id });
      await remove('event_teams', { event_id: state.eventId, player_id: id });   // 저장된 팀에서도 빼요
    }, `${nameOf(id)} 님을 뺐어요.`);
    fitArrangement(); if (state.arr) state.dirty = true; draw();
  });
  on(main, 'change', '[data-slot]', async (_e, el) => {
    const id = el.dataset.slot;
    const v = el.value ? Number(el.value) : null;
    await run(async () => {
      try { await update('event_participants', { slot_tier: v }, { event_id: state.eventId, player_id: id }); }
      catch (err) { throw /slot_tier/.test(errorText(err)) ? new Error('먼저 5단계 SQL(이번 내전만 티어 자리 바꾸기)을 SQL Editor 에서 실행해 주세요.') : err; }
    }, v ? `${nameOf(id)} 님은 이번 내전에서 ${v}티어 자리로 들어가요.` : `${nameOf(id)} 님을 원래 티어 자리로 돌렸어요.`);
    fitArrangement(); if (state.arr) state.dirty = true; draw();
  });

  // ── 자동 편성
  on(main, 'click', '[data-roll]', () => {
    const list = entrants();
    const plan = teamPlan(list);
    if (!plan.ok) return toast(plan.problems[0], true);
    const fixed = emptyTeams(plan.teams);
    if (state.arr) state.arr.forEach((t, i) => TIERS.forEach((k) => { if (t[k] && state.locks.has(t[k]) && i < plan.teams) fixed[i][k] = t[k]; }));
    const r = balance({ fixed, pool: poolFrom(list, fixed), value: valueFn(), shuffleGood: !!state.arr, avoid: state.arr });
    const same = state.arr && signature(r.teams) === signature(state.arr);
    state.arr = r.teams; state.options = r.options; state.dirty = true; state.sel = null;
    draw();
    if (same) toast('잠긴 선수가 많아서 지금이 가장 고른 배치예요. 자물쇠를 몇 개 풀고 다시 돌려 보세요.');
  });
  on(main, 'click', '[data-lock]', (_e, b) => {
    const id = b.dataset.lock;
    if (state.locks.has(id)) state.locks.delete(id); else state.locks.add(id);
    state.dirty = true; draw();
  });
  on(main, 'click', '[data-unlock-all]', () => { state.locks = new Set(); state.dirty = true; draw(); });
  on(main, 'click', '[data-swap]', (_e, b) => {
    const id = b.dataset.swap;
    if (!state.sel || state.sel === id) { state.sel = state.sel === id ? null : id; draw(); return; }
    const find = (pid) => { for (let i = 0; i < state.arr.length; i++) for (const k of TIERS) if (state.arr[i][k] === pid) return [i, k]; return null; };
    const a = find(state.sel), c = find(id);
    if (!a || !c || a[1] !== c[1]) { state.sel = id; draw(); return toast('같은 티어끼리만 맞바꿀 수 있어요. 방금 누른 선수를 골랐어요.'); }
    if (a[0] === c[0]) { state.sel = id; draw(); return; }
    state.arr[a[0]][a[1]] = id; state.arr[c[0]][c[1]] = state.sel;
    toast(`${nameOf(state.sel)} ↔ ${nameOf(id)} 자리를 바꿨어요.`);
    state.sel = null; state.dirty = true; draw();
  });
  on(main, 'click', '[data-save-auto]', async () => {
    const rows = [];
    state.arr.forEach((t, i) => TIERS.forEach((k) => { if (t[k]) rows.push({ event_id: state.eventId, player_id: t[k], team_no: i + 1, slot_tier: k, locked: state.locks.has(t[k]), pick_no: null, auto_pick: false }); }));
    await run(async () => {
      await remove('event_teams', { event_id: state.eventId });
      if (rows.length) await insert('event_teams', rows);
      if (draftRow) await remove('drafts', { event_id: state.eventId });
    }, ev()?.teams_public ? '저장했어요! 공개 팀 편성 페이지에 반영됐어요.' : '저장했어요. 공개하려면 "공개 페이지에 보여주기"를 켜 주세요.');
    loadArrangement(); draw();
  });
  on(main, 'click', '[data-clear-auto]', async () => {
    if (!confirm('이 내전의 팀 편성을 비울까요? 저장된 팀도 지워져요.')) return;
    await run(async () => { await remove('event_teams', { event_id: state.eventId }); }, '편성을 비웠어요.');
    loadArrangement(); draw();
  });

  // ── 드래프트
  on(main, 'click', '[data-up]', (_e, b) => { const i = Number(b.dataset.up); [state.order[i - 1], state.order[i]] = [state.order[i], state.order[i - 1]]; draw(); });
  on(main, 'click', '[data-down]', (_e, b) => { const i = Number(b.dataset.down); [state.order[i + 1], state.order[i]] = [state.order[i], state.order[i + 1]]; draw(); });
  on(main, 'click', '[data-reset-order]', () => { state.order = []; draw(); });
  on(main, 'change', '[data-public-start]', (_e, el) => { state.publicOnStart = el.checked; });
  on(main, 'click', '[data-start]', async () => {
    const plan = teamPlan(entrants());
    if (!plan.ok) return toast(plan.problems[0], true);
    if (teamRows.length && !confirm('이미 저장된 팀 편성이 있어요. 지우고 드래프트를 시작할까요?')) return;
    const order = state.order.slice();
    await run(async () => {
      await remove('event_teams', { event_id: state.eventId });
      await insert('event_teams', order.map((id, i) => ({ event_id: state.eventId, player_id: id, team_no: i + 1, slot_tier: 1, locked: true, pick_no: null, auto_pick: false })));
      await upsert('drafts', { event_id: state.eventId, captain_order: order, status: 'live', updated_at: new Date().toISOString() }, ['event_id']);
      if (state.publicOnStart && !ev().teams_public) { await update('events', { teams_public: true }, { id: state.eventId }); ev().teams_public = true; }
    }, `드래프트를 시작했어요! 첫 지명은 ${nameOf(order[0])} 팀장이에요.`);
  });
  const pickPlayer = async (id, auto) => {
    const d = draftInfo();
    if (!d.cur) return;
    const step = d.picks.length;
    await run(async () => {
      await insert('event_teams', { event_id: state.eventId, player_id: id, team_no: d.cur.team + 1, slot_tier: d.cur.tier, locked: true, pick_no: step + 1, auto_pick: auto });
      await update('drafts', { status: step + 1 >= d.seq.length ? 'done' : 'live', updated_at: new Date().toISOString() }, { event_id: state.eventId });
    }, `${nameOf(d.cur.captain)} 팀장 → ${nameOf(id)}${step + 1 >= d.seq.length ? ' · 드래프트 끝!' : ''}`);
  };
  on(main, 'click', '[data-pick]', (_e, b) => pickPlayer(b.dataset.pick, false));
  on(main, 'click', '[data-pick-rec]', () => {
    const d = draftInfo();
    if (!d.cur) return;
    const [best] = recommendPicks({ fixed: d.fixed, pool: d.pool, value: valueFn(), team: d.cur.team, tier: d.cur.tier });
    if (best) pickPlayer(best.id, true);
  });
  on(main, 'click', '[data-autofill]', async () => {
    const d = draftInfo();
    const fill = autoFillDraft({ captains: d.captains, picks: d.picks, pool: d.pool, value: valueFn() });
    if (!fill.length) return;
    if (!confirm(`남은 지명 ${fill.length}번을 밸런스에 맞춰 자동으로 채울까요? 되돌리기로 하나씩 취소할 수 있어요.`)) return;
    await run(async () => {
      await insert('event_teams', fill.map((f, k) => ({ event_id: state.eventId, player_id: f.id, team_no: f.team + 1, slot_tier: f.tier, locked: true, pick_no: d.picks.length + k + 1, auto_pick: true })));
      await update('drafts', { status: 'done', updated_at: new Date().toISOString() }, { event_id: state.eventId });
    }, '남은 지명을 채웠어요. 드래프트 끝!');
  });
  on(main, 'click', '[data-undo]', async () => {
    const d = draftInfo();
    const last = d.picks[d.picks.length - 1];
    if (!last) return;
    await run(async () => {
      await remove('event_teams', { event_id: state.eventId, player_id: last.player_id });
      await update('drafts', { status: 'live', updated_at: new Date().toISOString() }, { event_id: state.eventId });
    }, `${nameOf(last.player_id)} 지명을 되돌렸어요.`);
  });
  on(main, 'click', '[data-reset-draft]', async () => {
    if (!confirm('드래프트를 처음부터 다시 할까요? 팀장 순서와 지명이 모두 지워져요.')) return;
    await run(async () => {
      await remove('event_teams', { event_id: state.eventId });
      await remove('drafts', { event_id: state.eventId });
    }, '드래프트를 초기화했어요.');
    state.order = []; draw();
  });

  // ── 시작
  await reloadBase();
  await reloadEvent();
  loadArrangement();
  draw();
});
