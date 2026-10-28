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
  ['서버 관리자', [
    ['/내전공지 [내전]', '참가 버튼이 달린 공지를 그 채널에 올려요. "예정" 내전은 "참가 모집 중"으로 바뀌어요'],
    ['/mvp 시작 [내전]', '참가자끼리 MVP 투표 (자기 자신 X, 마감 전까지 바꾸기 O)'],
    ['/mvp 마감 [내전]', '최다 득표가 MVP, 공동 1위면 추첨 → 내전 기록에 저장'],
    ['/채널설정 공지 · 명령어 · 명령어해제 · 보기', '공지 · 알림 채널(공지 · 투표 · 발표 · 라운드 결과)과 참가자 명령어 채널 정하기'],
    ['/관리자키 [@유저]', '그 사람 계정으로만 쓸 수 있는 24시간 키를 DM 으로 (비우면 나). 무명섬 관리자도 쓸 수 있어요'],
    ['/관리자목록', '지금 관리자와 안 쓴 키 개수 (무명섬 관리자도 쓸 수 있어요)']
  ]],
  ['무명섬 소유자', [
    ['/관리자해제 @유저', '바로 관리자 화면에 못 들어오게 막고, 그 사람 앞으로 남은 키도 취소해요']
  ]]
];

startAdmin('access', async (main, { isOwner }) => {
  const state = { lock: 'any', fresh: null, freshFor: '', copied: false, busy: false };
  let keys = [], admins = [];

  const reload = async () => {
    const now = new Date().toISOString();
    [keys, admins] = await Promise.all([
      select('admin_keys', { isNull: ['used_at', 'revoked_at'], gte: { expires_at: now }, order: 'created_at', asc: false }),
      select('admins', { order: 'created_at' })
    ]);
  };

  const left = (ts) => {
    const ms = new Date(ts) - Date.now();
    const h = Math.floor(ms / 3600000);
    return h >= 24 ? `${Math.floor(h / 24)}일 남음` : h >= 1 ? `${h}시간 남음` : `${Math.max(1, Math.round(ms / 60000))}분 남음`;
  };

  const draw = () => mount(main, html`
    <div><h1>권한 관리</h1><p class="lead">관리자는 디스코드 로그인 + 관리자 키로 딱 한 번 등록해요! 디스코드 서버 역할이랑은 상관없어서 소유자가 그 서버에 없어도 괜찮답니다.</p></div>
    <div class="row">
      <div class="grow stack" style="gap: 18px">
        <section class="card ink"><h2>관리자 키 만들기</h2>
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
          <small class="muted" style="font-weight: 600">결과 검토에서 라운드를 확정하면 30초 안에 공지 채널에 결과가 자동으로 올라가요. 관리자 명령어는 디스코드 서버 관리자에게만 보이고, 봇 답장은 대부분 나만 보이게 와요. 설치 · 채널 나누기 · 서버 옮기기는 GitHub 의 bot/README.md 를 봐 주세요.</small>
        </section>
        <section class="card"><h2>안전장치</h2><ul style="margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: 13px; font-weight: 600">
          <li>키는 1회용이고, 유효 시간이 지나면 못 써요</li><li>키 원문은 저장하지 않고 암호화한 값만 남겨요</li><li>키를 5번 틀리면 10분 동안 막혀요</li><li>관리자 기능을 쓸 때마다 권한을 다시 확인해서, 해제하면 바로 막혀요</li><li>소유자는 처음 한 번 소유자 키로 등록하고, 해제할 수 없어요</li></ul></section>
      </div>
    </div>
    <section class="card"><h2>관리자 ${admins.filter((a) => !a.revoked_at).length}명</h2>
      <div class="table-wrap"><table class="data" style="min-width: 620px"><thead><tr><th>관리자</th><th>권한</th><th>등록 방법</th><th>마지막 접속</th><th><span class="sr-only">관리</span></th></tr></thead><tbody>
        ${admins.map((a) => html`<tr style="${a.revoked_at ? 'opacity: 0.55' : ''}"><td><b>${a.discord_name || '이름 없음'}</b>${a.discord_id ? html`<br><small class="muted">ID ${a.discord_id}</small>` : ''}</td>
          <td><span class="chip ${a.role === 'owner' ? 'soft' : 'sky'}" style="font-size: 12px; padding: 1px 10px">${a.role === 'owner' ? '소유자' : '관리자'}</span></td><td style="font-weight: 600">${a.registered_via}</td><td class="num muted">${a.revoked_at ? '해제됨' : dateTimeShort(a.last_seen_at)}</td>
          <td class="r">${a.role === 'owner' ? html`<small class="muted" style="font-weight: 700">해제 불가</small>` : isOwner ? html`<button class="btn sm ${a.revoked_at ? '' : 'ghost danger'}" type="button" data-toggle-admin="${a.user_id}" data-revoked="${a.revoked_at ? '1' : ''}">${a.revoked_at ? '되돌리기' : '해제'}</button>` : ''}</td></tr>`)}
      </tbody></table></div>
      ${!isOwner ? html`<p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">관리자 해제는 소유자만 할 수 있어요.</p>` : ''}
    </section>`);

  on(main, 'click', '[data-lock]', (_e, b) => { state.lock = b.dataset.lock; draw(); });
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

  await reload();
  draw();
});
