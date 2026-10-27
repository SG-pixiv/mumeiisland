-- ─────────────────────────────────────────────────────────────
-- 무명섬 초기 스키마
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 Run 하면 돼요.
-- ─────────────────────────────────────────────────────────────

create extension if not exists pgcrypto with schema extensions;

-- ═════════ 선수 ═════════
create table public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,                 -- 무명섬에서 쓰는 이름
  er_nickname text not null,                  -- 이터널 리턴 게임 닉네임 (API · CSV 매칭 기준)
  er_uid text,                                -- 이리 API UID (닉네임 바꾸면 바뀜 → 동기화 때 다시 찾음)
  balance_tier smallint not null default 3 check (balance_tier between 1 and 3),  -- 운영진만 바꿈
  role text,
  strength_note text,
  chzzk_channel_id text,
  youtube_url text,
  photo_source text not null default 'chzzk' check (photo_source in ('chzzk', 'youtube', 'upload')),
  chzzk_image_url text,
  youtube_image_url text,
  custom_photo_url text,
  is_live boolean not null default false,
  live_title text,
  live_viewers integer,
  live_checked_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index players_display_name_key on public.players (lower(display_name));
create unique index players_er_nickname_key on public.players (lower(er_nickname));

-- 공개하면 안 되는 선수 정보 (운영진만 봄)
create table public.player_private (
  player_id uuid primary key references public.players (id) on delete cascade,
  discord_id text,
  memo text
);

-- 이리 API 동기화 결과 (솔로 랭크 점수 = 자동 편성 밸런스 기준)
create table public.player_rank_stats (
  player_id uuid primary key references public.players (id) on delete cascade,
  season_id integer,
  rank_score integer,
  rank_games integer,
  rank_wins integer,
  top_characters jsonb not null default '[]'::jsonb,
  raw jsonb,
  synced_at timestamptz,
  sync_error text
);

create table public.er_characters (
  code integer primary key,
  name_ko text not null
);

create table public.tier_history (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  from_tier smallint,
  to_tier smallint not null,
  memo text,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);

-- ═════════ 내전 일정 · 팀 · 기록 ═════════
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  season smallint not null default 1,
  starts_at timestamptz not null,
  format text not null default 'draft' check (format in ('draft', 'auto')),
  planned_rounds smallint not null default 4,
  max_players smallint not null default 24,
  status text not null default 'plan' check (status in ('plan', 'open', 'fixed', 'done')),
  setting_code text,
  memo text,
  teams_public boolean not null default false,   -- 팀 편성을 공개 페이지에 보여줄지
  mvp_player_id uuid references public.players (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.event_participants (
  event_id uuid not null references public.events (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  primary key (event_id, player_id)
);

create table public.event_teams (
  event_id uuid not null references public.events (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  team_no smallint not null,
  slot_tier smallint not null check (slot_tier between 1 and 3),
  locked boolean not null default false,
  pick_no smallint,                    -- 드래프트 지명 순서 (팀장은 비워 둠)
  auto_pick boolean not null default false,
  primary key (event_id, player_id)
);

create table public.drafts (
  event_id uuid primary key references public.events (id) on delete cascade,
  captain_order uuid[] not null default '{}',
  status text not null default 'before' check (status in ('before', 'live', 'done')),
  updated_at timestamptz not null default now()
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  round_no smallint not null,
  status text not null default 'pending' check (status in ('pending', 'held', 'confirmed')),
  source text not null default 'manual' check (source in ('device', 'manual')),
  file_name text,
  raw_csv text,
  played_at timestamptz not null default now(),
  uploaded_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  unique (event_id, round_no)
);

-- 라운드별 팀 결과 (team_no 는 무명섬 팀 번호)
create table public.round_teams (
  round_id uuid not null references public.rounds (id) on delete cascade,
  team_no smallint not null,
  team_rank smallint not null check (team_rank between 1 and 8),
  team_kills smallint not null default 0,
  early_kills smallint not null default 0,   -- 0.5 KS 킬 (1일차 · 2일차 전투 연구실)
  penalties smallint not null default 0,     -- 처치자 불명 사망 (최종 2팀 전)
  primary key (round_id, team_no)
);

create table public.round_players (
  id bigint generated always as identity primary key,
  round_id uuid not null references public.rounds (id) on delete cascade,
  player_id uuid references public.players (id) on delete set null,
  csv_nickname text not null,
  team_no smallint not null,
  character_name text,
  kills smallint not null default 0,
  assists smallint not null default 0,
  damage integer not null default 0,
  extra jsonb
);
create index round_players_player_idx on public.round_players (player_id);
create index round_players_round_idx on public.round_players (round_id);

create table public.scoring_rules (
  id smallint primary key default 1 check (id = 1),
  placement numeric[] not null default '{10,7,5,4,3,2,1,0}',
  ks_early numeric not null default 0.5,
  ks_late numeric not null default 1,
  penalty numeric not null default 1,
  updated_at timestamptz not null default now()
);
insert into public.scoring_rules (id) values (1);

-- ═════════ 관리자 · 키 ═════════
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  discord_id text,
  discord_name text,
  avatar_url text,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  registered_via text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);
create unique index admins_one_owner on public.admins (role) where role = 'owner';

create table public.admin_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,      -- 키 원문은 저장하지 않아요
  prefix text not null,
  memo text,
  target_discord text,                -- 이 디스코드 계정만 쓸 수 있게 (아이디 또는 사용자명)
  expires_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'web' check (created_via in ('web', 'bot')),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);

create table public.key_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  fail_count smallint not null default 0,
  locked_until timestamptz
);

create table public.app_secrets (
  name text primary key,
  value_hash text not null
);

-- ═════════ 권한 확인 함수 ═════════
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and revoked_at is null);
$$;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'owner' and revoked_at is null);
$$;

create or replace function public.owner_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where role = 'owner' and revoked_at is null);
$$;

-- 로그인한 디스코드 계정 정보 (Supabase 디스코드 로그인이 넣어 주는 값)
create or replace function public.jwt_discord(out discord_id text, out discord_name text, out username text, out avatar_url text)
language sql stable as $$
  select
    coalesce(auth.jwt() -> 'user_metadata' ->> 'provider_id', auth.jwt() -> 'user_metadata' ->> 'sub'),
    coalesce(auth.jwt() -> 'user_metadata' -> 'custom_claims' ->> 'global_name', auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name'),
    lower(split_part(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', auth.jwt() -> 'user_metadata' ->> 'name', ''), '#', 1)),
    auth.jwt() -> 'user_metadata' ->> 'avatar_url';
$$;

create or replace function public._norm_key(p text) returns text
language sql immutable as $$
  select regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g');
$$;

create or replace function public._hash_key(p text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(public._norm_key(p), 'sha256'), 'hex');
$$;

-- 키를 틀렸을 때: 5번 틀리면 10분 잠금
create or replace function public._key_fail(p_uid uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare fails int;
begin
  insert into public.key_attempts as ka (user_id, fail_count) values (p_uid, 1)
  on conflict (user_id) do update set fail_count = ka.fail_count + 1, locked_until = null
  returning fail_count into fails;
  if fails >= 5 then
    update public.key_attempts set fail_count = 0, locked_until = now() + interval '10 minutes' where user_id = p_uid;
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;
  return jsonb_build_object('ok', false, 'reason', 'invalid', 'fails', fails);
end $$;

-- ═════════ 소유자 · 관리자 키 ═════════
-- (SQL Editor 전용) 소유자 설정 키 등록: select public.set_owner_setup_key('영문숫자로된긴키');
create or replace function public.set_owner_setup_key(p_key text) returns void
language sql security definer set search_path = public, extensions as $$
  insert into public.app_secrets (name, value_hash) values ('owner_setup_key', public._hash_key(p_key))
  on conflict (name) do update set value_hash = excluded.value_hash;
$$;
revoke execute on function public.set_owner_setup_key(text) from public, anon, authenticated;

create or replace function public.claim_owner(p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  d record;
  h text;
  att record;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'login'); end if;
  if public.owner_exists() then return jsonb_build_object('ok', false, 'reason', 'owner_exists'); end if;
  select * into att from public.key_attempts where user_id = uid;
  if att.locked_until is not null and att.locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  select value_hash into h from public.app_secrets where name = 'owner_setup_key';
  if h is null then return jsonb_build_object('ok', false, 'reason', 'no_setup_key'); end if;
  if h <> public._hash_key(p_key) then return public._key_fail(uid); end if;
  select * into d from public.jwt_discord();
  insert into public.admins (user_id, discord_id, discord_name, avatar_url, role, registered_via, last_seen_at)
  values (uid, d.discord_id, d.discord_name, d.avatar_url, 'owner', '소유자 키 (처음 한 번)', now())
  on conflict (user_id) do update set role = 'owner', revoked_at = null, last_seen_at = now();
  delete from public.app_secrets where name = 'owner_setup_key';
  delete from public.key_attempts where user_id = uid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.create_admin_key(p_memo text, p_target text, p_ttl_hours integer)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  k text := '';
  i int;
begin
  if not public.is_admin() then raise exception '관리자만 키를 만들 수 있어요'; end if;
  if p_ttl_hours is null or p_ttl_hours < 1 or p_ttl_hours > 168 then raise exception '유효 시간은 1시간에서 7일 사이로 정해 주세요'; end if;
  for i in 1..12 loop
    k := k || substr(alphabet, (get_byte(extensions.gen_random_bytes(1), 0) % 32) + 1, 1);
  end loop;
  insert into public.admin_keys (key_hash, prefix, memo, target_discord, expires_at, created_by)
  values (
    public._hash_key(k), substr(k, 1, 4), nullif(trim(coalesce(p_memo, '')), ''),
    nullif(lower(regexp_replace(trim(coalesce(p_target, '')), '^@', '')), ''),
    now() + make_interval(hours => p_ttl_hours), auth.uid()
  );
  return substr(k, 1, 4) || '-' || substr(k, 5, 4) || '-' || substr(k, 9, 4);
end $$;

create or replace function public.redeem_admin_key(p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := auth.uid();
  d record;
  att record;
  k record;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'login'); end if;
  if public.is_admin() then return jsonb_build_object('ok', true, 'already', true); end if;
  select * into att from public.key_attempts where user_id = uid;
  if att.locked_until is not null and att.locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  select * into d from public.jwt_discord();
  select * into k from public.admin_keys
   where key_hash = public._hash_key(p_key) and used_at is null and revoked_at is null and expires_at > now()
   for update;
  if k.id is null
     or (k.target_discord is not null and k.target_discord not in (lower(coalesce(d.discord_id, '')), lower(coalesce(d.discord_name, '')), coalesce(d.username, ''))) then
    return public._key_fail(uid);
  end if;
  update public.admin_keys set used_at = now(), used_by = uid where id = k.id;
  insert into public.admins (user_id, discord_id, discord_name, avatar_url, role, registered_via, last_seen_at)
  values (uid, d.discord_id, d.discord_name, d.avatar_url, 'admin',
          case when k.created_via = 'bot' then '봇 명령어로 받은 키' else '웹에서 받은 키' end, now())
  on conflict (user_id) do update set revoked_at = null, registered_via = excluded.registered_via, last_seen_at = now();
  delete from public.key_attempts where user_id = uid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.revoke_admin_key(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있어요'; end if;
  update public.admin_keys set revoked_at = now() where id = p_id and used_at is null;
end $$;

create or replace function public.set_admin_revoked(p_user uuid, p_revoked boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception '소유자만 관리자를 해제할 수 있어요'; end if;
  update public.admins set revoked_at = case when p_revoked then now() else null end
   where user_id = p_user and role <> 'owner';
end $$;

create or replace function public.touch_admin() returns void
language sql security definer set search_path = public as $$
  update public.admins set last_seen_at = now() where user_id = auth.uid() and revoked_at is null;
$$;

-- 티어는 운영진만, 바꿀 때마다 기록을 남겨요
create or replace function public.set_player_tier(p_player uuid, p_tier smallint, p_memo text) returns void
language plpgsql security definer set search_path = public as $$
declare old smallint;
begin
  if not public.is_admin() then raise exception '관리자만 티어를 바꿀 수 있어요'; end if;
  if p_tier not between 1 and 3 then raise exception '티어는 1~3 중에서 골라 주세요'; end if;
  select balance_tier into old from public.players where id = p_player for update;
  if old is null then raise exception '선수를 찾지 못했어요'; end if;
  if old = p_tier then return; end if;
  update public.players set balance_tier = p_tier, updated_at = now() where id = p_player;
  insert into public.tier_history (player_id, from_tier, to_tier, memo, changed_by)
  values (p_player, old, p_tier, nullif(trim(coalesce(p_memo, '')), ''), auth.uid());
end $$;

-- ═════════ 점수 · 통계 뷰 (확정된 라운드만) ═════════
create view public.v_round_team_scores with (security_invoker = on) as
select
  r.event_id, r.round_no, r.played_at, rt.round_id, rt.team_no, rt.team_rank, rt.team_kills, rt.early_kills, rt.penalties,
  coalesce(s.placement[rt.team_rank], 0) as rs,
  rt.early_kills * s.ks_early + greatest(rt.team_kills - rt.early_kills, 0) * s.ks_late as ks,
  rt.penalties * s.penalty as pen,
  coalesce(s.placement[rt.team_rank], 0)
    + rt.early_kills * s.ks_early + greatest(rt.team_kills - rt.early_kills, 0) * s.ks_late
    - rt.penalties * s.penalty as total
from public.round_teams rt
join public.rounds r on r.id = rt.round_id and r.status = 'confirmed'
cross join public.scoring_rules s;

create view public.v_event_standings with (security_invoker = on) as
select
  event_id, team_no, count(*) as rounds, sum(rs) as rs, sum(ks) as ks, sum(pen) as pen, sum(total) as total,
  rank() over (partition by event_id order by sum(total) desc, sum(ks) desc) as standing
from public.v_round_team_scores
group by event_id, team_no;

create view public.v_player_rounds with (security_invoker = on) as
select
  rp.id, rp.player_id, rp.round_id, rp.csv_nickname, rp.team_no, rp.character_name, rp.kills, rp.assists, rp.damage,
  ts.event_id, ts.round_no, ts.played_at, ts.team_rank, ts.team_kills, ts.rs, ts.ks, ts.pen, ts.total,
  e.season, e.title as event_title, e.starts_at as event_starts_at
from public.round_players rp
join public.v_round_team_scores ts on ts.round_id = rp.round_id and ts.team_no = rp.team_no
join public.events e on e.id = ts.event_id;

create view public.v_player_stats with (security_invoker = on) as
select
  player_id, season,
  count(*) as games,
  count(*) filter (where team_rank = 1) as wins,
  round(avg(team_rank), 2) as avg_rank,
  round(avg(team_kills), 2) as avg_tk,
  round(avg(damage)) as avg_dmg,
  round(avg(total), 2) as avg_total,
  count(*) filter (where played_at >= now() - interval '30 days') as games_30d,
  count(*) filter (where played_at >= now() - interval '30 days' and team_rank = 1) as wins_30d,
  round(avg(team_rank) filter (where played_at >= now() - interval '30 days'), 2) as avg_rank_30d,
  round(avg(team_kills) filter (where played_at >= now() - interval '30 days'), 2) as avg_tk_30d,
  round(avg(damage) filter (where played_at >= now() - interval '30 days')) as avg_dmg_30d,
  round(avg(total) filter (where played_at >= now() - interval '30 days'), 2) as avg_total_30d
from public.v_player_rounds
where player_id is not null
group by player_id, season;

-- ═════════ 보안 규칙 (RLS) ═════════
alter table public.players enable row level security;
alter table public.player_private enable row level security;
alter table public.player_rank_stats enable row level security;
alter table public.er_characters enable row level security;
alter table public.tier_history enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.event_teams enable row level security;
alter table public.drafts enable row level security;
alter table public.rounds enable row level security;
alter table public.round_teams enable row level security;
alter table public.round_players enable row level security;
alter table public.scoring_rules enable row level security;
alter table public.admins enable row level security;
alter table public.admin_keys enable row level security;
alter table public.key_attempts enable row level security;
alter table public.app_secrets enable row level security;

-- 누구나 읽기 + 운영진만 쓰기
create policy "public read" on public.players for select using (true);
create policy "admin write" on public.players for all using (public.is_admin()) with check (public.is_admin());
create policy "public read" on public.player_rank_stats for select using (true);
create policy "admin write" on public.player_rank_stats for all using (public.is_admin()) with check (public.is_admin());
create policy "public read" on public.er_characters for select using (true);
create policy "admin write" on public.er_characters for all using (public.is_admin()) with check (public.is_admin());
create policy "public read" on public.tier_history for select using (true);
create policy "admin write" on public.tier_history for all using (public.is_admin()) with check (public.is_admin());
create policy "public read" on public.events for select using (true);
create policy "admin write" on public.events for all using (public.is_admin()) with check (public.is_admin());
create policy "public read" on public.event_participants for select using (true);
create policy "admin write" on public.event_participants for all using (public.is_admin()) with check (public.is_admin());
create policy "public read" on public.scoring_rules for select using (true);
create policy "admin write" on public.scoring_rules for update using (public.is_admin()) with check (public.is_admin());

-- 운영진만
create policy "admin only" on public.player_private for all using (public.is_admin()) with check (public.is_admin());

-- 팀 편성 · 드래프트: 운영진이 공개로 바꾼 내전만 보여요
create policy "read when public" on public.event_teams for select
  using (public.is_admin() or exists (select 1 from public.events e where e.id = event_id and e.teams_public));
create policy "admin write" on public.event_teams for all using (public.is_admin()) with check (public.is_admin());
create policy "read when public" on public.drafts for select
  using (public.is_admin() or exists (select 1 from public.events e where e.id = event_id and e.teams_public));
create policy "admin write" on public.drafts for all using (public.is_admin()) with check (public.is_admin());

-- 라운드 기록: 확정된 것만 공개
create policy "read confirmed" on public.rounds for select using (status = 'confirmed' or public.is_admin());
create policy "admin write" on public.rounds for all using (public.is_admin()) with check (public.is_admin());
create policy "read confirmed" on public.round_teams for select
  using (exists (select 1 from public.rounds r where r.id = round_id and (r.status = 'confirmed' or public.is_admin())));
create policy "admin write" on public.round_teams for all using (public.is_admin()) with check (public.is_admin());
create policy "read confirmed" on public.round_players for select
  using (exists (select 1 from public.rounds r where r.id = round_id and (r.status = 'confirmed' or public.is_admin())));
create policy "admin write" on public.round_players for all using (public.is_admin()) with check (public.is_admin());

-- 관리자 목록 · 키: 운영진만 읽기, 쓰기는 위 함수로만
create policy "admin read" on public.admins for select using (public.is_admin());
create policy "admin read" on public.admin_keys for select using (public.is_admin());
-- key_attempts, app_secrets: 정책 없음 = 아무도 직접 못 읽고 못 씀

-- ═════════ 사이트가 쓰는 권한 ═════════
-- "Automatically expose new tables" 를 꺼도 동작하도록 직접 열어 둬요.
-- (실제로 누가 무엇을 읽고 쓸 수 있는지는 위의 RLS 규칙이 정해요)
grant usage on schema public to anon, authenticated;
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function
  public.is_admin(), public.is_owner(), public.owner_exists(), public.jwt_discord(),
  public._norm_key(text), public._hash_key(text),
  public.claim_owner(text), public.create_admin_key(text, text, integer), public.redeem_admin_key(text),
  public.revoke_admin_key(uuid), public.set_admin_revoked(uuid, boolean), public.touch_admin(),
  public.set_player_tier(uuid, smallint, text)
  to anon, authenticated;
-- 내부용 · SQL Editor 전용 함수는 사이트에서 못 부르게
revoke execute on function public._key_fail(uuid) from public, anon, authenticated;
revoke execute on function public.set_owner_setup_key(text) from public, anon, authenticated;
