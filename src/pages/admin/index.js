import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText } from '../../lib/dom.js';
import { select, rpc } from '../../lib/db.js';
import { loadEvents, nextEvent, loadPlayers } from '../../lib/api.js';
import { dateKo, timeKo, FORMAT_LABEL, dateTimeShort } from '../../lib/fmt.js';
import { isDemo } from '../../lib/supabase.js';
import { mountLiveControl } from '../../components/live-control.js';
import { liveReady } from '../../lib/live-api.js';

startAdmin('home', async (main, { user }) => {
 const render = async () => {
  const [events, { list, byId }, pending, admins, devices, links, linked, bot, grants, site] = await Promise.all([
    loadEvents(), loadPlayers({ includeInactive: true }),
    select('rounds', { eq: { status: 'pending' } }), select('admins'),
    select('upload_devices').catch(() => null),   // 2단계 SQL 실행 전이면 null
    select('discord_link_requests', { eq: { status: 'pending' }, order: 'created_at' }).catch(() => null),   // 6단계 SQL 실행 전이면 null
    select('player_private').catch(() => []),
    select('bot_status').catch(() => []),
    select('admin_grants', { columns: 'discord_id' }).catch(() => null),   // 8단계 SQL 실행 전이면 null
    select('site_settings', { eq: { id: 1 } }).catch(() => null)   // 12단계 SQL 실행 전이면 null
  ]);
  const discordOf = new Map((linked || []).filter((r) => r.discord_id).map((r) => [r.player_id, r.discord_id]));
  const botSeen = bot?.[0]?.last_seen_at;
  const botAlive = botSeen && Date.now() - Date.parse(botSeen) < 12 * 60000;
  const liveDevices = (devices || []).filter((d) => !d.revoked_at);
  const lastUpload = liveDevices.map((d) => d.last_seen_at).filter(Boolean).sort().pop();
  const withChannel = list.filter((p) => p.active && (p.chzzkId || p.youtubeUrl));
  const lastLiveCheck = withChannel.map((p) => p.liveCheckedAt).filter(Boolean).sort().pop();
  const liveFresh = lastLiveCheck && Date.now() - Date.parse(lastLiveCheck) < 20 * 60000;
  const liveNow = withChannel.filter((p) => p.isLive).length;
  const next = nextEvent(events);
  const synced = list.filter((p) => p.rank?.syncedAt);
  const lastSync = synced.map((p) => p.rank.syncedAt).sort().pop();
  const syncIssues = list.filter((p) => p.active && (!p.rank || p.rank.error));
  const noRank = list.filter((p) => p.active && p.rank && !p.rank.error && p.rank.score == null);

  const todos = [
    devices === null && ['결과 검토용 DB 추가하기', 'Supabase SQL Editor 에서 20261028000000_results.sql 을 실행해 주세요 (README 10번)', '/admin/review', '확인'],
    devices && !liveDevices.length && ['업로드 장치 연결하기', '게임 PC 에 업로드 프로그램을 켜 두면 결과 CSV 가 자동으로 올라와요', '/admin/devices', '설정하기'],
    !list.length && ['첫 선수 등록하기', '선수 관리에서 이름 · 게임 닉네임 · 티어를 넣어 주세요', '/admin/players', '선수 관리'],
    list.length && !synced.length && ['이리 데이터 처음 동기화', '솔로 랭크 점수랑 모스트 실험체를 가져와요', '/admin/players', '동기화'],
    syncIssues.length && synced.length && [`연동 확인 필요 ${syncIssues.length}명`, syncIssues.slice(0, 3).map((p) => p.name).join(' · ') + ' · 닉네임을 확인하고 다시 동기화해 주세요', '/admin/players', '선수 관리'],
    noRank.length && [`솔로 랭크 기록 없는 생존자 ${noRank.length}명`, noRank.slice(0, 3).map((p) => p.name).join(' · ') + ' · 자동 편성 때 같은 티어 평균 점수로 계산돼요', '/admin/tiers', '티어 관리'],
    pending.length && [`결과 검토 대기 ${pending.length}건`, '확정하면 기록과 랭킹에 반영돼요', '/admin/review', '검토하기'],
    !events.length && ['첫 내전 일정 만들기', '날짜 · 방식 · 참가자를 정해요', '/admin/schedule', '일정 관리'],
    admins.length < 2 && ['운영진 초대하기', '권한 관리에서 관리자 키를 만들어 전해 주세요', '/admin/access', '권한 관리'],
    links === null && ['디스코드 봇용 DB 추가하기', 'Supabase SQL Editor 에서 20261028080000_discord_bot.sql 을 실행해 주세요 (README 14번)', '/admin', '확인'],
    grants === null && ['관리자 바로 추가용 DB 추가하기', 'Supabase SQL Editor 에서 20261029000000_admin_grants.sql 을 실행해 주세요 (README 16번)', '/admin/access', '확인'],
    !liveReady(events) && ['방송 오버레이용 DB 추가하기', 'Supabase SQL Editor 에서 20261028100000_overlay.sql 을 실행해 주세요 (README 15번)', '/admin/live', '확인'],
    !site?.length && ['회차 · 기록 공개 설정용 DB 추가하기', 'Supabase SQL Editor 에서 20261030000000_records_privacy.sql 을 실행해 주세요 (README 20번). 그 전까지 공개 사이트는 경쟁 기록을 숨겨요', '/admin/records', '확인'],
    site?.length && !site[0].records_public && ['경쟁 기록 비공개 중', '내전 결과 · 우승 기록 · 개인 기록 · TK · MVP 가 공개 사이트에서 숨겨져 있어요. 기록은 계속 쌓여요', '/admin/records', '기록 공개']
  ].filter(Boolean);
  const linkCard = links && links.length ? html`<section class="card ink"><div class="card-head"><h2>디스코드 연결 요청 ${links.length}건</h2><small class="muted" style="font-weight: 600">봇의 /연결 게임닉네임</small></div>
    <ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 8px">${links.map((r) => {
      const p = byId.get(r.player_id);
      const cur = discordOf.get(r.player_id);
      return html`<li class="flex" style="flex-wrap: wrap; gap: 10px; background: var(--soft); border-radius: 18px; padding: 10px 12px">
        <span style="flex: 1 1 260px; display: grid; min-width: 0"><b>${r.discord_name || '디스코드 사용자'} → ${p ? p.name : '알 수 없는 선수'}</b>
          <small class="muted" style="font-weight: 600">디스코드 ID ${r.discord_id} · 게임 닉네임 ${p?.erNickname ?? '-'} · ${dateTimeShort(r.created_at)}${cur && cur !== r.discord_id ? ' · 지금은 다른 디스코드 계정과 연결돼 있어요 (승인하면 바뀌어요)' : ''}</small></span>
        <button type="button" class="btn sm pink" data-link="${r.id}" data-ok="1">승인</button><button type="button" class="btn sm ghost danger" data-link="${r.id}" data-ok="0">거절</button></li>`;
    })}</ul>
    <small class="muted" style="font-weight: 600">진짜 그 선수가 맞는지 확인하고 승인해 주세요. 승인하면 그 디스코드 계정으로 참가 신청 · MVP 투표를 할 수 있어요.</small></section>` : '';

  mount(main, html`
    <div><h1>대시보드</h1><p class="lead">어서 오세요! ${dateKo(new Date())}, ${next ? `다음 내전까지 ${Math.max(0, Math.ceil((new Date(next.starts_at) - Date.now()) / 86400000))}일 남았답니다.` : '아직 잡힌 내전이 없어요.'}</p></div>
    ${isDemo ? html`<p class="notice" style="margin: 0">지금은 예시 데이터로 돌아가는 데모 모드예요. 바꾼 내용은 새로고침하면 사라져요. Supabase 를 연결하면 진짜로 저장돼요.</p>` : ''}
    <div data-live-control></div>
    ${next ? html`<section class="hero" style="padding: 26px 28px; align-items: center">
      <div style="flex: 999 1 320px; display: grid; gap: 8px"><span class="sticker">다음 내전 · ${({ plan: '예정', open: '모집 중', fixed: '확정', done: '완료' })[next.status]}</span>
        <h2 class="big" style="font-size: 34px">${dateKo(next.starts_at)} ${timeKo(next.starts_at)}</h2>
        <p style="margin: 0; font-weight: 700">${FORMAT_LABEL[next.format]} · ${next.planned_rounds}라운드 · 참가 ${next.joined} / ${next.max_players}${next.setting_code ? html` · 설정 코드 <span class="num" style="background: var(--card); border: 2px solid var(--ink); border-radius: 10px; padding: 0 8px">${next.setting_code}</span>` : ''}</p></div>
      <div class="flex" style="flex: 1 1 220px; justify-content: flex-end"><a class="btn big" href="/admin/teams">${next.format === 'draft' ? '드래프트 준비' : '팀 편성'}</a><a class="btn big sky" href="/admin/schedule">일정 수정</a></div>
    </section>` : ''}
    ${linkCard}
    <div class="row">
      <section class="card grow" style="flex-basis: 380px"><h2>할 일</h2>
        ${todos.length ? html`<ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 8px">${todos.map(([t, s, href, go]) => html`<li class="flex" style="flex-wrap: nowrap; background: var(--soft); border-radius: 18px; padding: 10px 12px"><span style="flex: 1 1 auto; display: grid; min-width: 0"><b>${t}</b><small class="muted" style="font-weight: 600">${s}</small></span><a class="btn sm ghost" href="${href}">${go}</a></li>`)}</ul>` : html`<p class="muted" style="margin: 0; font-weight: 600">지금은 할 일이 없어요. 데이터가 깨끗해요, 헤헤.</p>`}
      </section>
      <section class="card side"><h2>연동 상태</h2>
        <ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px">
          <li class="flex" style="flex-wrap: nowrap"><span aria-hidden="true" style="width: 12px; height: 12px; border-radius: 50%; background: ${synced.length ? 'var(--good)' : 'var(--muted)'}"></span><span style="flex: 1 1 auto; display: grid"><b>이터널 리턴 Open API</b><small class="muted" style="font-weight: 600">${synced.length ? `솔로 랭크 점수 · 마지막 동기화 ${dateTimeShort(lastSync)}` : '아직 동기화 전'}</small></span></li>
          <li class="flex" style="flex-wrap: nowrap"><span aria-hidden="true" style="width: 12px; height: 12px; border-radius: 50%; background: ${liveFresh ? 'var(--good)' : lastLiveCheck ? 'var(--t3)' : 'var(--muted)'}"></span><span style="flex: 1 1 auto; display: grid"><b>치지직 · 유튜브</b><small class="muted" style="font-weight: 600">${!withChannel.length ? '방송 채널을 넣은 선수가 아직 없어요' : lastLiveCheck ? `방송 중 ${liveNow}명 · 마지막 확인 ${dateTimeShort(lastLiveCheck)}${liveFresh ? '' : ' (자동 확인이 멈췄어요)'}` : '아직 확인 전 · 선수 관리에서 새로 고침'}</small></span></li>
          <li class="flex" style="flex-wrap: nowrap"><span aria-hidden="true" style="width: 12px; height: 12px; border-radius: 50%; background: ${liveDevices.length ? 'var(--good)' : 'var(--muted)'}"></span><span style="flex: 1 1 auto; display: grid"><b>업로드 장치</b><small class="muted" style="font-weight: 600">${liveDevices.length ? `${liveDevices.length}대 등록 · ${lastUpload ? '마지막 업로드 ' + dateTimeShort(lastUpload) : '아직 업로드 없음'}` : '등록된 장치 없음'}</small></span></li>
          <li class="flex" style="flex-wrap: nowrap"><span aria-hidden="true" style="width: 12px; height: 12px; border-radius: 50%; background: ${botAlive ? 'var(--good)' : botSeen ? 'var(--t3)' : 'var(--muted)'}"></span><span style="flex: 1 1 auto; display: grid"><b>디스코드 봇</b><small class="muted" style="font-weight: 600">${botSeen ? `${botAlive ? '켜짐' : '꺼진 것 같아요'} · 마지막 신호 ${dateTimeShort(botSeen)} · 연결된 선수 ${discordOf.size}명` : links === null ? '6단계 SQL 실행 전' : '아직 봇을 켜지 않았어요 (bot/README.md)'}</small></span></li>
        </ul>
        <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">${loginLabel(user)}</p>
      </section>
    </div>`);
  const liveBox = main.querySelector('[data-live-control]');
  if (liveBox) mountLiveControl(liveBox);
 };
  on(main, 'click', '[data-link]', async (_e, b) => {
    const ok = b.dataset.ok === '1';
    if (!ok && !confirm('이 연결 요청을 거절할까요?')) return;
    b.disabled = true;
    try { await rpc('decide_discord_link', { p_id: b.dataset.link, p_ok: ok }); toast(ok ? '연결했어요! 이제 디스코드에서 참가 신청 · 투표를 할 수 있어요.' : '거절했어요.'); }
    catch (err) { toast(errorText(err), true); }
    await render();
  });
  await render();
});

function loginLabel(user) {
  const m = user?.user_metadata || {};
  return `로그인 계정: ${m.custom_claims?.global_name || m.full_name || m.name || '운영진'}`;
}
