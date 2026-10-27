import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText } from '../../lib/dom.js';
import { update } from '../../lib/db.js';
import { loadScoring } from '../../lib/api.js';
import { score } from '../../lib/fmt.js';

const OFFICIAL = { placement: [10, 7, 5, 4, 3, 2, 1, 0], ks_early: 0.5, ks_late: 1, penalty: 1 };
const OFFICIAL_URL = 'https://playeternalreturn.com/posts/news/2684?hl=ko-KR';

startAdmin('scoring', async (main) => {
  const saved = await loadScoring();
  const st = { placement: (saved.placement || OFFICIAL.placement).map(Number), ks_early: Number(saved.ks_early), ks_late: Number(saved.ks_late), penalty: Number(saved.penalty), rank: 1, ek: 2, lk: 6, deaths: 1, busy: false };
  const isOfficial = () => st.placement.every((v, i) => v === OFFICIAL.placement[i]) && st.ks_early === OFFICIAL.ks_early && st.ks_late === OFFICIAL.ks_late && st.penalty === OFFICIAL.penalty;

  const calc = () => {
    const rs = st.placement[st.rank - 1] || 0;
    const ks = st.ek * st.ks_early + st.lk * st.ks_late;
    const pen = st.deaths * st.penalty;
    return html`<span style="background: var(--soft); border-radius: 18px; padding: 6px 16px">RS <b class="num">${score(rs)}</b></span><span aria-hidden="true">+</span><span style="background: var(--sky-soft); border-radius: 18px; padding: 6px 16px">KS <b class="num">${score(ks)}</b></span><span aria-hidden="true">−</span><span style="background: var(--t3s); border-radius: 18px; padding: 6px 16px">감점 <b class="num">${score(pen)}</b></span><span aria-hidden="true">=</span><span style="background: var(--pink); border: 2px solid var(--ink); border-radius: 18px; padding: 6px 18px; box-shadow: 0 3px 0 var(--ink)">라운드 점수 <b class="num">${score(rs + ks - pen)}</b>점</span>`;
  };

  const numInput = (name, value, step = 1, extra = '') => html`<input type="number" data-num="${name}" min="0" max="50" step="${step}" value="${value}" style="width: 84px; text-align: center; font-family: var(--num); font-weight: 800; font-size: 20px; background: var(--card); border: 2px solid var(--line); border-radius: 14px; padding: 4px 6px; min-height: 44px; ${extra}">`;

  const draw = () => mount(main, html`
    <div class="page-head" style="align-items: center"><div><h1>점수 규칙</h1><p class="lead">라운드 점수 = 순위 점수(RS) + 킬 점수(KS) − 처치자 불명 감점! 공식 대회 규정 값으로 미리 채워 뒀어요.</p></div>
      <span class="chip ${isOfficial() ? 'ok' : 'warn'}">${isOfficial() ? '공식 규정 값' : '공식 값과 달라요'}</span></div>
    <div class="flex"><a class="btn sm sky" href="${OFFICIAL_URL}" target="_blank" rel="noopener">공식 규정 공지 →</a><a class="btn sm ghost" href="/rules">참가자용 규정 페이지 보기</a></div>
    <div class="row" style="align-items: stretch">
      <section class="card ink grow" style="flex-basis: 380px"><h2>순위 점수 (RS) <small class="num muted" style="font-size: 13px">2.1.2</small></h2>
        <div style="display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr))">${st.placement.map((v, i) => html`<label style="display: grid; gap: 4px; justify-items: center; background: ${['var(--soft)', 'var(--sky-soft)', 'var(--t1s)'][i] || 'var(--bg)'}; border: 2px solid ${i < 3 ? 'var(--ink)' : 'var(--line)'}; border-radius: 20px; padding: 10px 8px"><span style="font-family: var(--logo); font-size: 18px">${i + 1}위</span>${numInput('p' + i, v, 1, 'width: 100%; max-width: 90px')}</label>`)}</div>
      </section>
      <section class="card ink sky-shadow side"><h2>킬 점수 (KS) <small class="num muted" style="font-size: 13px">2.1.1</small></h2>
        <label class="stack" style="gap: 6px; background: var(--soft); border-radius: 20px; padding: 12px 14px"><span style="font-family: var(--head); font-size: 16px">전멸 시 자동 재생 가능</span><small class="muted" style="font-weight: 600">1일차 킬 · 2일차 전투 연구실 킬</small><span class="flex" style="font-weight: 700">1킬당 ${numInput('ks_early', st.ks_early, 0.5)} KS</span></label>
        <label class="stack" style="gap: 6px; background: var(--sky-soft); border-radius: 20px; padding: 12px 14px"><span style="font-family: var(--head); font-size: 16px">전멸 시 자동 재생 불가</span><small class="muted" style="font-weight: 600">3일차 이후 킬</small><span class="flex" style="font-weight: 700">1킬당 ${numInput('ks_late', st.ks_late, 0.5)} KS</span></label>
        <p class="muted" style="margin: 0; font-size: 12px; font-weight: 600">2일차 전투 연구실 밖 킬은 규정에 따로 적혀 있지 않아서 지금은 1 KS로 계산해요.</p>
      </section>
    </div>
    <div class="row" style="align-items: stretch">
      <section class="card side" style="border-color: var(--t3); box-shadow: 0 6px 0 var(--t3s)"><h2>처치자 불명 감점 <small class="num muted" style="font-size: 13px">2.1.3</small></h2>
        <label class="flex" style="font-weight: 700">금지 구역 · 야생 동물 사망 1회당 <span class="flex" style="gap: 4px; color: var(--t3); font-family: var(--num); font-weight: 800; font-size: 20px">−${numInput('penalty', st.penalty, 0.5)}</span>점</label>
        <ul style="margin: 0; padding-left: 18px; font-size: 14px; font-weight: 600"><li>최종 2팀이 남은 뒤에는 감점하지 않아요</li><li>최종 2팀 전투 중 처치자 불명 킬은 살아남은 팀의 킬로 쳐요</li></ul>
      </section>
      <section class="side stack"><h2 style="font-family: var(--head); font-size: 20px">순위 결정</h2>
        <div class="card" style="padding: 14px 16px; gap: 2px"><b style="font-family: var(--head); font-weight: 400; font-size: 17px">체크포인트 없음</b><small class="muted" style="font-weight: 600">라운드 점수를 모두 더한 합계로 최종 순위를 정해요</small></div>
        <div class="card" style="padding: 14px 16px; gap: 2px"><b style="font-family: var(--head); font-weight: 400; font-size: 17px">동점이면 킬 점수 우선</b><small class="muted" style="font-weight: 600">합계가 같으면 KS 합계가 높은 팀이 위예요</small></div>
      </section>
    </div>
    <section class="card"><h2>미리 계산해 보기</h2>
      <div class="pills" role="group" aria-label="등수">${[1, 2, 3, 4, 5, 6, 7, 8].map((r) => html`<button type="button" data-rank="${r}" aria-pressed="${st.rank === r}" style="min-width: 52px; justify-content: center">${r}위</button>`)}</div>
      <div class="flex" style="gap: 12px 20px; font-weight: 700"><label class="flex">0.5 KS 킬 ${numInput('ek', st.ek)}</label><label class="flex">1 KS 킬 ${numInput('lk', st.lk)}</label><label class="flex">처치자 불명 사망 ${numInput('deaths', st.deaths)}</label></div>
      <div class="flex" id="calc" aria-live="polite" style="gap: 10px; font-family: var(--head); font-size: 20px">${calc()}</div>
      <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">처치자 불명 사망은 최종 2팀이 남기 전에 나온 것만 세요.</p>
    </section>
    <section class="card ink sky-shadow" style="grid-template-columns: minmax(0, 1fr) auto auto; align-items: center">
      <span style="font-weight: 600">저장하면 이미 확정한 기록도 새 규칙으로 바로 다시 계산돼요. (점수는 저장된 값으로 매번 계산해요)</span>
      <button class="btn ghost" type="button" data-official>공식 값으로 되돌리기</button>
      <button class="btn pink" type="button" data-save ${st.busy ? 'disabled' : ''}>규칙 저장</button>
    </section>`);

  on(main, 'input', '[data-num]', (e) => {
    const k = e.target.dataset.num;
    const v = Math.max(0, Number(e.target.value) || 0);
    if (k.startsWith('p')) st.placement[Number(k.slice(1))] = v; else st[k] = v;
    mount(document.getElementById('calc'), calc());
  });
  on(main, 'click', '[data-rank]', (_e, b) => { st.rank = Number(b.dataset.rank); draw(); });
  on(main, 'click', '[data-official]', () => { Object.assign(st, { placement: OFFICIAL.placement.slice(), ks_early: OFFICIAL.ks_early, ks_late: OFFICIAL.ks_late, penalty: OFFICIAL.penalty }); draw(); });
  on(main, 'click', '[data-save]', async () => {
    st.busy = true; draw();
    try {
      await update('scoring_rules', { placement: st.placement, ks_early: st.ks_early, ks_late: st.ks_late, penalty: st.penalty, updated_at: new Date().toISOString() }, { id: 1 });
      toast('저장 완료! 모든 기록에 새 규칙이 적용됐어요.');
    } catch (e) { toast('저장하지 못했어요: ' + errorText(e), true); }
    st.busy = false; draw();
  });
  draw();
});
