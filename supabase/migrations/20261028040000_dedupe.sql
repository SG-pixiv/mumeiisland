-- ─────────────────────────────────────────────────────────────
-- 무명섬 4단계: 같은 게임이 두 번 확정되지 않게 막기
-- SQL Editor 에 통째로 붙여 넣고 Run. 여러 번 실행해도 괜찮아요.
-- 마지막에 "게임 번호 중복 금지" 가 원래 있었는지 / 지금 만들었는지 알려 줘요.
-- ─────────────────────────────────────────────────────────────

drop table if exists _mumei_before;
create temp table _mumei_before as
  select exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rounds_game_id_key') as had_index,
         (select count(*) from (select game_id from public.rounds where game_id is not null group by game_id having count(*) > 1) d) as dup_games;

-- 1. 같은 gameId 는 rounds 에 한 번만 (2단계에서 만들었지만, 없으면 지금 만들어요)
--    이미 겹친 판이 있으면 만들 수 없어서 건너뛰고 마지막에 알려 줘요
do $$
begin
  if (select dup_games from _mumei_before) = 0 then
    create unique index if not exists rounds_game_id_key on public.rounds (game_id) where game_id is not null;
  end if;
end $$;

-- 2. CSV 내용 지문: BOM · 줄바꿈(\r) 차이는 무시해요 (업로드 프로그램과 브라우저가 다르게 읽어도 같은 값)
create or replace function public._csv_fp(t text) returns text
language sql immutable set search_path = public as $$
  select md5(replace(replace(coalesce(t, ''), chr(65279), ''), chr(13), ''))
$$;

-- 3. 확정: 같은 게임(같은 gameId, 또는 같은 CSV 내용)이 이미 확정돼 있으면 거부
create or replace function public.confirm_round(p_round uuid, p_event uuid, p_round_no smallint, p_teams jsonb, p_players jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  n_teams int;
  v_game bigint;
  v_raw text;
  v_dup text;
begin
  if not public.is_admin() then raise exception '관리자만 확정할 수 있어요'; end if;
  -- 같은 판을 동시에 두 번 눌러도 차례대로 처리해요
  select r.game_id, r.raw_csv into v_game, v_raw from public.rounds r where r.id = p_round for update;
  if not found then raise exception '라운드를 찾지 못했어요'; end if;
  if not exists (select 1 from public.events where id = p_event) then raise exception '내전을 골라 주세요'; end if;
  if p_round_no is null or p_round_no < 1 or p_round_no > 30 then raise exception '라운드 번호는 1~30 사이로 정해 주세요'; end if;
  if exists (select 1 from public.rounds where event_id = p_event and round_no = p_round_no and id <> p_round) then
    raise exception '이 내전에 이미 %라운드가 있어요. 라운드 번호를 바꿔 주세요', p_round_no;
  end if;

  select coalesce(e.title, '내전 미지정') || ' ' || o.round_no || '라운드' into v_dup
    from public.rounds o left join public.events e on e.id = o.event_id
   where o.id <> p_round and o.status = 'confirmed'
     and ((v_game is not null and o.game_id = v_game)
       or (nullif(v_raw, '') is not null and nullif(o.raw_csv, '') is not null and public._csv_fp(o.raw_csv) = public._csv_fp(v_raw)))
   order by o.confirmed_at
   limit 1;
  if v_dup is not null then
    raise exception '같은 게임이 이미 "%"(으)로 확정돼 있어요. 그 판을 확정 취소하거나 이 판을 지워 주세요', v_dup;
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

grant execute on function public.confirm_round(uuid, uuid, smallint, jsonb, jsonb) to authenticated;
revoke execute on function public.confirm_round(uuid, uuid, smallint, jsonb, jsonb) from public, anon;
grant execute on function public._csv_fp(text) to service_role, authenticated;

select case when had_index then '원래 있었어요'
            when dup_games > 0 then '겹친 판이 ' || dup_games || '개 있어서 못 만들었어요. 결과 검토에서 겹친 판을 지우고 다시 실행해 주세요'
            else '없어서 지금 만들었어요' end as "게임 번호 중복 금지",
       '켜졌어요' as "확정할 때 같은 게임 검사"
  from _mumei_before;
