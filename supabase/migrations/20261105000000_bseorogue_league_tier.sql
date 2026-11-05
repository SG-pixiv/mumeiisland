-- ─────────────────────────────────────────────────────────────
-- 무명섬 14단계: 블서로그 리그(마스터즈 · KEL) · 티어
-- 13단계 다음에 SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
--
-- 1. 팀에 리그: KEL 팀 · 마스터즈 팀. 게임에서 1~20웨이브 팀 전투는 마스터즈 팀, 21웨이브부터는 KEL 팀이 나와요
--    마스터즈 팀이 하나도 없으면 임시 팀 8개("마스터즈 1팀" …)를 만들어요. 이름 · 실험체 · 로고는 관리 화면에서 바꿔요
-- 2. 랭킹 기록에 티어 (0 아이언 ~ 9 이터니티). 랭킹은 티어 → 웨이브 → 시간 순이에요
-- ─────────────────────────────────────────────────────────────

-- 1. 팀 리그
alter table public.rogue_teams add column if not exists league text not null default 'kel';
do $$ begin
  alter table public.rogue_teams add constraint rogue_teams_league_check check (league in ('kel', 'masters'));
exception when duplicate_object then null;
end $$;

insert into public.rogue_teams (name, region, sort, league)
select '마스터즈 ' || i || '팀', '', 100 + i, 'masters'
  from generate_series(1, 8) as i
 where not exists (select 1 from public.rogue_teams where league = 'masters')
on conflict (name) do nothing;

-- 2. 티어
alter table public.rogue_scores add column if not exists tier smallint not null default 0;
do $$ begin
  alter table public.rogue_scores add constraint rogue_scores_tier_check check (tier between 0 and 9);
exception when duplicate_object then null;
end $$;
create index if not exists rogue_scores_week_tier on public.rogue_scores (week_start, tier desc, wave desc, seconds, created_at) where not hidden;
create index if not exists rogue_scores_best_tier on public.rogue_scores (tier desc, wave desc, seconds, created_at) where not hidden;

-- 기록 올리기: 티어를 같이 받아요 (예전 게임이 티어 없이 올려도 아이언으로 받아요)
drop function if exists public.rogue_submit(text, integer, integer, boolean, integer[], text, text, text);
create or replace function public.rogue_submit(
  p_nickname text, p_wave integer, p_seconds integer, p_cleared boolean, p_party integer[],
  p_version text default '', p_mode text default 'classic', p_run text default null,
  p_tier integer default 0
) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  s public.rogue_settings;
  v_nick text := trim(coalesce(p_nickname, ''));
  v_key text;
  v_ip text;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_week date := date_trunc('week', now() at time zone 'Asia/Seoul')::date;
  v_run text := nullif(trim(coalesce(p_run, '')), '');
  v_id bigint;
  v_rank integer;
  v_best boolean;
  w text;
begin
  select * into s from public.rogue_settings where id = 1;
  if not found or not s.scores_open then raise exception '지금은 랭킹 기록을 받지 않아요'; end if;

  -- 같은 판을 두 번 올리면 처음 것을 돌려줘요
  if v_run is not null then
    if char_length(v_run) > 64 then raise exception '판 번호가 이상해요'; end if;
    select id into v_id from public.rogue_scores where run_id = v_run;
    if v_id is not null then
      return jsonb_build_object('id', v_id, 'duplicate', true);
    end if;
  end if;

  -- 닉네임
  if char_length(v_nick) < 2 or char_length(v_nick) > 12 then raise exception '닉네임은 2~12자로 적어 주세요'; end if;
  if v_nick !~ '^[가-힣A-Za-z0-9_]+$' then raise exception '닉네임은 한글 · 영문 · 숫자 · _ 만 쓸 수 있어요'; end if;
  v_key := lower(v_nick);
  foreach w in array s.banned_words loop
    if nullif(trim(w), '') is not null and position(lower(trim(w)) in v_key) > 0 then
      raise exception '쓸 수 없는 말이 들어 있어요';
    end if;
  end loop;
  if exists (select 1 from public.players p where lower(trim(p.display_name)) = v_key or lower(trim(p.er_nickname)) = v_key) then
    raise exception '무명섬 선수 이름과 같은 닉네임은 쓸 수 없어요';
  end if;

  -- 기록 검사
  if coalesce(p_mode, 'classic') <> 'classic' then raise exception '아직 클래식 기록만 받아요'; end if;
  if array_length(s.versions, 1) > 0 and not (coalesce(p_version, '') = any (s.versions)) then
    raise exception '게임을 새로고침해서 최신 버전으로 해 주세요';
  end if;
  if p_wave is null or p_wave < 1 or p_wave > s.max_wave then raise exception '웨이브 기록이 이상해요'; end if;
  if p_tier is null or p_tier < 0 or p_tier > 9 then raise exception '티어 기록이 이상해요'; end if;
  if coalesce(p_cleared, false) and p_wave <> s.max_wave then raise exception '클리어 기록이 이상해요'; end if;
  if p_seconds is null or p_seconds < p_wave * s.min_sec_per_wave or p_seconds > 7 * 24 * 3600 then
    raise exception '플레이 시간이 이상해요';
  end if;
  if p_party is null or coalesce(array_length(p_party, 1), 0) < 1 or array_length(p_party, 1) > s.max_party then
    raise exception '파티 기록이 이상해요';
  end if;
  if exists (select 1 from unnest(p_party) c where c is null or c < 1 or c > 99999)
     or (select count(distinct c) from unnest(p_party) c) <> array_length(p_party, 1) then
    raise exception '파티 기록이 이상해요';
  end if;
  if exists (select 1 from public.er_characters)
     and exists (select c from unnest(p_party) c except select code from public.er_characters) then
    raise exception '없는 실험체가 들어 있어요';
  end if;

  -- 하루에 올릴 수 있는 횟수
  if (select count(*) from public.rogue_scores where nick_key = v_key and kst_day = v_today) >= s.cap_nickname then
    raise exception '이 닉네임은 오늘 %번을 다 올렸어요. 내일 다시 올려 주세요', s.cap_nickname;
  end if;
  v_ip := public._rogue_ip_hash();
  if v_ip is not null and (select count(*) from public.rogue_scores where ip_hash = v_ip and kst_day = v_today) >= s.cap_ip then
    raise exception '오늘은 더 올릴 수 없어요. 내일 다시 올려 주세요';
  end if;

  insert into public.rogue_scores (nickname, nick_key, wave, seconds, cleared, party, version, mode, run_id, ip_hash, tier)
  values (v_nick, v_key, p_wave, p_seconds, coalesce(p_cleared, false), p_party, coalesce(p_version, ''), 'classic', v_run, v_ip, p_tier)
  returning id into v_id;

  -- 이번 주 순위 (닉네임마다 최고 기록 하나)
  with best as (
    select distinct on (nick_key) id, nick_key, tier, wave, seconds, created_at
      from public.rogue_scores
     where not hidden and mode = 'classic' and week_start = v_week
     order by nick_key, tier desc, wave desc, seconds, created_at
  ), ranked as (
    select id, nick_key, row_number() over (order by tier desc, wave desc, seconds, created_at) as rk from best
  )
  select rk, (id = v_id) into v_rank, v_best from ranked where nick_key = v_key;

  return jsonb_build_object('id', v_id, 'week_rank', v_rank, 'best', coalesce(v_best, false), 'duplicate', false);
end $$;
revoke execute on function public.rogue_submit(text, integer, integer, boolean, integer[], text, text, text, integer) from public;
grant execute on function public.rogue_submit(text, integer, integer, boolean, integer[], text, text, text, integer) to anon, authenticated;


-- 랭킹 보기: 티어 → 웨이브 → 시간 순 (돌려주는 칸이 바뀌어서 지우고 다시 만들어요)
drop function if exists public.rogue_board(text, integer);
create or replace function public.rogue_board(p_scope text default 'week', p_limit integer default 50)
returns table (rank integer, nickname text, tier smallint, wave integer, seconds integer, cleared boolean, party integer[], created_at timestamptz)
language sql stable security definer set search_path = public as $$
  with pool as (
    select r.* from public.rogue_scores r
     where not r.hidden and r.mode = 'classic'
       and (coalesce(p_scope, 'week') <> 'week' or r.week_start = date_trunc('week', now() at time zone 'Asia/Seoul')::date)
       and (coalesce((select x.live from public.rogue_settings x where x.id = 1), false) or public.is_admin())
  ), best as (
    select distinct on (nick_key) * from pool order by nick_key, tier desc, wave desc, seconds, created_at
  )
  select (row_number() over (order by b.tier desc, b.wave desc, b.seconds, b.created_at))::integer,
         b.nickname, b.tier, b.wave, b.seconds, b.cleared, b.party, b.created_at
    from best b
   order by 1
   limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;
revoke execute on function public.rogue_board(text, integer) from public;
grant execute on function public.rogue_board(text, integer) to anon, authenticated;

notify pgrst, 'reload schema';

select '블서로그 리그 · 티어 준비 완료' as "14단계",
       (select count(*) from public.rogue_teams where league = 'kel') as "KEL 팀",
       (select count(*) from public.rogue_teams where league = 'masters') as "마스터즈 팀";
