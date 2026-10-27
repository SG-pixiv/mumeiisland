import { startAdmin } from '../../components/shell.js';
import { html, mount } from '../../lib/dom.js';

startAdmin('review', async (main) => {
  mount(main, html`
    <div><h1>결과 검토</h1><p class="lead">다음 단계에서 연결할 화면이에요!</p></div>
    <section class="card ink"><span class="chip sky" style="justify-self: start">준비 중</span>
      <p style="margin: 0; font-weight: 600">게임에서 저장한 결과 CSV를 올리면 닉네임을 선수와 연결하고, 0.5 KS 킬 · 처치자 불명 감점을 확인한 다음 확정해요. 실제 CSV 파일 형식을 먼저 확인해야 해서, 테스트 CSV를 받으면 바로 붙일게요.</p>
      <a class="btn" href="/admin" style="justify-self: start">대시보드로</a>
    </section>`);
});
