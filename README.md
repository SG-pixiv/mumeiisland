# 무명섬

이터널 리턴 사설 내전 기록 · 팀 편성 · 일정 사이트.
화면은 Vite + 바닐라 JS, 데이터 · 디스코드 로그인 · 서버 함수는 Supabase, 배포는 Vercel 이에요.

```
index.html, players.html …   페이지 (공개)
admin/*.html                 관리자 페이지
src/pages/                   페이지별 화면 코드
src/lib/db.js                DB 접근 (Supabase 가 없으면 예시 데이터로 동작)
supabase/migrations/         DB 테이블 · 보안 규칙 · 함수 (SQL)
supabase/functions/er-sync/  이리 Open API 동기화 함수
docs/ERD.md                  테이블 관계도 (GitHub 에서 그림으로 보여요)
```

> Supabase 를 연결하기 전에는 **예시 데이터(데모 모드)** 로 모든 화면이 열려요. 배포해 보고 화면부터 확인해도 괜찮아요.

---

## 처음 한 번 설정하기

준비물: GitHub · Supabase · Vercel 계정(전부 무료), 디스코드 계정, 이리 API 키

### 1. Supabase 프로젝트 만들기
1. https://supabase.com → New project
2. Region 은 **Northeast Asia (Seoul)**, DB 비밀번호는 아무 데나 적어 두기
3. 만들어지면 **Project Settings → API** 에서 두 값을 복사해 둬요
   - Project URL (`https://xxxx.supabase.co`)
   - `anon` `public` 키 (또는 Publishable key)

### 2. DB 만들기
1. 왼쪽 **SQL Editor** → New query
2. `supabase/migrations/20261027000000_init.sql` 내용을 통째로 붙여 넣고 **Run**
3. "Success" 가 뜨면 끝이에요

### 3. 소유자 키 등록 (SG님 계정을 소유자로 만들 키)
SQL Editor 에서 아래를 실행해요. 키는 **영문 + 숫자 16자 이상**으로 직접 정해요.
```sql
select public.set_owner_setup_key('여기에_영문숫자로_긴_키');
```
이 키는 처음 로그인할 때 한 번만 쓰고 자동으로 사라져요. (DB에는 암호화된 값만 저장돼요)

### 4. 디스코드 로그인 연결
1. https://discord.com/developers/applications → **New Application** (이름: 무명섬)
2. **OAuth2** 메뉴 → Client ID, Client Secret 복사
3. 같은 화면 **Redirects** 에 추가:
   `https://<Supabase 프로젝트 ID>.supabase.co/auth/v1/callback`
4. Supabase → **Authentication → Sign In / Providers → Discord** 켜고 Client ID / Secret 붙여 넣기
5. Supabase → **Authentication → URL Configuration**
   - Site URL: Vercel 주소 (6번에서 생겨요, 예: `https://mumeiisland.vercel.app`)
   - Redirect URLs 에 추가: `https://mumeiisland.vercel.app/**`, `http://localhost:5173/**` (로그인 뒤 `?next=` 가 붙은 주소로도 돌아올 수 있게 `/**`)

### 5. 이리 API 동기화 함수 올리기 (PowerShell)
```powershell
cd 무명섬폴더
npx supabase login
npx supabase secrets set ER_API_KEY=발급받은_이리_API_키 --project-ref <Supabase 프로젝트 ID>
npx supabase functions deploy er-sync --project-ref <Supabase 프로젝트 ID> --use-api
```
- `--use-api` 는 Docker 없이 Supabase 서버에서 함수를 묶어 올리는 옵션이에요.
- `supabase/config.toml` 에 `verify_jwt = false` 가 들어 있어요. 함수 안에서 "로그인한 관리자인지"를 직접 확인해요.
- 이리 API 키는 **절대** `.env` 나 코드에 넣지 마세요. Secrets 에만 넣어요.

### 6. Vercel 배포
1. 이 폴더를 GitHub 저장소에 올려요
2. https://vercel.com → Add New → Project → 그 저장소 Import
3. Framework 는 **Vite** 로 자동 인식돼요
4. **Environment Variables** 에 두 개 추가 후 Deploy
   - `VITE_SUPABASE_URL` = 1번의 Project URL
   - `VITE_SUPABASE_ANON_KEY` = 1번의 anon(Publishable) 키
5. 배포 주소가 생기면 4-5번의 Site URL / Redirect URLs 를 그 주소로 맞춰 주세요

이후로는 GitHub 에 올릴 때마다 Vercel 이 자동으로 다시 배포해요.

### 7. 첫 로그인 (소유자 등록)
1. 사이트 `/login` → **디스코드로 로그인**
2. "소유자 설정 키" 칸에 3번에서 정한 키 입력 → 소유자 등록 완료
3. 다른 운영진은 **관리자 → 권한 관리** 에서 관리자 키를 만들어 전해 주면 돼요 (1회용 · 유효 시간 · 계정 지정 가능)

### 8. 선수 넣고 이리 데이터 확인
1. **관리자 → 선수 관리 → 새 선수 추가** (이름 · 게임 닉네임 · 티어)
2. **이 선수만 동기화** → 솔로 랭크 점수 · 판수 · 모스트 실험체가 채워지는지 확인
3. 점수가 게임 안의 솔로 랭크 점수와 다르면 알려 주세요.
   API 응답에 랭크 기록이 여러 개 오면 지금은 판수가 가장 많은 항목을 써요.
   어떤 항목이 솔로 랭크인지 확인되면 아래처럼 고정할 수 있어요.
   ```powershell
   npx supabase secrets set ER_RANK_TEAM_MODE=확인된_값
   ```
   (Supabase → Table Editor → `player_rank_stats` → `raw` 칸에 받은 원본이 저장돼 있어요)

### 9. (선택) 매일 새벽 자동 동기화
```powershell
npx supabase secrets set CRON_SECRET=아무거나_긴_문자열
```
Supabase → **Integrations → Cron** 에서 새 작업을 만들거나 SQL Editor 에서:
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('er-sync-daily', '0 20 * * *',  -- 매일 05:00 (한국 시간)
  $$ select net.http_post(
       url := 'https://<프로젝트 ID>.supabase.co/functions/v1/er-sync',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '위에서_정한_CRON_SECRET'),
       body := '{}'::jsonb,
       timeout_milliseconds := 120000) $$);
```
한 번에 최대 40명씩 처리해요. 선수가 40명보다 많아지면 알려 주세요. 나눠서 돌리게 바꿀게요.

---

### 10. 결과 검토 · 업로드 장치 (2단계)
게임 결과 CSV 를 올리고 확정하는 기능이에요. 1~9번을 끝낸 뒤 한 번만 하면 돼요.

1. **DB 추가**: Supabase SQL Editor 에 `supabase/migrations/20261028000000_results.sql` 을 통째로 붙여 넣고 Run
2. **서버 함수 올리기** (PowerShell, 무명섬 폴더에서)
   ```powershell
   npx supabase functions deploy upload-result --project-ref <Supabase 프로젝트 ID> --use-api
   npx supabase functions deploy er-sync --project-ref <Supabase 프로젝트 ID> --use-api
   ```
   `er-sync` 는 실험체 영문 이름(CSV 는 영문)을 받아 오도록 바뀌어서 한 번 더 올려요. 다음 동기화 때 자동으로 채워져요.
3. **게임 PC 업로드 프로그램**: 관리자 → **업로드 장치** → 장치 키 만들기 → 파일 3개(프로그램 · 실행 파일 · 설정 파일)를 한 폴더에 넣고 `start-mumei-uploader.bat` 실행 (Node.js 18 이상 필요)
4. 게임 결과 화면에서 **데이터 저장** → 관리자 → **결과 검토**에 판이 들어오면 확인하고 **확정**

알아 둘 것
- 사용자 설정 대전 방 설정에서 **대회 점수 산정**을 켜 두세요. 그래야 0.5점 킬(1~2일차)이 정확하게 들어와요.
- 처치자 불명(야생동물 · 금지구역 등) 사망은 −1 감점으로 자동 제안돼요. 최종 2팀이 남은 뒤의 사망이면 검토 화면에서 빼 주세요.
- 업로드 프로그램이 없어도 결과 검토 화면에서 CSV 를 직접 올릴 수 있어요.
- 사용자 설정 대전은 이리 API 에 기록이 남지 않아서 딜량은 쓰지 않아요. 내전 기록은 점수 기준이에요.

### 11. 치지직 · 유튜브 연동 (3단계)
선수 카드의 프로필 사진과 LIVE ON 을 자동으로 채워요. 선수 관리에서 치지직 방송국 주소나 유튜브 채널 주소(`https://www.youtube.com/@핸들`)를 넣어 두면 돼요.

1. **DB 추가**: SQL Editor 에 `supabase/migrations/20261028020000_live.sql` 붙여 넣고 Run
2. **유튜브 API 키** (유튜브를 쓸 때만)
   1. https://console.cloud.google.com → 프로젝트 만들기 (이름 예: mumeiisland)
   2. **API 및 서비스 → 라이브러리** → `YouTube Data API v3` → **사용**
   3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키** → 만든 키의 **API 제한사항**을 `YouTube Data API v3` 로 제한
   4. PowerShell: `npx supabase secrets set "YOUTUBE_API_KEY=발급받은_키" --project-ref <Supabase 프로젝트 ID>`
3. **서버 함수 올리기**
   ```powershell
   npx supabase functions deploy live-sync --project-ref <Supabase 프로젝트 ID> --use-api
   ```
4. **2분마다 자동 확인**: SQL Editor 에서 (CRON_SECRET 은 9번에서 정한 값)
   ```sql
   select cron.schedule('live-sync', '*/2 * * * *',
     $$ select net.http_post(
          url := 'https://<프로젝트 ID>.supabase.co/functions/v1/live-sync',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '위에서_정한_CRON_SECRET'),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000) $$);
   ```
5. 관리자 → 선수 관리 → **방송 · 프로필 새로 고침** 으로 바로 확인해 보세요.

알아 둘 것
- 치지직은 로그인 없이 쓰는 공개 주소(api.chzzk.naver.com)로 방송 상태를 확인해요. 공식 API 가 아니라서 치지직이 막으면 멈출 수 있어요. 그때는 사이트가 20분 뒤 LIVE ON 을 알아서 숨기고, 대시보드에 "자동 확인이 멈췄어요"가 떠요. (치지직 개발자 센터 키를 `CHZZK_CLIENT_ID` · `CHZZK_CLIENT_SECRET` 로 넣어 두면 프로필 사진은 공식 API 로도 받아요)
- 유튜브는 채널의 최근 영상 목록(RSS, 무료)에서 라이브를 찾아서, 방송을 켜고 1~2분 뒤에 LIVE ON 이 떠요. 2분마다 확인하면 하루 쿼터 10,000 중 약 720 만 써요. RSS 가 404 를 주는 채널(공개 영상이 없거나 유튜브 쪽 오류)은 API 업로드 목록으로 다시 확인해서, 그런 채널 하나당 하루 약 720 쿼터를 더 써요.
- 둘 다 방송 중이면 치지직 방송을 먼저 보여 줘요.

## 내 컴퓨터에서 고치면서 보기
```powershell
npm install
copy .env.example .env.local   # 값 채우기 (안 채우면 예시 데이터로 열려요)
npm run dev                     # http://localhost:5173
```
`npm test` 로 게임 결과 CSV 읽기 테스트를 돌릴 수 있어요 (`tests/fixtures` 의 실제 형식 예시).

## 보안 규칙 요약
- 공개 페이지는 누구나 볼 수 있어요. 쓰기는 전부 **관리자만** 할 수 있어요. (DB 행 단위 보안 RLS)
- 확정 전 라운드 기록, 디스코드 아이디 같은 비공개 정보, 관리자 키 목록은 관리자만 볼 수 있어요.
- 팀 편성 · 드래프트는 일정 관리에서 "팀 편성을 공개 페이지에 보여주기"를 켠 내전만 공개돼요.
- 티어(1~3)는 운영진만 바꿀 수 있고, 바꿀 때마다 기록이 남아요.

## 다음 단계
- 팀 편성 · 드래프트 관리자 화면 (자동 편성 · 자물쇠 · 밸런스 추천 · 자동 채우기)
- 디스코드 봇 (오라클 서버 · MVP 투표 · 참가 신청 · `/관리자키`)
