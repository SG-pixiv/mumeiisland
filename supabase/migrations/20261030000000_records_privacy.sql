-- ─────────────────────────────────────────────────────────────
-- 무명섬 12단계: 회차 번호 · 경쟁 기록 공개 설정
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요. (7단계 오버레이 SQL 을 먼저 해 주세요)
--
-- 1. 내전마다 회차 번호 (1회차, 2회차 …). 새 내전은 자동으로 다음 번호, 관리자가 고칠 수 있어요
-- 2. 경쟁 기록(내전 결과 · 우승 기록 · 개인 기록 · TK · 라운드 MVP) 공개 설정. 처음에는 비공개예요
--    → 관리자 → 기록 공개 에서 켜고, 몇 회차부터 셀지 · 대시보드에 띄울지 골라요
-- 3. 비공개일 때는 로그인 안 한 사람이 라운드 기록을 아예 못 읽어요 (관리자 · 봇은 그대로)
--    방송 중인 내전(OBS 조종판에서 라운드 시작 · 끝 한 내전, 12시간 동안)은 오버레이가 읽을 수 있어요
-- 기록은 공개 여부와 상관없이 계속 저장돼요.
-- ─────────────────────────────────────────────────────────────

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'live_state') then
    raise exception '7단계(20261028100000_overlay.sql)를 먼저 실행해 주세요';
  end if;
end $$;

-- 1. 회차 번호
alter table public.events add column if not exists episode integer;
with ordered as (
  select id, row_number() over (order by starts_at, created_at) as rn
    from public.events where episode is null
)
update public.events e
   set episode = (select coalesce(max(x.episode), 0) from public.events x) + o.rn
  from ordered o where o.id = e.id;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'events_episode_positive') then
    alter table public.events add constraint events_episode_positive check (episode is null or episode >= 1);
  end if;
end $$;
create unique index if not exists events_episode_key on public.events (episode);

create or replace function public._events_next_episode() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.episode is null then
    select coalesce(max(episode), 0) + 1 into new.episode from public.events;
  end if;
  return new;
end $$;
drop trigger if exists events_next_episode on public.events;
create trigger events_next_episode before insert on public.events
  for each row execute function public._events_next_episode();
revoke execute on function public._events_next_episode() from public, anon, authenticated;

-- 2. 사이트 설정 (한 줄)
create table if not exists public.site_settings (
  id smallint primary key default 1 check (id = 1),
  records_public boolean not null default false,
  records_from_episode integer not null default 1 check (records_from_episode >= 1),
  records_items jsonb not null default '{"results": {"on": true, "dash": true}, "hall": {"on": true, "dash": true}, "personal": {"on": true, "dash": true}, "tk": {"on": true}, "mvp": {"on": true}}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);
insert into public.site_settings (id) values (1) on conflict (id) do nothing;
alter table public.site_settings enable row level security;
drop policy if exists "public read" on public.site_settings;
create policy "public read" on public.site_settings for select using (true);
drop policy if exists "admin update" on public.site_settings;
create policy "admin update" on public.site_settings for update using (public.is_admin()) with check (public.is_admin());
grant select on public.site_settings to anon, authenticated;
grant update on public.site_settings to authenticated;
grant all on public.site_settings to service_role;

create or replace function public._site_settings_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists site_settings_touch on public.site_settings;
create trigger site_settings_touch before update on public.site_settings
  for each row execute function public._site_settings_touch();
revoke execute on function public._site_settings_touch() from public, anon, authenticated;

-- 3. 라운드 기록을 공개해도 되는지: 공개 설정이 켜져 있거나, 지금 방송 중인 내전
create or replace function public.records_open(p_event uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.records_public from public.site_settings s where s.id = 1), false)
      or exists (select 1 from public.events e
                  where e.id = p_event and e.live_state in ('playing', 'ended')
                    and e.live_changed_at > now() - interval '12 hours');
$$;
grant execute on function public.records_open(uuid) to anon, authenticated;

drop policy if exists "read confirmed" on public.rounds;
create policy "read confirmed" on public.rounds for select
  using (public.is_admin() or (status = 'confirmed' and public.records_open(event_id)));
drop policy if exists "read confirmed" on public.round_teams;
create policy "read confirmed" on public.round_teams for select
  using (exists (select 1 from public.rounds r where r.id = round_id
                  and (public.is_admin() or (r.status = 'confirmed' and public.records_open(r.event_id)))));
drop policy if exists "read confirmed" on public.round_players;
create policy "read confirmed" on public.round_players for select
  using (exists (select 1 from public.rounds r where r.id = round_id
                  and (public.is_admin() or (r.status = 'confirmed' and public.records_open(r.event_id)))));

select '회차 · 기록 공개 설정 준비 완료' as "12단계",
       (select count(*) from public.events) as "회차를 붙인 내전",
       (select case when records_public then '공개' else '비공개' end from public.site_settings where id = 1) as "경쟁 기록";
