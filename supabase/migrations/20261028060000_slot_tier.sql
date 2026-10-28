-- ─────────────────────────────────────────────────────────────
-- 무명섬 5단계: 이번 내전만 티어 자리 바꾸기 (팀 편성 · 드래프트)
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
--   예: 2티어가 9명 · 3티어가 7명이면, 2티어 한 명을 이번 내전에서만 3티어 자리로 넣어요.
--   선수의 진짜 티어(선수 관리 · 티어 관리)는 그대로예요.
-- ─────────────────────────────────────────────────────────────

alter table public.event_participants add column if not exists slot_tier smallint;   -- 비어 있으면 선수 티어 그대로
alter table public.event_participants drop constraint if exists event_participants_slot_tier_check;
alter table public.event_participants add constraint event_participants_slot_tier_check check (slot_tier is null or slot_tier between 1 and 3);

select '이번 내전만 티어 자리 바꾸기 준비 완료' as "5단계";
