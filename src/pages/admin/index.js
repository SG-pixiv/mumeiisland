import { startAdmin } from '../../components/shell.js';
import { html, mount } from '../../lib/dom.js';
import { select } from '../../lib/db.js';
import { loadEvents, nextEvent, loadPlayers } from '../../lib/api.js';
import { dateKo, timeKo, FORMAT_LABEL, dateTimeShort } from '../../lib/fmt.js';
import { isDemo } from '../../lib/supabase.js';

startAdmin('home', async (main, { user }) => {
  const [events, { list }, pending, admins, devices] = await Promise.all([
    loadEvents(), loadPlayers({ includeInactive: true }),
    select('rounds', { eq: { status: 'pending' } }), select('admins'),
    select('upload_devices').catch(() => null)   // 2단계 SQL 실행 전이면 null
  ]);
  const liveDevices = (devices || []).filter((d) => !d.revoked_at);
  const lastUpload = liveDevices.map((d) => d.last_seen_at).filter(Boolean).sort().pop();
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
    admins.length < 2 && ['운영진 초대하기', '권한 관리에서 관리자 키를 만들어 전해 주세요', '/admin/access', '권한 관리']
  ].filter(Boolean);

  mount(main, html`
    <div><h1>대시보드</h1><p class="lead">어서 오세요! ${dateKo(new Date())}, ${next ? `다음 내전까지 ${Math.max(0, Math.ceil((new Date(next.starts_at) - Date.now()) / 86400000))}일 남았답니다.` : '아직 잡힌 내전이 없어요.'}</p></div>
    ${isDemo ? html`<p class="notice" style="margin: 0">지금은 예시 데이터로 돌아가는 데모 모드예요. 바꾼 내용은 새로고침하면 사라져요. Supabase 를 연결하면 진짜로 저장돼요.</p>` : ''}
    ${next ? html`<section class="hero" style="padding: 26px 28px; align-items: center">
      <div style="flex: 999 1 320px; display: grid; gap: 8px"><span class="sticker">다음 내전 · ${({ plan: '예정', open: '모집 중', fixed: '확정', done: '완료' })[next.status]}</span>
        <h2 class="big" style="font-size: 34px">${dateKo(next.starts_at)} ${timeKo(next.starts_at)}</h2>
        <p style="margin: 0; font-weight: 700">${FORMAT_LABEL[next.format]} · ${next.planned_rounds}라운드 · 참가 ${next.joined} / ${next.max_players}${next.setting_code ? html` · 설정 코드 <span class="num" style="background: var(--card); border: 2px solid var(--ink); border-radius: 10px; padding: 0 8px">${next.setting_code}</span>` : ''}</p></div>
      <div class="flex" style="flex: 1 1 220px; justify-content: flex-end"><a class="btn big" href="/admin/teams">${next.format === 'draft' ? '드래프트 준비' : '팀 편성'}</a><a class="btn big sky" href="/admin/schedule">일정 수정</a></div>
    </section>` : ''}
    <div class="row">
      <section class="card grow" style="flex-basis: 380px"><h2>할 일</h2>
        ${todos.length ? html`<ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 8px">${todos.map(([t, s, href, go]) => html`<li class="flex" style="flex-wrap: nowrap; background: var(--soft); border-radius: 18px; padding: 10px 12px"><span style="flex: 1 1 auto; display: grid; min-width: 0"><b>${t}</b><small class="muted" style="font-weight: 600">${s}</small></span><a class="btn sm ghost" href="${href}">${go}</a></li>`)}</ul>` : html`<p class="muted" style="margin: 0; font-weight: 600">지금은 할 일이 없어요. 데이터가 깨끗해요, 헤헤.</p>`}
      </section>
      <section class="card side"><h2>연동 상태</h2>
        <ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px">
          <li class="flex" style="flex-wrap: nowrap"><span aria-hidden="true" style="width: 12px; height: 12px; border-radius: 50%; background: ${synced.length ? 'var(--good)' : 'var(--muted)'}"></span><span style="flex: 1 1 auto; display: grid"><b>이터널 리턴 Open API</b><small class="muted" style="font-weight: 600">${synced.length ? `솔로 랭크 점수 · 마지막 동기화 ${dateTimeShort(lastSync)}` : '아직 동기화 전'}</small></span></li>
          <li class="flex" style="flex-wrap: nowrap"><span aria-hidden="true" style="width: 12px; height: 12px; border-radius: 50%; background: var(--muted)"></span><span style="flex: 1 1 auto; display: grid"><b>치지직 · 유튜브</b><small class="muted" style="font-weight: 600">프로필 사진 · LIVE ON · 다음 단계에서 연결해요</small></span></li>
          <li class="flex" style="flex-wrap: nowrap"><span aria-hidden="true" style="width: 12px; height: 12px; border-radius: 50%; background: ${liveDevices.length ? 'var(--good)' : 'var(--muted)'}"></span><span style="flex: 1 1 auto; display: grid"><b>업로드 장치</b><small class="muted" style="font-weight: 600">${liveDevices.length ? `${liveDevices.length}대 등록 · ${lastUpload ? '마지막 업로드 ' + dateTimeShort(lastUpload) : '아직 업로드 없음'}` : '등록된 장치 없음'}</small></span></li>
          <li class="flex" style="flex-wrap: nowrap"><span aria-hidden="true" style="width: 12px; height: 12px; border-radius: 50%; background: var(--muted)"></span><span style="flex: 1 1 auto; display: grid"><b>디스코드 봇</b><small class="muted" style="font-weight: 600">MVP 투표 · 참가 신청 · 준비 중</small></span></li>
        </ul>
        <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">${loginLabel(user)}</p>
      </section>
    </div>`);
});

function loginLabel(user) {
  const m = user?.user_metadata || {};
  return `로그인 계정: ${m.custom_claims?.global_name || m.full_name || m.name || '운영진'}`;
}
