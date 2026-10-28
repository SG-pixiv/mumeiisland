// 이리 Open API 응답을 해석하고 선수 한 명을 동기화하는 로직.
// 네트워크 · DB 는 바깥에서 넣어 줘서(index.ts) 이 파일만 따로 테스트할 수 있어요.

export type ErResponse = { status: number; body: any };
export type ErFetch = (path: string) => Promise<ErResponse>;

export type PlayerRow = { id: string; display_name: string; er_nickname: string; er_uid: string | null };

export type RankStats = {
  season_id: number;
  rank_score: number | null;
  rank_games: number;
  rank_wins: number;
  top_characters: { code: number; name: string; games: number }[];
  raw: unknown;
};

export type SyncResult = {
  player_id: string;
  name: string;
  ok: boolean;
  uid?: string | null;
  uid_changed?: boolean;
  rank_score?: number | null;
  rank_games?: number;
  message?: string;
  nickname_missing?: boolean;                       // 저장된 UID · 닉네임 둘 다 이리에서 못 찾음 (닉네임이 바뀐 것 같아요)
  nickname_changed?: { from: string; to: string };  // 같은 계정의 닉네임이 바뀌어서 따라 고쳤어요
};

export type SyncOptions = {
  matchingMode: number;          // 랭크 = 3 (이리 API 기준)
  teamMode?: string | null;      // 솔로 랭크에 해당하는 matchingTeamMode (모르면 비워 두면 판수가 제일 많은 항목)
};

// API 는 HTTP 200 안에 code 로 결과를 알려주기도 해서 둘 다 확인해요
export function apiCode(r: ErResponse): number {
  const c = Number(r.body?.code);
  return Number.isFinite(c) && c > 0 ? c : r.status;
}

export function isNotFound(r: ErResponse): boolean {
  return apiCode(r) === 404;
}

export function pickUid(body: any): string | null {
  const u = body?.user;
  if (!u) return null;
  const v = u.uid ?? u.userId ?? u.userNum;
  return v === undefined || v === null || v === '' ? null : String(v);
}

export function pickCurrentSeason(body: any): number | null {
  const list: any[] = Array.isArray(body?.data) ? body.data : [];
  const cur = list.find((s) => s.isCurrent === 1 || s.isCurrent === true || s.isCurrent === '1');
  const id = cur?.seasonID ?? cur?.seasonId;
  return id === undefined ? null : Number(id);
}

// "Character/Name/1┃재키" 같은 줄에서 실험체 이름 표를 만들어요
export function parseCharacterNames(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^Character\/Name\/(\d+)\s*┃\s*(.+)$/);
    if (m) out.set(Number(m[1]), m[2].trim());
  }
  return out;
}

export function pickStatEntry(body: any, opts: SyncOptions): any | null {
  const raw = body?.userStats ?? body?.userStat ?? body?.data ?? null;
  const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!list.length) return null;
  if (opts.teamMode) {
    const hit = list.find((s) => String(s.matchingTeamMode) === String(opts.teamMode));
    if (hit) return hit;
  }
  return list.slice().sort((a, b) => (Number(b.totalGames) || 0) - (Number(a.totalGames) || 0))[0];
}

export function toRankStats(body: any, seasonId: number, names: Map<number, string>, opts: SyncOptions): RankStats {
  const s = pickStatEntry(body, opts);
  if (!s) {
    return { season_id: seasonId, rank_score: null, rank_games: 0, rank_wins: 0, top_characters: [], raw: body ?? null };
  }
  const chars: any[] = Array.isArray(s.characterStats) ? s.characterStats : [];
  const top = chars
    .map((c) => ({ code: Number(c.characterCode ?? c.characterNum), games: Number(c.totalGames ?? c.usages ?? 0) }))
    .filter((c) => Number.isFinite(c.code) && c.games > 0)
    .sort((a, b) => b.games - a.games)
    .slice(0, 3)
    .map((c) => ({ ...c, name: names.get(c.code) ?? `실험체 ${c.code}` }));
  const score = s.mmr ?? s.rankPoint ?? s.rp ?? null;
  return {
    season_id: seasonId,
    rank_score: score === null || score === undefined ? null : Math.round(Number(score)),
    rank_games: Number(s.totalGames) || 0,
    rank_wins: Number(s.totalWins ?? s.wins) || 0,
    top_characters: top,
    raw: s
  };
}

export async function lookupUid(er: ErFetch, nickname: string): Promise<string | null> {
  const r = await er('/v1/user/nickname?query=' + encodeURIComponent(nickname));
  if (apiCode(r) !== 200) return null;
  return pickUid(r.body);
}

export type SyncDeps = {
  er: ErFetch;
  saveUid: (playerId: string, uid: string | null) => Promise<void>;
  saveStats: (playerId: string, stats: RankStats | null, error: string | null) => Promise<void>;
  saveNickname?: (playerId: string, nickname: string) => Promise<void>;
};

const sameNick = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** 통계 응답 속 닉네임 (그 UID 계정의 지금 닉네임) */
export function pickNickname(body: any): string | null {
  const raw = body?.userStats ?? body?.userStat ?? body?.data ?? null;
  const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const n = list.map((s) => s?.nickname).find((v) => typeof v === 'string' && v.trim());
  return n ? String(n).trim() : null;
}

// 선수 한 명: UID 확인 → 이번 시즌 랭크 기록 → 저장.
// 이리 UID 는 닉네임을 바꿀 때마다 새로 생겨요(공식 문서). 예전 UID 로 못 찾으면 저장된 닉네임으로 다시 찾고,
// 그것도 없으면 닉네임이 바뀐 것이라 "기록 없음"으로 덮어쓰지 않고 예전 점수를 그대로 둬요.
export async function syncPlayer(p: PlayerRow, seasonId: number, names: Map<number, string>, opts: SyncOptions, deps: SyncDeps): Promise<SyncResult> {
  const base = { player_id: p.id, name: p.display_name };
  let uid = p.er_uid;
  let uidChanged = false;

  if (!uid) {
    uid = await lookupUid(deps.er, p.er_nickname);
    if (!uid) {
      const msg = `게임 닉네임 '${p.er_nickname}' 을(를) 찾지 못했어요`;
      await deps.saveStats(p.id, null, msg);
      return { ...base, ok: false, message: msg };
    }
    uidChanged = true;
  }

  const path = (u: string) => `/v2/user/stats/uid/${encodeURIComponent(u)}/${seasonId}/${opts.matchingMode}`;
  let r = await deps.er(path(uid));

  if (isNotFound(r) && !uidChanged) {
    const fresh = await lookupUid(deps.er, p.er_nickname);
    if (!fresh) {
      const msg = `이리에서 '${p.er_nickname}' 을(를) 찾지 못했어요. 닉네임이 바뀐 것 같아요. 선수 관리에서 새 닉네임으로 고쳐 주세요 (예전 점수는 그대로 둬요)`;
      await deps.saveStats(p.id, null, msg);
      return { ...base, ok: false, uid, nickname_missing: true, message: msg };
    }
    if (fresh !== uid) {
      uid = fresh;
      uidChanged = true;
      r = await deps.er(path(uid));
    }
  }
  if (uidChanged) await deps.saveUid(p.id, uid);

  const code = apiCode(r);
  if (code !== 200 && code !== 404) {
    const msg = `이리 API 오류 (${code})${r.body?.message ? ': ' + r.body.message : ''}`;
    await deps.saveStats(p.id, null, msg);
    return { ...base, ok: false, uid, uid_changed: uidChanged, message: msg };
  }

  // 404 = 이번 시즌 랭크 기록 없음
  const stats = code === 404 ? toRankStats(null, seasonId, names, opts) : toRankStats(r.body, seasonId, names, opts);
  await deps.saveStats(p.id, stats, null);

  // 같은 UID 계정인데 닉네임이 다르면 따라 고쳐요 (CSV 자동 연결 · 다음 동기화가 새 닉네임을 쓰게)
  let nicknameChanged: SyncResult['nickname_changed'];
  const now = code === 200 ? pickNickname(r.body) : null;
  if (now && !sameNick(now, p.er_nickname) && deps.saveNickname) {
    await deps.saveNickname(p.id, now);
    nicknameChanged = { from: p.er_nickname, to: now };
  }
  return {
    ...base, ok: true, uid, uid_changed: uidChanged, rank_score: stats.rank_score, rank_games: stats.rank_games,
    nickname_changed: nicknameChanged,
    message: nicknameChanged ? `닉네임이 '${nicknameChanged.from}' → '${nicknameChanged.to}' 로 바뀌어서 고쳤어요`
      : stats.rank_score === null ? '이번 시즌 솔로 랭크 기록 없음' : undefined
  };
}
