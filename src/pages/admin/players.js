import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText, safeUrl } from '../../lib/dom.js';
import { select, insert, update, upsert, invokeFunction } from '../../lib/db.js';
import { loadPlayers } from '../../lib/api.js';
import { avatar, num, pct, dateTimeShort, parseChzzkId, chzzkUrl } from '../../lib/fmt.js';

const ROLES = ['브루저', '원거리 딜러', '스킬 딜러', '탱커', '서포터', '암살자'];

startAdmin('players', async (main) => {
  let players = [];
  let privateBy = new Map();
  const state = { query: '', filter: 'all', sel: null, draft: null, syncing: false, syncText: '' };

  const reload = async () => {
    players = (await loadPlayers({ includeInactive: true })).list;
    privateBy = new Map((await select('player_private')).map((r) => [r.player_id, r]));
  };

  const blank = () => ({ id: null, name: '', erNickname: '', tier: 3, role: '', note: '', chzzk: '', youtube: '', photoSource: 'chzzk', customPhoto: '', discordId: '', active: true });
  const toDraft = (p) => ({ id: p.id, name: p.name, erNickname: p.erNickname, tier: p.tier, role: p.role, note: p.note, chzzk: p.chzzkId ? chzzkUrl(p.chzzkId) : '', youtube: p.youtubeUrl, photoSource: p.photoSource, customPhoto: p.customPhoto || '', discordId: privateBy.get(p.id)?.discord_id || '', active: p.active });

  const syncState = (p) => {
    if (!p.rank) return { text: '동기화 전', cls: 'plain' };
    if (p.rank.error) return { text: p.rank.error, cls: 'soft' };
    if (p.rank.score === null || p.rank.score === undefined) return { text: '솔로 랭크 기록 없음', cls: 'warn' };
    return { text: `${num(p.rank.score)}점 · ${pct(p.rank.wins, p.rank.games)}`, cls: 'ok' };
  };

  const list = () => {
    const q = state.query.trim().toLowerCase();
    return players.filter((p) => (!q || p.name.toLowerCase().includes(q) || p.erNickname.toLowerCase().includes(q))
      && (state.filter === 'all' || (state.filter === 'active' ? p.active : state.filter === 'rest' ? !p.active : (!p.rank || p.rank.error))));
  };

  const form = () => {
    const d = state.draft;
    if (!d) return html`<section class="card ink side" style="flex-basis: 340px"><h2>선수를 골라 주세요</h2><p class="muted" style="margin: 0; font-weight: 600">왼쪽 목록에서 "수정"을 누르거나 "새 선수 추가"를 눌러 주세요.</p></section>`;
    const isNew = !d.id;
    return html`<section class="card ink side" style="flex-basis: 360px" aria-labelledby="edit-title">
      <form data-form class="stack" style="gap: 12px">
        <h2 id="edit-title">${isNew ? '새 선수 추가' : d.name + ' 수정'}</h2>
        <label class="field">무명섬 이름 <input name="name" required maxlength="20" value="${d.name}"></label>
        <label class="field">이리 게임 닉네임 <input name="erNickname" required maxlength="40" value="${d.erNickname}"><span class="hint">게임 안 닉네임과 똑같이 넣어 주세요. 결과 CSV도 이 이름으로 찾아요.</span></label>
        ${isNew ? html`<label class="field">밸런스 티어 (처음 한 번) <select name="tier">${[1, 2, 3].map((t) => html`<option value="${t}" ${t === d.tier ? 'selected' : ''}>${t}티어</option>`)}</select><span class="hint">나중에 바꿀 땐 티어 관리에서 바꿔요.</span></label>` : ''}
        <label class="field">역할 <select name="role"><option value="">미정</option>${ROLES.map((r) => html`<option ${r === d.role ? 'selected' : ''}>${r}</option>`)}</select></label>
        <label class="field">치지직 방송국 주소 <input name="chzzk" value="${d.chzzk}" placeholder="https://chzzk.naver.com/채널ID"><span class="hint">주소에 있는 32자리 채널 ID를 자동으로 뽑아요.</span></label>
        <label class="field">유튜브 채널 주소 <input name="youtube" value="${d.youtube}" placeholder="https://www.youtube.com/@핸들"></label>
        <fieldset><legend>프로필 사진</legend>
          ${[['chzzk', '치지직 프로필 사진'], ['youtube', '유튜브 프로필 사진'], ['upload', '이미지 주소 직접 넣기']].map(([v, l]) => html`<label class="radio"><input type="radio" name="photoSource" value="${v}" ${d.photoSource === v ? 'checked' : ''}>${l}</label>`)}
          <input class="input" name="customPhoto" value="${d.customPhoto}" placeholder="https://… 이미지 주소 (직접 넣기일 때)">
          <span class="muted" style="font-size: 12px; font-weight: 600">치지직 · 유튜브 사진은 각 API를 연결하면 자동으로 채워져요.</span>
        </fieldset>
        <label class="field">장점 한 줄 <input name="note" maxlength="60" value="${d.note}" placeholder="예: 운영 콜, 교전 판단"></label>
        <label class="field">디스코드 아이디 (운영진만 봐요) <input name="discordId" value="${d.discordId}" placeholder="나중에 봇 연동 때 써요"></label>
        <label class="radio"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> 참가 중 (끄면 선수 목록에서 숨겨요)</label>
        <div class="flex" style="border-top: 2px dashed var(--line); padding-top: 12px">
          ${!isNew ? html`<button type="button" class="btn sm sky" data-sync-one="${d.id}" ${state.syncing ? 'disabled' : ''}>이 선수만 동기화</button>` : ''}
          <span class="spacer"></span>
          <button type="button" class="btn ghost" data-cancel>닫기</button>
          <button type="submit" class="btn pink">${isNew ? '추가' : '저장'}</button>
        </div>
      </form>
    </section>`;
  };

  const draw = () => {
    const rows = list();
    const issues = players.filter((p) => !p.rank || p.rank.error).length;
    mount(main, html`
      <div class="page-head"><div><h1>선수 관리</h1><p class="lead">방송 채널이랑 이리 닉네임만 연결해 두면 프로필 사진, LIVE ON, 랭크 승률은 자동으로 채워 드릴게요!</p></div>
        <span class="flex"><button class="btn sky" type="button" data-sync-all ${state.syncing ? 'disabled' : ''}>${state.syncing ? '동기화 중…' : '이리 데이터 전체 동기화'}</button><button class="btn pink" type="button" data-new>새 선수 추가</button></span></div>
      ${state.syncText ? html`<p class="notice" role="status" style="margin: 0">${state.syncText}</p>` : ''}
      <div class="flex">
        <label class="sr-only" for="q">선수 검색</label>
        <input id="q" class="input" type="search" placeholder="이름이나 게임 닉네임으로 검색" value="${state.query}" style="flex: 1 1 260px; border-radius: 999px; background: var(--card)">
        <div class="pills" role="group" aria-label="필터">${[['all', '전체'], ['active', '참가 중'], ['rest', '쉬는 중'], ['issue', `연동 확인 필요 ${issues || ''}`]].map(([id, l]) => html`<button type="button" data-filter="${id}" aria-pressed="${state.filter === id}">${l}</button>`)}</div>
      </div>
      <div class="row">
        <section class="card grow" aria-labelledby="list-title"><h2 id="list-title">선수 ${rows.length}명</h2>
          ${rows.length ? html`<div class="table-wrap"><table class="data" style="min-width: 560px"><thead><tr><th>선수</th><th>방송 채널</th><th>이리 연동 (솔로 랭크)</th><th><span class="sr-only">수정</span></th></tr></thead><tbody>
            ${rows.map((p) => { const s = syncState(p); return html`<tr class="${state.draft?.id === p.id ? 'changed' : ''}" style="${p.active ? '' : 'opacity: 0.6'}">
              <td><span class="flex" style="flex-wrap: nowrap">${avatar(p, 'sm')}<span style="display: grid"><b>${p.name}</b><small class="muted" style="font-weight: 600">${p.tier}티어 · ${p.role || '역할 미정'} · ${p.erNickname}${p.active ? '' : ' · 쉬는 중'}</small></span></span></td>
              <td><span class="flex" style="gap: 4px">${p.chzzkId ? html`<span class="chip sky" style="font-size: 12px; padding: 0 9px">치지직</span>` : ''}${safeUrl(p.youtubeUrl) ? html`<span class="chip soft" style="font-size: 12px; padding: 0 9px">유튜브</span>` : ''}${!p.chzzkId && !p.youtubeUrl ? html`<span class="muted" style="font-size: 12px">없음</span>` : ''}</span></td>
              <td><span class="chip ${s.cls}" style="font-size: 12px; padding: 1px 10px">${s.text}</span>${p.rank?.syncedAt ? html`<br><small class="muted">${dateTimeShort(p.rank.syncedAt)}</small>` : ''}</td>
              <td class="r"><button class="btn sm ${state.draft?.id === p.id ? 'pink' : 'ghost'}" type="button" data-edit="${p.id}" aria-label="${p.name} 수정">수정</button></td>
            </tr>`; })}
          </tbody></table></div>` : html`<p class="empty">${players.length ? '검색 결과가 없어요.' : '아직 선수가 없어요. "새 선수 추가"로 첫 선수를 넣어 주세요!'}</p>`}
        </section>
        ${form()}
      </div>`);
  };

  const readForm = (f) => {
    const fd = new FormData(f);
    return { ...state.draft, name: fd.get('name').trim(), erNickname: fd.get('erNickname').trim(), tier: Number(fd.get('tier') || state.draft.tier), role: fd.get('role'), note: fd.get('note').trim(), chzzk: fd.get('chzzk').trim(), youtube: fd.get('youtube').trim(), photoSource: fd.get('photoSource') || 'chzzk', customPhoto: fd.get('customPhoto').trim(), discordId: fd.get('discordId').trim(), active: fd.get('active') === 'on' };
  };

  const runSync = async (playerId) => {
    state.syncing = true; state.syncText = playerId ? '동기화 중이에요…' : '이리 API에서 데이터를 가져오는 중이에요. 선수 한 명에 1~2초씩 걸려요…'; draw();
    try {
      let offset = 0, ok = 0, bad = [], total = 0;
      do {
        const r = await invokeFunction('er-sync', playerId ? { player_id: playerId } : { offset, limit: 40 });
        total = r.total;
        (r.results || []).forEach((x) => (x.ok ? ok++ : bad.push(`${x.name}: ${x.message}`)));
        offset = r.next_offset;
        state.syncText = `${r.done} / ${total}명 동기화…`; draw();
      } while (offset !== null && offset !== undefined && !playerId);
      state.syncText = `동기화 완료! 성공 ${ok}명${bad.length ? ` · 확인 필요 ${bad.length}명 (${bad.slice(0, 3).join(' / ')}${bad.length > 3 ? ' …' : ''})` : ''}`;
      await reload();
    } catch (e) {
      state.syncText = '앗, 동기화하지 못했어요: ' + errorText(e);
    }
    state.syncing = false;
    draw();
  };

  on(main, 'input', '#q', (e) => { state.query = e.target.value; const pos = e.target.selectionStart; draw(); const q = main.querySelector('#q'); q.focus(); q.setSelectionRange(pos, pos); });
  on(main, 'click', '[data-filter]', (_e, b) => { state.filter = b.dataset.filter; draw(); });
  on(main, 'click', '[data-new]', () => { state.draft = blank(); draw(); main.querySelector('[name="name"]')?.focus(); });
  on(main, 'click', '[data-edit]', (_e, b) => { state.draft = toDraft(players.find((p) => p.id === b.dataset.edit)); draw(); });
  on(main, 'click', '[data-cancel]', () => { state.draft = null; draw(); });
  on(main, 'click', '[data-sync-all]', () => runSync(null));
  on(main, 'click', '[data-sync-one]', (_e, b) => runSync(b.dataset.syncOne));

  on(main, 'submit', '[data-form]', async (e, f) => {
    e.preventDefault();
    const d = readForm(f);
    const chzzkId = d.chzzk ? parseChzzkId(d.chzzk) : '';
    if (d.chzzk && !chzzkId) { toast('치지직 주소에서 채널 ID를 못 찾았어요. 방송국 주소를 그대로 붙여 넣어 주세요.', true); return; }
    if (d.youtube && !safeUrl(d.youtube)) { toast('유튜브 주소가 이상해요. https:// 로 시작하는 주소를 넣어 주세요.', true); return; }
    const row = {
      display_name: d.name, er_nickname: d.erNickname, role: d.role || null, strength_note: d.note || null,
      chzzk_channel_id: chzzkId || null, youtube_url: d.youtube || null, photo_source: d.photoSource,
      custom_photo_url: safeUrl(d.customPhoto) || null, active: d.active, updated_at: new Date().toISOString()
    };
    try {
      let id = d.id;
      if (!id) {
        const [made] = await insert('players', { ...row, balance_tier: d.tier });
        id = made.id;
        await insert('tier_history', { player_id: id, from_tier: null, to_tier: d.tier, memo: '첫 등록' });
      } else {
        const before = players.find((p) => p.id === id);
        if (before && before.erNickname !== d.erNickname) row.er_uid = null; // 닉네임이 바뀌면 UID 를 다시 찾게
        await update('players', row, { id });
      }
      await upsert('player_private', { player_id: id, discord_id: d.discordId || null }, ['player_id']);
      toast(d.id ? '저장 완료!' : '새 선수를 추가했어요! "이 선수만 동기화"로 랭크 기록을 가져와 보세요.');
      await reload();
      state.draft = toDraft(players.find((p) => p.id === id));
      draw();
    } catch (err) {
      const m = errorText(err);
      toast(/duplicate|23505/.test(m) ? '같은 이름이나 게임 닉네임을 가진 선수가 이미 있어요.' : '저장하지 못했어요: ' + m, true);
    }
  });

  await reload();
  draw();
});
