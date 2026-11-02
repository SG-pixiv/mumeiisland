import { startPublic } from '../components/shell.js';
import { html, mount, on, toast, errorText, safeUrl } from '../lib/dom.js';
import { select, rpc } from '../lib/db.js';
import { dateKo, shortDate } from '../lib/fmt.js';
import { loadBoard, loadCharacterNames, playTime, weekStartKst, FEEDBACK_KINDS } from '../lib/rogue.js';

const SOURCE_URL = 'https://github.com/SG-pixiv/bseorogue';
const NICK_KEY = 'mumei.rogue.nick';
const readNick = () => { try { return localStorage.getItem(NICK_KEY) || ''; } catch { return ''; } };
const saveNick = (v) => { try { localStorage.setItem(NICK_KEY, v); } catch { /* 저장 못 해도 괜찮아요 */ } };

startPublic('rogue', async (main, { rogue, me }) => {
  const admin = !!me?.admin;
  const play = safeUrl(rogue?.game_url);
  const head = html`<div class="page-head">
    <div><h1>블서로그</h1><p class="lead">이터널 리턴 실험체로 즐기는 로그라이트 웹게임이에요. 큐 잡는 동안 한 판!</p></div>
    <div class="flex" style="gap: 10px">
      ${play ? html`<a class="btn pink big" href="${play}" target="_blank" rel="noopener">하러 가기 <span aria-hidden="true">↗</span></a>` : ''}
      <a class="btn ghost" href="${SOURCE_URL}" target="_blank" rel="noopener" title="블서로그는 포켓로그(AGPL) 코드를 바탕으로 만들어서 소스를 모두 공개해요">소스 코드</a>
    </div>
  </div>`;

  if (!rogue) {
    mount(main, html`${head}<p class="notice warn">${admin ? 'Supabase SQL Editor 에서 20261102000000_bseorogue.sql (13단계)을 먼저 실행해 주세요.' : '블서로그는 아직 준비 중이에요. 조금만 기다려 주세요!'}</p>`);
    return;
  }
  if (!rogue.live && !admin) {
    mount(main, html`${head}<section class="card" style="justify-items: center; text-align: center; gap: 10px; padding: 40px 24px">
      <h2 style="font-family: var(--head); font-size: 24px">블서로그는 아직 준비 중이에요</h2>
      <p class="muted" style="margin: 0; font-weight: 600">열리면 이 페이지에서 랭킹 · 업데이트 소식을 보고 피드백도 보낼 수 있어요.</p>
      <a class="btn" href="/">대시보드로</a></section>`);
    return;
  }

  const [names, news] = await Promise.all([
    loadCharacterNames(),
    select('rogue_news', { eq: { published: true }, order: 'created_at', asc: false, limit: 20 }).catch(() => [])
  ]);
  const boards = { week: null, all: null };
  const state = { scope: 'week', kind: 'bug', sending: false };
  const weekFrom = weekStartKst();
  const sortedNews = news.slice().sort((a, b) => (b.pinned - a.pinned) || String(b.created_at).localeCompare(String(a.created_at)));

  const party = (codes) => (codes || []).map((c) => names.get(Number(c)) || `#${c}`).join(' · ');

  const boardView = () => {
    const rows = boards[state.scope];
    if (!rows) return html`<p class="loading">랭킹 불러오는 중…</p>`;
    if (!rows.length) return html`<p class="empty">${state.scope === 'week' ? '아직 이번 주 기록이 없어요. 첫 1등의 주인공이 되어 보세요!' : '아직 기록이 없어요.'}</p>`;
    return html`<div class="table-wrap"><table class="data" style="min-width: 560px"><thead><tr>
        <th>#</th><th>닉네임</th><th class="r">웨이브</th><th class="r">시간</th><th>파티</th><th class="r">날짜</th>
      </tr></thead><tbody>
      ${rows.map((r) => html`<tr>
        <td><span class="num">${r.rank}</span></td>
        <td><b>${r.nickname}</b></td>
        <td class="r"><span class="num">${r.wave}</span>${r.cleared ? html` <span class="chip ok" style="padding: 0 8px">클리어</span>` : ''}</td>
        <td class="r"><span class="num">${playTime(r.seconds)}</span></td>
        <td style="font-size: 13px; font-weight: 600">${party(r.party)}</td>
        <td class="r muted" style="font-size: 13px; white-space: nowrap">${shortDate(r.created_at)}</td>
      </tr>`)}
    </tbody></table></div>`;
  };

  const draw = () => {
    const body = main.querySelector('[data-fb-body]')?.value ?? '';
    const nick = main.querySelector('[data-fb-nick]')?.value ?? readNick();
    mount(main, html`${head}
      ${!rogue.live ? html`<p class="notice" role="status"><b>관리자 미리보기</b>&nbsp;· 아직 공개 전이에요. 관리자 → 블서로그 에서 공개하면 모두에게 보여요.</p>` : ''}
      <div class="row">
        <section class="card grow" aria-labelledby="rogue-board-h">
          <div class="flex" style="justify-content: space-between; gap: 12px">
            <h2 id="rogue-board-h" style="margin: 0">랭킹</h2>
            <div class="pills" role="group" aria-label="기간">
              <button type="button" data-scope="week" aria-pressed="${state.scope === 'week'}">이번 주</button>
              <button type="button" data-scope="all" aria-pressed="${state.scope === 'all'}">역대</button>
            </div>
          </div>
          <p class="muted" style="margin: 0; font-size: 13px; font-weight: 600">${state.scope === 'week' ? `${dateKo(weekFrom + 'T00:00:00+09:00')}부터 · 매주 월요일 0시에 새로 시작해요.` : '지금까지 기록 전부예요.'} 클래식 최고 웨이브 → 짧은 시간 순이고, 닉네임마다 가장 좋은 기록 하나만 보여요.</p>
          ${boardView()}
        </section>

        <div class="side" style="display: grid; gap: 24px">
          <section class="card" aria-labelledby="rogue-news-h" id="news">
            <h2 id="rogue-news-h">업데이트 소식</h2>
            ${sortedNews.length
              ? html`<ul style="list-style: none; margin: 0; padding: 0; display: grid; gap: 12px">${sortedNews.map((n) => html`<li style="background: var(--soft); border-radius: 18px; padding: 12px 14px; display: grid; gap: 4px">
                  <span class="flex" style="gap: 8px">${n.pinned ? html`<span class="chip soft" style="padding: 0 8px">고정</span>` : ''}<b>${n.title}</b></span>
                  <small class="muted" style="font-weight: 600">${dateKo(n.created_at, false)}</small>
                  ${n.body ? html`<p style="margin: 0; white-space: pre-line; font-size: 14px; font-weight: 500">${n.body}</p>` : ''}
                </li>`)}</ul>`
              : html`<p class="empty">아직 소식이 없어요.</p>`}
          </section>

          <section class="card" aria-labelledby="rogue-fb-h" id="feedback">
            <h2 id="rogue-fb-h">피드백 보내기</h2>
            ${rogue.feedback_open
              ? html`<form data-fb style="display: grid; gap: 12px">
                  <div class="pills" role="group" aria-label="종류">${FEEDBACK_KINDS.map(([k, label]) => html`<button type="button" data-kind="${k}" aria-pressed="${state.kind === k}">${label}</button>`)}</div>
                  <label class="field">내용<textarea data-fb-body rows="5" maxlength="1000" required placeholder="버그는 어느 웨이브에서 무엇을 했을 때인지 적어 주면 고치기 쉬워요">${body}</textarea></label>
                  <label class="field">닉네임 <span class="muted" style="font-weight: 600">(안 적어도 돼요)</span><input data-fb-nick maxlength="20" value="${nick}" autocomplete="nickname"></label>
                  <button class="btn sky" type="submit" ${state.sending ? 'disabled' : ''}>${state.sending ? '보내는 중…' : '보내기'}</button>
                  <small class="muted" style="font-weight: 600">운영진만 읽어요. 하루 10번까지 보낼 수 있어요.</small>
                </form>`
              : html`<p class="empty">지금은 피드백을 받지 않아요.</p>`}
          </section>
        </div>
      </div>`);
  };

  const fetchBoard = async (scope) => {
    try {
      boards[scope] = await loadBoard(scope, 50);
    } catch (e) {
      boards[scope] = [];
      toast('랭킹을 불러오지 못했어요: ' + errorText(e), true);
    }
    if (state.scope === scope) draw();
  };

  on(main, 'click', '[data-scope]', (_e, b) => {
    state.scope = b.dataset.scope;
    draw();
    if (!boards[state.scope]) fetchBoard(state.scope);
  });
  on(main, 'click', '[data-kind]', (_e, b) => { state.kind = b.dataset.kind; draw(); });
  on(main, 'submit', '[data-fb]', async (e) => {
    e.preventDefault();
    const body = main.querySelector('[data-fb-body]').value.trim();
    const nick = main.querySelector('[data-fb-nick]').value.trim();
    if (body.length < 2) { toast('내용을 적어 주세요', true); return; }
    state.sending = true; draw();
    try {
      await rpc('rogue_feedback_send', { p_kind: state.kind, p_body: body, p_nickname: nick, p_version: '', p_source: 'web' });
      saveNick(nick);
      main.querySelector('[data-fb-body]').value = '';
      toast('보냈어요! 고마워요');
    } catch (err) {
      toast('보내지 못했어요: ' + errorText(err), true);
    }
    state.sending = false; draw();
  });

  draw();
  fetchBoard('week');
});
