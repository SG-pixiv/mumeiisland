// Supabase 를 연결하기 전에도 화면을 확인할 수 있게 쓰는 예시 데이터 + 뷰 계산.
// DB 의 테이블 · 뷰와 같은 모양으로 돌려줘요. (새로고침하면 처음 상태로 돌아가요)

const iso = (s) => new Date(s).toISOString();
const T = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const roster = [
  // id, 이름, 게임 닉네임, 티어, 역할, 모스트, 솔로 랭크 점수, 랭크 판수, 승, 치지직, 유튜브, 방송 중
  [1, '새벽사냥꾼', 'dawn_hunter', 1, '브루저', ['재키', '유키', '히스이'], 6350, 143, 26, 'a1b2c3d4e5f60718293a4b5c6d7e8f90', '', true],
  [2, '루미아토박이', 'lumia_native', 1, '원거리 딜러', ['아이솔', '로지', '아르다'], 6420, 121, 26, 'b1b2c3d4e5f60718293a4b5c6d7e8f90', 'https://www.youtube.com/@lumia_native', false],
  [3, '위클라인잡이', 'wickline_catch', 1, '스킬 딜러', ['혜진', '비앙카', '라우라'], 6100, 98, 16, '', 'https://www.youtube.com/@wickline', false],
  [4, '운석줍는사람', 'meteor_picker', 1, '탱커', ['레녹스', '마커스', '에스텔'], 5540, 77, 10, 'c1b2c3d4e5f60718293a4b5c6d7e8f90', '', false],
  [5, '보급상자', 'supplybox', 2, '스킬 딜러', ['아야', '시셀라', '키아라'], 5600, 88, 13, '', 'https://www.youtube.com/@supplybox', true],
  [6, '호텔투숙객', 'hotel_guest', 2, '브루저', ['현우', '일레븐', '알렉스'], 5320, 76, 10, 'd1b2c3d4e5f60718293a4b5c6d7e8f90', '', true],
  [7, '금지구역탈출', 'restricted_out', 2, '서포터', ['요한', '바냐', '프리야'], 4900, 61, 7, 'e1b2c3d4e5f60718293a4b5c6d7e8f90', '', false],
  [8, '양궁장주민', 'archery_local', 2, '원거리 딜러', ['리오', '나딘', '아이솔'], 5050, 55, 6, '', 'https://www.youtube.com/@archery', false],
  [9, '성당종지기', 'bell_ringer', 3, '스킬 딜러', ['혜진', '아야'], 4480, 59, 6, 'f1b2c3d4e5f60718293a4b5c6d7e8f90', 'https://www.youtube.com/@bellringer', false],
  [10, '학교종소리', 'school_bell', 3, '서포터', ['니키', '요한'], 4200, 52, 5, '01b2c3d4e5f60718293a4b5c6d7e8f90', '', true],
  [11, '절간스님', 'temple_monk', 3, '브루저', ['현우', '재키', '알렉스'], 3950, 48, 4, '', 'https://www.youtube.com/@temple_monk', false],
  [12, '공장야근', 'factory_night', 3, '원거리 딜러', ['로지', '아이솔', '리오'], null, 0, 0, '11b2c3d4e5f60718293a4b5c6d7e8f90', '', false]
];

const charCodes = { 재키: 1, 아야: 2, 현우: 6, 매그너스: 7, 니키: 10, 요한: 13, 아이솔: 18, 혜진: 22, 레녹스: 41, 로지: 42, 알렉스: 45, 시셀라: 49, 마커스: 51, 리오: 53, 비앙카: 57, 키아라: 46, 유키: 21, 히스이: 30, 아르다: 72, 라우라: 61, 에스텔: 58, 일레븐: 50, 바냐: 64, 프리야: 68, 나딘: 16 };

const charEn = { 재키: 'Jackie', 아야: 'Aya', 현우: 'Hyunwoo', 매그너스: 'Magnus', 니키: 'Nicky', 요한: 'Johann', 아이솔: 'Isol', 혜진: 'Hyejin', 레녹스: 'Lenox', 로지: 'Rozzi', 알렉스: 'Alex', 시셀라: 'Sissela', 마커스: 'Markus', 리오: 'Rio', 비앙카: 'Bianca', 키아라: 'Chiara', 유키: 'Yuki', 히스이: 'Hisui', 아르다: 'Arda', 라우라: 'Laura', 에스텔: 'Estelle', 일레븐: 'Eleven', 바냐: 'Vanya', 프리야: 'Priya', 나딘: 'Nadine' };

// 검토 대기 예시: 게임 "데이터 저장" CSV 와 같은 형식 (12번 선수는 닉네임을 바꾼 상황, 3팀 한 명은 들개에게 사망)
function demoCsv() {
  const head = 'rank, level, character, nickname, weapon, best weapon mastery, best weapon mastery level, total field kill, team kill, elimination, down can not eliminate, repeat down can not eliminate, down can eliminate, repeat down can eliminate, kill, assist, hunting, killer, gameId, teamName, tournament total score, tournament rank score, tournament kill score';
  // 팀 번호, 순위, [선수 번호, 실험체, 킬, 어시, 죽인 사람], elim, down 0.5, down 1
  const teams = [
    [2, 1, [[1, '재키', 5, 3, ''], [5, '아야', 4, 4, ''], [12, '로지', 2, 6, '']], 7, 2, 2],
    [1, 2, [[2, '아이솔', 4, 2, 'dawn_hunter'], [6, '현우', 3, 3, 'supplybox'], [9, '혜진', 1, 5, 'dawn_hunter']], 4, 2, 2],
    [4, 3, [[4, '레녹스', 2, 2, 'lumia_native'], [7, '요한', 1, 3, 'dawn_hunter'], [11, '알렉스', 2, 1, 'factory_night99']], 3, 0, 2],
    [3, 4, [[3, '비앙카', 2, 1, 'hotel_guest'], [8, '나딘', 1, 1, 'WildDog'], [10, '니키', 0, 2, 'supplybox']], 1, 2, 0]
  ];
  const RS = [10, 7, 5, 4];
  const lines = [head];
  for (const [no, rank, members, elim, half, full] of teams) {
    const tfk = elim + half + full, ks = elim + half * 0.5 + full;
    for (const [n, ch, k, a, killer] of members) {
      const nick = n === 12 ? 'factory_night99' : roster[n - 1][2];
      lines.push([rank, 18 - rank, charEn[ch], nick, '', 'Defense', 15, tfk, tfk, elim, half, 0, full, 0, k, a, 20, killer, 67100001, `Team ${no}`, RS[rank - 1] + ks, RS[rank - 1], ks].join(', '));
    }
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

function build() {
  const players = roster.map(([n, name, nick, tier, role, , , , , chzzk, yt, live]) => ({
    id: T(n), display_name: name, er_nickname: nick, er_uid: 'demo-' + n, balance_tier: tier, role, strength_note: n === 1 ? '운영 콜, 교전 판단' : null,
    chzzk_channel_id: chzzk || null, youtube_url: yt || null, photo_source: chzzk ? 'chzzk' : yt ? 'youtube' : 'upload',
    chzzk_image_url: null, youtube_image_url: null, custom_photo_url: null,
    is_live: live, live_title: live ? '내전 대비 루트 연습' : null, live_viewers: live ? 100 + n * 37 : null, live_checked_at: new Date().toISOString(),
    live_platform: live ? (chzzk ? 'chzzk' : 'youtube') : null, live_url: live ? (chzzk ? `https://chzzk.naver.com/live/${chzzk}` : 'https://www.youtube.com/watch?v=demo') : null,
    live_started_at: live ? new Date(Date.now() - n * 600000).toISOString() : null, youtube_channel_id: null, profile_synced_at: null,
    active: true, created_at: iso('2026-09-01T12:00:00+09:00'), updated_at: iso('2026-10-20T12:00:00+09:00')
  }));
  const player_rank_stats = roster.map(([n, , , , , most, rp, games, wins]) => ({
    player_id: T(n), season_id: 33, rank_score: rp, rank_games: games, rank_wins: wins,
    top_characters: rp === null ? [] : most.map((m, i) => ({ code: charCodes[m] || 0, name: m, games: Math.max(1, Math.round(games * (0.4 - i * 0.12))) })),
    raw: null, synced_at: iso('2026-10-27T05:00:00+09:00'),
    // 12번(공장야근)은 게임 닉네임을 factory_night → factory_night99 로 바꾼 상황이에요 (예시 CSV 에 새 닉네임으로 나와요)
    sync_error: n === 12 ? "이리에서 'factory_night' 을(를) 찾지 못했어요. 닉네임이 바뀐 것 같아요. 선수 관리에서 새 닉네임으로 고쳐 주세요 (예전 점수는 그대로 둬요)" : null
  }));
  // 디스코드가 연결된 선수 몇 명 (봇 /연결 승인) · 9002 는 이미 관리자인 운영진
  const linkedDiscord = { 2: '402938470100000002', 3: '402938470100000003', 4: '9002' };
  const player_private = roster.map(([n]) => ({ player_id: T(n), discord_id: linkedDiscord[n] || null, memo: null }));
  const er_characters = Object.entries(charCodes).map(([name_ko, code]) => ({ code, name_ko, name_en: charEn[name_ko] || null }));
  const tier_history = [
    { id: 1, player_id: T(1), from_tier: null, to_tier: 2, memo: '첫 등록', changed_by: null, changed_at: iso('2026-09-12T19:00:00+09:00') },
    { id: 2, player_id: T(1), from_tier: 2, to_tier: 1, memo: '최근 내전 활약 반영', changed_by: null, changed_at: iso('2026-10-10T23:00:00+09:00') },
    { id: 3, player_id: T(10), from_tier: 2, to_tier: 3, memo: null, changed_by: null, changed_at: iso('2026-10-24T19:20:00+09:00') }
  ];

  const E = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
  const events = [
    { id: E(1), title: '10월 17일 내전', season: 2, starts_at: iso('2026-10-17T20:00:00+09:00'), format: 'auto', planned_rounds: 2, max_players: 12, status: 'done', setting_code: 'MMS-1017', memo: null, teams_public: true, mvp_player_id: T(1), created_at: iso('2026-10-10T12:00:00+09:00') },
    { id: E(2), title: '10월 24일 내전', season: 2, starts_at: iso('2026-10-24T20:00:00+09:00'), format: 'draft', planned_rounds: 3, max_players: 12, status: 'done', setting_code: 'MMS-1024', memo: null, teams_public: true, mvp_player_id: T(2), created_at: iso('2026-10-17T12:00:00+09:00') },
    { id: E(3), title: '10월 31일 내전', season: 2, starts_at: iso('2026-10-31T20:00:00+09:00'), format: 'draft', planned_rounds: 4, max_players: 12, status: 'fixed', setting_code: 'MMS-1031', memo: '19:40까지 디스코드 대기방 입장', teams_public: true, mvp_player_id: null, created_at: iso('2026-10-24T23:00:00+09:00') },
    { id: E(4), title: '11월 7일 내전', season: 2, starts_at: iso('2026-11-07T20:00:00+09:00'), format: 'auto', planned_rounds: 4, max_players: 12, status: 'open', setting_code: null, memo: '11월 5일까지 참가 신청', teams_public: false, mvp_player_id: null, created_at: iso('2026-10-26T18:40:00+09:00') },
    { id: E(5), title: '11월 14일 내전', season: 2, starts_at: iso('2026-11-14T20:00:00+09:00'), format: 'draft', planned_rounds: 4, max_players: 12, status: 'plan', setting_code: null, memo: '참가 신청은 11월 8일부터', teams_public: false, mvp_player_id: null, created_at: iso('2026-10-26T18:40:00+09:00') }
  ];
  const all = roster.map(([n]) => T(n));
  const event_participants = [
    ...[E(1), E(2), E(3)].flatMap((e) => all.map((p) => ({ event_id: e, player_id: p }))),
    ...[1, 2, 3, 5, 6, 9, 10, 11].map((n) => ({ event_id: E(4), player_id: T(n) }))
  ];

  // 지난 두 내전의 팀 (팀 번호 → [1티어, 2티어, 3티어])
  const teamsByEvent = {
    [E(1)]: [[1, 8, 9], [2, 7, 10], [3, 6, 11], [4, 5, 12]],
    [E(2)]: [[2, 6, 9], [1, 5, 12], [3, 8, 10], [4, 7, 11]]
  };
  const roundData = {
    [E(1)]: [{ ranks: [2, 1, 3, 4], tks: [9, 11, 6, 4], early: [2, 3, 1, 1], pen: [0, 0, 1, 0] }, { ranks: [1, 3, 2, 4], tks: [12, 5, 8, 3], early: [3, 1, 2, 0], pen: [0, 1, 0, 0] }],
    [E(2)]: [{ ranks: [1, 2, 4, 3], tks: [12, 9, 4, 5], early: [2, 2, 1, 1], pen: [0, 0, 0, 1] }, { ranks: [2, 1, 3, 4], tks: [8, 10, 7, 3], early: [1, 3, 2, 0], pen: [0, 0, 0, 0] }, { ranks: [1, 3, 2, 4], tks: [11, 6, 8, 2], early: [2, 1, 1, 0], pen: [0, 0, 1, 1] }]
  };
  const rounds = [];
  const round_teams = [];
  const round_players = [];
  let rpId = 1;
  Object.entries(roundData).forEach(([eventId, list], ei) => {
    const ev = events.find((e) => e.id === eventId);
    list.forEach((rd, ri) => {
      const id = `00000000-0000-4000-a000-${String(ei * 10 + ri + 1).padStart(12, '0')}`;
      const playedAt = new Date(new Date(ev.starts_at).getTime() + ri * 40 * 60000).toISOString();
      rounds.push({ id, event_id: eventId, round_no: ri + 1, status: 'confirmed', source: 'device', file_name: `CustomGame_${ri + 1}.csv`, raw_csv: null, played_at: playedAt, uploaded_at: playedAt, confirmed_at: playedAt, confirmed_by: null });
      teamsByEvent[eventId].forEach((members, ti) => {
        round_teams.push({ round_id: id, team_no: ti + 1, team_rank: rd.ranks[ti], team_kills: rd.tks[ti], early_kills: rd.early[ti], penalties: rd.pen[ti] });
        const tk = rd.tks[ti];
        const ks = [Math.round(tk * 0.45), Math.round(tk * 0.33)];
        ks.push(Math.max(0, tk - ks[0] - ks[1]));
        members.forEach((n, mi) => {
          const r = roster[n - 1];
          const tier = r[3];
          round_players.push({
            id: rpId++, round_id: id, player_id: T(n), csv_nickname: r[2], team_no: ti + 1,
            character_name: r[5][(ri + ei) % r[5].length], kills: ks[mi], assists: Math.max(1, tk - ks[mi] - 2),
            damage: ({ 1: 17000, 2: 13500, 3: 10000 })[tier] + ks[mi] * 900 + (5 - rd.ranks[ti]) * 600, extra: null
          });
        });
      });
    });
  });
  // 검토 대기 중인 라운드 (관리자만 보임)
  rounds.push({ id: '00000000-0000-4000-a000-000000000099', event_id: E(2), round_no: 4, status: 'pending', source: 'device', file_name: 'GameResult_48213.csv', raw_csv: demoCsv(), game_id: 67100001, device_id: 'dev-1', played_at: iso('2026-10-24T22:50:00+09:00'), uploaded_at: iso('2026-10-24T23:12:00+09:00'), confirmed_at: null, confirmed_by: null });

  // 10월 31일 드래프트 (지난 내전 순위 꼴찌 팀장부터) · 5번째 지명까지 진행
  const captains = [4, 3, 1, 2].map(T);
  const event_teams = [];
  captains.forEach((c, i) => event_teams.push({ event_id: E(3), player_id: c, team_no: i + 1, slot_tier: 1, locked: true, pick_no: null, auto_pick: false }));
  [[5, 0], [6, 1], [8, 2], [7, 3], [9, 3]].forEach(([n, teamIdx], i) =>
    event_teams.push({ event_id: E(3), player_id: T(n), team_no: teamIdx + 1, slot_tier: roster[n - 1][3], locked: true, pick_no: i + 1, auto_pick: false }));
  const drafts = [{ event_id: E(3), captain_order: captains, status: 'live', updated_at: iso('2026-10-27T10:00:00+09:00') }];

  const scoring_rules = [{ id: 1, placement: [10, 7, 5, 4, 3, 2, 1, 0], ks_early: 0.5, ks_late: 1, penalty: 1, updated_at: iso('2026-10-27T10:00:00+09:00') }];
  const admins = [
    { user_id: 'demo-owner', discord_id: '9001', discord_name: 'SG', avatar_url: null, role: 'owner', registered_via: '소유자 키 (처음 한 번)', created_at: iso('2026-09-01T12:00:00+09:00'), last_seen_at: iso('2026-10-27T10:00:00+09:00'), revoked_at: null },
    { user_id: 'demo-admin', discord_id: '9002', discord_name: '운석줍는사람', avatar_url: null, role: 'admin', registered_via: '웹에서 받은 키', created_at: iso('2026-10-15T20:03:00+09:00'), last_seen_at: iso('2026-10-27T09:58:00+09:00'), revoked_at: null }
  ];
  const admin_keys = [
    { id: 'k1', key_hash: 'x', prefix: 'Q9ZP', memo: '새 운영진', target_discord: null, expires_at: iso('2026-10-28T10:00:00+09:00'), created_by: 'demo-owner', created_via: 'web', created_at: iso('2026-10-27T09:00:00+09:00'), used_at: null, used_by: null, revoked_at: null }
  ];

  // 관리자 바로 추가 (8단계): 사이트 로그인을 기다리는 사람 한 명
  const admin_grants = [
    { discord_id: '1029384799', discord_name: '호텔투숙객', created_by: 'demo-owner', created_via: 'bot', created_at: iso('2026-10-28T21:10:00+09:00'), used_at: null, used_by: null, revoked_at: null }
  ];

  const upload_devices = [{ id: 'dev-1', name: 'SG 게임 PC', key_hash: 'demo', prefix: 'K7QX', created_by: 'demo-owner', created_at: iso('2026-10-20T19:00:00+09:00'), last_seen_at: iso('2026-10-24T23:12:00+09:00'), last_file: 'GameResult_48213.csv', revoked_at: null }];

  // 디스코드 봇 (6단계): 연결 요청 하나, 봇 켜짐 신호, 지난 두 내전의 MVP 투표 결과
  const discord_link_requests = [{ id: 'link-1', discord_id: '1029384756', discord_name: '새벽사냥꾼', player_id: T(1), status: 'pending', created_at: iso('2026-10-28T18:20:00+09:00'), decided_at: null, decided_by: null }];
  const bot_status = [{ id: 1, bot_tag: '무명섬#1234', guild_id: 'demo', last_seen_at: new Date(Date.now() - 2 * 60000).toISOString() }];
  const bot_messages = [];
  const mvp_votes = [];
  events.find((e) => e.id === E(1)).mvp_vote_result = { counts: { [T(1)]: 4, [T(5)]: 4, [T(9)]: 2 }, tied: [T(1), T(5)], picked: T(1), drawn: true, votes: 10 };
  events.find((e) => e.id === E(2)).mvp_vote_result = { counts: { [T(2)]: 6, [T(6)]: 3, [T(10)]: 2 }, tied: [T(2)], picked: T(2), drawn: false, votes: 11 };
  events.forEach((e) => { e.mvp_vote_status = e.mvp_vote_result ? 'closed' : 'none'; });
  // 방송 오버레이 (7단계): 10월 24일 내전 4라운드 결과 파일이 올라와서 "끝"이 된 상태
  events.forEach((e) => { e.live_state = 'idle'; e.live_round = null; e.live_changed_at = null; });
  Object.assign(events.find((e) => e.id === E(2)), { live_state: 'ended', live_round: 4, live_changed_at: iso('2026-10-24T23:12:00+09:00') });

  return { players, player_private, player_rank_stats, er_characters, tier_history, events, event_participants, event_teams, drafts, rounds, round_teams, round_players, scoring_rules, admins, admin_keys, admin_grants, upload_devices, discord_link_requests, bot_status, bot_messages, mvp_votes };
}

export const tables = build();

// ── 뷰 (DB 의 SQL 뷰와 같은 계산)
const confirmedRounds = () => tables.rounds.filter((r) => r.status === 'confirmed');

function vRoundTeamScores() {
  const s = tables.scoring_rules[0];
  const rounds = new Map(confirmedRounds().map((r) => [r.id, r]));
  return tables.round_teams.filter((t) => rounds.has(t.round_id)).map((t) => {
    const r = rounds.get(t.round_id);
    const rs = Number(s.placement[t.team_rank - 1] ?? 0);
    const ks = t.early_kills * s.ks_early + Math.max(t.team_kills - t.early_kills, 0) * s.ks_late;
    const pen = t.penalties * s.penalty;
    return { event_id: r.event_id, round_no: r.round_no, played_at: r.played_at, ...t, rs, ks, pen, total: rs + ks - pen };
  });
}

function vEventStandings() {
  const groups = new Map();
  for (const t of vRoundTeamScores()) {
    const k = t.event_id + '|' + t.team_no;
    const g = groups.get(k) || { event_id: t.event_id, team_no: t.team_no, rounds: 0, rs: 0, ks: 0, pen: 0, total: 0 };
    g.rounds++; g.rs += t.rs; g.ks += t.ks; g.pen += t.pen; g.total += t.total;
    groups.set(k, g);
  }
  const rows = [...groups.values()];
  const byEvent = new Map();
  rows.forEach((r) => { if (!byEvent.has(r.event_id)) byEvent.set(r.event_id, []); byEvent.get(r.event_id).push(r); });
  for (const list of byEvent.values()) {
    list.sort((a, b) => b.total - a.total || b.ks - a.ks);
    list.forEach((r, i) => { r.standing = i > 0 && list[i - 1].total === r.total && list[i - 1].ks === r.ks ? list[i - 1].standing : i + 1; });
  }
  return rows;
}

function vPlayerRounds() {
  const scores = new Map(vRoundTeamScores().map((t) => [t.round_id + '|' + t.team_no, t]));
  const events = new Map(tables.events.map((e) => [e.id, e]));
  return tables.round_players.flatMap((rp) => {
    const ts = scores.get(rp.round_id + '|' + rp.team_no);
    if (!ts) return [];
    const e = events.get(ts.event_id);
    return [{ ...rp, event_id: ts.event_id, round_no: ts.round_no, played_at: ts.played_at, team_rank: ts.team_rank, team_kills: ts.team_kills, rs: ts.rs, ks: ts.ks, pen: ts.pen, total: ts.total, season: e.season, event_title: e.title, event_starts_at: e.starts_at }];
  });
}

function vPlayerStats() {
  const cutoff = Date.now() - 30 * 86400000;
  const groups = new Map();
  for (const r of vPlayerRounds()) {
    if (!r.player_id) continue;
    const k = r.player_id + '|' + r.season;
    if (!groups.has(k)) groups.set(k, { player_id: r.player_id, season: r.season, rows: [] });
    groups.get(k).rows.push(r);
  }
  const avg = (rows, f) => (rows.length ? rows.reduce((s, r) => s + f(r), 0) / rows.length : null);
  const r2 = (v) => (v === null ? null : Math.round(v * 100) / 100);
  return [...groups.values()].map(({ player_id, season, rows }) => {
    const recent = rows.filter((r) => new Date(r.played_at).getTime() >= cutoff);
    return {
      player_id, season,
      games: rows.length, wins: rows.filter((r) => r.team_rank === 1).length,
      avg_rank: r2(avg(rows, (r) => r.team_rank)), avg_tk: r2(avg(rows, (r) => r.team_kills)), avg_dmg: Math.round(avg(rows, (r) => r.damage)), avg_total: r2(avg(rows, (r) => r.total)),
      games_30d: recent.length, wins_30d: recent.filter((r) => r.team_rank === 1).length,
      avg_rank_30d: r2(avg(recent, (r) => r.team_rank)), avg_tk_30d: r2(avg(recent, (r) => r.team_kills)),
      avg_dmg_30d: recent.length ? Math.round(avg(recent, (r) => r.damage)) : null, avg_total_30d: r2(avg(recent, (r) => r.total))
    };
  });
}

export const views = {
  v_round_team_scores: vRoundTeamScores,
  v_event_standings: vEventStandings,
  v_player_rounds: vPlayerRounds,
  v_player_stats: vPlayerStats
};
