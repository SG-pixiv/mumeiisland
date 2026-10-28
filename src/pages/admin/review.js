import { startAdmin } from '../../components/shell.js';
import { html, mount, on, toast, errorText } from '../../lib/dom.js';
import { select, insert, update, remove, rpc } from '../../lib/db.js';
import { loadEvents, loadPlayers } from '../../lib/api.js';
import { dateTimeShort, score, tierDot } from '../../lib/fmt.js';
import { parseGameResult, teamScore, normName } from '../../../supabase/functions/_shared/game-result.js';

const STATUS = { pending: ['검토 대기', 'soft'], held: ['보류', 'warn'], confirmed: ['확정', 'ok'] };
const SOURCE = { device: '업로드 장치', manual: '직접 올림' };
const mostCommon = (list) => {
  const c = new Map();
  list.forEach((v) => c.set(v, (c.get(v) || 0) + 1));
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const int = (v, min = 0) => Math.max(min, Math.round(Number(v) || 0));

startAdmin('review', async (main) => {
  let events = [], players = [], rules = null, rounds = [];
  let chars = new Map();
  const state = { sel: null, draft: null, busy: false, uploadEvent: null, newEvent: null };

  // 지금 진행 중인 내전 (서버 함수와 같은 기준: 12시간 전 ~ 6시간 뒤 시작, 가장 가까운 것)
  const currentEventId = () => {
    const now = Date.now();
    const near = events.filter((e) => e.status !== 'done' && Date.parse(e.starts_at) >= now - 12 * 3600e3 && Date.parse(e.starts_at) <= now + 6 * 3600e3)
      .sort((a, b) => Math.abs(Date.parse(a.starts_at) - now) - Math.abs(Date.parse(b.starts_at) - now));
    return near[0]?.id ?? '';
  };
  const nextRoundNo = (eventId, exceptId = null) =>
    Math.max(0, ...rounds.filter((r) => r.event_id === eventId && r.id !== exceptId).map((r) => r.round_no)) + 1;
  const eventTitle = (id) => events.find((e) => e.id === id)?.title ?? '내전 미지정';
  const playedMs = (r) => Date.parse(r.played_at || r.uploaded_at);
  // 이 판 앞뒤 12시간 안에 올라온, 아직 내전이 없는 판 (같은 날 내전으로 묶어요)
  const unassignedNear = (round) => rounds.filter((r) => r.id !== round.id && !r.event_id && r.status !== 'confirmed' && Math.abs(playedMs(r) - playedMs(round)) <= 12 * 3600e3);
  const defaultTitle = (round) => { const t = new Date(playedMs(round)); return `${t.getMonth() + 1}월 ${t.getDate()}일 내전`; };

  const reload = async () => {
    let ruleRows, charRows;
    [events, { list: players }, ruleRows, charRows, rounds] = await Promise.all([
      loadEvents(), loadPlayers({ includeInactive: true }), select('scoring_rules'), select('er_characters'),
      select('rounds', { order: 'uploaded_at', asc: false, limit: 80 })
    ]);
    rules = ruleRows[0] || null;
    chars = new Map(charRows.filter((c) => c.name_en).map((c) => [normName(c.name_en), c.name_ko]));
    if (state.uploadEvent === null) state.uploadEvent = currentEventId();
  };

  // ── 선택한 라운드의 검토 초안 (CSV + 이미 저장된 값)
  const guessTeams = async (d) => {
    const evTeams = d.eventId ? await select('event_teams', { eq: { event_id: d.eventId } }) : [];
    const teamOf = new Map(evTeams.map((t) => [t.player_id, t.team_no]));
    d.teams.forEach((t) => {
      if (t.teamNoSource === 'saved' || t.teamNoSource === 'manual') return;
      const votes = d.players.filter((p) => p.teamKey === t.key && p.playerId && teamOf.has(p.playerId)).map((p) => teamOf.get(p.playerId));
      const guess = mostCommon(votes);
      t.teamNo = guess ?? t.csvTeamNo ?? t.rank;
      t.teamNoSource = guess ? 'event' : 'csv';
    });
  };

  const buildDraft = async (round) => {
    const parsed = parseGameResult(round.raw_csv || '');
    const d = { round, parsed, eventId: round.event_id || state.uploadEvent || '', roundNo: 0, teams: [], players: [] };
    if (!parsed.ok) return d;
    d.roundNo = round.round_no > 0 ? round.round_no : d.eventId ? nextRoundNo(d.eventId, round.id) : 1;
    const [savedTeams, savedPlayers] = await Promise.all([
      select('round_teams', { eq: { round_id: round.id } }),
      select('round_players', { eq: { round_id: round.id } })
    ]);
    const byNick = new Map(players.map((p) => [String(p.erNickname).trim().toLowerCase(), p]));
    const savedByNick = new Map(savedPlayers.map((r) => [r.csv_nickname, r]));
    d.players = parsed.rows.filter((r) => !r.isBot).map((r) => {
      const saved = savedByNick.get(r.nickname);
      const auto = byNick.get(r.nickname.trim().toLowerCase());
      return {
        nickname: r.nickname, teamKey: r.teamName || `rank-${r.rank}`,
        playerId: saved ? saved.player_id || '' : auto?.id || '', auto: !saved && !!auto,
        characterEn: r.character, characterKo: chars.get(normName(r.character)) || r.character,
        kills: r.kills, assists: r.assists, killer: r.killer,
        extra: { level: r.level, mastery: r.mastery, mastery_level: r.masteryLevel, hunting: r.hunting, killer: r.killer || null, csv_team: r.teamName, character_en: r.character }
      };
    });
    d.teams = parsed.teams.map((t) => {
      const saved = savedTeams.find((s) => s.team_rank === t.rank);
      return {
        key: t.key, rank: t.rank, csvTeamNo: t.csvTeamNo, allBots: t.allBots, include: saved ? true : !t.allBots,
        teamNo: saved?.team_no ?? t.csvTeamNo ?? t.rank, teamNoSource: saved ? 'saved' : 'csv',
        teamKills: saved?.team_kills ?? t.totalFieldKill, earlyKills: saved?.early_kills ?? t.earlyKills,
        penalties: saved?.penalties ?? t.unknownDeaths.length, deaths: t.unknownDeaths,
        tournament: t.tournament, earlySource: t.earlySource, members: t.members
      };
    });
    await guessTeams(d);
    return d;
  };

  const pick = async (id) => {
    const round = rounds.find((r) => r.id === id);
    state.sel = id;
    state.draft = round ? await buildDraft(round) : null;
    state.newEvent = round ? { title: defaultTitle(round), withOthers: true } : null;
    draw();
  };

  // ── 경고
  const warnings = (d) => {
    const w = [];
    if (!d.parsed.ok) return [['pink', d.parsed.error]];
    if (!d.eventId && d.round.status !== 'confirmed') w.push(['pink', '어느 내전의 판인지 정해야 확정할 수 있어요. 아래에서 내전을 고르거나, 일정에 없던 내전이면 바로 만들어 주세요.']);
    if (!d.parsed.scoringOn) w.push(['warn', '대회 점수 산정이 꺼진 판이에요. 0.5점 킬은 CSV 의 "down can not eliminate" 값으로 채웠으니 한 번 확인해 주세요.']);
    if (d.parsed.hasBots) w.push(['', '봇이 들어 있는 판이에요. 봇만 있는 팀은 기본으로 저장하지 않아요.']);
    const inc = d.teams.filter((t) => t.include);
    const nos = inc.map((t) => t.teamNo);
    if (new Set(nos).size !== nos.length) w.push(['pink', '같은 팀 번호가 두 번 이상 있어요. 팀 번호를 확인해 주세요.']);
    const unmatched = d.players.filter((p) => !p.playerId && inc.some((t) => t.key === p.teamKey));
    if (unmatched.length) w.push(['warn', `선수와 연결 안 된 닉네임이 ${unmatched.length}명 있어요 (${unmatched.slice(0, 3).map((p) => p.nickname).join(', ')}${unmatched.length > 3 ? ' …' : ''}). 연결하지 않으면 기록만 남고 선수 통계에는 안 들어가요.`]);
    const deaths = inc.reduce((s, t) => s + t.deaths.length, 0);
    if (deaths) w.push(['', `처치자 불명 사망 ${deaths}건을 감점으로 넣어 뒀어요. 최종 2팀이 남은 뒤의 사망이면 감점을 빼고, 그 킬은 생존 팀 전체 킬에 더해 주세요.`]);
    d.parsed.warnings.forEach((x) => w.push(['warn', x]));
    return w;
  };

  // ── 화면
  const listItem = (r) => {
    const [label, cls] = STATUS[r.status] || [r.status, 'plain'];
    return html`<button type="button" data-pick="${r.id}" aria-pressed="${state.sel === r.id}" class="card" style="cursor: pointer; text-align: left; padding: 12px 14px; border-radius: 22px; gap: 4px; align-content: start; ${state.sel === r.id ? 'background: var(--soft); border-color: var(--pink); box-shadow: 0 4px 0 var(--pink)' : ''}">
      <span style="font-family: var(--head); font-size: 16px">${eventTitle(r.event_id)}${r.round_no > 0 ? ` · ${r.round_no}라운드` : ''}</span>
      <small class="muted" style="font-weight: 600; word-break: break-all">${r.file_name || '파일 이름 없음'} · ${dateTimeShort(r.uploaded_at)}</small>
      <span class="flex" style="gap: 6px"><span class="chip ${cls}" style="font-size: 12px; padding: 0 10px">${label}</span><span class="chip plain" style="font-size: 12px; padding: 0 6px">${SOURCE[r.source] || r.source}</span></span>
    </button>`;
  };

  const teamTable = (d) => html`<div class="table-wrap"><table class="data" style="min-width: 860px">
    <thead><tr><th>저장</th><th>순위</th><th>팀 번호</th><th>선수</th><th class="r">전체 킬</th><th class="r">0.5점 킬</th><th class="r">감점</th><th class="r">RS</th><th class="r">KS</th><th class="r">합계</th><th>게임 대회 점수</th></tr></thead>
    <tbody>${d.teams.map((t, i) => {
      const s = teamScore({ rank: t.rank, teamKills: t.teamKills, earlyKills: t.earlyKills, penalties: t.penalties }, rules);
      const same = t.tournament && s.rs === t.tournament.rank && s.ks === t.tournament.kill;
      const names = d.players.filter((p) => p.teamKey === t.key);
      const bots = t.members.filter((m) => m.isBot).length;
      return html`<tr style="${t.include ? '' : 'opacity: 0.45'}">
        <td><input type="checkbox" data-team-include="${i}" ${t.include ? 'checked' : ''} aria-label="${t.key} 저장"></td>
        <td><span class="medal sm">${t.rank}</span></td>
        <td><span style="display: grid; gap: 2px"><input class="input" type="number" min="1" max="24" data-team-no="${i}" value="${t.teamNo}" aria-label="${t.key} 팀 번호" style="width: 74px; min-height: 36px; padding: 4px 8px">
          <small class="muted" style="font-weight: 600">${t.teamNoSource === 'event' ? '팀 편성 기준' : t.teamNoSource === 'saved' ? '저장된 값' : t.teamNoSource === 'manual' ? '직접 고침' : 'CSV ' + t.key}</small></span></td>
        <td><span class="flex" style="gap: 4px">${names.map((p) => {
          const pl = players.find((x) => x.id === p.playerId);
          return html`<span class="chip ${pl ? '' : 'warn'}" style="font-size: 12px; padding: 0 8px">${pl ? tierDot(pl.tier) : ''}${pl ? pl.name : p.nickname}</span>`;
        })}${bots ? html`<span class="chip plain" style="font-size: 12px; padding: 0 6px">봇 ${bots}</span>` : ''}</span></td>
        <td class="r"><input class="input" type="number" min="0" data-team-kills="${i}" value="${t.teamKills}" aria-label="${t.key} 전체 킬" style="width: 70px; min-height: 36px; padding: 4px 8px; text-align: right"></td>
        <td class="r"><input class="input" type="number" min="0" data-team-early="${i}" value="${t.earlyKills}" aria-label="${t.key} 0.5점 킬" style="width: 70px; min-height: 36px; padding: 4px 8px; text-align: right; ${t.earlySource === 'mismatch' ? 'border-color: var(--t3)' : ''}"></td>
        <td class="r"><span style="display: grid; gap: 2px; justify-items: end"><input class="input" type="number" min="0" data-team-pen="${i}" value="${t.penalties}" aria-label="${t.key} 감점 횟수" style="width: 64px; min-height: 36px; padding: 4px 8px; text-align: right">
          ${t.deaths.map((x) => html`<small class="muted" style="font-weight: 600; font-family: var(--body); white-space: nowrap">${x.nickname} ← ${x.killer}</small>`)}</span></td>
        <td class="r">${score(s.rs)}</td><td class="r">${score(s.ks)}</td>
        <td class="r"><span class="num" style="font-size: 17px">${score(s.total)}</span></td>
        <td>${t.tournament
          ? html`<span style="display: grid; gap: 2px"><small class="muted" style="font-weight: 600">RS ${score(t.tournament.rank)} · KS ${score(t.tournament.kill)}</small>
              <span class="chip ${same ? 'ok' : 'warn'}" style="justify-self: start; font-size: 12px; padding: 0 8px">${same ? '같아요' : '달라요'}</span></span>`
          : html`<small class="muted" style="font-weight: 600">꺼진 판</small>`}</td>
      </tr>`;
    })}</tbody></table></div>`;

  const playerTable = (d) => {
    const opts = players.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return d.players.length
      ? html`<div class="table-wrap"><table class="data pink" style="min-width: 760px">
        <thead><tr><th>CSV 닉네임</th><th>무명섬 선수</th><th>팀</th><th>실험체</th><th class="r">킬</th><th class="r">어시</th><th>죽인 사람</th></tr></thead>
        <tbody>${d.players.map((p, i) => {
          const t = d.teams.find((x) => x.key === p.teamKey);
          return html`<tr style="${t?.include ? '' : 'opacity: 0.45'}">
            <td><b>${p.nickname}</b></td>
            <td><span class="flex" style="gap: 6px; flex-wrap: nowrap"><select class="input" data-player-link="${i}" aria-label="${p.nickname} 선수 연결" style="min-height: 36px; padding: 4px 8px; min-width: 190px; ${p.playerId ? '' : 'border-color: var(--t3)'}">
              <option value="">선수 아님 (기록만)</option>${opts.map((x) => html`<option value="${x.id}" ${x.id === p.playerId ? 'selected' : ''}>${x.name} · ${x.erNickname}</option>`)}
            </select>${p.auto && p.playerId ? html`<span class="chip sky" style="font-size: 11px; padding: 0 8px">자동</span>` : ''}</span></td>
            <td class="muted" style="font-weight: 600; white-space: nowrap">${t ? `팀 ${t.teamNo} · ${t.rank}위` : '-'}</td>
            <td style="font-family: var(--head); white-space: nowrap">${p.characterKo}${p.characterKo !== p.characterEn ? '' : html` <small class="muted" style="font-family: var(--body)">(영문)</small>`}</td>
            <td class="r">${p.kills}</td><td class="r">${p.assists}</td>
            <td class="muted" style="font-weight: 600">${p.killer || '생존'}</td>
          </tr>`;
        })}</tbody></table></div>`
      : html`<p class="empty">사람 선수가 없는 판이에요 (봇만 있어요).</p>`;
  };

  const newEventForm = (d) => {
    const others = unassignedNear(d.round);
    const ne = state.newEvent;
    const startMs = Math.min(playedMs(d.round), ...(ne.withOthers ? others.map(playedMs) : []));
    return html`<form data-new-event class="stack" style="gap: 10px; background: var(--sky-soft); border: 2px dashed var(--ink); border-radius: 20px; padding: 14px 16px">
      <b style="font-family: var(--head); font-size: 17px">일정에 없던 내전이면 여기서 바로 만들어요</b>
      <label class="field">내전 이름 <input name="title" required maxlength="40" value="${ne.title}" data-new-title></label>
      ${others.length ? html`<label class="flex" style="gap: 8px; align-items: center; font-size: 14px; font-weight: 700; flex-wrap: nowrap">
        <input type="checkbox" name="withOthers" data-new-others ${ne.withOthers ? 'checked' : ''}>
        <span>비슷한 시간(앞뒤 12시간)에 올라온 미지정 판 ${others.length}개도 같이 넣기 <small class="muted" style="font-weight: 600">게임 시각 순서로 1, 2, 3… 라운드가 돼요</small></span></label>` : ''}
      <small class="muted" style="font-weight: 600">첫 판 게임 시각(${dateTimeShort(new Date(startMs).toISOString())})에 시작한 "확정" 상태 내전으로 만들어요. 이어서 하는 판은 업로드 프로그램이 이 내전으로 자동으로 넣어요. 이름 · 시간은 일정 관리에서 고칠 수 있어요.</small>
      <div class="flex"><span class="spacer"></span><button type="submit" class="btn sky" ${state.busy ? 'disabled' : ''}>내전 만들고 ${others.length && ne.withOthers ? `${others.length + 1}판` : '이 판'} 넣기</button></div>
    </form>`;
  };

  const detail = () => {
    const d = state.draft;
    if (!d) return html`<section class="card"><h2>라운드를 골라 주세요</h2><p class="muted" style="margin: 0; font-weight: 600">왼쪽 목록에서 고르거나, CSV 를 올려 주세요. 게임 PC 에 업로드 프로그램을 켜 두면 "데이터 저장"을 누를 때마다 여기로 자동으로 들어와요.</p></section>`;
    const r = d.round;
    const [label, cls] = STATUS[r.status] || [r.status, 'plain'];
    const confirmed = r.status === 'confirmed';
    return html`<section class="card ink stack" style="gap: 16px" aria-label="선택한 판 검토">
      <div class="flex" style="gap: 8px; align-items: center">
        <h2 style="word-break: break-all">${r.file_name || '게임 결과'}</h2>
        <span class="chip ${cls}">${label}</span><span class="chip plain">${SOURCE[r.source] || r.source}</span>
        ${d.parsed.gameId ? html`<span class="chip plain num" style="font-size: 12px">gameId ${d.parsed.gameId}</span>` : ''}
      </div>
      <small class="muted" style="font-weight: 600; margin-top: -10px">올린 시각 ${dateTimeShort(r.uploaded_at)} · 게임 시각 ${dateTimeShort(r.played_at)}${confirmed && r.confirmed_at ? ` · 확정 ${dateTimeShort(r.confirmed_at)}` : ''}</small>
      ${warnings(d).map(([c, msg]) => html`<p class="notice ${c}" style="margin: 0">${msg}</p>`)}
      ${d.parsed.ok ? html`
        ${confirmed ? html`<p class="notice" style="margin: 0">확정된 판이에요. 고치려면 아래 "확정 취소"를 누른 다음 다시 확정해 주세요.</p>` : ''}
        <div class="form-grid">
          <label class="field">내전 <select data-event ${confirmed ? 'disabled' : ''}><option value="">내전 미지정</option>${events.map((e) => html`<option value="${e.id}" ${e.id === d.eventId ? 'selected' : ''}>${e.title}</option>`)}</select></label>
          <label class="field">라운드 번호 <input type="number" min="1" max="30" data-round-no value="${d.roundNo}" ${confirmed ? 'disabled' : ''}></label>
        </div>
        ${!confirmed && !d.eventId ? newEventForm(d) : ''}
        <div class="stack" style="gap: 8px"><h3 style="font-family: var(--head); font-size: 19px">팀 결과</h3>
          <small class="muted" style="font-weight: 600">합계 = 순위 점수(RS) + 킬 점수(KS) − 감점. 0.5점 킬은 1~2일차(부활 가능한 시기) 킬이에요. 게임 대회 점수는 감점을 빼지 않아서 RS · KS 만 비교해요.</small>
          ${teamTable(d)}</div>
        <div class="stack" style="gap: 8px"><h3 style="font-family: var(--head); font-size: 19px">선수 연결</h3>
          <small class="muted" style="font-weight: 600">게임 닉네임이 선수 관리의 "이리 게임 닉네임"과 같으면 자동으로 연결돼요.</small>
          ${playerTable(d)}</div>` : ''}
      <div class="flex" style="border-top: 2px dashed var(--line); padding-top: 14px; gap: 8px">
        <button type="button" class="btn ghost danger" data-delete>삭제</button>
        ${confirmed ? '' : html`<button type="button" class="btn ghost" data-hold ${r.status === 'held' ? 'disabled' : ''}>보류</button>`}
        <span class="spacer"></span>
        ${confirmed
          ? html`<button type="button" class="btn" data-unconfirm ${state.busy ? 'disabled' : ''}>확정 취소</button>`
          : d.parsed.ok ? html`<button type="button" class="btn pink big" data-confirm ${state.busy ? 'disabled' : ''}>${state.busy ? '저장 중…' : '확정하기'}</button>` : ''}
      </div>
    </section>`;
  };

  const draw = () => {
    const waiting = rounds.filter((r) => r.status !== 'confirmed');
    const done = rounds.filter((r) => r.status === 'confirmed').slice(0, 8);
    mount(main, html`
      <div class="page-head"><div><h1>결과 검토</h1><p class="lead">게임에서 저장한 결과를 확인하고 확정해요. 확정해야 공개 기록이랑 랭킹에 들어가요!</p></div></div>
      <div class="row">
        <section class="grow stack" style="gap: 10px">
          <h2 style="font-family: var(--head); font-size: 20px">검토할 판 <span class="chip soft num" style="font-size: 13px; padding: 0 10px">${waiting.length}</span></h2>
          ${waiting.length ? html`<div class="grid" style="--min: 230px">${waiting.map(listItem)}</div>` : html`<p class="empty">검토할 판이 없어요! 업로드 장치가 올리거나 직접 올리면 여기에 생겨요.</p>`}
          ${done.length ? html`<details><summary style="cursor: pointer; font-family: var(--head); font-size: 17px">최근 확정 ${done.length}개</summary><div class="grid" style="--min: 230px; margin-top: 10px">${done.map(listItem)}</div></details>` : ''}
        </section>
        <form class="side card stack" data-upload style="gap: 10px; padding: 16px; flex-basis: 280px">
          <h2 style="font-family: var(--head); font-size: 18px">CSV 직접 올리기</h2>
          <label class="field">내전 <select name="event"><option value="">내전 미지정</option>${events.map((e) => html`<option value="${e.id}" ${e.id === state.uploadEvent ? 'selected' : ''}>${e.title}</option>`)}</select></label>
          <label class="field">결과 파일 (GameResult_*.csv, 여러 개 가능) <input type="file" name="files" accept=".csv,text/csv" multiple required></label>
          <button type="submit" class="btn sky" ${state.busy ? 'disabled' : ''}>올리기</button>
          <small class="muted" style="font-weight: 600">여러 파일은 파일 시간 순서대로 라운드 번호가 붙어요. 같은 판(gameId)은 한 번만 들어가요.</small>
        </form>
      </div>
      ${detail()}`);
  };

  // ── 입력 (값만 바꾸고 다시 그려요)
  const team = (el, attr) => state.draft?.teams[Number(el.dataset[attr])];
  on(main, 'click', '[data-pick]', (_e, b) => pick(b.dataset.pick));
  on(main, 'change', '[data-team-include]', (_e, el) => { team(el, 'teamInclude').include = el.checked; draw(); });
  on(main, 'change', '[data-team-no]', (_e, el) => { const t = team(el, 'teamNo'); t.teamNo = int(el.value, 1); t.teamNoSource = 'manual'; draw(); });
  on(main, 'change', '[data-team-kills]', (_e, el) => { const t = team(el, 'teamKills'); t.teamKills = int(el.value); t.earlyKills = Math.min(t.earlyKills, t.teamKills); draw(); });
  on(main, 'change', '[data-team-early]', (_e, el) => { const t = team(el, 'teamEarly'); t.earlyKills = Math.min(int(el.value), t.teamKills); draw(); });
  on(main, 'change', '[data-team-pen]', (_e, el) => { team(el, 'teamPen').penalties = int(el.value); draw(); });
  on(main, 'change', '[data-player-link]', (_e, el) => { const p = state.draft.players[Number(el.dataset.playerLink)]; p.playerId = el.value; p.auto = false; draw(); });
  on(main, 'change', '[data-round-no]', (_e, el) => { state.draft.roundNo = int(el.value, 1); draw(); });
  on(main, 'change', '[data-event]', async (_e, el) => {
    const d = state.draft;
    d.eventId = el.value;
    d.roundNo = d.eventId ? nextRoundNo(d.eventId, d.round.id) : d.roundNo;
    await guessTeams(d);
    draw();
  });
  on(main, 'change', '[data-upload] select[name="event"]', (_e, el) => { state.uploadEvent = el.value; });
  on(main, 'input', '[data-new-title]', (_e, el) => { state.newEvent.title = el.value; });
  on(main, 'change', '[data-new-others]', (_e, el) => { state.newEvent.withOthers = el.checked; draw(); });

  // ── 일정에 없던 내전: 만들고 미지정 판들을 라운드로 넣기
  on(main, 'submit', '[data-new-event]', async (e, form) => {
    e.preventDefault();
    const d = state.draft;
    if (!d || d.eventId) return;
    const title = form.elements.title.value.trim();
    if (!title) return toast('내전 이름을 적어 주세요.', true);
    const group = [d.round, ...(form.elements.withOthers?.checked ? unassignedNear(d.round) : [])].sort((a, b) => playedMs(a) - playedMs(b));
    const season = events.reduce((m, ev) => Math.max(m, ev.season || 1), 1);
    state.busy = true; draw();
    try {
      const [ev] = await insert('events', {
        title, starts_at: new Date(playedMs(group[0])).toISOString(), status: 'fixed', season, planned_rounds: Math.max(4, group.length)
      });
      for (const [i, r] of group.entries()) await update('rounds', { event_id: ev.id, round_no: i + 1 }, { id: r.id });
      state.busy = false;
      await reload();
      await pick(d.round.id);
      toast(`"${title}" 내전을 만들고 ${group.length}판을 넣었어요. 확인하고 확정해 주세요.`);
    } catch (err) {
      state.busy = false; draw();
      toast('내전을 만들지 못했어요: ' + errorText(err), true);
    }
  });

  // ── CSV 직접 올리기
  on(main, 'submit', '[data-upload]', async (e, form) => {
    e.preventDefault();
    const files = [...form.elements.files.files].sort((a, b) => a.lastModified - b.lastModified);
    const eventId = form.elements.event.value || null;
    state.busy = true; draw();
    let added = 0, firstId = null;
    const skipped = [];
    let roundNo = eventId ? nextRoundNo(eventId) : 0;
    for (const f of files) {
      try {
        const text = await f.text();
        const parsed = parseGameResult(text);
        if (!parsed.ok) { skipped.push(`${f.name}: ${parsed.error}`); continue; }
        if (parsed.gameId && rounds.some((r) => Number(r.game_id) === parsed.gameId)) { skipped.push(`${f.name}: 이미 올라간 판이에요`); continue; }
        const [row] = await insert('rounds', {
          event_id: eventId, round_no: eventId ? roundNo++ : 0, status: 'pending', source: 'manual',
          file_name: f.name, raw_csv: text, game_id: parsed.gameId, played_at: new Date(f.lastModified || Date.now()).toISOString()
        });
        rounds.unshift(row);
        firstId ??= row.id;
        added++;
      } catch (err) {
        skipped.push(`${f.name}: ${/game_id/.test(errorText(err)) ? '이미 올라간 판이에요' : errorText(err)}`);
      }
    }
    state.busy = false;
    await reload();
    if (firstId) await pick(firstId); else draw();
    toast(`${added}개 올렸어요${skipped.length ? ` · 건너뜀 ${skipped.length}개 (${skipped[0]}${skipped.length > 1 ? ' …' : ''})` : ''}`, !added && skipped.length > 0);
  });

  // ── 확정 · 보류 · 삭제 · 확정 취소
  on(main, 'click', '[data-confirm]', async () => {
    const d = state.draft;
    const inc = d.teams.filter((t) => t.include);
    if (!d.eventId) {
      const input = main.querySelector('[data-new-title]');
      input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      input?.focus({ preventScroll: true });
      return toast('어느 내전의 판인지 먼저 정해 주세요. 내전을 고르거나, 위의 파란 칸에서 바로 만들 수 있어요.', true);
    }
    if (!inc.length) return toast('저장할 팀이 없어요.', true);
    if (new Set(inc.map((t) => t.teamNo)).size !== inc.length) return toast('같은 팀 번호가 있어요. 팀 번호를 확인해 주세요.', true);
    if (rounds.some((r) => r.id !== d.round.id && r.event_id === d.eventId && r.round_no === d.roundNo)) return toast(`이 내전에 이미 ${d.roundNo}라운드가 있어요. 라운드 번호를 바꿔 주세요.`, true);
    const keys = new Set(inc.map((t) => t.key));
    const ps = d.players.filter((p) => keys.has(p.teamKey));
    const unmatched = ps.filter((p) => !p.playerId).length;
    if (unmatched && !confirm(`선수와 연결 안 된 닉네임 ${unmatched}명은 기록만 남아요. 이대로 확정할까요?`)) return;
    const teamNoOf = new Map(inc.map((t) => [t.key, t.teamNo]));
    state.busy = true; draw();
    try {
      await rpc('confirm_round', {
        p_round: d.round.id, p_event: d.eventId, p_round_no: d.roundNo,
        p_teams: inc.map((t) => ({ team_no: t.teamNo, team_rank: t.rank, team_kills: t.teamKills, early_kills: t.earlyKills, penalties: t.penalties })),
        p_players: ps.map((p) => ({ player_id: p.playerId || null, csv_nickname: p.nickname, team_no: teamNoOf.get(p.teamKey), character_name: p.characterKo, kills: p.kills, assists: p.assists, extra: p.extra }))
      });
      toast(`${eventTitle(d.eventId)} ${d.roundNo}라운드를 확정했어요! 공개 기록에 반영됐어요.`);
      const nextWaiting = rounds.find((r) => r.status !== 'confirmed' && r.id !== d.round.id);
      state.busy = false;
      await reload();
      if (nextWaiting) await pick(nextWaiting.id); else await pick(d.round.id);
    } catch (err) {
      state.busy = false; draw();
      toast('확정하지 못했어요: ' + errorText(err), true);
    }
  });
  on(main, 'click', '[data-hold]', async () => {
    try { await update('rounds', { status: 'held' }, { id: state.draft.round.id }); await reload(); await pick(state.sel); toast('보류해 뒀어요. 나중에 다시 확정할 수 있어요.'); } catch (e) { toast(errorText(e), true); }
  });
  on(main, 'click', '[data-unconfirm]', async () => {
    if (!confirm('확정을 취소할까요? 공개 기록과 랭킹에서 이 판이 빠지고, 다시 검토 대기로 돌아가요.')) return;
    try { await update('rounds', { status: 'pending', confirmed_at: null, confirmed_by: null }, { id: state.draft.round.id }); await reload(); await pick(state.sel); toast('확정을 취소했어요.'); } catch (e) { toast(errorText(e), true); }
  });
  on(main, 'click', '[data-delete]', async () => {
    if (!confirm('이 판을 지울까요? 저장된 팀 · 선수 기록도 같이 지워지고 되돌릴 수 없어요.')) return;
    try { await remove('rounds', { id: state.draft.round.id }); state.sel = null; state.draft = null; await reload(); draw(); toast('지웠어요.'); } catch (e) { toast(errorText(e), true); }
  });

  await reload();
  const first = rounds.find((r) => r.status !== 'confirmed');
  if (first) await pick(first.id); else draw();
});
