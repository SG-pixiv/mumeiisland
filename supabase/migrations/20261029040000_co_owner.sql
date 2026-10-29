-- ─────────────────────────────────────────────────────────────
-- 무명섬 11단계: 공동 소유자
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
--
-- 공동 소유자 = 사이트 관리를 소유자처럼 할 수 있는 관리자
--   할 수 있어요: 관리자 바로 추가 · 해제 · 되돌리기, 로그인 전 추가 취소, 봇 /관리자추가 · /관리자해제
--   못 해요:      소유자 해제, 공동 소유자 올리기 · 내리기 · 해제 (이건 소유자만)
--   Supabase · Vercel · 오라클 서버 같은 계정 권한은 따로라서 여기서 주지 않아요
-- ─────────────────────────────────────────────────────────────

-- 1. 권한 종류에 공동 소유자 추가
alter table public.admins drop constraint if exists admins_role_check;
alter table public.admins add constraint admins_role_check check (role in ('owner', 'co_owner', 'admin'));

-- 2. 소유자 기능(관리자 추가 · 해제)은 소유자 + 공동 소유자
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role in ('owner', 'co_owner') and revoked_at is null);
$$;

-- 진짜 소유자만 (공동 소유자 정하기)
create or replace function public.is_primary_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and role = 'owner' and revoked_at is null);
$$;

-- 3. 관리자 해제 · 되돌리기
--    소유자는 아무도 못 빼요. 공동 소유자는 소유자만 뺄 수 있고, 빼면 관리자로 내려가요 (되돌려도 관리자)
create or replace function public.set_admin_revoked(p_user uuid, p_revoked boolean) returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not public.is_owner() then raise exception '소유자 · 공동 소유자만 관리자를 해제할 수 있어요'; end if;
  select * into t from public.admins where user_id = p_user for update;
  if t.user_id is null then return; end if;
  if t.role = 'owner' then raise exception '소유자는 해제할 수 없어요'; end if;
  if t.role = 'co_owner' and not public.is_primary_owner() then raise exception '공동 소유자는 소유자만 해제할 수 있어요'; end if;
  update public.admins
     set revoked_at = case when p_revoked then now() else null end,
         role = case when p_revoked then 'admin' else role end
   where user_id = p_user;
end $$;

-- 해제된 사람은 공동 소유자로 남지 않아요 (봇 /관리자해제 · 키 · 다시 추가 어느 길로 돌아와도 관리자)
create or replace function public._admins_revoked_not_co_owner() returns trigger
language plpgsql as $$
begin
  if new.revoked_at is not null and new.role = 'co_owner' then new.role := 'admin'; end if;
  return new;
end $$;
drop trigger if exists admins_revoked_not_co_owner on public.admins;
create trigger admins_revoked_not_co_owner before insert or update on public.admins
  for each row execute function public._admins_revoked_not_co_owner();
revoke execute on function public._admins_revoked_not_co_owner() from public, anon, authenticated;

-- 4. 공동 소유자로 올리기 · 관리자로 내리기 (소유자만)
create or replace function public.set_admin_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if not public.is_primary_owner() then raise exception '공동 소유자는 소유자만 정할 수 있어요'; end if;
  if coalesce(p_role, '') not in ('co_owner', 'admin') then raise exception '공동 소유자나 관리자 중에서 골라 주세요'; end if;
  select * into t from public.admins where user_id = p_user for update;
  if t.user_id is null then raise exception '관리자 목록에 없는 사람이에요'; end if;
  if t.role = 'owner' then raise exception '소유자 권한은 바꿀 수 없어요'; end if;
  if t.revoked_at is not null then raise exception '해제된 관리자예요. 먼저 되돌린 뒤 바꿔 주세요'; end if;
  update public.admins set role = p_role where user_id = p_user;
end $$;

-- 5. 관리자 바로 추가: 다시 추가된 사람은 관리자로 돌아와요 (공동 소유자는 소유자가 따로 올려요)
create or replace function public._grant_admin(p_discord_id text, p_name text, p_by uuid, p_via text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  did text := trim(coalesce(p_discord_id, ''));
  nm text := nullif(left(trim(coalesce(p_name, '')), 60), '');
  via text := case when p_via = 'bot' then '봇 /관리자추가' else '소유자가 웹에서 추가' end;
  cur record;
  u record;
begin
  if did !~ '^[0-9]{15,21}$' then raise exception '디스코드 사용자 ID(숫자 17~19자리)를 확인해 주세요'; end if;

  select * into cur from public.admins where discord_id = did order by revoked_at nulls first limit 1;
  if cur.user_id is not null and cur.revoked_at is null then
    return jsonb_build_object('ok', true, 'state', 'already', 'name', coalesce(cur.discord_name, nm));
  end if;

  insert into public.admin_grants as g (discord_id, discord_name, created_by, created_via)
  values (did, nm, p_by, case when p_via = 'bot' then 'bot' else 'web' end)
  on conflict (discord_id) do update
     set discord_name = coalesce(excluded.discord_name, g.discord_name), created_by = excluded.created_by,
         created_via = excluded.created_via, created_at = now(), used_at = null, used_by = null, revoked_at = null;

  -- 해제됐던 관리자면 되살려요
  if cur.user_id is not null then
    update public.admins set revoked_at = null, role = 'admin', registered_via = via where user_id = cur.user_id and role <> 'owner';
    update public.admin_grants set used_at = now(), used_by = cur.user_id where discord_id = did;
    return jsonb_build_object('ok', true, 'state', 'added', 'name', coalesce(cur.discord_name, nm));
  end if;

  -- 사이트에 디스코드로 로그인한 적 있으면 바로 관리자
  select * into u from public._discord_user(did);
  if u.user_id is not null then
    insert into public.admins (user_id, discord_id, discord_name, avatar_url, role, registered_via)
    values (u.user_id, did, coalesce(u.discord_name, nm), u.avatar_url, 'admin', via)
    on conflict (user_id) do update
       set revoked_at = null, discord_id = excluded.discord_id, registered_via = excluded.registered_via,
           role = case when public.admins.revoked_at is null then public.admins.role else 'admin' end
     where public.admins.role <> 'owner';
    update public.admin_grants set used_at = now(), used_by = u.user_id where discord_id = did;
    return jsonb_build_object('ok', true, 'state', 'added', 'name', coalesce(u.discord_name, nm));
  end if;

  return jsonb_build_object('ok', true, 'state', 'pending', 'name', nm);
end $$;

-- 6. 봇 /관리자추가: 명령어를 쓴 디스코드 계정이 소유자 · 공동 소유자인지 확인
create or replace function public.bot_grant_admin(p_by_discord text, p_discord_id text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare by_uid uuid;
begin
  select user_id into by_uid from public.admins
   where discord_id = trim(coalesce(p_by_discord, '')) and role in ('owner', 'co_owner') and revoked_at is null
   limit 1;
  if by_uid is null then raise exception '관리자 추가는 무명섬 소유자 · 공동 소유자만 할 수 있어요'; end if;
  return public._grant_admin(p_discord_id, p_name, by_uid, 'bot');
end $$;

-- 안내 문구만 바꿔요 (권한 확인은 위의 is_owner 그대로)
create or replace function public.grant_admin(p_discord_id text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception '관리자 바로 추가는 소유자 · 공동 소유자만 할 수 있어요'; end if;
  return public._grant_admin(p_discord_id, p_name, auth.uid(), 'web');
end $$;

create or replace function public.revoke_admin_grant(p_discord_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception '소유자 · 공동 소유자만 취소할 수 있어요'; end if;
  update public.admin_grants set revoked_at = now()
   where discord_id = trim(coalesce(p_discord_id, '')) and used_at is null and revoked_at is null;
end $$;

grant execute on function public.grant_admin(text, text), public.revoke_admin_grant(text) to authenticated;
revoke execute on function public.grant_admin(text, text), public.revoke_admin_grant(text) from public, anon;
grant execute on function public.is_primary_owner(), public.set_admin_role(uuid, text) to authenticated;
revoke execute on function public.is_primary_owner(), public.set_admin_role(uuid, text) from public, anon;
grant execute on function public.is_owner(), public.set_admin_revoked(uuid, boolean) to anon, authenticated;
revoke execute on function public._grant_admin(text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.bot_grant_admin(text, text, text) from public, anon, authenticated;
grant execute on function public.bot_grant_admin(text, text, text) to service_role;

select '공동 소유자 준비 완료' as "11단계",
       (select discord_name from public.admins where role = 'owner' and revoked_at is null) as "소유자",
       (select count(*) from public.admins where role = 'co_owner' and revoked_at is null) as "공동 소유자",
       (select count(*) from public.admins where role = 'admin' and revoked_at is null) as "관리자";
