-- ─────────────────────────────────────────────────────────────
-- 무명섬 8단계: 소유자가 디스코드 계정을 관리자로 바로 추가 (키 없이)
--   웹 권한 관리 · 봇 /관리자추가 @유저
--   사이트에 로그인한 적 있으면 바로 관리자, 없으면 그 디스코드 계정으로 처음 로그인할 때 관리자가 돼요
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
-- ─────────────────────────────────────────────────────────────

-- 1. 관리자 예약 (디스코드 사용자 ID 기준)
create table if not exists public.admin_grants (
  discord_id text primary key,
  discord_name text,
  created_by uuid references auth.users (id) on delete set null,
  created_via text not null default 'web' check (created_via in ('web', 'bot')),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
alter table public.admin_grants enable row level security;
drop policy if exists "admin read" on public.admin_grants;
create policy "admin read" on public.admin_grants for select using (public.is_admin());
grant select on public.admin_grants to authenticated;
grant all on public.admin_grants to service_role;

-- 2. 디스코드 로그인 기록(auth.identities)에서 계정 찾기
--    사용자가 직접 고칠 수 있는 user_metadata 는 믿지 않고, 디스코드가 넣어 준 로그인 기록만 봐요
create or replace function public._discord_user(p_discord_id text)
returns table (user_id uuid, discord_name text, avatar_url text)
language sql stable security definer set search_path = public, auth as $$
  select i.user_id,
         coalesce(i.identity_data -> 'custom_claims' ->> 'global_name', i.identity_data ->> 'full_name', i.identity_data ->> 'name'),
         i.identity_data ->> 'avatar_url'
    from auth.identities i
   where i.provider = 'discord'
     and (i.identity_data ->> 'sub' = p_discord_id or i.identity_data ->> 'provider_id' = p_discord_id)
   order by i.last_sign_in_at desc nulls last
   limit 1;
$$;

-- 3. 추가 (웹 · 봇이 같이 써요)
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

  -- 누가 언제 추가했는지 남겨요 (다시 추가하면 새로)
  insert into public.admin_grants as g (discord_id, discord_name, created_by, created_via)
  values (did, nm, p_by, case when p_via = 'bot' then 'bot' else 'web' end)
  on conflict (discord_id) do update
     set discord_name = coalesce(excluded.discord_name, g.discord_name), created_by = excluded.created_by,
         created_via = excluded.created_via, created_at = now(), used_at = null, used_by = null, revoked_at = null;

  -- 해제됐던 관리자면 되살려요
  if cur.user_id is not null then
    update public.admins set revoked_at = null, registered_via = via where user_id = cur.user_id and role <> 'owner';
    update public.admin_grants set used_at = now(), used_by = cur.user_id where discord_id = did;
    return jsonb_build_object('ok', true, 'state', 'added', 'name', coalesce(cur.discord_name, nm));
  end if;

  -- 사이트에 디스코드로 로그인한 적 있으면 바로 관리자
  select * into u from public._discord_user(did);
  if u.user_id is not null then
    insert into public.admins (user_id, discord_id, discord_name, avatar_url, role, registered_via)
    values (u.user_id, did, coalesce(u.discord_name, nm), u.avatar_url, 'admin', via)
    on conflict (user_id) do update
       set revoked_at = null, discord_id = excluded.discord_id, registered_via = excluded.registered_via
     where public.admins.role <> 'owner';
    update public.admin_grants set used_at = now(), used_by = u.user_id where discord_id = did;
    return jsonb_build_object('ok', true, 'state', 'added', 'name', coalesce(u.discord_name, nm));
  end if;

  return jsonb_build_object('ok', true, 'state', 'pending', 'name', nm);
end $$;

-- 웹 권한 관리 (소유자만)
create or replace function public.grant_admin(p_discord_id text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception '관리자 바로 추가는 소유자만 할 수 있어요'; end if;
  return public._grant_admin(p_discord_id, p_name, auth.uid(), 'web');
end $$;

-- 봇 /관리자추가 (서버 키로만 불러요 · 명령어를 쓴 디스코드 계정이 소유자인지 여기서도 확인)
create or replace function public.bot_grant_admin(p_by_discord text, p_discord_id text, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare owner_uid uuid;
begin
  select user_id into owner_uid from public.admins
   where discord_id = trim(coalesce(p_by_discord, '')) and role = 'owner' and revoked_at is null;
  if owner_uid is null then raise exception '관리자 추가는 무명섬 소유자만 할 수 있어요'; end if;
  return public._grant_admin(p_discord_id, p_name, owner_uid, 'bot');
end $$;

-- 4. 로그인할 때: 내 디스코드 계정이 예약돼 있으면 관리자로 (로그인 화면 · 관리자 화면이 불러요)
create or replace function public.claim_admin_grant() returns boolean
language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
  idn record;
  g record;
begin
  if uid is null then return false; end if;
  if public.is_admin() then return true; end if;
  for idn in
    select coalesce(x.identity_data ->> 'sub', x.identity_data ->> 'provider_id') as did,
           coalesce(x.identity_data -> 'custom_claims' ->> 'global_name', x.identity_data ->> 'full_name', x.identity_data ->> 'name') as nm,
           x.identity_data ->> 'avatar_url' as av
      from auth.identities x
     where x.user_id = uid and x.provider = 'discord'
  loop
    select * into g from public.admin_grants
     where discord_id = idn.did and used_at is null and revoked_at is null
     for update;
    if g.discord_id is not null then
      insert into public.admins (user_id, discord_id, discord_name, avatar_url, role, registered_via, last_seen_at)
      values (uid, idn.did, coalesce(idn.nm, g.discord_name), idn.av, 'admin',
              case when g.created_via = 'bot' then '봇 /관리자추가' else '소유자가 웹에서 추가' end, now())
      on conflict (user_id) do update
         set revoked_at = null, discord_id = excluded.discord_id, registered_via = excluded.registered_via, last_seen_at = now()
       where public.admins.role <> 'owner';
      update public.admin_grants set used_at = now(), used_by = uid where discord_id = g.discord_id;
      return true;
    end if;
  end loop;
  return false;
end $$;

-- 5. 로그인 전 예약 취소 (소유자만)
create or replace function public.revoke_admin_grant(p_discord_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception '소유자만 취소할 수 있어요'; end if;
  update public.admin_grants set revoked_at = now()
   where discord_id = trim(coalesce(p_discord_id, '')) and used_at is null and revoked_at is null;
end $$;

grant execute on function public.grant_admin(text, text), public.claim_admin_grant(), public.revoke_admin_grant(text) to authenticated;
revoke execute on function public.grant_admin(text, text), public.claim_admin_grant(), public.revoke_admin_grant(text) from public, anon;
revoke execute on function public._grant_admin(text, text, uuid, text), public._discord_user(text) from public, anon, authenticated;
revoke execute on function public.bot_grant_admin(text, text, text) from public, anon, authenticated;
grant execute on function public.bot_grant_admin(text, text, text) to service_role;

select '관리자 바로 추가 준비 완료' as "8단계",
       (select count(*) from public.admins where revoked_at is null) as "지금 관리자",
       (select count(*) from public.admin_grants where used_at is null and revoked_at is null) as "로그인 기다리는 사람";
