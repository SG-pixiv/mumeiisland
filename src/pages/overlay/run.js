// 오버레이 공통: 10초마다 다시 읽고, 바뀐 게 있을 때만 다시 그려요 (오류가 나면 마지막 화면 그대로)
import '../../styles/overlay.css';
import { mount } from '../../lib/dom.js';
import { sizeParam } from '../../lib/live.js';

export function runOverlay(load, draw, { every = 10000 } = {}) {
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  document.documentElement.style.setProperty('--ov-size', String(sizeParam(params.get('size'))));
  let last = null;
  const tick = async () => {
    try {
      const view = draw(await load(params), params);
      if (view.s !== last) { last = view.s; mount(app, view); }
    } catch (e) {
      console.error('[무명섬 오버레이]', e);
    }
  };
  tick();
  setInterval(tick, every);
}
