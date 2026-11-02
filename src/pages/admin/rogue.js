import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText, qs, safeUrl } from '../../lib/dom.js';
import { select, update, insert, remove, uploadPublic } from '../../lib/db.js';
import { dateTimeShort, dateKo } from '../../lib/fmt.js';
import { ROGUE_DEFAULTS, FEEDBACK_KINDS, FEEDBACK_STATUS, playTime, splitList, weekStartKst } from '../../lib/rogue.js';

const NEED_13 = 'Supabase SQL Editor 에서 20261102000000_bseorogue.sql (13단계)을 먼저 실행해 주세요.';
const TABS = [['settings', '공개 · 설정'], ['teams', 'KEL 팀'], ['scores', '랭킹 기록'], ['news', '업데이트 소식'], ['feedback', '피드백']];
const KIND = Object.fromEntries(FEEDBACK_KINDS);
const LOGO_MAX = 1024 * 1024;
// 로고 미리보기: 인터넷 주소 · 예시 모드에서 올린 그림만
const imgSrc = (u) => (/^data:image\//.test(String(u || '')) ? u : safeUrl(u));

startAdmin('rogue', async (main) => {
  const [settingsRows, teams, chars, news, feedback] = await Promise.all([
    select('rogue_settings', { eq: { id: 1 } }).catch(() => null),
    select('rogue_teams', { order: 'sort' }).catch(() => []),
    select('er_characters', { columns: 'code, name_ko', order: 'name_ko' }).catch(() => []),
    select('rogue_news', { order: 'created_at', asc: false, limit: 100 }).catch(() => []),
    select('rogue_feedback', { order: 'created_at', asc: false, limit: 300 }).catch(() => [])
  ]);
  if (!settingsRows?.length) {
    mount(main, html`<div><h1>블서로그</h1><p class="lead">블서로그 랭킹 · KEL 팀 · 업데이트 소식 · 피드백을 관리하는 곳이에요.</p></div>
      <p class="notice warn">${NEED_13}</p>`);
    return;
  }

  let settings = { ...ROGUE_DEFAULTS, ...settingsRows[0] };
  const nameOf = new Map(chars.map((c) => [Number(c.code), c.name_ko]));
  const state = {
    tab: TABS.some(([k]) => k === qs('tab')) ? qs('tab') : 'settings',
    busy: false, scores: null, scoreScope: 'week', scoreQ: '', fbFilter: 'new', editNews: null
  };

  const go = (tab) => {
    state.tab = tab;
    const u = new URL(location.href); u.searchParams.set('tab', tab); history.replaceState(null, '', u);
    if (tab === 'scores' && !state.scores) loadScores();
    draw();
  };

  // ── 공개 · 설정
  const settingsView = () => html`
    <section class="card ${settings.live ? '' : 'ink'}" style="${settings.live ? 'border-color: var(--good); box-shadow: 0 6px 0 var(--t2s)' : ''}">
      <div class="flex" style="gap: 18px; justify-content: space-between">
        <span style="display: grid; gap: 4px; flex: 1 1 320px">
          <span class="flex" style="gap: 10px"><h2 style="margin: 0">블서로그 공개</h2><span class="chip ${settings.live ? 'ok' : 'warn'}">${settings.live ? '지금 공개 중' : '지금 비공개'}</span></span>
          <span class="muted" style="font-weight: 600">켜면 모든 사람에게 헤더 오른쪽 블서로그 칸 · 블서로그 페이지(랭킹 · 소식 · 피드백)가 보여요. 끄면 관리자에게만 보여요.</span>
        </span>
        <button class="btn big ${settings.live ? '' : 'pink'}" type="button" data-live ${state.busy ? 'disabled' : ''}>${settings.live ? '비공개로 바꾸기' : '공개하기'}</button>
      </div>
    </section>
    <form class="card" data-settings style="gap: 16px">
      <h2 style="margin: 0">게임 연결</h2>
      <label class="field">게임 주소<input name="game_url" type="url" placeholder="https://bseorogue.vercel.app" value="${settings.game_url}"><span class="hint">헤더의 "하러 가기" 버튼과 블서로그 페이지가 이 주소로 열려요. 비워 두면 버튼이 안 보여요.</span></label>
      <div class="flex" style="gap: 18px">
        <label class="flex" style="gap: 8px; font-weight: 700; min-height: 44px"><input type="checkbox" name="scores_open" ${settings.scores_open ? 'checked' : ''} style="width: 22px; height: 22px; accent-color: var(--pink-ink)">게임에서 랭킹 기록 받기</label>
        <label class="flex" style="gap: 8px; font-weight: 700; min-height: 44px"><input type="checkbox" name="feedback_open" ${settings.feedback_open ? 'checked' : ''} style="width: 22px; height: 22px; accent-color: var(--pink-ink)">피드백 받기</label>
      </div>
      <label class="field">받는 게임 버전<input name="versions" placeholder="예: 0.1.0, 0.1.1" value="${settings.versions.join(', ')}"><span class="hint">쉼표로 나눠 적어요. 비워 두면 아무 버전이나 받아요. 큰 밸런스 패치 뒤에 옛 버전 기록을 막을 때 써요.</span></label>
      <h2 style="margin: 8px 0 0">가짜 점수 검사</h2>
      <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">게임이 보낸 기록이 아래 기준을 넘으면 자동으로 거절해요. 그래도 이상한 기록은 "랭킹 기록" 탭에서 숨겨요.</p>
      <div class="flex" style="gap: 14px; align-items: flex-start">
        ${[['max_wave', '최대 웨이브', '클래식 마지막 웨이브'], ['min_sec_per_wave', '웨이브당 최소 초', '이보다 빠르면 거절'], ['max_party', '파티 최대 인원', ''],
           ['cap_nickname', '닉네임당 하루', '번까지 올리기'], ['cap_ip', '같은 인터넷 연결당 하루', '번까지 올리기']].map(([k, label, hint]) => html`
          <label class="field" style="width: 170px">${label}<input name="${k}" type="number" min="0" value="${settings[k]}" style="font-family: var(--num); font-weight: 800"><span class="hint">${hint}</span></label>`)}
      </div>
      <label class="field">금지어<textarea name="banned_words" rows="3" placeholder="쉼표나 줄바꿈으로 나눠 적어요">${settings.banned_words.join(', ')}</textarea><span class="hint">닉네임에 들어 있으면 올릴 수 없어요. 무명섬 선수 이름 · 게임 닉네임과 똑같은 닉네임은 따로 적지 않아도 막아요.</span></label>
      <div class="flex" style="justify-content: space-between">
        <small class="muted" style="font-weight: 600">마지막 저장 ${settings.updated_at ? dateTimeShort(settings.updated_at) : '-'}</small>
        <button class="btn pink" type="submit" ${state.busy ? 'disabled' : ''}>설정 저장</button>
      </div>
    </form>`;

  // ── KEL 팀
  const memberSelect = (teamId, slot, code) => html`<select name="m${slot}" aria-label="실험체 ${slot + 1}" style="min-width: 0; width: 100%">
    <option value="">${slot + 1}번 실험체</option>
    ${code && !nameOf.has(code) ? html`<option value="${code}" selected>#${code}</option>` : ''}
    ${chars.map((c) => html`<option value="${c.code}" ${Number(c.code) === code ? 'selected' : ''}>${c.name_ko}</option>`)}
  </select>`;

  const teamsView = () => html`
    <section class="card" style="gap: 12px">
      <div><h2 style="margin: 0">KEL 팀</h2><p class="muted" style="margin: 4px 0 0; font-size: 13px; font-weight: 600">게임에서 적 팀으로 나와요. 팀마다 실험체 3명과 로고를 정하고 줄마다 저장해요. 끄면 게임에 안 나와요.</p></div>
      ${!chars.length ? html`<p class="notice warn">실험체 목록이 비어 있어요. 선수 관리에서 이리 데이터를 한 번 동기화하면 채워져요.</p>` : ''}
      <div style="display: grid; gap: 10px">
        ${teams.map((t) => html`<form data-team="${t.id}" class="rogue-team ${t.active ? '' : 'off'}">
          <span class="rogue-logo">${imgSrc(t.logo_url) ? html`<img src="${imgSrc(t.logo_url)}" alt="${t.name} 로고">` : html`<span aria-hidden="true">${t.name.slice(0, 2)}</span>`}</span>
          <span style="display: grid; gap: 6px; min-width: 0">
            <span class="flex" style="gap: 8px; flex-wrap: nowrap">
              <input name="name" value="${t.name}" aria-label="팀 이름" maxlength="40" required style="flex: 2 1 160px; min-width: 0; font-weight: 800">
              <input name="region" value="${t.region}" aria-label="지역" placeholder="지역" maxlength="10" style="flex: 0 1 80px; min-width: 0">
              <input name="sort" type="number" value="${t.sort}" aria-label="순서" title="순서" style="width: 64px; font-family: var(--num)">
            </span>
            <span class="rogue-members">${[0, 1, 2].map((i) => memberSelect(t.id, i, Number(t.members?.[i]) || 0))}</span>
            <span class="flex" style="gap: 8px">
              <label class="btn sm ghost" style="cursor: pointer">로고 올리기<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-logo hidden></label>
              <input name="logo_url" value="${/^data:/.test(t.logo_url) ? '' : t.logo_url}" placeholder="또는 로고 이미지 주소" aria-label="로고 이미지 주소" style="flex: 1 1 200px; min-width: 0; font-size: 13px">
              <label class="flex" style="gap: 6px; font-weight: 700; min-height: 36px"><input type="checkbox" name="active" ${t.active ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: var(--pink-ink)">게임에 나오기</label>
            </span>
          </span>
          <span style="display: grid; gap: 6px; align-content: start">
            <button class="btn sm pink" type="submit">저장</button>
            <button class="btn sm ghost danger" type="button" data-del-team>지우기</button>
          </span>
        </form>`)}
      </div>
      <form class="flex" data-new-team style="gap: 8px">
        <input name="name" placeholder="새 팀 이름" maxlength="40" aria-label="새 팀 이름" style="flex: 1 1 200px">
        <button class="btn sm" type="submit">팀 추가</button>
      </form>
    </section>`;

  // ── 랭킹 기록
  const scoresView = () => {
    const q = state.scoreQ.trim().toLowerCase();
    const rows = (state.scores || []).filter((r) => !q || r.nickname.toLowerCase().includes(q));
    return html`<section class="card" style="gap: 12px">
      <div class="flex" style="justify-content: space-between; gap: 12px">
        <h2 style="margin: 0">랭킹 기록</h2>
        <div class="pills" role="group" aria-label="기간">
          <button type="button" data-sscope="week" aria-pressed="${state.scoreScope === 'week'}">이번 주</button>
          <button type="button" data-sscope="all" aria-pressed="${state.scoreScope === 'all'}">최근 300개</button>
        </div>
      </div>
      <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">숨기면 랭킹에서 빠지고 기록은 남아요. 지우기는 테스트 기록을 정리할 때만 써요.</p>
      <label class="field" style="max-width: 320px"><span class="sr-only">닉네임 검색</span><input type="search" data-sq value="${state.scoreQ}" placeholder="닉네임 검색"></label>
      ${state.scores === null ? html`<p class="loading">불러오는 중…</p>`
        : rows.length ? html`<div class="table-wrap"><table class="data" style="min-width: 720px"><thead><tr><th>올린 때</th><th>닉네임</th><th class="r">웨이브</th><th class="r">시간</th><th>파티</th><th>버전</th><th>상태</th><th></th></tr></thead><tbody>
          ${rows.map((r) => html`<tr style="${r.hidden ? 'opacity: 0.6' : ''}">
            <td style="white-space: nowrap; font-size: 13px">${dateTimeShort(r.created_at)}</td>
            <td><b>${r.nickname}</b></td>
            <td class="r"><span class="num">${r.wave}</span>${r.cleared ? html` <span class="chip ok" style="padding: 0 8px">클리어</span>` : ''}</td>
            <td class="r"><span class="num">${playTime(r.seconds)}</span></td>
            <td style="font-size: 13px">${(r.party || []).map((c) => nameOf.get(Number(c)) || '#' + c).join(' · ')}</td>
            <td style="font-size: 13px">${r.version || '-'}</td>
            <td>${r.hidden ? html`<span class="chip warn" title="${r.hidden_reason || ''}">숨김${r.hidden_reason ? ' · ' + r.hidden_reason : ''}</span>` : html`<span class="chip ok">보임</span>`}</td>
            <td style="white-space: nowrap"><button class="btn sm ${r.hidden ? '' : 'ghost'}" type="button" data-hide="${r.id}">${r.hidden ? '다시 보이기' : '숨기기'}</button> <button class="btn sm ghost danger" type="button" data-del-score="${r.id}">지우기</button></td>
          </tr>`)}
        </tbody></table></div>`
        : html`<p class="empty">${state.scoreScope === 'week' ? '이번 주 기록이 없어요.' : '아직 기록이 없어요.'}</p>`}
    </section>`;
  };

  // ── 업데이트 소식
  const newsView = () => {
    const ed = news.find((n) => n.id === state.editNews) || null;
    return html`<form class="card" data-news style="gap: 12px">
        <h2 style="margin: 0">${ed ? '소식 고치기' : '새 소식 쓰기'}</h2>
        <label class="field">제목<input name="title" maxlength="80" required value="${ed?.title || ''}" placeholder="예: v0.1 첫 공개!"></label>
        <label class="field">내용<textarea name="body" rows="6" maxlength="4000" placeholder="바뀐 점, 새 실험체, 고친 버그 …">${ed?.body || ''}</textarea></label>
        <div class="flex" style="gap: 18px">
          <label class="flex" style="gap: 8px; font-weight: 700; min-height: 44px"><input type="checkbox" name="pinned" ${ed?.pinned ? 'checked' : ''} style="width: 22px; height: 22px; accent-color: var(--pink-ink)">맨 위에 고정</label>
          <label class="flex" style="gap: 8px; font-weight: 700; min-height: 44px"><input type="checkbox" name="published" ${!ed || ed.published ? 'checked' : ''} style="width: 22px; height: 22px; accent-color: var(--pink-ink)">공개</label>
          <span style="margin-left: auto" class="flex">${ed ? html`<button class="btn ghost" type="button" data-news-cancel>새로 쓰기</button>` : ''}<button class="btn pink" type="submit">${ed ? '고친 내용 저장' : '올리기'}</button></span>
        </div>
      </form>
      <section class="card" style="gap: 10px"><h2 style="margin: 0">올린 소식</h2>
        ${news.length ? html`<ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px">${news.map((n) => html`<li class="flex" style="flex-wrap: nowrap; gap: 12px; background: var(--soft); border-radius: 18px; padding: 10px 14px">
            <span style="flex: 1 1 auto; display: grid; min-width: 0"><span class="flex" style="gap: 6px">${n.pinned ? html`<span class="chip soft" style="padding: 0 8px">고정</span>` : ''}${!n.published ? html`<span class="chip warn" style="padding: 0 8px">비공개</span>` : ''}<b>${n.title}</b></span><small class="muted" style="font-weight: 600">${dateKo(n.created_at, false)}</small></span>
            <button class="btn sm ghost" type="button" data-edit-news="${n.id}">고치기</button>
            <button class="btn sm ghost danger" type="button" data-del-news="${n.id}">지우기</button>
          </li>`)}</ul>` : html`<p class="empty">아직 올린 소식이 없어요.</p>`}
      </section>`;
  };

  // ── 피드백
  const feedbackView = () => {
    const rows = feedback.filter((f) => state.fbFilter === 'all' || f.status === state.fbFilter);
    const count = (s) => feedback.filter((f) => f.status === s).length;
    return html`<section class="card" style="gap: 12px">
      <div class="flex" style="justify-content: space-between; gap: 12px">
        <h2 style="margin: 0">피드백</h2>
        <div class="pills" role="group" aria-label="상태">${[['new', `새 피드백 ${count('new')}`], ['read', `읽음 ${count('read')}`], ['done', `반영함 ${count('done')}`], ['all', '전체']].map(([k, label]) => html`<button type="button" data-fbf="${k}" aria-pressed="${state.fbFilter === k}">${label}</button>`)}</div>
      </div>
      ${rows.length ? html`<ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px">${rows.map((f) => html`<li data-fb="${f.id}" style="background: ${f.status === 'new' ? 'var(--sky-soft)' : 'var(--soft)'}; border-radius: 18px; padding: 12px 14px; display: grid; gap: 8px">
          <span class="flex" style="gap: 6px"><span class="chip sky" style="padding: 0 8px">${KIND[f.kind] || f.kind}</span><span class="chip" style="padding: 0 8px">${f.source === 'game' ? '게임에서' : '웹에서'}</span>
            <b>${f.nickname || '이름 없음'}</b><small class="muted" style="font-weight: 600">${dateTimeShort(f.created_at)}${f.version ? ' · v' + f.version : ''} · ${FEEDBACK_STATUS[f.status]}</small></span>
          <p style="margin: 0; white-space: pre-line; font-weight: 500">${f.body}</p>
          <span class="flex" style="gap: 8px">
            <input data-memo value="${f.memo}" maxlength="500" placeholder="운영진 메모" aria-label="운영진 메모" style="flex: 1 1 220px; min-width: 0; font-size: 13px">
            ${f.status !== 'read' ? html`<button class="btn sm ghost" type="button" data-fbs="read">읽음</button>` : ''}
            ${f.status !== 'done' ? html`<button class="btn sm sky" type="button" data-fbs="done">반영함</button>` : ''}
            <button class="btn sm ghost" type="button" data-fbs="${f.status}">메모 저장</button>
            <button class="btn sm ghost danger" type="button" data-del-fb>지우기</button>
          </span>
        </li>`)}</ul>` : html`<p class="empty">${state.fbFilter === 'new' ? '새 피드백이 없어요.' : '피드백이 없어요.'}</p>`}
    </section>`;
  };

  const views = { settings: settingsView, teams: teamsView, scores: scoresView, news: newsView, feedback: feedbackView };
  const draw = () => {
    const fresh = feedback.filter((f) => f.status === 'new').length;
    mount(main, html`
      <div class="flex" style="justify-content: space-between; gap: 12px; align-items: flex-end">
        <div><h1>블서로그</h1><p class="lead">블서로그 공개 · 랭킹 기록 · KEL 팀 · 업데이트 소식 · 피드백을 관리해요.</p></div>
        <a class="btn ghost" href="/rogue" target="_blank" rel="noopener">블서로그 페이지 보기</a>
      </div>
      <div class="pills" role="group" aria-label="블서로그 관리">${TABS.map(([k, label]) => html`<button type="button" data-tab="${k}" aria-pressed="${state.tab === k}">${label}${k === 'feedback' && fresh ? html` <span class="badge">${fresh}</span>` : ''}</button>`)}</div>
      ${views[state.tab]()}`);
  };

  // ── 데이터
  async function loadScores() {
    state.scores = null;
    try {
      state.scores = state.scoreScope === 'week'
        ? await select('rogue_scores', { eq: { week_start: weekStartKst() }, order: 'created_at', asc: false, limit: 300 })
        : await select('rogue_scores', { order: 'created_at', asc: false, limit: 300 });
    } catch (e) {
      state.scores = [];
      toast('기록을 불러오지 못했어요: ' + errorText(e), true);
    }
    draw();
  }
  const saveSettings = async (values, msg) => {
    state.busy = true; draw();
    try {
      const res = await update('rogue_settings', values, { id: 1 });
      if (!res.length) throw new Error('저장되지 않았어요. 관리자 권한을 확인해 주세요');
      settings = { ...ROGUE_DEFAULTS, ...res[0] };
      toast(msg);
    } catch (e) { toast('저장하지 못했어요: ' + errorText(e), true); }
    state.busy = false; draw();
  };
  const teamPatch = (form) => {
    const fd = new FormData(form);
    const members = [0, 1, 2].map((i) => Number(fd.get('m' + i)) || 0).filter(Boolean);
    if (new Set(members).size !== members.length) throw new Error('같은 실험체를 두 번 넣었어요');
    const logo = String(fd.get('logo_url') || '').trim();
    if (logo && !safeUrl(logo)) throw new Error('로고 주소는 https:// 로 시작해야 해요');
    const name = String(fd.get('name') || '').trim();
    if (!name) throw new Error('팀 이름을 적어 주세요');
    return { name, region: String(fd.get('region') || '').trim(), sort: Number(fd.get('sort')) || 0, members, active: fd.get('active') === 'on', ...(logo ? { logo_url: logo } : {}) };
  };

  // ── 이벤트
  on(main, 'click', '[data-tab]', (_e, b) => go(b.dataset.tab));
  on(main, 'click', '[data-live]', () => {
    const turnOn = !settings.live;
    if (turnOn && !settings.game_url && !confirm('게임 주소가 비어 있어요. 그래도 공개할까요? (랭킹 · 소식 · 피드백 페이지는 보여요)')) return;
    saveSettings({ live: turnOn }, turnOn ? '블서로그를 공개했어요!' : '블서로그를 비공개로 바꿨어요.');
  });
  on(main, 'submit', '[data-settings]', (e, form) => {
    e.preventDefault();
    const fd = new FormData(form);
    const url = String(fd.get('game_url') || '').trim();
    if (url && !safeUrl(url)) { toast('게임 주소는 https:// 로 시작해야 해요', true); return; }
    const n = (k, min, max) => Math.min(max, Math.max(min, Math.floor(Number(fd.get(k))) || min));
    saveSettings({
      game_url: url, scores_open: fd.get('scores_open') === 'on', feedback_open: fd.get('feedback_open') === 'on',
      versions: splitList(fd.get('versions')),
      max_wave: n('max_wave', 1, 10000), min_sec_per_wave: n('min_sec_per_wave', 0, 600), max_party: n('max_party', 1, 6),
      cap_nickname: n('cap_nickname', 1, 1000), cap_ip: n('cap_ip', 1, 10000), banned_words: splitList(fd.get('banned_words'))
    }, '블서로그 설정을 저장했어요.');
  });

  on(main, 'submit', '[data-team]', async (e, form) => {
    e.preventDefault();
    const id = Number(form.dataset.team);
    try {
      const patch = teamPatch(form);
      const [row] = await update('rogue_teams', patch, { id });
      if (!row) throw new Error('저장되지 않았어요');
      Object.assign(teams.find((t) => t.id === id), row);
      toast(`${row.name} 팀을 저장했어요.`);
      draw();
    } catch (err) { toast('저장하지 못했어요: ' + errorText(err), true); }
  });
  on(main, 'change', '[data-logo]', async (_e, input) => {
    const form = input.closest('[data-team]');
    const id = Number(form.dataset.team);
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > LOGO_MAX) { toast('로고는 1MB 까지 올릴 수 있어요', true); return; }
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const url = await uploadPublic('rogue', `teams/${id}-${Date.now()}.${ext}`, file);
      const [row] = await update('rogue_teams', { logo_url: url }, { id });
      Object.assign(teams.find((t) => t.id === id), row || { logo_url: url });
      toast('로고를 올렸어요.');
      draw();
    } catch (err) { toast('로고를 올리지 못했어요: ' + errorText(err) + ' (이미지 주소로 넣어도 돼요)', true); }
  });
  on(main, 'click', '[data-del-team]', async (_e, b) => {
    const id = Number(b.closest('[data-team]').dataset.team);
    const t = teams.find((x) => x.id === id);
    if (!confirm(`${t.name} 팀을 지울까요? 게임에서도 사라져요. (잠깐 빼려면 "게임에 나오기"만 꺼도 돼요)`)) return;
    try {
      await remove('rogue_teams', { id });
      teams.splice(teams.indexOf(t), 1);
      toast('팀을 지웠어요.'); draw();
    } catch (err) { toast('지우지 못했어요: ' + errorText(err), true); }
  });
  on(main, 'submit', '[data-new-team]', async (e, form) => {
    e.preventDefault();
    const name = String(new FormData(form).get('name') || '').trim();
    if (!name) return;
    try {
      const [row] = await insert('rogue_teams', { name, sort: Math.max(0, ...teams.map((t) => t.sort)) + 1, members: [], region: '', logo_url: '', active: true });
      teams.push({ id: row.id, region: '', logo_url: '', members: [], active: true, ...row });
      toast(`${name} 팀을 추가했어요.`); draw();
    } catch (err) { toast('추가하지 못했어요: ' + errorText(err), true); }
  });

  on(main, 'click', '[data-sscope]', (_e, b) => { state.scoreScope = b.dataset.sscope; loadScores(); });
  on(main, 'input', '[data-sq]', (_e, el) => {
    state.scoreQ = el.value;
    const pos = el.selectionStart;
    draw();
    const again = main.querySelector('[data-sq]');
    again.focus(); again.setSelectionRange(pos, pos);
  });
  on(main, 'click', '[data-hide]', async (_e, b) => {
    const r = state.scores.find((x) => x.id === Number(b.dataset.hide));
    let reason = null;
    if (!r.hidden) {
      reason = prompt(`${r.nickname} · ${r.wave}웨이브 기록을 랭킹에서 숨겨요. 이유를 적어 둘까요? (안 적어도 돼요)`, '');
      if (reason === null) return;
    }
    try {
      const [row] = await update('rogue_scores', { hidden: !r.hidden, hidden_reason: r.hidden ? null : reason.trim() || null }, { id: r.id });
      Object.assign(r, row || { hidden: !r.hidden });
      toast(r.hidden ? '랭킹에서 숨겼어요.' : '다시 보이게 했어요.'); draw();
    } catch (err) { toast('바꾸지 못했어요: ' + errorText(err), true); }
  });
  on(main, 'click', '[data-del-score]', async (_e, b) => {
    const r = state.scores.find((x) => x.id === Number(b.dataset.delScore));
    if (!confirm(`${r.nickname} · ${r.wave}웨이브 기록을 지울까요? 되돌릴 수 없어요. (랭킹에서만 빼려면 숨기기를 써요)`)) return;
    try {
      await remove('rogue_scores', { id: r.id });
      state.scores = state.scores.filter((x) => x !== r);
      toast('기록을 지웠어요.'); draw();
    } catch (err) { toast('지우지 못했어요: ' + errorText(err), true); }
  });

  on(main, 'submit', '[data-news]', async (e, form) => {
    e.preventDefault();
    const fd = new FormData(form);
    const values = { title: String(fd.get('title') || '').trim(), body: String(fd.get('body') || '').trim(), pinned: fd.get('pinned') === 'on', published: fd.get('published') === 'on' };
    if (!values.title) { toast('제목을 적어 주세요', true); return; }
    try {
      if (state.editNews) {
        const [row] = await update('rogue_news', values, { id: state.editNews });
        Object.assign(news.find((n) => n.id === state.editNews), row || values);
        toast('소식을 고쳤어요.');
      } else {
        const [row] = await insert('rogue_news', values);
        news.unshift({ ...values, ...row });
        toast(values.published ? '소식을 올렸어요.' : '비공개로 저장했어요.');
      }
      state.editNews = null; draw();
    } catch (err) { toast('저장하지 못했어요: ' + errorText(err), true); }
  });
  on(main, 'click', '[data-edit-news]', (_e, b) => { state.editNews = Number(b.dataset.editNews) || b.dataset.editNews; draw(); main.querySelector('[data-news] input[name="title"]')?.focus(); });
  on(main, 'click', '[data-news-cancel]', () => { state.editNews = null; draw(); });
  on(main, 'click', '[data-del-news]', async (_e, b) => {
    const id = Number(b.dataset.delNews) || b.dataset.delNews;
    const n = news.find((x) => x.id === id);
    if (!confirm(`"${n.title}" 소식을 지울까요?`)) return;
    try {
      await remove('rogue_news', { id });
      news.splice(news.indexOf(n), 1);
      if (state.editNews === id) state.editNews = null;
      toast('소식을 지웠어요.'); draw();
    } catch (err) { toast('지우지 못했어요: ' + errorText(err), true); }
  });

  on(main, 'click', '[data-fbf]', (_e, b) => { state.fbFilter = b.dataset.fbf; draw(); });
  on(main, 'click', '[data-fbs]', async (_e, b) => {
    const li = b.closest('[data-fb]');
    const f = feedback.find((x) => String(x.id) === li.dataset.fb);
    const memo = li.querySelector('[data-memo]').value.trim();
    const memoOnly = b.dataset.fbs === f.status;
    try {
      const [row] = await update('rogue_feedback', { status: b.dataset.fbs, memo }, { id: f.id });
      Object.assign(f, row || { status: b.dataset.fbs, memo });
      toast(memoOnly ? '메모를 저장했어요.' : `"${FEEDBACK_STATUS[f.status]}"(으)로 바꿨어요.`);
      draw();
    } catch (err) { toast('바꾸지 못했어요: ' + errorText(err), true); }
  });
  on(main, 'click', '[data-del-fb]', async (_e, b) => {
    const li = b.closest('[data-fb]');
    const f = feedback.find((x) => String(x.id) === li.dataset.fb);
    if (!confirm('이 피드백을 지울까요?')) return;
    try {
      await remove('rogue_feedback', { id: f.id });
      feedback.splice(feedback.indexOf(f), 1);
      toast('피드백을 지웠어요.'); draw();
    } catch (err) { toast('지우지 못했어요: ' + errorText(err), true); }
  });

  if (state.tab === 'scores') loadScores();
  draw();
});
