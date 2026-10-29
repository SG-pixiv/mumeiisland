-- ─────────────────────────────────────────────────────────────
-- 무명섬 9단계: 라운드 MVP 투표
--   결과 검토에서 라운드를 확정하면 봇이 디스코드에 그 라운드 MVP 투표를 열고, 30분 뒤 마감 · 발표해요
--   선수 MVP 횟수 = 라운드 MVP 로 뽑힌 횟수 (내전 전체 MVP 는 더 안 써요)
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
-- ─────────────────────────────────────────────────────────────

-- 1. 라운드마다 MVP 투표 칸
alter table public.rounds add column if not exists mvp_player_id uuid references public.players (id) on delete set null;
alter table public.rounds add column if not exists mvp_vote_status text not null default 'none';
alter table public.rounds drop constraint if exists rounds_mvp_vote_status_check;
alter table public.rounds add constraint rounds_mvp_vote_status_check check (mvp_vote_status in ('none', 'open', 'closed'));
alter table public.rounds add column if not exists mvp_vote_closes_at timestamptz;   -- 자동 마감 시각
alter table public.rounds add column if not exists mvp_vote_result jsonb;            -- { counts, tied, picked, drawn, votes, closed_at }
alter table public.rounds add column if not exists mvp_channel_id text;              -- 투표 메시지 (마감하면 지워요)
alter table public.rounds add column if not exists mvp_message_id text;
create index if not exists rounds_mvp_open_idx on public.rounds (mvp_vote_closes_at) where mvp_vote_status = 'open';

-- 2. 라운드 MVP 표 (누가 누구를 찍었는지는 관리자만 볼 수 있어요 · 봇은 서버 키로 써요)
create table if not exists public.round_mvp_votes (
  round_id uuid not null references public.rounds (id) on delete cascade,
  voter_player_id uuid not null references public.players (id) on delete cascade,
  candidate_player_id uuid not null references public.players (id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (round_id, voter_player_id),
  constraint round_mvp_votes_not_self check (voter_player_id <> candidate_player_id)
);
alter table public.round_mvp_votes enable row level security;
drop policy if exists "admin all" on public.round_mvp_votes;
create policy "admin all" on public.round_mvp_votes for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.round_mvp_votes to authenticated;
grant all on public.round_mvp_votes to service_role;

-- 3. 선수별 라운드 MVP 횟수 (확정된 라운드만 · 공개)
create or replace view public.v_player_round_mvp with (security_invoker = on) as
select r.mvp_player_id as player_id, count(*)::int as round_mvp
  from public.rounds r
 where r.status = 'confirmed' and r.mvp_player_id is not null
 group by r.mvp_player_id;
grant select on public.v_player_round_mvp to anon, authenticated, service_role;

select '라운드 MVP 준비 완료' as "9단계",
       (select count(*) from public.rounds where status = 'confirmed') as "확정된 라운드",
       (select count(*) from public.rounds where mvp_player_id is not null) as "라운드 MVP";
