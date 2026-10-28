# 무명섬 디스코드 봇

내전 디스코드 서버에서 쓰는 봇이에요. 무명섬 DB(Supabase)에 바로 읽고 써요.

| 명령어 | 누가 | 하는 일 |
| --- | --- | --- |
| `/연결 게임닉네임` | 누구나 | 내 디스코드 계정을 무명섬 선수와 연결 요청 → 웹 관리자 대시보드에서 승인 |
| `/내정보` | 누구나 | 연결된 선수 · 티어 · 솔로 랭크 점수 · 신청한 내전 |
| `/참가` · `/참가취소` | 연결된 선수 | 내전 참가 신청 · 취소 (내전을 안 고르면 가장 가까운 내전) |
| `/내전공지` | 서버 관리자 | 이 채널에 [참가하기] [참가 취소] 버튼이 달린 공지. "예정" 내전은 "참가 모집 중"으로 바뀌어요 |
| `/mvp 시작` · `/mvp 마감` | 서버 관리자 | 참가자끼리 MVP 투표(자기 자신 X, 마감 전까지 바꾸기 O). 최다 득표가 MVP, 공동 1위면 추첨 → 무명섬 내전 기록에 저장 |
| `/관리자키` | 서버 관리자 | 무명섬 웹 관리자 키 (24시간, 명령어를 쓴 디스코드 계정으로 로그인해야만 쓸 수 있어요) |

- 답장은 대부분 **나만 보이게** 와요. 공지 · 투표 · MVP 발표만 채널에 올라가요.
- 공지 인원과 투표 수는 버튼을 누를 때마다, 그리고 3분마다(웹에서 바꾼 것까지) 다시 그려져요.
- 봇은 디스코드로 나가는 연결만 써서 서버에 포트를 열 필요가 없어요.

---

## 처음 한 번 설치하기

### 1. 무명섬 DB 준비 (6단계 SQL)
Supabase → SQL Editor 에 `supabase/migrations/20261028080000_discord_bot.sql` 을 통째로 붙여 넣고 Run → "디스코드 봇 준비 완료" 가 나오면 끝.

### 2. 디스코드 개발자 포털 (로그인에 쓰는 그 무명섬 앱)
https://discord.com/developers/applications → 무명섬 앱
1. **General Information** → `Application ID` 복사 → `DISCORD_APP_ID`
2. **Bot** → **Reset Token** → 나온 토큰 복사 → `DISCORD_TOKEN` (한 번만 보여요. 절대 공유 금지)
   - Privileged Gateway Intents 는 **전부 꺼 둬도** 돼요
   - 다른 사람이 봇을 초대하지 못하게 **Public Bot** 은 꺼 두는 걸 추천해요
3. 아래 주소의 `앱ID` 를 바꿔서 열고 → 내전 서버 고르기 → 승인 (봇 초대)
   ```
   https://discord.com/oauth2/authorize?client_id=앱ID&scope=bot%20applications.commands&permissions=84992
   ```
   (권한: 채널 보기 · 메시지 보내기 · 링크 첨부 · 메시지 기록 보기)
4. 디스코드 앱 → 설정 → **고급** → 개발자 모드 켜기 → 내전 서버 이름 우클릭 → **서버 ID 복사** → `DISCORD_GUILD_ID`

### 3. Supabase 비밀 키
Supabase → Project Settings → **API Keys** → Secret keys 의 `sb_secret_...` 복사 → `SUPABASE_SECRET_KEY` (절대 공유 금지)

### 4. 오라클 서버에 설치
SSH 로 접속해서 (Ubuntu 기준)
```bash
# Node.js 22 (이미 있으면 건너뛰기: node -v 가 v20.6 이상이면 OK)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 코드 받기
git clone https://github.com/SG-pixiv/mumeiisland.git
cd mumeiisland/bot
npm ci

# 설정 파일 만들고 2 · 3 에서 복사한 값 넣기 (nano: 저장 Ctrl+O → Enter, 나가기 Ctrl+X)
cp .env.example .env
nano .env

# 슬래시 명령어 등록 (명령어 7개를 등록했어요 가 나오면 OK)
npm run register

# 시험 실행 → "무명섬 봇 켜짐" · "무명섬 DB 연결 OK" 가 나오면 Ctrl+C 로 끄기
npm start
```
> Oracle Linux 라면 첫 두 줄 대신 `sudo dnf module install -y nodejs:22 && sudo dnf install -y git`

### 5. 계속 켜 두기 (pm2)
```bash
sudo npm install -g pm2
pm2 start npm --name mumei-bot -- start
pm2 save
pm2 startup        # 나온 sudo ... 줄을 그대로 복사해서 한 번 실행 (서버가 재부팅돼도 자동으로 켜져요)
```
예전 픽시브 봇이 같은 서버에 있어도 같이 돌아가요. 무명섬 관리자 **대시보드 → 연동 상태 → 디스코드 봇** 이 "켜짐" 이면 성공이에요.

---

## 자주 쓰는 명령어 (서버에서)
```bash
pm2 logs mumei-bot          # 로그 보기 (나가기 Ctrl+C)
pm2 restart mumei-bot       # 다시 켜기
pm2 status                  # 켜져 있는지

# 새 버전 받기
cd ~/mumeiisland && git pull && cd bot && npm ci && npm run register && pm2 restart mumei-bot
```

## 내전 날 흐름
1. 운영진: 웹 일정 관리에서 내전 만들기 → 디스코드 공지 채널에서 `/내전공지`
2. 참가자: 처음 한 번 `/연결 게임닉네임` → 운영진이 웹 대시보드에서 **승인** → [참가하기] 버튼
3. 운영진: 웹 팀 편성 · 드래프트 → 게임 → 결과 검토에서 확정
4. 운영진: `/mvp 시작` → 참가자 투표 → `/mvp 마감` → MVP 발표 (웹 내전 기록에도 표시)

## 문제가 생기면
- **명령어가 안 보여요**: `npm run register` 를 다시 하고, `DISCORD_GUILD_ID` 가 내전 서버 ID 인지 확인. 디스코드 앱을 껐다 켜면 바로 보여요
- **"이 채널에 글을 쓸 권한이 없어요"**: 그 채널 설정 → 권한에서 봇(또는 봇 역할)에 메시지 보내기 · 링크 첨부 허용
- **로그에 "무명섬 DB 에 연결하지 못했어요"**: `SUPABASE_URL` · `SUPABASE_SECRET_KEY` 확인, 6단계 SQL 실행 여부 확인
- **"디스코드 로그인 실패: DISCORD_TOKEN 이 틀렸어요"**: 개발자 포털 → Bot → Reset Token 으로 새로 받아 `.env` 에 넣고 `pm2 restart mumei-bot`
- **서버 관리자 명령어가 일반 멤버에게 보여요**: 디스코드 서버 설정 → 연동 → 무명섬에서 명령어 권한을 바꿨는지 확인 (봇이 한 번 더 서버 관리자 권한을 확인하니까 실행은 안 돼요)
