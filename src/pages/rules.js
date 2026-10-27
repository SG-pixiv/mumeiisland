import { startPublic } from '../components/shell.js';
import { html, mount, on } from '../lib/dom.js';
import { loadScoring } from '../lib/api.js';
import { score, medalClass, STAR_PINK } from '../lib/fmt.js';

const OFFICIAL = 'https://playeternalreturn.com/posts/news/2684?hl=ko-KR';
const WEATHER = [
  ['모래바람', '이에요', 'var(--t3s)', 'M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7'],
  ['비', '예요', 'var(--sky-soft)', 'M7 15a4 4 0 1 1 .9-7.9A5 5 0 0 1 17.5 9a3 3 0 0 1-.5 6H7zM8 18l-1 3M12 18l-1 3M16 18l-1 3'],
  ['쾌청', '이에요', 'var(--soft)', 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  ['흐림', '이에요', 'var(--t1s)', 'M6 19a4 4 0 1 1 .9-7.9A5 5 0 0 1 16.5 12a3.5 3.5 0 0 1-.5 7H6zM9 7.5A4.5 4.5 0 0 1 17.6 6 3 3 0 0 1 20 11']
];
const OPTIONS = ['금지 구역 가속 허용', '임시 안전 지대 재생 허용', '일반 차원의 틈 생성 허용', '탈출 허용', '캐릭터 순차 선택 옵션 적용'];
const REVIVE = [['전멸 방지 허용', '1일차 밤까지', 2], ['임시 안전 지대 재생 허용', '2일차 밤까지', 4], ['일반 차원의 틈 생성 허용', '4일차 밤까지', 8], ['탈출 허용', '6일차 낮까지', 11], ['재생성 키트 허용', '비활성화', 0]];

startPublic('rules', async (main) => {
  const s = await loadScoring();
  const placement = (s.placement || []).map(Number);
  let round = 1;

  const weatherBlock = () => {
    const wi = (round - 1) % 4;
    const start = Math.floor((round - 1) / 4) * 4 + 1;
    const pos = (round - 1) % 4 + 1;
    return html`
      <div class="seg" role="group" aria-label="라운드 선택" style="border-radius: 22px">${Array.from({ length: 12 }, (_, i) => i + 1).map((n) => html`<button type="button" data-round="${n}" aria-pressed="${n === round}" style="min-width: 48px; padding: 6px 10px">${n}R</button>`)}</div>
      <div style="display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr))">${WEATHER.map(([name, , bg, icon], i) => {
        const onNow = i === wi;
        return html`<div style="display: grid; justify-items: center; gap: 4px; text-align: center; background: ${onNow ? bg : 'var(--card)'}; border: ${onNow ? 3 : 2}px solid ${onNow ? 'var(--ink)' : 'var(--line)'}; border-radius: 22px; padding: 14px 8px; box-shadow: ${onNow ? '0 5px 0 var(--ink)' : 'none'}; transform: ${onNow ? 'translateY(-3px)' : 'none'}">
          <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24"><path d="${icon}" fill="none" stroke="#3A2440" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <span style="font-family: var(--head); font-size: 19px">${name}</span><span class="muted" style="font-size: 13px; font-weight: 700">${i + 1} · ${i + 5} · ${i + 9}라운드</span></div>`;
      })}</div>
      <p aria-live="polite" style="margin: 0; font-family: var(--head); font-size: 18px">${round}라운드 메인 날씨는 ${WEATHER[wi][0]}${WEATHER[wi][1]}.</p>
      <p class="muted" style="margin: 0; font-size: 13px; font-weight: 700">${pos === 1 ? `${round}라운드에서 서브 날씨 풀이 다시 채워져요. 네 가지 중 하나가 나와요.` : `${round}라운드는 ${start}~${start + 3}라운드 묶음의 ${pos}번째 판이에요. 아직 안 나온 서브 날씨 ${5 - pos}개 중 하나가 나와요.`}</p>`;
  };

  const draw = () => mount(main, html`
    <div class="page-head"><div><h1>내전 규정 ${STAR_PINK}</h1><p class="lead">무명섬 내전은 이터널 리턴 공식 대회 규정대로 진행한답니다! 생존자 여러분, 방을 만들 때 아래 옵션을 그대로 맞춰 주세요.</p></div>
      <a class="btn big" href="${OFFICIAL}" target="_blank" rel="noopener">공식 규정 공지 보기 →</a></div>

    <section class="hero" aria-labelledby="formula-title" style="display: grid; gap: 16px">
      <h2 id="formula-title" class="sticker">팀 점수 계산</h2>
      <div class="flex" style="gap: 10px 14px; font-family: var(--head); font-size: 22px">
        <span style="display: grid; justify-items: center; background: var(--card); border: 2px solid var(--ink); border-radius: 20px; padding: 8px 18px; box-shadow: 0 4px 0 var(--ink)">순위 점수<small class="num muted" style="font-size: 13px">RS</small></span><span aria-hidden="true">+</span>
        <span style="display: grid; justify-items: center; background: var(--sky); border: 2px solid var(--ink); border-radius: 20px; padding: 8px 18px; box-shadow: 0 4px 0 var(--ink)">킬 점수<small class="num" style="font-size: 13px">KS</small></span><span aria-hidden="true">−</span>
        <span style="display: grid; justify-items: center; background: var(--t3s); border: 2px solid var(--ink); border-radius: 20px; padding: 8px 18px; box-shadow: 0 4px 0 var(--ink)">처치자 불명 감점<small class="num" style="font-size: 13px; color: var(--t3)">1회당 −${score(s.penalty)}</small></span><span aria-hidden="true">=</span>
        <span style="display: grid; justify-items: center; background: var(--ink); color: #FFFFFF; border: 2px solid var(--ink); border-radius: 20px; padding: 8px 22px; box-shadow: 0 4px 0 var(--sky)">라운드 점수<small class="num" style="font-size: 13px; color: var(--sky)">TOTAL</small></span>
      </div>
      <p style="margin: 0; font-weight: 700">라운드 점수를 전부 더해서 최종 순위를 정해요. 체크포인트는 없고, 합계가 같으면 킬 점수가 높은 팀이 위랍니다!</p>
    </section>

    <div class="row" style="align-items: stretch">
      <section class="card grow" style="flex-basis: 420px"><span class="num muted" style="font-size: 13px">2.1.1</span><h2>킬 점수 (KS)</h2>
        <p class="muted" style="margin: 0; font-size: 14px; font-weight: 600">인게임에서 KS로 표시되는 점수예요. 언제 나온 킬인지에 따라 점수가 달라요.</p>
        <div class="grid" style="--min: 200px; gap: 12px">
          <div class="stack" style="gap: 8px; background: var(--soft); border: 2px solid var(--pink); border-radius: 22px; padding: 16px"><span><b style="font-family: var(--logo); font-weight: 400; font-size: 34px">${score(s.ks_early)}</b> <span style="font-family: var(--head)">KS / 1킬</span></span><span class="chip soft plain" style="justify-self: start; background: var(--card)">전멸 시 자동 재생 가능</span><ul style="margin: 0; padding-left: 18px; font-weight: 600; font-size: 14px"><li>1일차에 나온 모든 킬</li><li>2일차 전투 연구실에서 나온 모든 킬</li></ul></div>
          <div class="stack" style="gap: 8px; background: var(--sky-soft); border: 2px solid var(--sky-ink); border-radius: 22px; padding: 16px"><span><b style="font-family: var(--logo); font-weight: 400; font-size: 34px">${score(s.ks_late)}</b> <span style="font-family: var(--head)">KS / 1킬</span></span><span class="chip sky plain" style="justify-self: start; background: var(--card)">전멸 시 자동 재생 불가</span><ul style="margin: 0; padding-left: 18px; font-weight: 600; font-size: 14px"><li>3일차 이후에 나온 모든 킬</li></ul></div>
        </div>
      </section>
      <section class="card grow" style="flex-basis: 420px"><span class="num muted" style="font-size: 13px">2.1.2</span><h2>순위 점수 (RS)</h2>
        <p class="muted" style="margin: 0; font-size: 14px; font-weight: 600">라운드가 끝났을 때의 팀 순위로 받는 점수예요.</p>
        <ol style="list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(4, minmax(0, 1fr))">${placement.map((pt, i) => html`<li style="display: grid; justify-items: center; gap: 2px; background: ${['var(--pink)', 'var(--sky)', 'var(--t1s)'][i] || 'var(--bg)'}; border: 2px solid ${i < 3 ? 'var(--ink)' : 'var(--line)'}; border-radius: 20px; padding: 10px 6px"><span style="font-family: var(--head)">${i + 1}위</span><span style="font-family: var(--logo); font-size: 28px; line-height: 1.1">${score(pt)}</span><small class="muted" style="font-weight: 700">점</small></li>`)}</ol>
      </section>
    </div>

    <section class="card" style="border-color: var(--t3); box-shadow: 0 6px 0 var(--t3s); grid-template-columns: auto minmax(0, 1fr); align-items: start">
      <span aria-hidden="true" style="width: 84px; height: 84px; border-radius: 26px; display: grid; place-items: center; font-family: var(--logo); font-size: 34px; background: var(--t3s); border: 3px solid var(--ink); transform: rotate(-4deg)">−${score(s.penalty)}</span>
      <div class="stack"><span class="num muted" style="font-size: 13px">2.1.3</span><h2>처치자 불명 감점</h2>
        <p style="margin: 0; font-weight: 600">금지 구역, 야생 동물에 의한 사망처럼 플레이어 킬로 잡히지 않는 처치가 나오면, 처치당한 팀에서 <b>${score(s.penalty)}점</b>을 빼요.</p>
        <ul style="margin: 0; padding-left: 18px; font-weight: 600; font-size: 14px; display: grid; gap: 4px"><li>최종 2팀이 남은 상황에서는 감점하지 않아요. 일부러 감점을 유도하는 걸 막기 위해서예요.</li><li>최종 2팀이 싸우다 처치자 불명 킬이 나오면, 끝까지 살아남은 팀의 킬로 쳐요.</li></ul></div>
    </section>

    <div class="row" style="align-items: stretch">
      <section class="card side" style="flex-basis: 340px"><span class="num muted" style="font-size: 13px">2.3.3</span><h2>게임 옵션</h2><p class="muted" style="margin: 0; font-size: 14px; font-weight: 600">사용자 설정 대전 방을 만들 때 모두 켜 주세요.</p>
        <ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 8px">${OPTIONS.map((o) => html`<li class="flex" style="flex-wrap: nowrap; background: var(--sky-soft); border-radius: 16px; padding: 9px 14px"><span aria-hidden="true" style="width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; background: var(--sky); border: 2px solid var(--ink); flex: none"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" fill="none" stroke="#3A2440" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><b style="flex: 1 1 auto">${o}</b><small style="color: var(--sky-ink); font-weight: 700">활성화</small></li>`)}</ul>
      </section>
      <section class="card grow" style="flex-basis: 560px"><span class="num muted" style="font-size: 13px">2.3.4</span><h2>부활 정보</h2><p class="muted" style="margin: 0; font-size: 14px; font-weight: 600">각 옵션을 언제까지 허용하는지예요. 막대가 끝나는 시점까지 쓸 수 있어요.</p>
        <div class="table-wrap"><div style="min-width: 560px; display: grid; gap: 8px">
          <div aria-hidden="true" style="display: grid; grid-template-columns: 180px repeat(12, minmax(0, 1fr)); font-size: 12px; font-weight: 700; text-align: center" class="muted"><span></span>${[1, 2, 3, 4, 5, 6].map((d) => html`<span style="grid-column: span 2; font-family: var(--head); font-size: 14px; color: var(--ink)">${d}일차</span>`)}<span></span>${Array.from({ length: 12 }, (_, i) => html`<span>${i % 2 ? '밤' : '낮'}</span>`)}</div>
          ${REVIVE.map(([name, end, span]) => html`<div style="display: grid; grid-template-columns: 180px repeat(12, minmax(0, 1fr)); align-items: center; min-height: 46px">
            <span style="grid-column: 1; grid-row: 1; display: grid; padding-right: 12px"><b style="font-size: 14px">${name}</b><small style="font-weight: 700; color: ${span ? 'var(--sky-ink)' : 'var(--pink-ink)'}">${end}</small></span>
            <span aria-hidden="true" style="grid-column: 2 / span 12; grid-row: 1; height: 24px; border-radius: 999px; background: repeating-linear-gradient(90deg, var(--soft) 0 16.6667%, var(--bg) 16.6667% 33.3333%)"></span>
            <span aria-hidden="true" style="grid-column: 2 / span ${span || 12}; grid-row: 1; height: 24px; border-radius: 999px; background: ${span ? 'var(--sky)' : 'transparent'}; border: 2px ${span ? 'solid var(--ink)' : 'dashed var(--muted)'}"></span>
          </div>`)}
        </div></div>
      </section>
    </div>

    <section class="card"><span class="num muted" style="font-size: 13px">2.5</span><h2>날씨 선택 규정</h2>
      <div class="row">
        <div class="grow stack" style="gap: 14px"><h3 style="font-family: var(--head); font-size: 19px">2.5.1 메인 날씨 · 라운드 로테이션</h3><div id="weather" class="stack" style="gap: 14px">${weatherBlock()}</div></div>
        <div class="side stack" style="background: var(--bg); border: 2px solid var(--line); border-radius: 24px; padding: 18px"><h3 style="font-family: var(--head); font-size: 19px">2.5.2 서브 날씨</h3>
          <div class="flex">${['무풍', '강풍', '벼락', '자색안개'].map((w) => html`<span class="chip" style="font-family: var(--head); font-size: 15px">${w}</span>`)}</div>
          <p style="margin: 0; font-size: 14px; font-weight: 600">네 가지 모두 켜고 진행해요. 한 번 나온 서브 날씨는 랜덤 풀에서 빠지고, 네 가지가 다 나오는 4라운드마다 풀이 다시 채워져요.</p></div>
      </div>
    </section>`);

  on(main, 'click', '[data-round]', (_e, b) => { round = Number(b.dataset.round); mount(document.getElementById('weather'), weatherBlock()); });
  draw();
});
