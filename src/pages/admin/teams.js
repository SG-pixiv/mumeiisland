import { startAdmin } from '../../components/shell.js';
import { html, mount } from '../../lib/dom.js';

startAdmin('teams', async (main) => {
  mount(main, html`
    <div><h1>팀 편성 · 드래프트</h1><p class="lead">다음 단계에서 연결할 화면이에요!</p></div>
    <section class="card ink"><span class="chip sky" style="justify-self: start">준비 중</span>
      <p style="margin: 0; font-weight: 600">자동 편성(솔로 랭크 점수 밸런스 · 자물쇠 잠금)과 드래프트(지난 내전 꼴찌 팀장부터 · 밸런스 추천 · 남은 지명 자동 채우기)를 여기서 하게 돼요. 시안에서 만든 계산 로직을 DB에 저장하도록 옮기는 중이에요.</p>
      <a class="btn" href="/admin" style="justify-self: start">대시보드로</a>
    </section>`);
});
