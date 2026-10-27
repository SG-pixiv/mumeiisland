import { startAdmin } from '../../components/shell.js';
import { html, mount } from '../../lib/dom.js';

startAdmin('devices', async (main) => {
  mount(main, html`
    <div><h1>업로드 장치</h1><p class="lead">다음 단계에서 연결할 화면이에요!</p></div>
    <section class="card ink"><span class="chip sky" style="justify-self: start">준비 중</span>
      <p style="margin: 0; font-weight: 600">게임하는 PC에 작은 업로드 프로그램을 켜 두면 "데이터 저장"을 누를 때마다 CSV가 자동으로 올라와요. 결과 검토 화면을 먼저 만든 다음 이어서 만들어요.</p>
      <a class="btn" href="/admin" style="justify-self: start">대시보드로</a>
    </section>`);
});
