// 디스코드에 등록할 슬래시 명령어 (npm run register 가 이 목록을 서버에 올려요)

// 운영진 명령어도 목록에는 누구나 보여요. 쓸 수 있는지는 봇이 확인해요:
//   운영진 = 디스코드 서버 관리자 또는 무명섬 관리자 (소유자 · 공동 소유자가 /관리자추가 · 웹에서 추가한 사람 포함)
//   그래서 서버 관리자 권한이 없어도 무명섬 관리자면 다 쓸 수 있어요
const eventOption = (description = '비워 두면 가장 가까운 내전') => ({ type: 3, name: '내전', description, required: false, autocomplete: true });
const roundOption = (description) => ({ type: 4, name: '라운드', description, required: false, min_value: 1, max_value: 30 });

export const commands = [
  {
    name: '연결', description: '내 디스코드 계정을 무명섬 선수와 연결해요 (승인 후 완료) · 없는 닉네임이면 바로 새 선수 등록',
    options: [{ type: 3, name: '게임닉네임', description: '이터널 리턴 게임 닉네임', required: true, max_length: 40 }]
  },
  { name: '등록', description: '무명섬 선수로 바로 등록해요 (이름 · 게임 닉네임 · 방송 채널, 3티어로 시작)' },
  { name: '내정보', description: '연결된 무명섬 선수 정보를 보여 줘요' },
  { name: '연결해제', description: '내 디스코드 계정과 무명섬 선수의 연결을 풀어요 (대기 중인 연결 요청도 취소)' },
  { name: '참가', description: '내전 참가 신청', options: [eventOption('비워 두면 모집 중인 가장 가까운 내전')] },
  { name: '참가취소', description: '내전 참가 취소', options: [eventOption('비워 두면 내가 신청한 가장 가까운 내전')] },
  { name: '내전공지', description: '참가 버튼이 달린 내전 공지를 공지 채널에 올려요 (운영진)', options: [eventOption()] },
  { name: '소개공지', description: '무명섬 소개 공지(그림 + 사이트 버튼)를 이 채널에 올려요. 창에서 제목 · 내용을 고쳐요 (운영진)' },
  { name: '등록안내', description: '선수 등록 안내([선수예요] [관계자예요] 버튼)를 이 채널에 올려요 (운영진)' },
  {
    name: 'mvp', description: '라운드 MVP 투표 (운영진). 결과를 확정하면 자동으로 열리고 30분 뒤 자동 마감돼요',
    options: [
      { type: 1, name: '시작', description: '라운드 MVP 투표를 열거나 다시 열어요', options: [eventOption('비워 두면 가장 최근 내전'), roundOption('비워 두면 가장 최근에 확정한 라운드')] },
      { type: 1, name: '마감', description: '30분을 기다리지 않고 바로 마감 · 발표해요 (공동 1위는 추첨)', options: [eventOption('비워 두면 투표 중인 라운드'), roundOption('비워 두면 투표 중인 라운드')] }
    ]
  },
  {
    name: '채널설정', description: '공지 · 명령어 · 환영 채널과 1티어 역할 정하기 (운영진)',
    options: [
      { type: 1, name: '공지', description: '내전 공지 · MVP 투표 · 발표 · 라운드 결과가 올라갈 채널', options: [{ type: 7, name: '채널', description: '비우면 지금 채널', required: false, channel_types: [0, 5] }] },
      { type: 1, name: '명령어', description: '참가자 명령어(/연결 · /참가 …)를 받을 채널', options: [{ type: 7, name: '채널', description: '비우면 지금 채널', required: false, channel_types: [0, 5] }] },
      { type: 1, name: '명령어해제', description: '명령어 채널 제한 풀기 (어디서나 쓸 수 있게)' },
      { type: 1, name: '환영', description: '새 인원이 들어오면 선수 · 관계자 안내가 올라갈 채널 (비우면 공지 채널)', options: [{ type: 7, name: '채널', description: '비우면 지금 채널', required: false, channel_types: [0, 5] }] },
      { type: 1, name: '역할', description: '1티어(오더) 선수에게 자동으로 줄 역할 (티어가 바뀌면 주고 빼요)', options: [{ type: 8, name: '역할', description: '1티어 선수에게 줄 디스코드 역할', required: true }] },
      { type: 1, name: '역할해제', description: '1티어 역할 자동 관리 끄기' },
      { type: 1, name: '보기', description: '지금 정해진 채널 보기' }
    ]
  },
  {
    name: '관리자키', description: '무명섬 웹 관리자 키 (운영진 · 24시간 · 받은 사람 계정으로만 쓸 수 있어요)',
    options: [{ type: 6, name: '유저', description: '키를 줄 사람 (DM 으로 보내요). 비우면 나', required: false }]
  },
  { name: '관리자목록', description: '무명섬 관리자와 안 쓴 키 개수 (운영진)' },
  {
    name: '관리자추가', description: '무명섬 관리자로 바로 추가해요. 서버 관리자처럼 운영진 명령어도 쓸 수 있어요 (소유자 · 공동 소유자만)',
    options: [{ type: 6, name: '유저', description: '관리자로 추가할 사람', required: true }]
  },
  {
    name: '관리자해제', description: '무명섬 웹 관리자에서 빼요 (소유자 · 공동 소유자만)',
    options: [{ type: 6, name: '유저', description: '관리자에서 뺄 사람', required: true }]
  }
].map((c) => ({ ...c, contexts: [0] }));   // 서버 안에서만 (DM 에서는 안 보여요)
