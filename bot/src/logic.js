// 무명섬 디스코드 봇: 화면(메시지) 만들기와 규칙 — 디스코드 · DB 없이 테스트할 수 있는 순수 함수만 있어요

export const PINK = 0xf880b9;
export const SKY = 0x8fdff5;
export const STATUS_LABEL = { plan: '예정', open: '참가 모집 중', fixed: '확정', done: '완료' };
export const FORMAT_LABEL = { draft: '드래프트', auto: '자동 편성' };
const HOUR = 3600_000;

const ms = (iso) => Date.parse(iso);
const unix = (iso) => Math.floor(ms(iso) / 1000);
/** 디스코드 시간 표시 (보는 사람 시간대로 바뀌어요) */
export const when = (iso) => `<t:${unix(iso)}:F> (<t:${unix(iso)}:R>)`;
/** 자동완성 · 로그용 짧은 한국 시간 */
export function shortKst(iso) {
  const d = new Date(ms(iso) + 9 * HOUR);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

// ── 어느 내전인지 (명령어에서 내전을 안 고르면)

/** 참가 신청: 모집 중인 내전 중 가장 가까운 것 */
export function pickSignupEvent(events, now = Date.now()) {
  return events.filter((e) => e.status === 'open' && ms(e.starts_at) >= now - 6 * HOUR)
    .sort((a, b) => ms(a.starts_at) - ms(b.starts_at))[0] ?? null;
}
/** 공지: 끝나지 않은 다가오는 내전 중 가장 가까운 것 */
export function pickAnnounceEvent(events, now = Date.now()) {
  return events.filter((e) => e.status !== 'done' && ms(e.starts_at) >= now - 6 * HOUR)
    .sort((a, b) => ms(a.starts_at) - ms(b.starts_at))[0] ?? null;
}
/** 라운드 MVP 투표 (/mvp): 이미 시작한(시작 시각이 지난) 내전 중 가장 최근 것 */
export function pickMvpEvent(events, now = Date.now()) {
  return events.filter((e) => ms(e.starts_at) <= now + HOUR)
    .sort((a, b) => ms(b.starts_at) - ms(a.starts_at))[0] ?? null;
}

/** 내전 자동완성 목록 (최대 25개): 끝나지 않은 것 먼저, 가까운 날짜 순 */
export function eventChoices(events, query = '', now = Date.now()) {
  const q = String(query).trim().toLowerCase();
  return events
    .filter((e) => !q || e.title.toLowerCase().includes(q) || shortKst(e.starts_at).includes(q))
    .sort((a, b) => (a.status === 'done') - (b.status === 'done') || Math.abs(ms(a.starts_at) - now) - Math.abs(ms(b.starts_at) - now))
    .slice(0, 25)
    .map((e) => ({ name: `${e.title} · ${shortKst(e.starts_at)} · ${STATUS_LABEL[e.status] ?? e.status}`.slice(0, 100), value: e.id }));
}

// ── 참가 신청 규칙

/** → '' 이면 신청 가능, 아니면 안 되는 이유 */
export function joinProblem({ event, count, already, linked }) {
  if (!linked) return '먼저 `/연결 게임닉네임` 으로 디스코드 계정을 무명섬 선수와 연결해 주세요!';
  if (!event) return '지금 참가 신청을 받는 내전이 없어요.';
  if (event.status === 'done') return '이미 끝난 내전이에요.';
  if (event.status === 'plan') return '아직 참가 신청을 받기 전이에요. 공지가 올라오면 다시 눌러 주세요!';
  if (event.status === 'fixed') return '참가 신청이 마감됐어요. 운영진에게 말해 주세요.';
  if (already) return '이미 신청했어요! 취소하려면 "참가 취소"를 눌러 주세요.';
  if (count >= event.max_players) return `자리가 다 찼어요 (${count}/${event.max_players}명).`;
  return '';
}
export function leaveProblem({ event, already, linked, inTeam }) {
  if (!linked) return '먼저 `/연결 게임닉네임` 으로 디스코드 계정을 연결해 주세요.';
  if (!event) return '참가 신청한 내전을 찾지 못했어요.';
  if (event.status === 'done') return '이미 끝난 내전이에요.';
  if (!already) return '이 내전에 신청한 기록이 없어요.';
  if (inTeam) return '팀이 이미 짜여 있어서 직접 취소할 수 없어요. 운영진에게 말해 주세요!';
  return '';
}

// ── MVP

/**
 * 표 세기: 최다 득표가 MVP, 공동 1위면 그중에서 추첨
 *   votes: [{ candidate_player_id }]  rng: () => 0~1
 * → { counts: { id: n }, ranking: [{ id, votes }], tied: [id], picked, drawn, votes }
 */
export function tally(votes, rng = Math.random) {
  const counts = {};
  for (const v of votes) counts[v.candidate_player_id] = (counts[v.candidate_player_id] || 0) + 1;
  const ranking = Object.entries(counts).map(([id, n]) => ({ id, votes: n })).sort((a, b) => b.votes - a.votes || a.id.localeCompare(b.id));
  if (!ranking.length) return { counts, ranking, tied: [], picked: null, drawn: false, votes: 0 };
  const top = ranking[0].votes;
  const tied = ranking.filter((r) => r.votes === top).map((r) => r.id);
  const picked = tied.length > 1 ? tied[Math.min(tied.length - 1, Math.floor(rng() * tied.length))] : tied[0];
  return { counts, ranking, tied, picked, drawn: tied.length > 1, votes: votes.length };
}

// ── 라운드 MVP 투표 (결과를 확정하면 자동으로 열고 30분 뒤 자동 마감)

export const ROUND_VOTE_MINUTES = 30;

/**
 * 웹 관리자 → 기록 공개 설정 (DB 12단계 site_settings)
 * 비공개거나 설정을 못 읽으면 결과 공지 · MVP 투표를 쉬어요. 기록 저장은 그대로예요
 */
export function recordsVisibility(row) {
  if (!row || !row.records_public) return { results: false, mvp: false };
  const items = row.records_items || {};
  return { results: items.results?.on !== false, mvp: items.mvp?.on !== false };
}
export const RECORDS_OFF_TEXT = '지금 무명섬 경쟁 기록이 비공개라 라운드 MVP 투표를 쉬고 있어요. 웹 관리자 → 기록 공개에서 켜면 다시 열 수 있어요.';

/**
 * 라운드 MVP 투표를 할 수 있는지
 * voters: 투표할 수 있는 선수 id (내전 참가자 + 그 라운드에 뛴 선수), candidates: 후보 id (그 라운드에 뛴 선수)
 */
export function roundVoteProblem({ round, voter, candidate, voters = new Set(), candidates = new Set(), now = Date.now() }) {
  if (!voter) return '먼저 `/연결 게임닉네임` 으로 디스코드 계정을 연결해 주세요!';
  if (!round || round.mvp_vote_status !== 'open' || round.status !== 'confirmed') return 'MVP 투표가 열려 있지 않아요.';
  if (round.mvp_vote_closes_at && ms(round.mvp_vote_closes_at) <= now) return '투표가 막 마감됐어요! 곧 발표돼요.';
  if (!voters.has(voter)) return '이 내전 참가자만 투표할 수 있어요.';
  if (!candidate || !candidates.has(candidate)) return '그 선수는 후보가 아니에요.';
  if (candidate === voter) return '자기 자신은 고를 수 없어요!';
  return '';
}

/**
 * 내전이 끝났는지 → 끝나면 참가 공지 · 투표 메시지를 지워요 (라운드 결과 · MVP 발표는 남겨요)
 * 끝 = 시작한 뒤에 (상태 완료) 또는 (시작 12시간 뒤) 또는 (예정 라운드를 다 확정했고 열려 있는 투표가 없음)
 */
export function eventEnded(event, rounds = [], now = Date.now()) {
  const start = ms(event.starts_at);
  if (!(start <= now)) return false;
  if (event.status === 'done' || now >= start + 12 * HOUR) return true;
  const mine = rounds.filter((r) => r.event_id === event.id && r.status === 'confirmed');
  const planned = Number(event.planned_rounds) || 0;
  if (!planned || new Set(mine.map((r) => r.round_no)).size < planned) return false;
  return mine.every((r) => r.mvp_vote_status !== 'open');
}

// ── 메시지 (discord.js 에 그대로 넘기는 JSON)

const tierLine = (list) => (list.length ? list.join(' · ') : '아직 없어요');

/** 참가 신청 공지: participants = [{ name, tier }] */
export function signupMessage(event, participants, siteUrl) {
  const open = event.status === 'open';
  const byTier = [1, 2, 3].map((t) => participants.filter((p) => p.tier === t).map((p) => p.name));
  const lines = [
    `🗓️ ${when(event.starts_at)}`,
    `🎮 ${FORMAT_LABEL[event.format] ?? event.format} 방식 · ${event.planned_rounds}라운드`,
    `👥 **${participants.length} / ${event.max_players}명**${open ? '' : ` · ${STATUS_LABEL[event.status] ?? event.status}`}`
  ];
  if (event.setting_code) lines.push(`🔑 설정 코드 \`${event.setting_code}\``);
  if (event.memo) lines.push(`📌 ${event.memo}`);
  return {
    embeds: [{
      title: `📢 ${event.title}`,
      url: siteUrl ? `${siteUrl}/schedule` : undefined,
      description: lines.join('\n'),
      color: open ? PINK : SKY,
      fields: [1, 2, 3].map((t, i) => ({ name: `${t}티어 (${byTier[i].length})`, value: tierLine(byTier[i]).slice(0, 1024), inline: false })),
      footer: { text: open ? '참가하기 버튼을 누르거나 /참가 를 입력해 주세요 · 무명섬' : '지금은 참가 신청을 받지 않아요 · 무명섬' }
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: '참가하기', emoji: { name: '✋' }, custom_id: `join:${event.id}`, disabled: !open },
        { type: 2, style: 2, label: '참가 취소', custom_id: `leave:${event.id}`, disabled: event.status === 'done' },
        ...(siteUrl ? [{ type: 2, style: 5, label: '무명섬에서 보기', url: `${siteUrl}/draft?id=${event.id}` }] : [])
      ]
    }]
  };
}

// ── 참가 공지 자동 게시 (30초마다 확인)
//   ① 일정이 "참가 모집 중"이 되면 바로
//   ② 시작 24시간 전에 한 번 더 (모집 중 · 확정 내전). 이미 24시간 안에 올라간 공지가 있으면 건너뛰어요
//   시작이 24시간도 안 남았을 때 모집 중이 되면 한 번만 올려요

const DAY = 24 * HOUR;
const kstDay = (t) => Math.floor((t + 9 * HOUR) / DAY);

/**
 * events: 아직 안 끝난 내전, posted: Map(내전 id → 마지막 참가 공지 시각), marks: 지난번 기록 { [id]: { open, d1 } }
 * → { posts: [{ event, kind: 'open' | 'd1' }], marks }   marks 는 시작 전 내전만 남긴 새 객체
 */
export function autoAnnouncePlan(events, posted = new Map(), marks = {}, now = Date.now()) {
  const posts = [];
  const next = {};
  for (const e of events) {
    const start = ms(e.starts_at);
    if (!(start > now) || e.status === 'done') continue;
    const m = { ...(marks[e.id] ?? {}) };
    const last = posted.get(e.id) ? ms(posted.get(e.id)) : null;
    const inWindow = now >= start - DAY;
    const postedInWindow = last !== null && last >= start - DAY;
    if (e.status === 'open' && !m.open) {
      m.open = true;
      if (last === null) {                       // 손으로 올린 공지(/내전공지)가 있으면 그걸로 쳐요
        posts.push({ event: e, kind: 'open' });
        if (inWindow) m.d1 = e.starts_at;        // 24시간 안이면 이걸로 하루 전 공지도 끝
      }
    }
    // 하루 전 공지는 "그 시작 시각" 기준이라 일정을 옮기면 다시 올라가요
    if (inWindow && m.d1 !== e.starts_at && (e.status === 'open' || e.status === 'fixed')) {
      m.d1 = e.starts_at;
      if (!postedInWindow) posts.push({ event: e, kind: 'd1' });
    }
    next[e.id] = m;
  }
  return { posts, marks: next };
}

/** "내일 오후 8시" · "오늘 오후 8시 30분" (한국 시간) */
export function kstWhenWord(iso, now = Date.now()) {
  const t = ms(iso);
  const diff = kstDay(t) - kstDay(now);
  const dayWord = diff <= 0 ? '오늘' : diff === 1 ? '내일' : diff === 2 ? '모레' : `${diff}일 뒤`;
  const d = new Date(t + 9 * HOUR);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const half = h < 12 ? '오전' : '오후';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${dayWord} ${half} ${h12}시${m ? ` ${m}분` : ''}`;
}

/** 자동 공지 위에 붙는 한 줄 */
export function autoAnnounceText({ event, kind }, now = Date.now()) {
  const soon = ms(event.starts_at) - now <= DAY;
  const at = kstWhenWord(event.starts_at, now);
  if (kind === 'open') {
    return soon
      ? `📢 **참가 모집 시작! ${at} 내전이에요.** 아래 [참가하기] 버튼이나 /참가 로 신청해 주세요!`
      : '📢 **참가 모집을 시작했어요!** 아래 [참가하기] 버튼이나 /참가 로 신청해 주세요!';
  }
  return event.status === 'open'
    ? `⏰ **${at} 내전이에요!** 아직 신청 안 했다면 아래 [참가하기] 버튼으로 신청해 주세요.`
    : `⏰ **${at} 내전이에요!** 참가 명단이 확정됐어요. 늦지 않게 와 주세요!`;
}

// ── 디스코드 첫 소개 공지 (/소개공지 → 창에서 제목 · 내용 고치기 → 이 채널에)
//   디스코드는 그림을 링크로 만들 수 없어서, 제목과 아래 버튼을 누르면 사이트로 가요

export const INTRO_MODAL_ID = 'intro';

/** 창에 미리 채워 둘 제목 · 내용 (commandsChannel: /채널설정 명령어 로 정한 채널) */
export function introDefaults({ commandsChannel = null } = {}) {
  const where = commandsChannel ? `<#${commandsChannel}> 에서` : '아무 채널에서';
  return {
    title: '🏝️ 무명섬에 오신 걸 환영해요!',
    body: [
      '이터널 리턴 사설 내전 **무명섬**이 문을 열었어요!',
      '',
      '🗓️ 내전 일정과 참가 신청',
      '🏆 내전 기록 · 선수 랭킹 · MVP',
      '👥 팀 편성 · 드래프트 진행판',
      '',
      '**참가하는 법**',
      `1️⃣ ${where} \`/연결 게임닉네임\` 을 입력해 주세요. 운영진이 확인하면 연결 끝!`,
      '2️⃣ 내전 공지가 올라오면 [참가하기] 버튼을 누르거나 `/참가`',
      '3️⃣ 내 정보는 `/내정보` 로 확인해요',
      '',
      '제목이나 아래 버튼을 누르면 무명섬 사이트로 가요.'
    ].join('\n')
  };
}

/** /소개공지 를 치면 뜨는 창 */
export function introModal({ title, body }) {
  return {
    custom_id: INTRO_MODAL_ID,
    title: '무명섬 소개 공지',
    components: [
      { type: 1, components: [{ type: 4, custom_id: 'title', label: '제목', style: 1, required: true, max_length: 200, value: title.slice(0, 200) }] },
      { type: 1, components: [{ type: 4, custom_id: 'body', label: '내용 (줄바꿈 · **굵게** 다 돼요)', style: 2, required: true, max_length: 4000, value: body.slice(0, 4000) }] }
    ]
  };
}

/** 소개 공지 메시지: 큰 그림(welcome.png) + 사이트로 가는 링크 버튼 */
export function introMessage({ title, body, siteUrl }) {
  const url = (path = '') => (siteUrl ? `${siteUrl}${path}` : undefined);
  const links = siteUrl ? [
    ['무명섬 바로가기', ''], ['내전 일정', '/schedule'], ['내전 기록', '/matches'], ['선수 · 랭킹', '/players'], ['규칙', '/rules']
  ] : [];
  return {
    embeds: [{
      title: String(title || '').trim().slice(0, 256) || '무명섬',
      url: url(),
      description: String(body || '').trim().slice(0, 4096),
      color: PINK,
      image: siteUrl ? { url: url('/welcome.png') } : undefined,
      footer: { text: '무명섬 · 이터널 리턴 사설 내전' }
    }],
    components: links.length ? [{ type: 1, components: links.map(([label, path]) => ({ type: 2, style: 5, label, url: url(path) })) }] : []
  };
}

/** 라운드 MVP 투표 메시지: candidates = [{ id, name, team, kills, assists, damage }] */
export function roundVoteMessage({ event, round, candidates = [], votes = 0, eligible = 0, label = (n) => `팀 ${n}` }) {
  const open = round.mvp_vote_status === 'open';
  const closes = round.mvp_vote_closes_at;
  return {
    embeds: [{
      title: `🏆 ${event.title} ${round.round_no}라운드 MVP 투표`,
      description: open
        ? [
          '이번 판에서 가장 빛난 생존자를 골라 주세요!',
          '이 내전 참가자만 투표할 수 있고, 마감 전까지 몇 번이든 바꿀 수 있어요. 자기 자신은 못 골라요.',
          '',
          `⏰ ${closes ? `<t:${unix(closes)}:R> 마감` : '곧 마감'} · 🗳️ **${votes} / ${eligible}명** 투표했어요`
        ].join('\n')
        : `투표가 마감됐어요! 🗳️ ${votes}명이 투표했어요.`,
      color: open ? PINK : SKY,
      footer: { text: '최다 득표가 라운드 MVP · 공동 1위면 봇이 추첨해요 · 무명섬' }
    }],
    components: open && candidates.length ? [{
      type: 1,
      components: [{
        type: 3, custom_id: `rmvp:${round.id}`, placeholder: 'MVP 고르기', min_values: 1, max_values: 1,
        options: candidates.slice(0, 25).map((c) => ({
          label: c.name.slice(0, 100), value: c.id,
          description: `${label(c.team)} · ${c.kills}킬 ${c.assists}어시`.slice(0, 100)
        }))
      }]
    }] : []
  };
}

/** 라운드 MVP 발표 (이 메시지는 내전이 끝나도 남겨요) */
export function roundMvpResultMessage({ event, round, result, nameOf, siteUrl }) {
  const name = nameOf(result.picked);
  const top = result.ranking[0]?.votes ?? 0;
  const lines = [
    result.drawn
      ? `공동 1위 ${result.tied.length}명(각 ${top}표) 중에서 추첨했어요! 🎲\n후보: ${result.tied.map(nameOf).join(', ')}`
      : `**${top}표**로 ${round.round_no}라운드 MVP가 됐어요!`,
    '',
    ...result.ranking.slice(0, 5).map((r, i) => `${i + 1}. ${nameOf(r.id)} — ${r.votes}표`)
  ];
  return {
    embeds: [{
      title: `🏆 ${event.title} ${round.round_no}라운드 MVP는 ${name}!`,
      url: siteUrl ? `${siteUrl}/match?id=${event.id}` : undefined,
      description: lines.join('\n'),
      color: PINK,
      footer: { text: `${result.votes}명 투표 · 축하해요! · 무명섬` }
    }]
  };
}

/** 점수: 0.5 단위라 정수면 그대로, 아니면 소수 첫째 자리 */
export const pts = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(1); };

/**
 * 라운드 결과 공지
 *   teams: [{ team_no, team_rank, rs, ks, pen, total, team_kills }]
 *   standings: [{ team_no, standing, total, rounds }]  (이 라운드까지 누적)
 *   members: Map(team_no → [이름])   label: team_no → '팀 3' · '새벽사냥꾼 팀'
 */
export function roundResultMessage({ event, round, teams, standings, members, label, siteUrl, edited = false }) {
  const rows = teams.slice().sort((a, b) => a.team_rank - b.team_rank).map((t) => {
    const who = (members.get(t.team_no) || []).join(' · ');
    const pen = Number(t.pen) ? ` − 감점 ${pts(t.pen)}` : '';
    return `**${t.team_rank}위** ${label(t.team_no)} · **${pts(t.total)}점** (순위 ${pts(t.rs)} + 킬 ${pts(t.ks)}${pen}) · ${t.team_kills}킬${who ? `\n　${who}` : ''}`;
  });
  const top = standings.slice().sort((a, b) => a.standing - b.standing).slice(0, 8)
    .map((s) => `${s.standing}. ${label(s.team_no)} — ${pts(s.total)}점 (${s.rounds}판)`);
  return {
    embeds: [{
      title: `🏁 ${event.title} ${round.round_no}라운드 결과${edited ? ' (수정됨)' : ''}`,
      url: siteUrl ? `${siteUrl}/match?id=${event.id}` : undefined,
      description: rows.join('\n').slice(0, 3500),
      color: PINK,
      fields: top.length ? [{ name: `누적 순위 (${Math.max(...standings.map((s) => Number(s.rounds) || 0))}라운드까지)`, value: top.join('\n').slice(0, 1024) }] : [],
      footer: { text: '순위 점수 + 킬 점수(1~2일차 0.5점) − 처치자 불명 감점 · 무명섬' }
    }],
    components: siteUrl ? [{ type: 1, components: [{ type: 2, style: 5, label: '내전 기록 보기', url: `${siteUrl}/match?id=${event.id}` }] }] : []
  };
}

export const parseId = (customId, prefix) => (customId.startsWith(prefix + ':') ? customId.slice(prefix.length + 1) : null);

// ── 새 인원 · 선수 등록 (디스코드에서 바로 · 3티어)
export const REGISTER_MODAL_ID = 'regform';
export const SELF_REGISTER_MEMO = '디스코드로 직접 등록 (3티어)';
export const WELCOME_KEEP_HOURS = 24;

/** 방송 채널 주소 → 치지직 채널 id 또는 유튜브 주소 (비우면 없음, 못 알아보면 ok: false) */
export function parseChannel(input) {
  const s = String(input ?? '').trim();
  if (!s) return { ok: true };
  const chz = s.match(/chzzk\.naver\.com\/(?:live\/)?([0-9a-f]{32})/i) || s.match(/^([0-9a-f]{32})$/i);
  if (chz) return { ok: true, chzzk_channel_id: chz[1].toLowerCase(), photo_source: 'chzzk' };
  if (/^(https?:\/\/)?((www|m)\.)?(youtube\.com|youtu\.be)\/\S+/i.test(s)) {
    return { ok: true, youtube_url: (/^https?:\/\//i.test(s) ? s : 'https://' + s).slice(0, 300), photo_source: 'youtube' };
  }
  return { ok: false };
}

/** 이름 · 닉네임 검사 (빈칸 · 너무 김) */
export function registerProblem({ name, nickname }) {
  if (!name) return '이름을 적어 주세요. 치지직 · 유튜브 채널 이름이면 돼요.';
  if (!nickname) return '이터널 리턴 게임 닉네임을 적어 주세요.';
  if (name.length > 30) return '이름은 30자까지예요.';
  if (nickname.length > 30) return '게임 닉네임은 30자까지예요.';
  return '';
}

/** 선수 등록 창 (이름 · 게임 닉네임 · 방송 채널 주소) */
export function registerModal({ name = '', nickname = '' } = {}) {
  const input = (custom_id, label, { required = true, max = 30, value = '', placeholder } = {}) => ({
    type: 1,
    components: [{ type: 4, custom_id, label, style: 1, required, max_length: max, ...(value ? { value: String(value).slice(0, max) } : {}), ...(placeholder ? { placeholder } : {}) }]
  });
  return {
    custom_id: REGISTER_MODAL_ID,
    title: '무명섬 선수 등록',
    components: [
      input('name', '이름 (치지직 · 유튜브 채널 이름)', { value: name, placeholder: '사이트 · 공지에 보일 이름' }),
      input('nick', '이터널 리턴 게임 닉네임', { value: nickname, placeholder: '게임 안 닉네임 그대로' }),
      input('channel', '방송 채널 주소 (없으면 비워 두세요)', { required: false, max: 200, placeholder: 'https://chzzk.naver.com/… 또는 유튜브 채널 주소' })
    ]
  };
}

const registerButtons = (suffix = '') => [{
  type: 1,
  components: [
    { type: 2, style: 1, label: '선수예요 · 등록하기', custom_id: 'reg:p' + suffix },
    { type: 2, style: 2, label: '관계자예요', custom_id: 'reg:s' + suffix }
  ]
}];
const registerGuide = [
  '**선수예요** → 이름(치지직 · 유튜브 채널 이름)과 게임 닉네임을 적으면 바로 무명섬 선수로 등록돼요. 그다음 공지의 [참가하기]로 내전에 참가하면 돼요.',
  '**관계자예요** → 따로 할 건 없어요. 공지에서 내전 소식을 볼 수 있어요.'
].join('\n');

/** 새 인원이 들어오면 환영 채널에 올리는 안내 (그 사람을 @멘션) */
export function welcomeMessage({ userId, siteUrl = '' }) {
  return {
    content: `<@${userId}>`,
    embeds: [{ title: '무명섬에 오신 걸 환영해요!', url: siteUrl || undefined, color: 0xF880B9, description: `선수인지 관계자인지 골라 주세요.\n\n${registerGuide}` }],
    components: registerButtons(':' + userId)
  };
}

/** /등록안내: 누구나 누를 수 있는 고정 안내 */
export function registerPanel({ siteUrl = '' } = {}) {
  return {
    embeds: [{ title: '무명섬 선수 등록', url: siteUrl || undefined, color: 0x8FDFF5, description: `처음 오셨나요? 아래에서 골라 주세요.\n\n${registerGuide}\n\n이미 무명섬에 선수로 등록돼 있다면 \`/연결 게임닉네임\` 으로 디스코드만 연결하면 돼요.` }],
    components: registerButtons()
  };
}

/** 등록이 끝났을 때 답장 */
export function registeredText({ name, nickname, channel }) {
  return [
    `**${name}** 선수로 등록했어요! (게임 닉네임 \`${nickname}\` · 3티어)`,
    '• 티어는 운영진이 정해요. 바뀌면 바로 반영돼요.',
    '• 공지의 [참가하기] 버튼이나 `/참가` 로 내전에 참가할 수 있어요. 내 정보는 `/내정보`.',
    channel === false ? '• 방송 채널 주소를 알아보지 못했어요. 치지직 · 유튜브 주소를 운영진에게 알려 주세요.' : channel ? '• 방송 채널도 연결했어요. 프로필 사진과 LIVE 표시는 몇 분 안에 사이트에 떠요.' : ''
  ].filter(Boolean).join('\n');
}

/**
 * 1티어(오더) 역할: 연결된 선수 중 활동 중인 1티어에게만 주고, 티어가 바뀌거나 연결을 풀면 빼요
 * links: [{ discord_id, tier, active }] · managed: 지난번에 역할을 준 사람
 */
export function tierRolePlan({ links, managed = [] }) {
  const want = new Set(links.filter((l) => l.discord_id && l.active !== false && Number(l.tier) === 1).map((l) => l.discord_id));
  const remove = new Set([...links.filter((l) => l.discord_id && !want.has(l.discord_id)).map((l) => l.discord_id), ...managed.filter((id) => !want.has(id))]);
  return { add: [...want], remove: [...remove], managed: [...want] };
}
