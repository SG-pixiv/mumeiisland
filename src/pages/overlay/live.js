// ① LIVE 배지: 무명섬 내전 · LIVE · N라운드 시작 / 끝  (OBS 소스 560 × 90, 왼쪽 위)
import { html } from '../../lib/dom.js';
import { select } from '../../lib/db.js';
import { pickLiveEvent, liveOf, liveLabel } from '../../lib/live.js';
import { runOverlay } from './run.js';

runOverlay(
  async (params) => pickLiveEvent(await select('events', { order: 'starts_at' }), { id: params.get('event') }),
  (ev) => {
    const label = liveLabel(ev);
    return html`<div class="ov-fit"><div class="ov-live" role="status">
      <b>무명섬 내전</b>
      <span class="ov-pill live"><span class="ov-dot" aria-hidden="true"></span>LIVE</span>
      ${label ? html`<span class="ov-pill ${liveOf(ev).state}">${label}</span>` : ''}
    </div></div>`;
  }
);
