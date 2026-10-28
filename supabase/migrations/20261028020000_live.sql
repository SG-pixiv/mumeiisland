-- ─────────────────────────────────────────────────────────────
-- 무명섬 3단계: 치지직 · 유튜브 연동 (프로필 사진 · LIVE ON)
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
-- ─────────────────────────────────────────────────────────────

alter table public.players add column if not exists youtube_channel_id text;       -- 유튜브 주소에서 찾은 UC… 채널 ID
alter table public.players add column if not exists live_platform text;            -- 지금 방송 중인 곳 (chzzk / youtube)
alter table public.players add column if not exists live_url text;                 -- 방송 보러 가기 주소
alter table public.players add column if not exists live_started_at timestamptz;
alter table public.players add column if not exists profile_synced_at timestamptz; -- 프로필 사진을 마지막으로 받은 시각

alter table public.players drop constraint if exists players_live_platform_check;
alter table public.players add constraint players_live_platform_check check (live_platform is null or live_platform in ('chzzk', 'youtube'));

-- 방송 주소를 바꾸면 예전 채널의 사진 · 방송 상태를 지우고, 다음 확인 때 새로 받아요
create or replace function public._players_channel_changed() returns trigger
language plpgsql as $$
begin
  if new.chzzk_channel_id is distinct from old.chzzk_channel_id then
    new.chzzk_image_url := null;
    new.profile_synced_at := null;
    if old.live_platform = 'chzzk' then
      new.is_live := false; new.live_platform := null; new.live_title := null; new.live_viewers := null; new.live_url := null; new.live_started_at := null;
    end if;
  end if;
  if new.youtube_url is distinct from old.youtube_url then
    new.youtube_channel_id := null;
    new.youtube_image_url := null;
    new.profile_synced_at := null;
    if old.live_platform = 'youtube' then
      new.is_live := false; new.live_platform := null; new.live_title := null; new.live_viewers := null; new.live_url := null; new.live_started_at := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists players_channel_changed on public.players;
create trigger players_channel_changed before update of chzzk_channel_id, youtube_url on public.players
  for each row execute function public._players_channel_changed();
