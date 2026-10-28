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
/** MVP 투표 시작: 이미 시작한(시작 시각이 지난) 내전 중 가장 최근 것 */
export function pickMvpEvent(events, now = Date.now()) {
  return events.filter((e) => ms(e.starts_at) <= now + HOUR)
    .sort((a, b) => ms(b.starts_at) - ms(a.starts_at))[0] ?? null;
}
/** MVP 마감: 투표 중인 내전 (여럿이면 가장 최근) */
export function pickOpenVoteEvent(events) {
  return events.filter((e) => e.mvp_vote_status === 'open').sort((a, b) => ms(b.starts_at) - ms(a.starts_at))[0] ?? null;
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

export function voteProblem({ event, voter, candidate, isParticipant, candidateIsParticipant }) {
  if (!voter) return '먼저 `/연결 게임닉네임` 으로 디스코드 계정을 연결해 주세요!';
  if (!event || event.mvp_vote_status !== 'open') return 'MVP 투표가 열려 있지 않아요.';
  if (!isParticipant) return '이 내전 참가자만 투표할 수 있어요.';
  if (!candidate || !candidateIsParticipant) return '그 선수는 후보가 아니에요.';
  if (candidate === voter) return '자기 자신은 고를 수 없어요!';
  return '';
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

/** MVP 투표 메시지: candidates = [{ id, name, tier, team }] */
export function mvpMessage(event, candidates, votes, eligible) {
  const open = event.mvp_vote_status === 'open';
  return {
    embeds: [{
      title: `🏆 ${event.title} MVP 투표`,
      description: open
        ? `오늘 가장 빛난 생존자를 골라 주세요!\n이 내전 참가자만 투표할 수 있고, 마감 전까지 몇 번이든 바꿀 수 있어요. 자기 자신은 못 골라요.\n\n🗳️ **${votes} / ${eligible}명** 투표했어요`
        : `투표가 마감됐어요! 🗳️ ${votes}명이 투표했어요.`,
      color: open ? PINK : SKY,
      footer: { text: '최다 득표가 MVP · 공동 1위면 봇이 추첨해요 · 무명섬' }
    }],
    components: open && candidates.length ? [{
      type: 1,
      components: [{
        type: 3, custom_id: `mvp:${event.id}`, placeholder: 'MVP 고르기', min_values: 1, max_values: 1,
        options: candidates.slice(0, 25).map((c) => ({
          label: c.name.slice(0, 100), value: c.id,
          description: `${c.tier}티어${c.team ? ` · 팀 ${c.team}` : ''}`
        }))
      }]
    }] : []
  };
}

/** MVP 결과 발표 */
export function mvpResultMessage(event, result, nameOf) {
  const name = nameOf(result.picked);
  const top = result.ranking[0]?.votes ?? 0;
  const lines = [
    result.drawn
      ? `공동 1위 ${result.tied.length}명(각 ${top}표) 중에서 추첨했어요! 🎲\n후보: ${result.tied.map(nameOf).join(', ')}`
      : `**${top}표**로 MVP가 됐어요!`,
    '',
    ...result.ranking.slice(0, 5).map((r, i) => `${i + 1}. ${nameOf(r.id)} — ${r.votes}표`)
  ];
  return {
    embeds: [{
      title: `🏆 ${event.title} MVP는 ${name}!`,
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
