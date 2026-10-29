import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText } from '../../lib/dom.js';
import { select, insert, update, remove } from '../../lib/db.js';
import { loadEvents, loadPlayers } from '../../lib/api.js';
import { STATUS_LABEL, FORMAT_LABEL, dateKo, tierDot } from '../../lib/fmt.js';

const pad = (n) => String(n).padStart(2, '0');
const localDate = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const localTime = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

startAdmin('schedule', async (main) => {
  let events = [], players = [], parts = [];
  const state = { sel: null, form: null, busy: false };

  const reload = async () => {
    [events, { list: players }, parts] = await Promise.all([loadEvents(), loadPlayers(), select('event_participants')]);
  };
  const toForm = (e) => ({ id: e.id, title: e.title, date: localDate(e.starts_at), time: localTime(e.starts_at), season: e.season, format: e.format, rounds: e.planned_rounds, max: e.max_players, status: e.status, code: e.setting_code || '', memo: e.memo || '', teamsPublic: e.teams_public, mvp: e.mvp_player_id || '' });
  const blank = () => {
    const last = events[events.length - 1];
    const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); // 다음 토요일
    return { id: null, title: '', date: localDate(d), time: '20:00', season: last?.season || 1, format: 'draft', rounds: 4, max: 24, status: 'plan', code: '', memo: '', teamsPublic: false, mvp: '' };
  };

  const draw = () => {
    const f = state.form;
    const sorted = events.slice().sort((a, b) => (a.status === 'done') - (b.status === 'done') || new Date(a.starts_at) - new Date(b.starts_at));
    const joined = f?.id ? parts.filter((p) => p.event_id === f.id).map((p) => players.find((x) => x.id === p.player_id)).filter(Boolean) : [];
    const bench = players.filter((p) => !joined.some((j) => j.id === p.id));
    mount(main, html`
      <div class="page-head"><div><h1>일정 관리</h1><p class="lead">여기서 바꾼 일정은 공개 일정이랑 홈 화면에 바로 반영된답니다!</p></div><button class="btn pink" type="button" data-new>새 내전 추가</button></div>
      <div class="row">
        <section class="side stack" style="flex-basis: 280px"><h2 style="font-family: var(--head); font-size: 20px">내전 목록</h2>
          ${sorted.length ? sorted.map((e) => html`<button type="button" data-pick="${e.id}" aria-pressed="${f?.id === e.id}" class="card" style="cursor: pointer; text-align: left; padding: 12px 14px; border-radius: 22px; gap: 2px; ${f?.id === e.id ? 'background: var(--soft); border-color: var(--pink); box-shadow: 0 4px 0 var(--pink)' : ''}">
            <span style="font-family: var(--head); font-size: 16px">${e.title}</span><small class="muted" style="font-weight: 600">${dateKo(e.starts_at)} ${localTime(e.starts_at)} · ${FORMAT_LABEL[e.format]} · ${e.joined} / ${e.max_players}명</small>
            <span class="chip ${e.status === 'fixed' ? 'soft' : e.status === 'open' ? 'sky' : 'plain'}" style="justify-self: start; font-size: 12px; padding: 0 10px">${STATUS_LABEL[e.status]}</span></button>`) : html`<p class="empty">아직 일정이 없어요.</p>`}
        </section>
        ${f ? html`<section class="card ink grow"><form data-form class="stack" style="gap: 14px">
          <h2>${f.id ? f.title : '새 내전'}</h2>
          <div class="form-grid">
            <label class="field">날짜 <input type="date" name="date" required value="${f.date}"></label>
            <label class="field">시작 시간 <input type="time" name="time" required value="${f.time}"></label>
            <label class="field">이름 <input name="title" placeholder="비우면 '10월 31일 내전'처럼 자동" value="${f.title}"></label>
            <label class="field">시즌 <input type="number" name="season" min="1" max="99" value="${f.season}"></label>
            <label class="field">편성 방식 <select name="format">${Object.entries(FORMAT_LABEL).map(([v, l]) => html`<option value="${v}" ${f.format === v ? 'selected' : ''}>${l}</option>`)}</select></label>
            <label class="field">라운드 수 <input type="number" name="rounds" min="1" max="12" value="${f.rounds}"></label>
            <label class="field">최대 인원 <input type="number" name="max" min="3" max="24" step="3" value="${f.max}"></label>
            <label class="field">상태 <select name="status">${Object.entries(STATUS_LABEL).map(([v, l]) => html`<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`)}</select></label>
          </div>
          <small class="muted" style="font-weight: 600">디스코드 자동 공지: <b>참가 모집 중</b>으로 저장하면 바로, 시작 24시간 전에 한 번 더 참가 공지가 올라가요 (확정 내전은 24시간 전에만 · 예정은 안 올라가요). 시작이 24시간도 안 남았으면 한 번만 올라가요.</small>
          <label class="field">사용자 설정 대전 설정 코드 <input name="code" value="${f.code}" placeholder="게임에서 저장한 설정 코드" style="font-family: var(--num); font-weight: 800"><span class="hint">참가자들이 같은 설정으로 방을 만들 수 있게 일정 페이지에 같이 보여줘요.</span></label>
          <label class="field">공지 메모 <textarea name="memo" rows="2">${f.memo}</textarea></label>
          <div class="form-grid">
            <label class="radio"><input type="checkbox" name="teamsPublic" ${f.teamsPublic ? 'checked' : ''}> 팀 편성을 공개 페이지에 보여주기</label>
            <label class="field">MVP (디스코드 투표 결과) <select name="mvp"><option value="">아직 없음</option>${players.map((p) => html`<option value="${p.id}" ${f.mvp === p.id ? 'selected' : ''}>${p.name}</option>`)}</select></label>
          </div>
          ${f.id ? html`<div class="stack" style="gap: 8px"><span style="font-family: var(--head); font-size: 17px">참가자 <b class="num">${joined.length} / ${f.max}</b></span>
            <div class="flex" style="gap: 6px">${joined.map((p) => html`<span class="chip" style="padding: 1px 4px">${tierDot(p.tier)}${p.name}<button type="button" class="btn text" data-out="${p.id}" aria-label="${p.name} 빼기" style="min-height: 26px; padding: 0 6px; color: var(--pink-ink)">×</button></span>`)}</div>
            ${joined.length < f.max && bench.length ? html`<div class="flex" style="gap: 6px; border-top: 2px dashed var(--line); padding-top: 10px"><small class="muted" style="font-weight: 700">추가할 수 있는 선수</small><button type="button" class="chip sky" data-in-all style="cursor: pointer">+ 전체 추가 (${bench.length}명)</button>${bench.map((p) => html`<button type="button" class="chip" data-in="${p.id}" style="cursor: pointer; border-style: dashed; border-color: var(--sky-ink)">+ ${p.name}</button>`)}</div>` : ''}
            <small class="muted" style="font-weight: 600">디스코드에서 공지 버튼이나 /참가 로 신청한 사람도 여기에 바로 들어와요.</small></div>` : html`<p class="muted" style="margin: 0; font-weight: 600">저장하면 참가자를 넣을 수 있어요.</p>`}
          <div class="flex" style="border-top: 2px dashed var(--line); padding-top: 14px">${f.id ? html`<button type="button" class="btn ghost danger" data-delete>삭제</button>` : ''}<span class="spacer"></span><button type="submit" class="btn pink" ${state.busy ? 'disabled' : ''}>저장</button></div>
        </form></section>` : html`<section class="card grow"><h2>내전을 골라 주세요</h2><p class="muted" style="margin: 0; font-weight: 600">왼쪽에서 고르거나 "새 내전 추가"를 눌러 주세요.</p></section>`}
      </div>`);
  };

  on(main, 'click', '[data-new]', () => { state.form = blank(); draw(); });
  on(main, 'click', '[data-pick]', (_e, b) => { state.form = toForm(events.find((e) => e.id === b.dataset.pick)); draw(); });
  on(main, 'click', '[data-in]', async (_e, b) => { try { await insert('event_participants', { event_id: state.form.id, player_id: b.dataset.in }); await reload(); draw(); } catch (e) { toast(errorText(e), true); } });
  on(main, 'click', '[data-in-all]', async () => {
    const joinedIds = new Set(parts.filter((p) => p.event_id === state.form.id).map((p) => p.player_id));
    const bench = players.filter((p) => !joinedIds.has(p.id));
    const total = joinedIds.size + bench.length;
    if (!bench.length) return;
    if (!confirm(total > state.form.max ? `${bench.length}명을 넣으면 ${total}명이 돼서 최대 인원(${state.form.max}명)을 넘어요. 그래도 다 넣을까요?` : `${bench.length}명을 모두 참가자로 넣을까요? (모두 ${total}명)`)) return;
    try { await insert('event_participants', bench.map((p) => ({ event_id: state.form.id, player_id: p.id }))); await reload(); draw(); toast(`${bench.length}명을 넣었어요.`); } catch (e) { toast(errorText(e), true); }
  });
  on(main, 'click', '[data-out]', async (_e, b) => { try { await remove('event_participants', { event_id: state.form.id, player_id: b.dataset.out }); await reload(); draw(); } catch (e) { toast(errorText(e), true); } });
  on(main, 'click', '[data-delete]', async () => {
    if (!confirm('이 내전을 삭제할까요? 연결된 라운드 기록도 같이 지워지고, 디스코드에 올라간 이 내전의 공지 · 투표 · 결과 메시지도 1분 안에 지워져요.')) return;
    try { await remove('events', { id: state.form.id }); state.form = null; await reload(); draw(); toast('삭제했어요.'); } catch (e) { toast(errorText(e), true); }
  });
  on(main, 'submit', '[data-form]', async (e, form) => {
    e.preventDefault();
    const fd = new FormData(form);
    const startsAt = new Date(`${fd.get('date')}T${fd.get('time')}:00`);
    const d = new Date(startsAt);
    const row = {
      title: fd.get('title').trim() || `${d.getMonth() + 1}월 ${d.getDate()}일 내전`,
      starts_at: startsAt.toISOString(), season: Number(fd.get('season')) || 1, format: fd.get('format'),
      planned_rounds: Number(fd.get('rounds')) || 4, max_players: Number(fd.get('max')) || 24, status: fd.get('status'),
      setting_code: fd.get('code').trim() || null, memo: fd.get('memo').trim() || null,
      teams_public: fd.get('teamsPublic') === 'on', mvp_player_id: fd.get('mvp') || null
    };
    state.busy = true; draw();
    try {
      let id = state.form.id;
      if (id) await update('events', row, { id }); else id = (await insert('events', row))[0].id;
      await reload();
      state.form = toForm(events.find((x) => x.id === id));
      toast('저장 완료! 공개 일정에 반영됐어요.');
    } catch (err) { toast('저장하지 못했어요: ' + errorText(err), true); }
    state.busy = false; draw();
  });

  await reload();
  draw();
});
