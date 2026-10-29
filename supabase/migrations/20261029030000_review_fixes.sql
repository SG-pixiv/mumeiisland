-- ─────────────────────────────────────────────────────────────
-- 무명섬 10단계: 전체 검토에서 찾은 보안 수정
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
--
-- 고친 것: 로그인한 사람의 디스코드 계정을 확인할 때, 사용자가 직접 고칠 수 있는 프로필 값(user_metadata) 대신
--          디스코드가 넣어 준 로그인 기록(auth.identities)을 봐요.
--   → "이 계정만 쓸 수 있는 관리자 키"를 남이 프로필을 바꿔서 쓰는 걸 막아요
--   → 관리자 목록의 디스코드 ID 를 진짜 값으로 맞춰요 (봇이 운영진인지 볼 때 이 값을 써요)
-- ─────────────────────────────────────────────────────────────

create or replace function public.jwt_discord(out discord_id text, out discord_name text, out username text, out avatar_url text)
language sql stable security definer set search_path = public, auth as $$
  select coalesce(i.identity_data ->> 'sub', i.identity_data ->> 'provider_id'),
         coalesce(i.identity_data -> 'custom_claims' ->> 'global_name', i.identity_data ->> 'full_name', i.identity_data ->> 'name'),
         lower(split_part(coalesce(i.identity_data ->> 'full_name', i.identity_data ->> 'name', ''), '#', 1)),
         i.identity_data ->> 'avatar_url'
    from auth.identities i
   where i.user_id = auth.uid() and i.provider = 'discord'
   order by i.last_sign_in_at desc nulls last
   limit 1;
$$;
grant execute on function public.jwt_discord() to anon, authenticated;

-- 이미 등록된 관리자의 디스코드 ID 를 로그인 기록 기준으로 다시 맞춰요
drop table if exists _mumei_fixed;
create temp table _mumei_fixed as
with real_id as (
  select distinct on (i.user_id) i.user_id, coalesce(i.identity_data ->> 'sub', i.identity_data ->> 'provider_id') as did
    from auth.identities i
   where i.provider = 'discord'
   order by i.user_id, i.last_sign_in_at desc nulls last
), changed as (
  update public.admins a set discord_id = r.did
    from real_id r
   where r.user_id = a.user_id and r.did is not null and a.discord_id is distinct from r.did
  returning a.user_id
)
select count(*) as n from changed;

select '보안 수정 완료' as "10단계",
       (select n from _mumei_fixed) as "디스코드 ID 를 바로잡은 관리자",
       (select count(*) from public.admins where revoked_at is null) as "지금 관리자";
