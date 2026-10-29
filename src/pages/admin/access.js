import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText } from '../../lib/dom.js';
import { select, rpc } from '../../lib/db.js';
import { dateTimeShort } from '../../lib/fmt.js';

// 디스코드 봇 명령어 (bot/src/commands.js 와 같아요)
const BOT_COMMANDS = [
  ['누구나', [
    ['/연결 게임닉네임', '내 디스코드 계정을 무명섬 선수와 연결 요청 → 대시보드에서 승인하면 끝'],
    ['/연결해제', '내 연결 풀기 (대기 중인 연결 요청도 취소)'],
    ['/내정보', '연결된 선수 · 티어 · 솔로 랭크 점수 · 신청한 내전'],
    ['/참가 [내전]', '참가 신청 (비우면 모집 중인 가장 가까운 내전). 공지의 [참가하기] 버튼도 같아요'],
    ['/참가취소 [내전]', '참가 취소 (팀이 짜인 뒤에는 운영진이 직접)']
  ]],
  ['운영진 (서버 관리자 · 무명섬 관리자)', [
    ['/내전공지 [내전]', '참가 버튼이 달린 공지를 공지 채널에 올려요. "예정" 내전은 "참가 모집 중"으로 바뀌어요'],
    ['/소개공지', '무명섬 소개 공지(그림 + 사이트 버튼)를 그 채널에 올려요. 뜨는 창에서 제목 · 내용을 고쳐요'],
    ['/mvp 시작 [내전] [라운드]', '라운드 MVP 투표를 손으로 열거나 다시 열기 (보통은 결과를 확정하면 자동으로 열려요)'],
    ['/mvp 마감 [내전] [라운드]', '30분을 기다리지 않고 바로 마감 · 발표 (공동 1위면 추첨 · 라운드 기록에 저장)'],
    ['/채널설정 공지 · 명령어 · 명령어해제 · 보기', '공지 · 알림 채널(공지 · 투표 · 발표 · 라운드 결과)과 참가자 명령어 채널 정하기'],
    ['/관리자키 [@유저]', '그 사람 계정으로만 쓸 수 있는 24시간 키를 DM 으로 (비우면 나)'],
    ['/관리자목록', '지금 관리자 · 로그인 전 추가 · 안 쓴 키 개수']
  ]],
  ['무명섬 소유자 · 공동 소유자', [
    ['/관리자추가 @유저', '키 없이 바로 무명섬 관리자로 (아래 "관리자 바로 추가"와 같아요). 유저 칸에서 @ 로 사람을 골라요. DM 으로 안내가 가요'],
    ['/관리자해제 @유저', '바로 관리자 화면에 못 들어오게 막고, 그 사람 앞으로 남은 키 · 로그인 전 추가도 취소해요 (공동 소유자를 빼는 건 소유자만)']
  ]]
];

// 권한 이름 · 색 · 목록 순서
const ROLES = { owner: ['소유자', 'soft', 0], co_owner: ['공동 소유자', 'warn', 1], admin: ['관리자', 'sky', 2] };
const roleOf = (r) => ROLES[r] || ROLES.admin;
const NEED_11 = 'Supabase SQL Editor 에서 20261029040000_co_owner.sql (11단계)을 먼저 실행해 주세요.';

startAdmin('access', async (main, { user, isOwner }) => {
  const state = { lock: 'any', fresh: null, freshFor: '', copied: false, busy: false, grantMode: 'player', granting: false };
  let keys = [], admins = [], grants = null, linked = [];
  // 진짜 소유자인지 (공동 소유자 정하기) · 11단계 SQL 전이면 null
  const isPrimary = await rpc('is_primary_owner').catch(() => null);
  const coOwnerReady = isPrimary !== null;
  const meOwner = () => admins.some((a) => a.user_id === user?.id && a.role === 'owner' && !a.revoked_at);

  const reload = async () => {
    const now = new Date().toISOString();
    let privates, players;
    [keys, admins, grants, privates, players] = await Promise.all([
      select('admin_keys', { isNull: ['used_at', 'revoked_at'], gte: { expires_at: now }, order: 'created_at', asc: false }),
      select('admins', { order: 'created_at' }),
      select('admin_grants', { isNull: ['used_at', 'revoked_at'], order: 'created_at', asc: false }).catch(() => null),   // 8단계 SQL 전이면 null
      select('player_private').catch(() => []),
      select('players', { columns: 'id, display_name, active', order: 'display_name' }).catch(() => [])
    ]);
    // 디스코드가 연결된 선수 (봇 /연결 → 대시보드 승인)
    const nameOf = new Map(players.map((p) => [p.id, p.display_name]));
    linked = privates.filter((r) => r.discord_id && nameOf.has(r.player_id))
      .map((r) => ({ discordId: r.discord_id, name: nameOf.get(r.player_id) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  };
  const activeAdmin = (discordId) => admins.some((a) => a.discord_id === discordId && !a.revoked_at);
  const waiting = (discordId) => (grants || []).some((g) => g.discord_id === discordId);

  const left = (ts) => {
    const ms = new Date(ts) - Date.now();
    const h = Math.floor(ms / 3600000);
    return h >= 24 ? `${Math.floor(h / 24)}일 남음` : h >= 1 ? `${h}시간 남음` : `${Math.max(1, Math.round(ms / 60000))}분 남음`;
  };

  const grantCard = () => {
    if (grants === null) {
      return html`<section class="card ink"><h2>관리자 바로 추가</h2><p class="notice warn" style="margin: 0">Supabase SQL Editor 에서 <b>20261029000000_admin_grants.sql</b> (8단계)을 실행하면 키 없이 디스코드 계정을 바로 관리자로 추가할 수 있어요.</p></section>`;
    }
    const list = grants.length ? html`<div class="stack" style="gap: 8px"><b style="font-size: 14px">사이트 로그인 기다리는 중 ${grants.length}명</b>
        ${grants.map((g) => html`<div class="flex" style="background: var(--bg); border-radius: 18px; padding: 10px 14px"><span style="flex: 1 1 200px; display: grid"><b>${g.discord_name || '이름 없음'}</b><small class="muted" style="font-weight: 600">디스코드 ID ${g.discord_id} · ${g.created_via === 'bot' ? '봇 /관리자추가' : '웹'} · ${dateTimeShort(g.created_at)} · 운영진 명령어는 지금도 돼요</small></span>${isOwner ? html`<button class="btn sm ghost danger" type="button" data-cancel-grant="${g.discord_id}">취소</button>` : ''}</div>`)}
      </div>` : '';
    if (!isOwner) {
      return html`<section class="card ink"><h2>관리자 바로 추가</h2><p class="muted" style="margin: 0; font-weight: 600">관리자 바로 추가는 소유자 · 공동 소유자만 할 수 있어요. 다른 운영진을 부르려면 아래에서 관리자 키를 만들어 주세요.</p>${list}</section>`;
    }
    const options = linked.map((l) => {
      const tag = activeAdmin(l.discordId) ? ' (이미 관리자)' : waiting(l.discordId) ? ' (로그인 기다리는 중)' : '';
      return html`<option value="${l.discordId}" data-name="${l.name}" ${tag ? 'disabled' : ''}>${l.name}${tag}</option>`;
    });
    const canPick = linked.some((l) => !activeAdmin(l.discordId) && !waiting(l.discordId));
    return html`<section class="card ink"><h2>관리자 바로 추가</h2>
      <p class="muted" style="margin: 0; font-weight: 600">키 없이 디스코드 계정을 바로 관리자로 만들어요. 관리자 화면에 들어올 수 있고, 디스코드 봇의 운영진 명령어(/내전공지 · /mvp · /채널설정 …)도 서버 관리자처럼 쓸 수 있어요.</p>
      <form data-grant class="stack" style="gap: 12px">
        <div class="pills" role="radiogroup" aria-label="추가할 사람 고르는 방법">${[['player', '디스코드 연결된 선수'], ['id', '디스코드 ID 직접']].map(([id, l]) => html`<button type="button" role="radio" data-grant-mode="${id}" aria-pressed="${state.grantMode === id}" aria-checked="${state.grantMode === id}">${l}</button>`)}</div>
        ${state.grantMode === 'player'
          ? (linked.length
            ? html`<label class="field">선수 <select name="pick" required>${canPick ? '' : html`<option value="">고를 수 있는 선수가 없어요</option>`}${options}</select><span class="hint">봇 /연결 로 디스코드를 연결한 선수만 나와요</span></label>`
            : html`<p class="notice" style="margin: 0">디스코드가 연결된 선수가 아직 없어요. 봇에서 <b>/연결 게임닉네임</b> → 대시보드에서 승인하면 여기서 고를 수 있어요. 또는 "디스코드 ID 직접"을 써 주세요.</p>`)
          : html`<label class="field">디스코드 사용자 ID <input name="did" required inputmode="numeric" pattern="[0-9]{15,21}" autocomplete="off" placeholder="예: 123456789012345678"><span class="hint">디스코드 설정 → 고급 → 개발자 모드 켜기 → 그 사람 프로필 우클릭 → 사용자 ID 복사</span></label>
            <label class="field">이름 (목록에 보일 이름) <input name="name" maxlength="40" placeholder="예: 호텔투숙객"></label>`}
        <div class="flex"><span class="spacer"></span><button class="btn pink" type="submit" ${state.granting || (state.grantMode === 'player' && !canPick) ? 'disabled' : ''}>관리자로 추가</button></div>
      </form>
      ${list}
    </section>`;
  };

  const sortedAdmins = () => [...admins].sort((a, b) => (!!a.revoked_at - !!b.revoked_at) || (roleOf(a.role)[2] - roleOf(b.role)[2]) || String(a.created_at).localeCompare(String(b.created_at)));
  const small = (t) => html`<small class="muted" style="font-weight: 700">${t}</small>`;
  // 줄마다 할 수 있는 일: 소유자는 못 건드리고, 공동 소유자는 소유자만 바꿔요
  const actions = (a) => {
    if (a.role === 'owner') return small('해제 불가');
    if (a.revoked_at) return isOwner ? html`<button class="btn sm" type="button" data-toggle-admin="${a.user_id}" data-revoked="1">되돌리기</button>` : '';
    if (a.role === 'co_owner') return isPrimary ? html`<button class="btn sm ghost" type="button" data-set-role="admin" data-user="${a.user_id}" data-name="${a.discord_name || ''}">관리자로 내리기</button>` : small('소유자만 바꿀 수 있어요');
    return html`${isPrimary ? html`<button class="btn sm" type="button" data-set-role="co_owner" data-user="${a.user_id}" data-name="${a.discord_name || ''}">공동 소유자로</button>` : ''}${isOwner ? html`<button class="btn sm ghost danger" type="button" data-toggle-admin="${a.user_id}" data-revoked="">해제</button>` : ''}`;
  };
  const coOwnerNote = () => {
    const what = '공동 소유자는 소유자처럼 관리자를 바로 추가하고 해제할 수 있는 관리자예요. 소유자와 다른 공동 소유자는 못 빼고, 공동 소유자를 정하는 건 소유자만 해요. Supabase · Vercel · 봇 서버 계정은 따로라서 여기서 생기지 않아요.';
    if (!coOwnerReady && meOwner()) return `${what} 쓰려면 ${NEED_11}`;
    if (!isOwner) return `관리자 해제는 소유자 · 공동 소유자만 할 수 있어요. ${what}`;
    return what;
  };

  const draw = () => mount(main, html`
    <div><h1>권한 관리</h1><p class="lead">관리자는 디스코드로 로그인해요. 소유자 · 공동 소유자가 디스코드 계정을 바로 추가하거나, 관리자 키를 주면 돼요! 디스코드 서버 역할이랑은 상관없어서 서버 권한이 바뀌어도 괜찮답니다.</p></div>
    <div class="row">
      <div class="grow stack" style="gap: 18px">
        ${grantCard()}
        <section class="card"><h2>관리자 키 만들기</h2>
          <form data-make class="stack" style="gap: 12px">
            <label class="field">메모 (누구에게 주는 키인지) <input name="memo" maxlength="40" placeholder="예: 호텔투숙객 · 결과 검토 담당"></label>
            <div class="stack" style="gap: 6px"><span style="font-size: 13px; font-weight: 700">사용할 수 있는 계정</span>
              <div class="pills" role="radiogroup">${[['any', '아무 디스코드 계정'], ['one', '이 계정만']].map(([id, l]) => html`<button type="button" role="radio" data-lock="${id}" aria-pressed="${state.lock === id}" aria-checked="${state.lock === id}">${l}</button>`)}</div></div>
            ${state.lock === 'one' ? html`<label class="field">디스코드 사용자명 또는 사용자 ID <input name="target" required placeholder="@디스코드사용자명"><span class="hint">다른 계정이 이 키를 넣으면 거절돼요. 키가 새도 안전해요.</span></label>` : ''}
            <div class="flex" style="align-items: flex-end"><label class="field">유효 시간 <select name="ttl"><option value="1">1시간</option><option value="24" selected>24시간</option><option value="168">7일</option></select></label><span class="spacer"></span><button class="btn pink" type="submit" ${state.busy ? 'disabled' : ''}>키 만들기</button></div>
          </form>
          ${state.fresh ? html`<div role="status" class="stack" style="justify-items: center; text-align: center; gap: 10px; background: var(--sky-soft); border: 3px solid var(--ink); border-radius: 24px; padding: 18px">
            <span style="font-size: 13px; font-weight: 700">${state.freshFor}</span>
            <span style="font-family: Consolas, 'D2Coding', monospace; font-weight: 700; font-size: 30px; letter-spacing: 0.1em; background: var(--card); border: 2px solid var(--ink); border-radius: 16px; padding: 6px 18px">${state.fresh}</span>
            <span class="flex"><button class="btn sky" type="button" data-copy>${state.copied ? '복사했어요' : '키 복사'}</button><button class="btn ghost" type="button" data-close>닫기</button></span>
            <span style="font-size: 12px; font-weight: 700; color: var(--pink-ink)">이 키는 지금 한 번만 보여요. 닫으면 다시 볼 수 없어요.</span>
          </div>` : ''}
        </section>
        <section class="card"><h2>아직 안 쓴 키 ${keys.length}개</h2>
          ${keys.length ? keys.map((k) => html`<div class="flex" style="background: var(--bg); border-radius: 18px; padding: 10px 14px"><b style="font-family: Consolas, monospace">${k.prefix}-••••-••••</b><span style="flex: 1 1 200px; display: grid"><b>${k.memo || '메모 없음'}</b><small class="muted" style="font-weight: 600">${k.target_discord ? '@' + k.target_discord + ' 만' : '아무 계정'} · ${k.created_via === 'bot' ? '봇 명령어' : '웹'} · ${left(k.expires_at)}</small></span><button class="btn sm ghost danger" type="button" data-revoke-key="${k.id}">취소</button></div>`) : html`<p class="muted" style="margin: 0; font-weight: 600">남아 있는 키가 없어요.</p>`}
        </section>
      </div>
      <div class="side stack" style="gap: 18px">
        <section class="card" style="border-color: var(--sky-ink)"><h2>디스코드 봇 명령어</h2>
          ${BOT_COMMANDS.map(([group, list]) => html`<div class="stack" style="gap: 6px"><b style="font-family: var(--head); font-size: 15px; color: var(--sky-ink)">${group}</b>
            ${list.map(([c, d]) => html`<div style="display: grid; gap: 2px; background: var(--sky-soft); border-radius: 16px; padding: 8px 12px"><code style="font-weight: 700">${c}</code><span style="font-size: 13px; font-weight: 600">${d}</span></div>`)}</div>`)}
          <small class="muted" style="font-weight: 600">결과 검토에서 라운드를 확정하면 30초 안에 공지 채널에 결과가 자동으로 올라가요. 참가 공지도 일정이 모집 중이 되면 바로, 시작 24시간 전에 한 번 더 자동으로 올라가요. 라운드를 확정하면 그 라운드 MVP 투표가 열리고 30분 뒤 자동으로 마감 · 발표돼요. 내전이 끝나면 참가 공지 · 투표 메시지는 지워지고 결과 · MVP 발표는 남아요. 운영진 명령어는 목록에는 누구나 보이지만 서버 관리자나 무명섬 관리자만 쓸 수 있어요. 봇 답장은 대부분 나만 보이게 와요. 설치 · 채널 나누기 · 서버 옮기기는 GitHub 의 bot/README.md 를 봐 주세요.</small>
        </section>
        <section class="card"><h2>안전장치</h2><ul style="margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; font-weight: 600">
          <li>키는 1회용이고, 유효 시간이 지나면 못 써요</li><li>키 원문은 저장하지 않고 암호화한 값만 남겨요</li><li>키를 5번 틀리면 10분 동안 막혀요</li><li>관리자 기능을 쓸 때마다 권한을 다시 확인해서, 해제하면 바로 막혀요</li><li>바로 추가 · 해제는 소유자 · 공동 소유자만 할 수 있고, 디스코드가 알려 준 로그인 기록으로 본인인지 확인해요</li><li>소유자는 처음 한 번 소유자 키로 등록하고, 해제할 수 없어요</li><li>공동 소유자는 소유자만 정하고 뺄 수 있어요. 공동 소유자끼리도 서로 못 빼요</li></ul></section>
      </div>
    </div>
    <section class="card"><h2>관리자 ${admins.filter((a) => !a.revoked_at).length}명</h2>
      <div class="table-wrap"><table class="data" style="min-width: 680px"><thead><tr><th>관리자</th><th>권한</th><th>등록 방법</th><th>마지막 접속</th><th><span class="sr-only">관리</span></th></tr></thead><tbody>
        ${sortedAdmins().map((a) => html`<tr style="${a.revoked_at ? 'opacity: 0.55' : ''}"><td><b>${a.discord_name || '이름 없음'}</b>${a.user_id === user?.id ? html` <small class="muted" style="font-weight: 700">(나)</small>` : ''}${a.discord_id ? html`<br><small class="muted">ID ${a.discord_id}</small>` : ''}</td>
          <td><span class="chip ${roleOf(a.role)[1]}" style="font-size: 12px; padding: 1px 10px">${roleOf(a.role)[0]}</span></td><td style="font-weight: 600">${a.registered_via}</td><td class="num muted">${a.revoked_at ? '해제됨' : dateTimeShort(a.last_seen_at)}</td>
          <td class="r"><span class="flex" style="justify-content: flex-end; flex-wrap: nowrap; gap: 6px">${actions(a)}</span></td></tr>`)}
      </tbody></table></div>
      <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">${coOwnerNote()}</p>
    </section>`);

  on(main, 'click', '[data-lock]', (_e, b) => { state.lock = b.dataset.lock; draw(); });
  on(main, 'click', '[data-grant-mode]', (_e, b) => { state.grantMode = b.dataset.grantMode; draw(); });
  on(main, 'submit', '[data-grant]', async (e, f) => {
    e.preventDefault();
    let did, name;
    if (state.grantMode === 'player') {
      const opt = f.pick?.selectedOptions?.[0];
      did = opt?.value || '';
      name = opt?.dataset.name || '';
    } else {
      did = f.did.value.replace(/\s/g, '');
      name = f.name.value.trim();
    }
    if (!did) return;
    state.granting = true; draw();
    try {
      const r = await rpc('grant_admin', { p_discord_id: did, p_name: name });
      const who = name || r?.name || '그 사람';
      toast(r?.state === 'already' ? `${who} 님은 이미 관리자예요.`
        : r?.state === 'added' ? `${who} 님을 바로 관리자로 추가했어요!`
        : `${who} 님을 관리자로 추가했어요! 디스코드로 처음 로그인하면 바로 관리자 화면이 열려요. 봇 운영진 명령어는 지금부터 돼요.`);
      await reload();
    } catch (err) { toast('추가하지 못했어요: ' + errorText(err), true); }
    state.granting = false; draw();
  });
  on(main, 'click', '[data-cancel-grant]', async (_e, b) => {
    try { await rpc('revoke_admin_grant', { p_discord_id: b.dataset.cancelGrant }); await reload(); draw(); toast('관리자 추가를 취소했어요.'); } catch (err) { toast(errorText(err), true); }
  });
  on(main, 'click', '[data-close]', () => { state.fresh = null; draw(); });
  on(main, 'click', '[data-copy]', async () => { try { await navigator.clipboard.writeText(state.fresh); } catch { /* 직접 복사 */ } state.copied = true; draw(); });
  on(main, 'submit', '[data-make]', async (e, f) => {
    e.preventDefault();
    const memo = f.memo.value.trim();
    const target = state.lock === 'one' ? f.target.value.trim() : '';
    const ttl = Number(f.ttl.value);
    state.busy = true; draw();
    try {
      state.fresh = await rpc('create_admin_key', { p_memo: memo, p_target: target, p_ttl_hours: ttl });
      state.freshFor = `${memo || '새 관리자'} · ${target ? target + ' 만' : '아무 계정'} · ${ttl === 168 ? '7일' : ttl + '시간'}`;
      state.copied = false;
      await reload();
    } catch (err) { toast('키를 만들지 못했어요: ' + errorText(err), true); }
    state.busy = false; draw();
  });
  on(main, 'click', '[data-revoke-key]', async (_e, b) => {
    try { await rpc('revoke_admin_key', { p_id: b.dataset.revokeKey }); await reload(); draw(); toast('키를 취소했어요.'); } catch (err) { toast(errorText(err), true); }
  });
  on(main, 'click', '[data-toggle-admin]', async (_e, b) => {
    try { await rpc('set_admin_revoked', { p_user: b.dataset.toggleAdmin, p_revoked: !b.dataset.revoked }); await reload(); draw(); } catch (err) { toast(errorText(err), true); }
  });
  on(main, 'click', '[data-set-role]', async (_e, b) => {
    const up = b.dataset.setRole === 'co_owner';
    const who = b.dataset.name || '이 관리자';
    if (up && !confirm(`${who} 님을 공동 소유자로 올릴까요?\n관리자를 바로 추가하고 해제하는 일을 소유자처럼 할 수 있게 돼요. 소유자(나)는 못 빼요.`)) return;
    try {
      await rpc('set_admin_role', { p_user: b.dataset.user, p_role: b.dataset.setRole });
      await reload(); draw();
      toast(up ? `${who} 님이 공동 소유자가 됐어요.` : `${who} 님을 관리자로 내렸어요.`);
    } catch (err) {
      const msg = errorText(err);
      toast(/set_admin_role|schema cache|admins_role_check/.test(msg) ? NEED_11 : msg, true);
    }
  });

  await reload();
  if (!linked.length) state.grantMode = 'id';   // 연결된 선수가 없으면 ID 직접 넣기부터
  draw();
});
