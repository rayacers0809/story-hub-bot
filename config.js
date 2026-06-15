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

  // 모든 문의가 들어올 단일 카테고리
  TICKET_CATEGORY_ID: '1476939501933695190',

  WEB_BASE_URL: process.env.WEB_BASE_URL,

  // 버튼 1개로 통합
  TICKET_OPTIONS: [
    {
      label: '문의하기',
      description: '문의는 이 버튼을 이용해 주세요',
      value: 'INQUIRY',
      emoji: '📩',
      channelPrefix: '문의',
    },
  ],
};
