-- ─────────────────────────────────────────────────────────────
-- 무명섬 7단계: 방송 오버레이 (라운드 시작 · 끝 표시, MVP 투표 인원)
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
-- ─────────────────────────────────────────────────────────────

-- 1. 내전의 방송 상태: idle(표시 안 함) · playing(N라운드 시작) · ended(N라운드 끝)
alter table public.events add column if not exists live_state text not null default 'idle';
alter table public.events drop constraint if exists events_live_state_check;
alter table public.events add constraint events_live_state_check check (live_state in ('idle', 'playing', 'ended'));
alter table public.events add column if not exists live_round smallint;
alter table public.events add column if not exists live_changed_at timestamptz;

-- 2. 대시보드 · OBS 조종판의 버튼 (관리자만)
--    한 번에 한 내전만 방송 중이에요: 이 내전을 켜면 다른 내전은 꺼져요
create or replace function public.set_live(p_event uuid, p_state text, p_round smallint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '관리자만 할 수 있어요'; end if;
  if p_state not in ('idle', 'playing', 'ended') then raise exception '알 수 없는 상태예요'; end if;
  if p_state <> 'idle' and (p_round is null or p_round < 1 or p_round > 30) then raise exception '라운드 번호를 확인해 주세요'; end if;
  if not exists (select 1 from public.events where id = p_event) then raise exception '내전을 찾지 못했어요'; end if;
  if p_state <> 'idle' then
    update public.events set live_state = 'idle', live_changed_at = now() where id <> p_event and live_state <> 'idle';
  end if;
  update public.events
     set live_state = p_state,
         live_round = case when p_state = 'idle' then live_round else p_round end,
         live_changed_at = now()
   where id = p_event;
end $$;

-- 3. 게임 결과가 올라오면 (업로드 프로그램이든 결과 검토의 직접 올리기든) 진행 중인 라운드를 "끝"으로
--    시작 버튼을 누르기 전에 끝난 게임 파일이 늦게 올라온 거면 건드리지 않아요 (컴퓨터 시계 차이 2분까지 봐줘요)
create or replace function public._round_uploaded_end_live() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.events
     set live_state = 'ended', live_changed_at = now()
   where live_state = 'playing'
     and new.played_at >= coalesce(live_changed_at, '-infinity'::timestamptz) - interval '2 minutes';
  return new;
end $$;
drop trigger if exists rounds_end_live on public.rounds;
create trigger rounds_end_live after insert on public.rounds
  for each row execute function public._round_uploaded_end_live();

-- 4. MVP 투표 중 인원 (누가 누구를 찍었는지는 안 보이고, 몇 명이 투표했는지만)
create or replace function public.mvp_vote_count(p_event uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.mvp_votes where event_id = p_event;
$$;

grant execute on function public.set_live(uuid, text, smallint) to authenticated;
revoke execute on function public.set_live(uuid, text, smallint) from public, anon;
revoke execute on function public._round_uploaded_end_live() from public, anon, authenticated;
grant execute on function public.mvp_vote_count(uuid) to anon, authenticated;

select '방송 오버레이 준비 완료' as "7단계",
       (select count(*) from public.events where live_state <> 'idle') as "방송 중인 내전";
