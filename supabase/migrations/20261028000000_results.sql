-- ─────────────────────────────────────────────────────────────
-- 무명섬 2단계: 결과 검토 · 업로드 장치
-- 처음 SQL(20261027000000_init.sql)을 실행한 뒤, 이 파일을 SQL Editor 에 통째로 붙여 넣고 Run 하면 돼요.
-- 여러 번 실행해도 괜찮게 만들어 뒀어요.
-- ─────────────────────────────────────────────────────────────

-- 실험체 영문 이름 (게임 CSV 는 영문 이름이라 한글로 바꿀 때 써요. 이리 동기화가 채워요)
alter table public.er_characters add column if not exists name_en text;

-- ═════════ 업로드 장치 (게임 PC 의 자동 업로드 프로그램) ═════════
create table if not exists public.upload_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_hash text not null unique,            -- 키 원문은 저장하지 않아요
  prefix text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_file text,
  revoked_at timestamptz
);
alter table public.upload_devices enable row level security;
drop policy if exists "admin read" on public.upload_devices;
create policy "admin read" on public.upload_devices for select using (public.is_admin());
grant select on public.upload_devices to anon, authenticated;

-- ═════════ 라운드: 게임 번호 · 장치 · 내전 미지정 업로드 ═════════
alter table public.rounds add column if not exists game_id bigint;
alter table public.rounds add column if not exists device_id uuid references public.upload_devices (id) on delete set null;
create unique index if not exists rounds_game_id_key on public.rounds (game_id) where game_id is not null;
-- 장치가 올린 판이 어느 내전인지 모를 때도 일단 받아 두고, 관리자가 검토에서 정해요 (round_no = 0)
alter table public.rounds alter column event_id drop not null;
alter table public.rounds drop constraint if exists rounds_confirmed_needs_event;
alter table public.rounds add constraint rounds_confirmed_needs_event check (status <> 'confirmed' or (event_id is not null and round_no > 0));

-- ═════════ 장치 키 ═════════
create or replace function public.create_device_key(p_name text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  k text := '';
  i int;
begin
  if not public.is_admin() then raise exception '관리자만 장치 키를 만들 수 있어요'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception '장치 이름을 적어 주세요'; end if;
  for i in 1..16 loop
    k := k || substr(alphabet, (get_byte(extensions.gen_random_bytes(1), 0) % 32) + 1, 1);
  end loop;
  insert into public.upload_devices (name, key_hash, prefix, created_by)
  values (left(trim(p_name), 40), public._hash_key(k), substr(k, 1, 4), auth.uid());
  return substr(k, 1, 4) || '-' || substr(k, 5, 4) || '-' || substr(k, 9, 4) || '-' || substr(k, 13, 4);
end $$;

create or replace function public.revoke_device(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있어요'; end if;
  update public.upload_devices set revoked_at = now() where id = p_id and revoked_at is null;
end $$;

-- ═════════ 결과 확정 (팀 · 선수 기록을 한 번에 저장) ═════════
-- p_teams:   [{team_no, team_rank, team_kills, early_kills, penalties}]
-- p_players: [{player_id, csv_nickname, team_no, character_name, kills, assists, extra}]
create or replace function public.confirm_round(p_round uuid, p_event uuid, p_round_no smallint, p_teams jsonb, p_players jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  n_teams int;
begin
  if not public.is_admin() then raise exception '관리자만 확정할 수 있어요'; end if;
  if not exists (select 1 from public.rounds where id = p_round) then raise exception '라운드를 찾지 못했어요'; end if;
  if not exists (select 1 from public.events where id = p_event) then raise exception '내전을 골라 주세요'; end if;
  if p_round_no is null or p_round_no < 1 or p_round_no > 30 then raise exception '라운드 번호는 1~30 사이로 정해 주세요'; end if;
  if exists (select 1 from public.rounds where event_id = p_event and round_no = p_round_no and id <> p_round) then
    raise exception '이 내전에 이미 %라운드가 있어요. 라운드 번호를 바꿔 주세요', p_round_no;
  end if;
  if jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) = 0 then raise exception '팀 결과가 비어 있어요'; end if;

  select count(*) into n_teams from jsonb_to_recordset(p_teams) as t(team_no smallint);
  if n_teams <> (select count(distinct t.team_no) from jsonb_to_recordset(p_teams) as t(team_no smallint)) then
    raise exception '같은 팀 번호가 두 번 들어 있어요';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_teams) as t(team_kills smallint, early_kills smallint, penalties smallint)
             where t.early_kills < 0 or t.team_kills < 0 or t.penalties < 0 or t.early_kills > t.team_kills) then
    raise exception '킬 수나 감점이 올바르지 않아요 (0.5점 킬은 전체 킬보다 많을 수 없어요)';
  end if;

  update public.rounds
     set event_id = p_event, round_no = p_round_no, status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid()
   where id = p_round;

  delete from public.round_teams where round_id = p_round;
  insert into public.round_teams (round_id, team_no, team_rank, team_kills, early_kills, penalties)
  select p_round, t.team_no, t.team_rank, t.team_kills, t.early_kills, t.penalties
    from jsonb_to_recordset(p_teams) as t(team_no smallint, team_rank smallint, team_kills smallint, early_kills smallint, penalties smallint);

  delete from public.round_players where round_id = p_round;
  insert into public.round_players (round_id, player_id, csv_nickname, team_no, character_name, kills, assists, extra)
  select p_round, p.player_id, p.csv_nickname, p.team_no, p.character_name, coalesce(p.kills, 0), coalesce(p.assists, 0), p.extra
    from jsonb_to_recordset(coalesce(p_players, '[]'::jsonb))
      as p(player_id uuid, csv_nickname text, team_no smallint, character_name text, kills smallint, assists smallint, extra jsonb);
end $$;

-- ═════════ 권한 ═════════
-- 서버 함수(업로드 · 동기화)가 쓰는 service_role. "Automatically expose new tables" 를 꺼도 동작하게 직접 열어 둬요.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.create_device_key(text), public.revoke_device(uuid),
  public.confirm_round(uuid, uuid, smallint, jsonb, jsonb) to authenticated;
revoke execute on function public.create_device_key(text), public.revoke_device(uuid),
  public.confirm_round(uuid, uuid, smallint, jsonb, jsonb) from public, anon;
