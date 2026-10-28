// 디스코드에 등록할 슬래시 명령어 (npm run register 가 이 목록을 서버에 올려요)

const ADMIN = String(1 << 3);   // 서버 관리자(Administrator) 권한만 보이게
const eventOption = (description = '비워 두면 가장 가까운 내전') => ({ type: 3, name: '내전', description, required: false, autocomplete: true });

export const commands = [
  {
    name: '연결', description: '내 디스코드 계정을 무명섬 선수와 연결해요 (운영진 승인 후 완료)',
    options: [{ type: 3, name: '게임닉네임', description: '이터널 리턴 게임 닉네임', required: true, max_length: 40 }]
  },
  { name: '내정보', description: '연결된 무명섬 선수 정보를 보여 줘요' },
  { name: '연결해제', description: '내 디스코드 계정과 무명섬 선수의 연결을 풀어요 (대기 중인 연결 요청도 취소)' },
  { name: '참가', description: '내전 참가 신청', options: [eventOption('비워 두면 모집 중인 가장 가까운 내전')] },
  { name: '참가취소', description: '내전 참가 취소', options: [eventOption('비워 두면 내가 신청한 가장 가까운 내전')] },
  { name: '내전공지', description: '참가 버튼이 달린 내전 공지를 이 채널에 올려요 (서버 관리자)', default_member_permissions: ADMIN, options: [eventOption()] },
  {
    name: 'mvp', description: 'MVP 투표 (서버 관리자)', default_member_permissions: ADMIN,
    options: [
      { type: 1, name: '시작', description: 'MVP 투표를 이 채널에 열어요', options: [eventOption('비워 두면 가장 최근 내전')] },
      { type: 1, name: '마감', description: '투표를 마감하고 MVP 를 발표해요 (공동 1위는 추첨)', options: [eventOption('비워 두면 투표 중인 내전')] }
    ]
  },
  { name: '관리자키', description: '무명섬 웹 관리자 키 받기 (서버 관리자 · 24시간 · 나만 쓸 수 있어요)', default_member_permissions: ADMIN }
].map((c) => ({ ...c, contexts: [0] }));   // 서버 안에서만 (DM 에서는 안 보여요)
