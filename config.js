module.exports = {
  TOKEN:                   process.env.TOKEN,
  CLIENT_ID:               process.env.CLIENT_ID,
  CLIENT_SECRET:           process.env.CLIENT_SECRET,
  PUBLIC_KEY:              process.env.PUBLIC_KEY,
  GUILD_ID:                process.env.GUILD_ID,
  TICKET_PANEL_CHANNEL_ID: process.env.TICKET_PANEL_CHANNEL_ID,
  LOG_CHANNEL_ID:          process.env.LOG_CHANNEL_ID,
  STAFF_ROLE_ID:           process.env.STAFF_ROLE_ID,
  STAFF_ROLE_ID2:          process.env.STAFF_ROLE_ID2,
  STAFF_ROLE_ID3:          process.env.STAFF_ROLE_ID3,

  // 구매문의/서버문의 전부 이 카테고리로 들어옴
  TICKET_CATEGORY_ID: '1476939501933695190',

  WEB_BASE_URL: process.env.WEB_BASE_URL,

  TICKET_OPTIONS: [
    {
      label: '구매 문의',
      description: '구매 문의는 이 티켓을 이용해 주세요',
      value: 'BUY',
      emoji: '🔒',
      channelPrefix: '구매문의',
    },
    {
      label: '서버 문의',
      description: '서버 관련 문의는 이 티켓을 이용해 주세요',
      value: 'SERVER',
      emoji: '🔧',
      channelPrefix: '서버문의',
    },
    {
      label: '스태프 지원',
      description: '스태프 지원 문의는 이 티켓을 이용해 주세요',
      value: 'SERVER',
      emoji: '💼',
      channelPrefix: '스태프지원',
    },
  ],
};
