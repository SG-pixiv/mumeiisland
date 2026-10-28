// 방송 진행판: 라운드 시작 · 끝 버튼 (대시보드 맨 위 카드 · OBS 조종판에서 같이 써요)
import { html, mount, on, toast, errorText } from '../lib/dom.js';
import { select, rpc } from '../lib/db.js';
import { pickLiveEvent, liveOf, nextRoundNo, liveAction, mvpInfo } from '../lib/live.js';
import { liveReady, voteCount } from '../lib/live-api.js';
import { dateKo, timeKo, dateTimeShort } from '../lib/fmt.js';

const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

async function load(pickedId) {
  const [events, rounds, players] = await Promise.all([
    select('events', { order: 'starts_at' }),
    select('rounds', { columns: 'id, event_id, round_no, status, played_at, uploaded_at' }),
    select('players', { columns: 'id, display_name' })
  ]);
  const ready = liveReady(events);
  const auto = pickLiveEvent(events);
  const event = (pickedId && events.find((e) => e.id === pickedId)) || auto;
  if (!event) return { ready, event: null, choices: [] };
  const choices = events.filter((e) => e.status !== 'done' || liveOf(e).state !== 'idle' || e.id === event.id);
  const mvpOpen = event.mvp_vote_status === 'open' && !event.mvp_player_id;
  const [parts, votes] = await Promise.all([
    mvpOpen ? select('event_participants', { eq: { event_id: event.id } }) : [],
    mvpOpen ? voteCount(event.id) : null
  ]);
  const mine = rounds.filter((r) => r.event_id === event.id);
  return {
    ready, event, choices, rounds: mine,
    lastUpload: rounds.map((r) => r.uploaded_at).filter(Boolean).sort().pop() || null,
    mvp: mvpInfo(event, { names: new Map(players.map((p) => [p.id, p.display_name])), voteCount: votes, voters: parts.length })
  };
}

function stateLine(ev) {
  const { state, round, changedAt } = liveOf(ev);
  if (state === 'playing') return html`<span class="live-state playing"><span class="live-dot" aria-hidden="true"></span>${round}라운드 진행 중</span><small class="muted">${changedAt ? hhmm(changedAt) + ' 시작' : ''}</small>`;
  if (state === 'ended') return html`<span class="live-state ended">${round}라운드 끝</span><small class="muted">${changedAt ? hhmm(changedAt) + ' 끝' : ''}</small>`;
  return html`<span class="live-state">꺼짐</span><small class="muted">오버레이에 라운드 표시가 안 떠요</small>`;
}

function mvpLine(m) {
  if (m.kind === 'done') return html`<b>MVP 발표</b> · ${m.name}${m.note ? ` · ${m.note}` : ''}`;
  if (m.kind === 'voting') return html`<b>MVP 투표 중</b> · ${m.count === null ? '인원 확인 전' : `${m.count} / ${m.voters}명 투표`}`;
  return html`<b>MVP 투표 전</b> · 디스코드에서 /mvp 시작`;
}

function view(st, { compact }) {
  const d = st.data;
  if (st.error && !d) return html`<p class="notice warn" style="margin: 0">진행판을 불러오지 못했어요 · ${st.error}</p>`;
  if (!d) return html`<p class="loading" style="margin: 0">진행판 불러오는 중…</p>`;
  if (!d.ready) return html`<div class="live-card"><h2>방송 진행판</h2><p class="notice warn" style="margin: 0">Supabase SQL Editor 에서 <b>20261028100000_overlay.sql</b> (7단계)을 실행하면 라운드 시작 버튼이 생겨요.</p></div>`;
  if (!d.event) return html`<div class="live-card"><h2>방송 진행판</h2><p class="muted" style="margin: 0; font-weight: 600">아직 내전 일정이 없어요. <a href="/admin/schedule">일정 관리</a>에서 만들어 주세요.</p></div>`;
  const ev = d.event;
  const live = liveOf(ev);
  const n = st.round ?? nextRoundNo(ev, d.rounds);
  const busy = st.busy ? 'disabled' : '';
  const picker = d.choices.length > 1
    ? html`<label class="live-pick"><span class="sr-only">방송할 내전</span><select data-live-pick>${d.choices.map((e) => html`<option value="${e.id}" ${e.id === ev.id ? 'selected' : ''}>${e.title} · ${dateKo(e.starts_at, false)}${liveOf(e).state !== 'idle' ? ' (방송 중)' : ''}</option>`)}</select></label>`
    : html`<span class="muted" style="font-weight: 700">${ev.title} · ${dateKo(ev.starts_at, false)} ${timeKo(ev.starts_at)}</span>`;
  const buttons = live.state === 'playing'
    ? html`<button type="button" class="btn sky big live-main" data-live-act="end" ${busy}>${live.round}라운드 끝</button>
        <button type="button" class="btn ghost sm" data-live-act="cancel" ${busy}>시작 취소</button>`
    : html`<span class="live-step" role="group" aria-label="시작할 라운드 번호">
          <button type="button" class="btn sm" data-live-round="-1" aria-label="라운드 번호 하나 줄이기" ${n <= 1 ? 'disabled' : ''}>−</button>
          <span class="num" aria-live="polite">${n}</span>
          <button type="button" class="btn sm" data-live-round="1" aria-label="라운드 번호 하나 늘리기" ${n >= 30 ? 'disabled' : ''}>+</button>
        </span>
        <button type="button" class="btn pink big live-main" data-live-act="start" ${busy}>${n}라운드 시작</button>
        ${live.state === 'ended' ? html`<button type="button" class="btn ghost sm" data-live-act="off" ${busy}>표시 끄기</button>` : ''}`;
  return html`<div class="live-card${compact ? ' compact' : ''}">
    <div class="live-head"><h2>방송 진행판</h2>${picker}</div>
    <div class="live-now">${stateLine(ev)}</div>
    <div class="live-buttons">${buttons}</div>
    <p class="live-hint">게임 결과 파일이 올라오면 자동으로 "끝"으로 바뀌어요${d.lastUpload ? ` · 마지막 업로드 ${dateTimeShort(d.lastUpload)}` : ''}</p>
    <p class="live-mvp">${mvpLine(d.mvp)}</p>
    ${compact ? '' : html`<p class="live-hint" style="margin: 0"><a href="/admin/live" target="_blank" rel="noopener">OBS 조종판 · 오버레이 주소</a></p>`}
  </div>`;
}

/** el 안에 진행판을 그리고 15초마다 새로 고쳐요 (el 이 화면에서 빠지면 멈춰요) */
export function mountLiveControl(el, { compact = false, every = 15000 } = {}) {
  const st = { picked: null, round: null, data: null, busy: false, error: '', key: '' };
  const draw = () => { if (el.isConnected) mount(el, view(st, { compact })); };
  const refresh = async () => {
    try {
      st.data = await load(st.picked);
      st.error = '';
      // 내전이나 상태가 바뀌면 직접 고친 라운드 번호는 버려요
      const ev = st.data.event;
      const key = ev ? `${ev.id}|${ev.live_state}|${ev.live_round}` : '';
      if (key !== st.key) { st.key = key; st.round = null; }
    } catch (e) {
      st.error = errorText(e);
    }
    draw();
  };
  on(el, 'click', '[data-live-round]', (_e, b) => {
    const ev = st.data?.event;
    if (!ev) return;
    const cur = st.round ?? nextRoundNo(ev, st.data.rounds);
    st.round = Math.min(30, Math.max(1, cur + Number(b.dataset.liveRound)));
    draw();
  });
  on(el, 'change', '[data-live-pick]', async (_e, s) => { st.picked = s.value; st.round = null; await refresh(); });
  on(el, 'click', '[data-live-act]', async (_e, b) => {
    const ev = st.data?.event;
    if (!ev || st.busy) return;
    const act = b.dataset.liveAct;
    const n = st.round ?? nextRoundNo(ev, st.data.rounds);
    const next = liveAction(ev, act, n);
    // OBS 조종판에서는 확인 창이 안 떠서 묻지 않고 바로 바꿔요 (다른 내전 표시는 서버에서 꺼져요)
    const other = act === 'start' ? st.data.choices.find((e) => e.id !== ev.id && liveOf(e).state !== 'idle') : null;
    st.busy = true;
    draw();
    try {
      await rpc('set_live', { p_event: ev.id, p_state: next.state, p_round: next.round });
      toast({ start: `${n}라운드 시작! 오버레이에 떠요${other ? ` (${other.title} 표시는 껐어요)` : ''}`, end: `${next.round}라운드 끝으로 바꿨어요`, cancel: '시작을 취소했어요', off: '라운드 표시를 껐어요' }[act]);
    } catch (e) {
      toast(errorText(e), true);
    }
    st.busy = false;
    await refresh();
  });
  const timer = setInterval(() => {
    if (!el.isConnected) { clearInterval(timer); return; }
    if (!st.busy && document.visibilityState !== 'hidden') refresh();
  }, every);
  draw();
  return refresh();
}
