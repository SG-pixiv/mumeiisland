-- ─────────────────────────────────────────────────────────────
-- 무명섬 6단계: 디스코드 봇 (계정 연결 · 참가 신청 · MVP 투표 · /관리자키)
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
-- "Run and enable RLS" 를 물어보면 아무거나 눌러도 돼요 (아래에서 RLS 를 직접 켜요).
-- 봇은 Supabase 비밀 키(service_role)로 접근하고, 웹에서는 관리자만 보고 승인해요.
-- ─────────────────────────────────────────────────────────────

-- 1. 디스코드 계정 ↔ 선수: 한 디스코드 계정은 한 선수에만
create unique index if not exists player_private_discord_key on public.player_private (discord_id) where discord_id is not null;

-- 봇의 /연결 게임닉네임 → 관리자가 웹에서 승인하면 player_private.discord_id 에 들어가요
create table if not exists public.discord_link_requests (
  id uuid primary key default gen_random_uuid(),
  discord_id text not null,
  discord_name text,
  player_id uuid not null references public.players (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null
);
create unique index if not exists discord_link_pending_key on public.discord_link_requests (discord_id) where status = 'pending';

-- 2. 봇이 올린 메시지 (참가 신청 공지 · MVP 투표) — 인원 · 투표 수가 바뀌면 봇이 고쳐 써요
create table if not exists public.bot_messages (
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null check (kind in ('signup', 'mvp')),
  channel_id text not null,
  message_id text not null,
  created_at timestamptz not null default now(),
  primary key (event_id, kind)
);

-- 3. MVP 투표: 참가자만, 자기 자신은 안 돼요. 마감 때 최다 득표가 MVP (공동 1위는 추첨)
alter table public.events add column if not exists mvp_vote_status text not null default 'none';
alter table public.events drop constraint if exists events_mvp_vote_status_check;
alter table public.events add constraint events_mvp_vote_status_check check (mvp_vote_status in ('none', 'open', 'closed'));
alter table public.events add column if not exists mvp_vote_result jsonb;   -- { counts, tied, picked, drawn, votes, voters, closed_at }

create table if not exists public.mvp_votes (
  event_id uuid not null references public.events (id) on delete cascade,
  voter_player_id uuid not null references public.players (id) on delete cascade,
  candidate_player_id uuid not null references public.players (id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (event_id, voter_player_id),
  check (voter_player_id <> candidate_player_id)
);

-- 봇이 몇 분마다 남기는 "살아 있어요" 신호 (관리자 대시보드에 켜짐 · 꺼짐으로 보여요)
create table if not exists public.bot_status (
  id smallint primary key default 1 check (id = 1),
  bot_tag text,
  guild_id text,
  last_seen_at timestamptz
);

-- 4. RLS: 관리자만 (봇은 service_role 이라 RLS 를 건너뛰어요)
alter table public.discord_link_requests enable row level security;
alter table public.bot_messages enable row level security;
alter table public.mvp_votes enable row level security;
alter table public.bot_status enable row level security;
drop policy if exists "admin read" on public.bot_status;
create policy "admin read" on public.bot_status for select using (public.is_admin());
drop policy if exists "admin all" on public.discord_link_requests;
create policy "admin all" on public.discord_link_requests for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.bot_messages;
create policy "admin all" on public.bot_messages for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin all" on public.mvp_votes;
create policy "admin all" on public.mvp_votes for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.discord_link_requests, public.bot_messages, public.mvp_votes to authenticated;
grant select on public.bot_status to authenticated;
grant all on public.discord_link_requests, public.bot_messages, public.mvp_votes, public.bot_status to service_role;

-- 5. 연결 요청 승인 · 거절 (웹 관리자)
create or replace function public.decide_discord_link(p_id uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있어요'; end if;
  select * into r from public.discord_link_requests where id = p_id for update;
  if r.id is null then raise exception '요청을 찾지 못했어요'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 요청이에요'; end if;
  if p_ok then
    -- 이 디스코드 계정이 다른 선수에 붙어 있었으면 떼고, 이 선수에 붙여요
    update public.player_private set discord_id = null where discord_id = r.discord_id and player_id <> r.player_id;
    insert into public.player_private (player_id, discord_id) values (r.player_id, r.discord_id)
    on conflict (player_id) do update set discord_id = excluded.discord_id;
  end if;
  update public.discord_link_requests
     set status = case when p_ok then 'approved' else 'rejected' end, decided_at = now(), decided_by = auth.uid()
   where id = p_id;
end $$;

-- 6. 봇의 /관리자키: 명령어를 쓴 디스코드 계정만 쓸 수 있는 24시간 키 (봇 = service_role 전용)
create or replace function public.bot_create_admin_key(p_discord_id text, p_discord_name text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  k text := '';
  i int;
begin
  if coalesce(trim(p_discord_id), '') = '' then raise exception '디스코드 계정을 알 수 없어요'; end if;
  for i in 1..12 loop
    k := k || substr(alphabet, (get_byte(extensions.gen_random_bytes(1), 0) % 32) + 1, 1);
  end loop;
  insert into public.admin_keys (key_hash, prefix, memo, target_discord, expires_at, created_via)
  values (public._hash_key(k), substr(k, 1, 4), left('디스코드 /관리자키 · ' || coalesce(nullif(trim(p_discord_name), ''), p_discord_id), 80),
          lower(trim(p_discord_id)), now() + interval '24 hours', 'bot');
  return substr(k, 1, 4) || '-' || substr(k, 5, 4) || '-' || substr(k, 9, 4);
end $$;

grant execute on function public.decide_discord_link(uuid, boolean) to authenticated;
revoke execute on function public.decide_discord_link(uuid, boolean) from public, anon;
revoke execute on function public.bot_create_admin_key(text, text) from public, anon, authenticated;
grant execute on function public.bot_create_admin_key(text, text) to service_role;

select '디스코드 봇 준비 완료' as "6단계",
       (select count(*) from public.player_private where discord_id is not null) as "연결된 선수";
