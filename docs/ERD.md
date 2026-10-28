# 무명섬 ERD

설명서 전체는 Claude 문서 "무명섬 설명서 · ERD" 에 있어요. 이 파일은 GitHub 에서 바로 볼 수 있는 관계도예요.
기준: `supabase/migrations/20261027000000_init.sql` + `20261028000000_results.sql`

```mermaid
erDiagram
  players ||--|| player_private : "1:1"
  players ||--o| player_rank_stats : "1:1"
  players ||--o{ tier_history : "티어 변경"
  players ||--o{ event_participants : "참가"
  players ||--o{ event_teams : "팀 배정"
  players |o--o{ round_players : "매칭되면"
  players |o--o{ events : "MVP"

  events ||--o{ event_participants : ""
  events ||--o{ event_teams : ""
  events ||--o| drafts : "1:1"
  events ||--o{ rounds : ""

  rounds ||--o{ round_teams : ""
  rounds ||--o{ round_players : ""

  auth_users ||--o| admins : "1:1"
  auth_users ||--o| key_attempts : "1:1"
  auth_users |o--o{ admin_keys : "만든 사람 / 쓴 사람"
  auth_users |o--o{ tier_history : "바꾼 사람"
  auth_users |o--o{ rounds : "확정한 사람"
  upload_devices |o--o{ rounds : "올린 장치"
  auth_users |o--o{ upload_devices : "만든 사람"

  players {
    uuid id PK
    text display_name UK
    text er_nickname UK
    text er_uid
    smallint balance_tier "1~3"
    text role
    text strength_note
    text chzzk_channel_id
    text youtube_url
    text photo_source "chzzk / youtube / upload"
    text chzzk_image_url
    text youtube_image_url
    text custom_photo_url
    boolean is_live
    text live_title
    integer live_viewers
    timestamptz live_checked_at
    boolean active
    timestamptz created_at
    timestamptz updated_at
  }
  player_private {
    uuid player_id PK, FK
    text discord_id
    text memo
  }
  player_rank_stats {
    uuid player_id PK, FK
    integer season_id
    integer rank_score "솔로 랭크 점수"
    integer rank_games
    integer rank_wins
    jsonb top_characters
    jsonb raw
    timestamptz synced_at
    text sync_error
  }
  er_characters {
    integer code PK
    text name_ko
    text name_en "CSV 영문 이름 매칭"
  }
  tier_history {
    bigint id PK
    uuid player_id FK
    smallint from_tier
    smallint to_tier
    text memo
    uuid changed_by FK
    timestamptz changed_at
  }
  events {
    uuid id PK
    text title
    smallint season
    timestamptz starts_at
    text format "draft / auto"
    smallint planned_rounds
    smallint max_players
    text status "plan / open / fixed / done"
    text setting_code
    text memo
    boolean teams_public
    uuid mvp_player_id FK
    timestamptz created_at
  }
  event_participants {
    uuid event_id PK, FK
    uuid player_id PK, FK
  }
  event_teams {
    uuid event_id PK, FK
    uuid player_id PK, FK
    smallint team_no
    smallint slot_tier "1~3"
    boolean locked
    smallint pick_no
    boolean auto_pick
  }
  drafts {
    uuid event_id PK, FK
    uuid_array captain_order
    text status "before / live / done"
    timestamptz updated_at
  }
  rounds {
    uuid id PK
    uuid event_id FK "확정 전엔 비어 있을 수 있음"
    bigint game_id UK "게임 번호, 중복 방지"
    uuid device_id FK
    smallint round_no
    text status "pending / held / confirmed"
    text source "device / manual"
    text file_name
    text raw_csv
    timestamptz played_at
    timestamptz uploaded_at
    timestamptz confirmed_at
    uuid confirmed_by FK
  }
  round_teams {
    uuid round_id PK, FK
    smallint team_no PK
    smallint team_rank "1~8"
    smallint team_kills
    smallint early_kills "0.5 KS 킬"
    smallint penalties "처치자 불명 사망"
  }
  round_players {
    bigint id PK
    uuid round_id FK
    uuid player_id FK
    text csv_nickname
    smallint team_no
    text character_name
    smallint kills
    smallint assists
    integer damage
    jsonb extra
  }
  scoring_rules {
    smallint id PK "항상 1"
    numeric_array placement "10,7,5,4,3,2,1,0"
    numeric ks_early "0.5"
    numeric ks_late "1"
    numeric penalty "1"
    timestamptz updated_at
  }
  auth_users {
    uuid id PK "Supabase 로그인 계정"
  }
  admins {
    uuid user_id PK, FK
    text discord_id
    text discord_name
    text avatar_url
    text role "owner 1명 / admin"
    text registered_via
    timestamptz created_at
    timestamptz last_seen_at
    timestamptz revoked_at
  }
  admin_keys {
    uuid id PK
    text key_hash UK
    text prefix
    text memo
    text target_discord
    timestamptz expires_at
    uuid created_by FK
    text created_via "web / bot"
    timestamptz created_at
    timestamptz used_at
    uuid used_by FK
    timestamptz revoked_at
  }
  key_attempts {
    uuid user_id PK, FK
    smallint fail_count
    timestamptz locked_until
  }
  app_secrets {
    text name PK
    text value_hash
  }
  upload_devices {
    uuid id PK
    text name
    text key_hash UK
    text prefix
    uuid created_by FK
    timestamptz last_seen_at
    text last_file
    timestamptz revoked_at
  }
```

## 키 없이 값으로 이어지는 것
- `player_rank_stats.top_characters` 의 실험체 번호 → `er_characters.code`
- `round_players (round_id, team_no)` → `round_teams (round_id, team_no)`: 선수 기록에 그 팀 점수를 붙일 때
- `scoring_rules` (1줄) × `round_teams` → 점수 계산 뷰

## 계산 뷰 (확정된 라운드만)
| 뷰 | 내용 |
| --- | --- |
| `v_round_team_scores` | 라운드 × 팀별 RS · KS · 감점 · 합계 |
| `v_event_standings` | 내전 × 팀별 누적 점수와 순위 (합계 → KS 순) |
| `v_player_rounds` | 선수 × 라운드 기록 + 그 팀 점수 |
| `v_player_stats` | 선수 × 시즌 평균 (전체 + 최근 30일) |
