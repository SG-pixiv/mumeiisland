-- ─────────────────────────────────────────────────────────────
-- 무명섬 13단계: 블서로그 (랭킹 · KEL 팀 · 업데이트 소식 · 피드백)
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요. (12단계 SQL 을 먼저 해 주세요)
--
-- 1. 블서로그 설정 (한 줄): 공개 스위치, 게임 주소, 가짜 점수 검사 기준, 금지어
--    처음에는 비공개예요 → 관리자 → 블서로그 에서 켜요
-- 2. 랭킹 기록: 게임이 닉네임만 적고 올려요. 이상한 기록은 자동으로 거절하고, 관리자가 숨길 수 있어요
-- 3. KEL 팀: 게임에 적 팀으로 나와요. 팀마다 실험체 3명 · 로고를 관리자 화면에서 바꿔요
-- 4. 업데이트 소식 (관리자가 씀) · 피드백 (누구나 보냄, 관리자만 읽음)
-- 5. 팀 로고 저장소 (rogue 버킷)
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if to_regclass('public.site_settings') is null then
    raise exception '12단계(20261030000000_records_privacy.sql)를 먼저 실행해 주세요';
  end if;
end $$;

-- 1. 설정
create table if not exists public.rogue_settings (
  id smallint primary key default 1 check (id = 1),
  live boolean not null default false,                -- 헤더 오른쪽 · 블서로그 페이지 · 랭킹 공개
  scores_open boolean not null default true,          -- 게임에서 기록 받기
  feedback_open boolean not null default true,        -- 피드백 받기
  game_url text not null default '',                  -- 게임 주소 (Vercel)
  versions text[] not null default '{}',              -- 받는 게임 버전 (비어 있으면 아무 버전)
  max_wave integer not null default 50 check (max_wave between 1 and 10000),
  min_sec_per_wave integer not null default 15 check (min_sec_per_wave between 0 and 600),
  max_party integer not null default 3 check (max_party between 1 and 6),
  cap_nickname integer not null default 5 check (cap_nickname between 1 and 1000),
  cap_ip integer not null default 20 check (cap_ip between 1 and 10000),
  banned_words text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.rogue_settings (id) values (1) on conflict (id) do nothing;
alter table public.rogue_settings enable row level security;
drop policy if exists "public read" on public.rogue_settings;
create policy "public read" on public.rogue_settings for select using (true);
drop policy if exists "admin update" on public.rogue_settings;
create policy "admin update" on public.rogue_settings for update using (public.is_admin()) with check (public.is_admin());
grant select on public.rogue_settings to anon, authenticated;
grant update on public.rogue_settings to authenticated;
grant all on public.rogue_settings to service_role;

-- 공용: 고친 시각 · 고친 사람
create or replace function public._rogue_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
revoke execute on function public._rogue_touch() from public, anon, authenticated;
drop trigger if exists rogue_settings_touch on public.rogue_settings;
create trigger rogue_settings_touch before update on public.rogue_settings
  for each row execute function public._rogue_touch();

-- 인터넷 연결 구분용 소금 (아무도 못 읽어요)
create table if not exists public.rogue_private (
  id smallint primary key default 1 check (id = 1),
  salt text not null default md5(random()::text || clock_timestamp()::text)
);
insert into public.rogue_private (id) values (1) on conflict (id) do nothing;
alter table public.rogue_private enable row level security;
revoke all on public.rogue_private from anon, authenticated;

-- 요청한 인터넷 연결을 알아볼 수 없게 바꾼 값 (원래 주소는 저장하지 않아요)
create or replace function public._rogue_ip_hash() returns text
language plpgsql stable security definer set search_path = public as $$
declare
  h json;
  ip text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    h := null;
  end;
  ip := nullif(trim(coalesce(nullif(h ->> 'cf-connecting-ip', ''),
                              nullif(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1), ''),
                              h ->> 'x-real-ip', '')), '');
  if ip is null then return null; end if;
  return md5(ip || ':' || (select salt from public.rogue_private where id = 1));
end $$;
revoke execute on function public._rogue_ip_hash() from public, anon, authenticated;

-- 2. 랭킹 기록
create table if not exists public.rogue_scores (
  id bigint generated always as identity primary key,
  nickname text not null,
  nick_key text not null,
  wave integer not null check (wave >= 1),
  seconds integer not null check (seconds >= 0),
  cleared boolean not null default false,
  party integer[] not null default '{}',
  version text not null default '',
  mode text not null default 'classic' check (mode in ('classic', 'endless')),
  run_id text,
  created_at timestamptz not null default now(),
  kst_day date not null default (now() at time zone 'Asia/Seoul')::date,
  week_start date not null default date_trunc('week', now() at time zone 'Asia/Seoul')::date,
  ip_hash text,
  hidden boolean not null default false,
  hidden_at timestamptz,
  hidden_by uuid references auth.users (id) on delete set null,
  hidden_reason text
);
create index if not exists rogue_scores_week on public.rogue_scores (week_start, wave desc, seconds, created_at) where not hidden;
create index if not exists rogue_scores_best on public.rogue_scores (wave desc, seconds, created_at) where not hidden;
create index if not exists rogue_scores_nick_day on public.rogue_scores (nick_key, kst_day);
create index if not exists rogue_scores_ip_day on public.rogue_scores (ip_hash, kst_day);
create unique index if not exists rogue_scores_run on public.rogue_scores (run_id) where run_id is not null;
alter table public.rogue_scores enable row level security;
drop policy if exists "admin read" on public.rogue_scores;
create policy "admin read" on public.rogue_scores for select using (public.is_admin());
drop policy if exists "admin update" on public.rogue_scores;
create policy "admin update" on public.rogue_scores for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete" on public.rogue_scores;
create policy "admin delete" on public.rogue_scores for delete using (public.is_admin());
grant select, update, delete on public.rogue_scores to authenticated;
grant all on public.rogue_scores to service_role;

create or replace function public._rogue_scores_hide() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.hidden is distinct from old.hidden then
    new.hidden_at := case when new.hidden then now() end;
    new.hidden_by := case when new.hidden then auth.uid() end;
    if not new.hidden then new.hidden_reason := null; end if;
  end if;
  -- 관리자는 숨기기만 바꿀 수 있어요 (기록 내용은 그대로)
  new.nickname := old.nickname; new.nick_key := old.nick_key; new.wave := old.wave; new.seconds := old.seconds;
  new.cleared := old.cleared; new.party := old.party; new.version := old.version; new.mode := old.mode;
  new.created_at := old.created_at; new.kst_day := old.kst_day; new.week_start := old.week_start; new.ip_hash := old.ip_hash;
  return new;
end $$;
revoke execute on function public._rogue_scores_hide() from public, anon, authenticated;
drop trigger if exists rogue_scores_hide on public.rogue_scores;
create trigger rogue_scores_hide before update on public.rogue_scores
  for each row execute function public._rogue_scores_hide();

-- 기록 올리기 (게임이 부름). 이상하면 이유와 함께 거절해요
create or replace function public.rogue_submit(
  p_nickname text, p_wave integer, p_seconds integer, p_cleared boolean, p_party integer[],
  p_version text default '', p_mode text default 'classic', p_run text default null
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

  insert into public.rogue_scores (nickname, nick_key, wave, seconds, cleared, party, version, mode, run_id, ip_hash)
  values (v_nick, v_key, p_wave, p_seconds, coalesce(p_cleared, false), p_party, coalesce(p_version, ''), 'classic', v_run, v_ip)
  returning id into v_id;

  -- 이번 주 순위 (닉네임마다 최고 기록 하나)
  with best as (
    select distinct on (nick_key) id, nick_key, wave, seconds, created_at
      from public.rogue_scores
     where not hidden and mode = 'classic' and week_start = v_week
     order by nick_key, wave desc, seconds, created_at
  ), ranked as (
    select id, nick_key, row_number() over (order by wave desc, seconds, created_at) as rk from best
  )
  select rk, (id = v_id) into v_rank, v_best from ranked where nick_key = v_key;

  return jsonb_build_object('id', v_id, 'week_rank', v_rank, 'best', coalesce(v_best, false), 'duplicate', false);
end $$;
revoke execute on function public.rogue_submit(text, integer, integer, boolean, integer[], text, text, text) from public;
grant execute on function public.rogue_submit(text, integer, integer, boolean, integer[], text, text, text) to anon, authenticated;

-- 랭킹 보기: 'week' = 이번 주(월요일 0시부터), 'all' = 역대. 닉네임마다 최고 기록 하나
create or replace function public.rogue_board(p_scope text default 'week', p_limit integer default 50)
returns table (rank integer, nickname text, wave integer, seconds integer, cleared boolean, party integer[], created_at timestamptz)
language sql stable security definer set search_path = public as $$
  with pool as (
    select r.* from public.rogue_scores r
     where not r.hidden and r.mode = 'classic'
       and (coalesce(p_scope, 'week') <> 'week' or r.week_start = date_trunc('week', now() at time zone 'Asia/Seoul')::date)
       and (coalesce((select x.live from public.rogue_settings x where x.id = 1), false) or public.is_admin())
  ), best as (
    select distinct on (nick_key) * from pool order by nick_key, wave desc, seconds, created_at
  )
  select (row_number() over (order by b.wave desc, b.seconds, b.created_at))::integer,
         b.nickname, b.wave, b.seconds, b.cleared, b.party, b.created_at
    from best b
   order by 1
   limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;
revoke execute on function public.rogue_board(text, integer) from public;
grant execute on function public.rogue_board(text, integer) to anon, authenticated;

-- 3. KEL 팀 (게임의 적 팀)
create table if not exists public.rogue_teams (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(trim(name)) between 1 and 40),
  region text not null default '',
  logo_url text not null default '',
  members integer[] not null default '{}' check (coalesce(array_length(members, 1), 0) <= 3),
  sort integer not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.rogue_teams enable row level security;
drop policy if exists "public read" on public.rogue_teams;
create policy "public read" on public.rogue_teams for select using (true);
drop policy if exists "admin write" on public.rogue_teams;
create policy "admin write" on public.rogue_teams for all using (public.is_admin()) with check (public.is_admin());
grant select on public.rogue_teams to anon, authenticated;
grant insert, update, delete on public.rogue_teams to authenticated;
grant all on public.rogue_teams to service_role;
drop trigger if exists rogue_teams_touch on public.rogue_teams;
create trigger rogue_teams_touch before insert or update on public.rogue_teams
  for each row execute function public._rogue_touch();

insert into public.rogue_teams (name, region, sort) values
  ('Seongnam ROX', '성남', 1), ('INCHEON WAVE', '인천', 2), ('DAEJEON AutoArms', '대전', 3), ('FN SEJONG', '세종', 4),
  ('Gyeonggi Innate', '경기', 5), ('Chungnam CNJ esports', '충남', 6), ('GyeongBuk Ascenders', '경북', 7), ('Daegu Guardians', '대구', 8),
  ('GJ Slasher', '광주', 9), ('GC Busan Stella', '부산', 10), ('New Rise Gangwon', '강원', 11), ('Gyeongnam Sparkle Esports', '경남', 12),
  ('YJ Whales', '양주', 13), ('Goyang Mir', '고양', 14), ('Jeju Shadow', '제주', 15), ('Jeonnam Esports', '전남', 16)
on conflict (name) do nothing;

-- 4-1. 업데이트 소식
create table if not exists public.rogue_news (
  id bigint generated always as identity primary key,
  title text not null check (char_length(trim(title)) between 1 and 80),
  body text not null default '' check (char_length(body) <= 4000),
  pinned boolean not null default false,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
alter table public.rogue_news enable row level security;
drop policy if exists "public read" on public.rogue_news;
create policy "public read" on public.rogue_news for select using (published or public.is_admin());
drop policy if exists "admin write" on public.rogue_news;
create policy "admin write" on public.rogue_news for all using (public.is_admin()) with check (public.is_admin());
grant select on public.rogue_news to anon, authenticated;
grant insert, update, delete on public.rogue_news to authenticated;
grant all on public.rogue_news to service_role;
drop trigger if exists rogue_news_touch on public.rogue_news;
create trigger rogue_news_touch before insert or update on public.rogue_news
  for each row execute function public._rogue_touch();

-- 4-2. 피드백 (누구나 보내고, 관리자만 읽어요)
create table if not exists public.rogue_feedback (
  id bigint generated always as identity primary key,
  kind text not null default 'etc' check (kind in ('bug', 'idea', 'balance', 'etc')),
  body text not null check (char_length(body) between 2 and 1000),
  nickname text not null default '' check (char_length(nickname) <= 20),
  version text not null default '',
  source text not null default 'web' check (source in ('web', 'game')),
  status text not null default 'new' check (status in ('new', 'read', 'done')),
  memo text not null default '' check (char_length(memo) <= 500),
  created_at timestamptz not null default now(),
  kst_day date not null default (now() at time zone 'Asia/Seoul')::date,
  ip_hash text
);
create index if not exists rogue_feedback_new on public.rogue_feedback (status, created_at desc);
create index if not exists rogue_feedback_ip_day on public.rogue_feedback (ip_hash, kst_day);
alter table public.rogue_feedback enable row level security;
drop policy if exists "admin read" on public.rogue_feedback;
create policy "admin read" on public.rogue_feedback for select using (public.is_admin());
drop policy if exists "admin update" on public.rogue_feedback;
create policy "admin update" on public.rogue_feedback for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete" on public.rogue_feedback;
create policy "admin delete" on public.rogue_feedback for delete using (public.is_admin());
grant select, update, delete on public.rogue_feedback to authenticated;
grant all on public.rogue_feedback to service_role;

create or replace function public.rogue_feedback_send(
  p_kind text, p_body text, p_nickname text default '', p_version text default '', p_source text default 'web'
) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_body text := trim(coalesce(p_body, ''));
  v_ip text := public._rogue_ip_hash();
  v_id bigint;
begin
  if not coalesce((select feedback_open from public.rogue_settings where id = 1), false) then
    raise exception '지금은 피드백을 받지 않아요';
  end if;
  if coalesce(p_kind, '') not in ('bug', 'idea', 'balance', 'etc') then raise exception '종류를 골라 주세요'; end if;
  if char_length(v_body) < 2 then raise exception '내용을 적어 주세요'; end if;
  if char_length(v_body) > 1000 then raise exception '1000자까지 적을 수 있어요'; end if;
  if char_length(trim(coalesce(p_nickname, ''))) > 20 then raise exception '닉네임은 20자까지예요'; end if;
  if v_ip is not null and (select count(*) from public.rogue_feedback
                            where ip_hash = v_ip and kst_day = (now() at time zone 'Asia/Seoul')::date) >= 10 then
    raise exception '오늘은 피드백을 더 보낼 수 없어요. 고마워요!';
  end if;
  insert into public.rogue_feedback (kind, body, nickname, version, source, ip_hash)
  values (p_kind, v_body, trim(coalesce(p_nickname, '')), left(coalesce(p_version, ''), 40),
          case when p_source = 'game' then 'game' else 'web' end, v_ip)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.rogue_feedback_send(text, text, text, text, text) from public;
grant execute on function public.rogue_feedback_send(text, text, text, text, text) to anon, authenticated;

-- 5. 팀 로고 저장소 (누구나 보기, 관리자만 올리기)
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('rogue', 'rogue', true, 1048576, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists "rogue admin insert" on storage.objects';
    execute 'create policy "rogue admin insert" on storage.objects for insert to authenticated with check (bucket_id = ''rogue'' and public.is_admin())';
    execute 'drop policy if exists "rogue admin update" on storage.objects';
    execute 'create policy "rogue admin update" on storage.objects for update to authenticated using (bucket_id = ''rogue'' and public.is_admin()) with check (bucket_id = ''rogue'' and public.is_admin())';
    execute 'drop policy if exists "rogue admin delete" on storage.objects';
    execute 'create policy "rogue admin delete" on storage.objects for delete to authenticated using (bucket_id = ''rogue'' and public.is_admin())';
  end if;
exception when others then
  -- 저장소 권한을 못 만들어도 나머지는 그대로 써요 (로고는 이미지 주소로 넣으면 돼요)
  raise notice '로고 저장소 설정을 건너뛰었어요: %', sqlerrm;
end $$;

select '블서로그 준비 완료' as "13단계",
       (select count(*) from public.rogue_teams) as "KEL 팀",
       (select case when live then '공개' else '비공개' end from public.rogue_settings where id = 1) as "블서로그",
       (select case when (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
                           and policyname like 'rogue admin%') = 3 then '준비됨'
                    else '없음 (로고는 이미지 주소로 넣어요)' end) as "로고 저장소";
