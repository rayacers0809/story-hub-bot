const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  ChannelType,
  AttachmentBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
} = require('discord.js');

const { v4: uuidv4 } = require('uuid');
const config = require('./config');
const { initFirebase, getDb } = require('./firebase');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: ['CHANNEL', 'MESSAGE'],
});

initFirebase();

let ticketCounter = 0;
const dmMap = new Map();

// ─────────────────────────────────────────────
// Firestore에서 설정값 가져오기
// ─────────────────────────────────────────────
async function getSetting(key) {
  try {
    const doc = await getDb().collection('settings').doc(key).get();
    if (doc.exists) return doc.data().value;
  } catch {}
  return null;
}

async function setSetting(key, value) {
  await getDb().collection('settings').doc(key).set({ value });
}

// ─────────────────────────────────────────────
// 슬래시 커맨드 등록
// ─────────────────────────────────────────────
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('panel')
      .setDescription('티켓 패널 전송 (관리자 전용)'),

    new SlashCommandBuilder()
      .setName('설정')
      .setDescription('봇 설정 변경 (관리자 전용)')
      .addStringOption(o =>
        o.setName('항목')
          .setDescription('변경할 항목')
          .setRequired(true)
          .addChoices(
            { name: '계좌안내', value: '계좌안내' },
            { name: '결제동의서', value: '결제동의서' },
            { name: '느린문의', value: '느린문의' },
          )
      )
      .addStringOption(o =>
        o.setName('내용')
          .setDescription('변경할 내용 (링크 또는 텍스트)')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('설정확인')
      .setDescription('현재 설정값 확인 (관리자 전용)'),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(config.TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID), { body: commands });
    console.log('✅ 슬래시 커맨드 등록 완료');
  } catch (e) {
    console.error('커맨드 등록 실패:', e.message);
  }
}

// ─────────────────────────────────────────────
// 봇 준비
// ─────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} 온라인`);
  await registerCommands();
  try {
    const db = getDb();
    const metaDoc = await db.collection('meta').doc('counter').get();
    if (metaDoc.exists) {
      ticketCounter = metaDoc.data().value || 0;
      console.log(`📊 티켓 카운터 복원: ${ticketCounter}`);
    }
  } catch (e) {
    console.error('카운터 복원 실패:', e.message);
  }
});

// ─────────────────────────────────────────────
// Interaction 핸들러
// ─────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {

  // ── /panel ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ 관리자만 사용 가능합니다.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('📦 Story HUB 고객센터')
      .setDescription(
        '## 고객센터 안내사항\n\n' +
        '> 본 고객센터는 **스크립트, 디자인 등 다양한 디지털 상품**에 대한\n' +
        '> 구매 문의 및 서비스 이용 관련 문의를 접수하기 위한 공간입니다.\n\n' +
        '> 해당 채널을 악용하거나 용도 이외의 방법으로 사용하는 경우\n' +
        '> 관련 규정에 따라 **제재 처리**될 수 있습니다.\n\n' +
        '> 아래의 항목 중 해당되는 카테고리를 선택하여\n' +
        '> 고객센터 문의를 시작해 주세요.'
      )
      .setFooter({ text: 'Story HUB • 문의는 언제든지 환영합니다' })
      .setTimestamp();

    const buttons = config.TICKET_OPTIONS.map(opt =>
      new ButtonBuilder()
        .setCustomId(`ticket_btn:${opt.value}`)
        .setLabel(opt.label)
        .setEmoji(opt.emoji)
        .setStyle(ButtonStyle.Primary)
    );
    const row = new ActionRowBuilder().addComponents(buttons);
    const targetChannel = interaction.guild.channels.cache.get(config.TICKET_PANEL_CHANNEL_ID);
    if (!targetChannel) return interaction.reply({ content: '❌ TICKET_PANEL_CHANNEL_ID를 확인해주세요.', ephemeral: true });

    await targetChannel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: `✅ ${targetChannel} 에 패널 전송 완료!`, ephemeral: true });
  }

  // ── /설정 ──
  if (interaction.isChatInputCommand() && interaction.commandName === '설정') {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ 관리자만 사용 가능합니다.', ephemeral: true });
    }
    const 항목 = interaction.options.getString('항목');
    const 내용 = interaction.options.getString('내용');
    await setSetting(항목, 내용);
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('✅ 설정 완료')
        .addFields({ name: '항목', value: 항목, inline: true }, { name: '내용', value: 내용, inline: true })
        .setTimestamp()
      ],
      ephemeral: true
    });
  }

  // ── /설정확인 ──
  if (interaction.isChatInputCommand() && interaction.commandName === '설정확인') {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ 관리자만 사용 가능합니다.', ephemeral: true });
    }
    const [계좌, 동의서, 느린] = await Promise.all([
      getSetting('계좌안내'),
      getSetting('결제동의서'),
      getSetting('느린문의'),
    ]);
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle('📋 현재 설정값')
        .addFields(
          { name: '💳 계좌안내', value: 계좌 || '*(미설정)*', inline: false },
          { name: '📄 결제동의서', value: 동의서 || '*(미설정)*', inline: false },
          { name: '🐢 느린문의', value: 느린 || '*(미설정)*', inline: false },
        )
        .setTimestamp()
      ],
      ephemeral: true
    });
  }

  // ── Select Menu: 티켓 생성 ──
  if (interaction.isButton() && interaction.customId.startsWith('ticket_btn:')) {
    await interaction.deferReply({ flags: 64 });

    const selectedValue = interaction.customId.split(':')[1];
    const option = config.TICKET_OPTIONS.find(o => o.value === selectedValue);
    if (!option) return interaction.editReply({ content: '❌ 알 수 없는 옵션입니다.' });

    const guild = interaction.guild;
    const member = interaction.member;
    const categoryId = config.CATEGORIES[option.categoryKey];
    const category = guild.channels.cache.get(categoryId);

    if (!category) return interaction.editReply({ content: `❌ \`${option.label}\` 카테고리를 찾을 수 없습니다.` });

    if (dmMap.has(member.id)) {
      const existing = dmMap.get(member.id);
      const existingCh = guild.channels.cache.get(existing.channelId);
      return interaction.editReply({ content: `❌ 이미 진행중인 문의가 있습니다.${existingCh ? ` (${existingCh})` : ''}` });
    }

    ticketCounter++;
    const ticketId = uuidv4();

    try {
      await getDb().collection('meta').doc('counter').set({ value: ticketCounter });
    } catch (e) {
      console.error('카운터 저장 실패:', e);
    }

    const safeName = member.user.username.toLowerCase().replace(/[^a-z0-9가-힣]/g, '').slice(0, 12) || 'user';
    const channelName = `${option.value.toLowerCase()}-${safeName}-${member.user.id.slice(-4)}`;
    const ticketNum = String(ticketCounter).padStart(4, '0');

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: `ticketId:${ticketId} | userId:${member.id} | type:${option.value}`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: config.STAFF_ROLE_ID,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.ManageMessages,
          ],
        },
        {
          id: config.STAFF_ROLE_ID2,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.ManageMessages,
          ],
        },
        {
          id: config.STAFF_ROLE_ID3,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.ManageMessages,
          ],
        },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        },
      ],
    });

    dmMap.set(member.id, { ticketId, channelId: ticketChannel.id, type: option.value, typeLabel: option.label });

    const ticketData = {
      ticketId,
      ticketNumber: ticketCounter,
      channelId: ticketChannel.id,
      channelName,
      type: option.value,
      typeLabel: option.label,
      userId: member.id,
      userTag: member.user.tag,
      userDisplayName: member.displayName,
      guildId: guild.id,
      guildName: guild.name,
      status: 'open',
      createdAt: new Date().toISOString(),
      closedAt: null,
      closedBy: null,
      messages: [],
    };

    try {
      await getDb().collection('tickets').doc(ticketId).set(ticketData);
    } catch (e) {
      console.error('티켓 생성 Firestore 저장 실패:', e);
    }

    // ── 스탭 채널 안내 임베드 (2번째 사진 형식) ──
    await sendStaffGuide(ticketChannel, member, option, ticketNum, ticketId);

    // ── 유저 DM ──
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle(`${option.emoji} ${option.label} 문의 접수`)
        .setDescription(
          `안녕하세요 **${member.displayName}**님!\n\n` +
          `**[${option.label}]** 문의가 접수되었습니다 🩷\n\n` +
          `아래에 문의하실 내용을 입력해주세요.\n` +
          `스탭이 확인 후 이 DM으로 답변드리겠습니다.`
        )
        .setFooter({ text: 'StoryHUB • 이 DM에 메시지를 보내면 스탭에게 전달됩니다' })
        .setTimestamp();
      await member.user.send({ embeds: [dmEmbed] });
    } catch {
      await ticketChannel.send({
        embeds: [new EmbedBuilder().setColor(0xef4444).setDescription(`⚠️ **${member.user.tag}** 님의 DM이 차단되어 있어 메시지를 전송할 수 없습니다.`)]
      });
    }

    logAction(guild, `🎫 티켓 생성`, null, 0x22c55e, [
      { name: '유형', value: option.label, inline: true },
      { name: '생성자', value: member.user.tag, inline: true },
      { name: '채널', value: `${ticketChannel}`, inline: true },
      { name: '티켓 번호', value: `#${ticketNum}`, inline: true },
    ]);

    return interaction.editReply({ content: `✅ 문의가 접수되었습니다! DM을 확인해주세요 🩷` });
  }

  // ── 클레임 ──
  if (interaction.isButton() && interaction.customId.startsWith('ticket_claim:')) {
    const member = interaction.member;
    const isStaff = member.roles.cache.has(config.STAFF_ROLE_ID) || member.roles.cache.has(config.STAFF_ROLE_ID2) || member.roles.cache.has(config.STAFF_ROLE_ID3);
    if (!isStaff) return interaction.reply({ content: '❌ 스탭만 클레임할 수 있습니다.', flags: 64 });
    const ticketId = interaction.customId.split(':')[1];
    const claimEmbed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle('✋ 티켓 클레임')
      .setDescription(`**${member.user.tag}** 님이 이 티켓을 담당합니다.`)
      .setTimestamp();
    await interaction.reply({ embeds: [claimEmbed] });
    try {
      await getDb().collection('tickets').doc(ticketId).update({
        claimedBy: member.user.tag,
        claimedById: member.id,
        claimedAt: new Date().toISOString(),
      });
    } catch {}
    logAction(interaction.guild, `✋ 티켓 클레임`, null, 0xf59e0b, [
      { name: '채널', value: interaction.channel.name, inline: true },
      { name: '담당자', value: member.user.tag, inline: true },
    ]);
    return;
  }

  // ── 티켓 종료 버튼 ──
  if (interaction.isButton() && interaction.customId.startsWith('ticket_close:')) {
    const member = interaction.member;
    const isStaff = member.roles.cache.has(config.STAFF_ROLE_ID) || member.roles.cache.has(config.STAFF_ROLE_ID2) || member.roles.cache.has(config.STAFF_ROLE_ID3);
    if (!isStaff) {
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xef4444).setDescription('❌ 스탭만 티켓을 종료할 수 있습니다.')],
        flags: 64,
      });
    }
    const ticketId = interaction.customId.split(':')[1];
    await closeTicket(interaction.channel, ticketId, member, interaction);
  }
});

// ─────────────────────────────────────────────
// 스탭 채널 안내 임베드 전송
// ─────────────────────────────────────────────
async function sendStaffGuide(ticketChannel, member, option, ticketNum, ticketId) {
  // 최근 문의 내역 (Firestore에서 해당 유저의 최근 5개)
  let recentList = '없음';
  try {
    const db = getDb();
    const snap = await db.collection('tickets')
      .where('userId', '==', member.id)
      .where('status', '==', 'closed')
      .orderBy('closedAt', 'desc')
      .limit(4)
      .get();

    if (!snap.empty) {
      recentList = snap.docs.map(doc => {
        const d = doc.data();
        const date = new Date(d.closedAt);
        const label = `${String(date.getFullYear()).slice(2)}년 ${String(date.getMonth()+1).padStart(2,'0')}월 ${String(date.getDate()).padStart(2,'0')}일 문의내역`;
        return `[${label}](${config.WEB_BASE_URL}ticket/${d.ticketId})`;
      }).join('\n');
    }
  } catch {}

  // 안내 임베드
  const guideEmbed = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setAuthor({
      name: `${member.displayName} (${member.user.tag})`,
      iconURL: member.user.displayAvatarURL({ size: 64 }),
    })
    .setTitle('문의 관리 안내')
    .addFields(
      {
        name: '📢 문의 응대 안내',
        value: [
          '> 텍스트 앞에 `$`을 붙이고 채팅을 친다면 문의자에게 발송이 되지 않습니다. (`예시: $ @GM 도와주세요`)',
          '> 문의가 밀려 문의를 기다려야 할 경우 `.느린문의`를 입력해 주세요.',
          '> 항상 친절하고, 정확하게 전달을 중요시 하여야 합니다. 모르는 것이 있다면 담당 개발자 또는 관리자에게 질문 후 답변 부탁드리겠습니다.',
        ].join('\n'),
        inline: false,
      },
      {
        name: '🔒 문의 종료 안내',
        value: [
          '> `.문의종료`를 입력해 주세요.',
          '> 위의 문의종료가 정상적으로 작동 되지 않는다면 `.강제종료`를 입력해 주세요.',
        ].join('\n'),
        inline: false,
      },
      {
        name: '⌨️ 문의 명령어 안내',
        value: [
          '> `.느린문의 [초]` — 채널 슬로우모드를 설정합니다. (예: `.느린문의 30`)',
          '> `.계좌안내` — 전체 계좌 정보를 전송합니다.',
          '> `.수콩계좌` / `.바른각계좌` / `.현성계좌` / `.인찬계좌` — 개별 계좌 전송',
          '> `.결제동의서` — 결제동의서 링크를 전송합니다.',
        ].join('\n'),
        inline: false,
      },
      {
        name: '📋 최근 문의 내역',
        value: recentList,
        inline: false,
      },
    )
    .setFooter({ text: `StoryHUB • 티켓 #${ticketNum}` })
    .setTimestamp();

  // 스탭 알림 임베드
  const staffEmbed = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle(`${option.emoji} ${option.label} 티켓 #${ticketNum}`)
    .setDescription(
      `<@&${config.STAFF_ROLE_ID}> 새 문의가 접수되었습니다.\n\n` +
      `> 이 채널에서 답변을 입력하면 유저의 DM으로 자동 전달됩니다.`
    )
    .addFields(
      { name: '📋 문의 유형', value: option.label, inline: true },
      { name: '👤 유저', value: `${member.user.tag}`, inline: true },
      { name: '🆔 티켓 ID', value: `\`${ticketId}\``, inline: false },
    )
    .setFooter({ text: 'StoryHUB' })
    .setTimestamp();

  const closeBtn = new ButtonBuilder()
    .setCustomId(`ticket_close:${ticketId}`)
    .setLabel('🔒 티켓 종료')
    .setStyle(ButtonStyle.Danger);

  const claimBtn = new ButtonBuilder()
    .setCustomId(`ticket_claim:${ticketId}`)
    .setLabel('✋ 클레임')
    .setStyle(ButtonStyle.Secondary);

  const btnRow = new ActionRowBuilder().addComponents(claimBtn, closeBtn);

  await ticketChannel.send({ embeds: [staffEmbed], components: [btnRow] });
  await ticketChannel.send({ embeds: [guideEmbed] });
}

// ─────────────────────────────────────────────
// 메시지 핸들러
// ─────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ── DM: 유저 → 스탭 채널 릴레이 ──
  if (message.channel.type === ChannelType.DM) {
    const ticketInfo = dmMap.get(message.author.id);
    if (!ticketInfo) {
      return message.reply({
        embeds: [new EmbedBuilder().setColor(0xef4444).setDescription('❌ 진행중인 문의가 없습니다.\n서버에서 티켓을 먼저 생성해주세요.')]
      });
    }

    // DM에서 . 명령어 차단
    if (message.content.trim().startsWith('.')) {
      return message.reply({
        embeds: [new EmbedBuilder().setColor(0xef4444).setDescription('❌ 해당 명령어는 스탭만 사용 가능합니다.')]
      });
    }

    const guild = client.guilds.cache.get(config.GUILD_ID);
    if (!guild) return;
    const ticketChannel = guild.channels.cache.get(ticketInfo.channelId);
    if (!ticketChannel) return;

    const relayEmbed = new EmbedBuilder()
      .setColor(0x6366f1)
      .setAuthor({
        name: `${message.author.tag} (유저)`,
        iconURL: message.author.displayAvatarURL({ size: 64 }),
      })
      .setDescription(message.content || '(첨부파일)')
      .setTimestamp();

    const files = message.attachments.map(a => a.url);
    await ticketChannel.send({ embeds: [relayEmbed], files });
    await message.react('✅').catch(() => {});

    try {
      const db = getDb();
      const ticketDoc = await db.collection('tickets').doc(ticketInfo.ticketId).get();
      if (ticketDoc.exists) {
        const msgs = ticketDoc.data().messages || [];
        msgs.push({
          authorId: message.author.id,
          authorTag: message.author.tag,
          authorAvatar: message.author.displayAvatarURL({ size: 64 }),
          content: message.content || '',
          attachments: files,
          isBot: false,
          from: 'user',
          timestamp: new Date().toISOString(),
        });
        await db.collection('tickets').doc(ticketInfo.ticketId).update({ messages: msgs });
      }
    } catch (e) {
      console.error('메시지 저장 실패:', e);
    }
    return;
  }

  // ── 스탭 채널 메시지 ──
  if (message.guild && message.guild.id === config.GUILD_ID) {
    const channel = message.channel;
    if (!channel.topic || !channel.topic.includes('ticketId:')) return;

    const isStaff = (
      message.member?.roles.cache.has(config.STAFF_ROLE_ID) ||
      message.member?.roles.cache.has(config.STAFF_ROLE_ID2) ||
      message.member?.roles.cache.has(config.STAFF_ROLE_ID3)
    );
    if (!isStaff) return;

    const content = message.content.trim();
    const ticketId = channel.topic.match(/ticketId:([a-f0-9-]+)/)?.[1];
    const userId = channel.topic.match(/userId:(\d+)/)?.[1];

    // ── .문의종료 / !종료 ──
    if (content === '.문의종료' || content === '!종료') {
      if (ticketId) await closeTicket(channel, ticketId, message.member, null, message);
      return;
    }

    // ── ! 로 시작하면 스탭 내부 메시지 (유저에게 안 보냄) ──
    if (content.startsWith('!')) {
      await message.react('🔕').catch(() => {});
      return;
    }

    // ── .강제종료 (유저가 서버 나간 경우 등 강제 삭제) ──
    if (content === '.강제종료') {
      const forceEmbed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle('⚠️ 강제 종료')
        .setDescription(`**${message.member.user.tag}** 님이 티켓을 강제 종료합니다.
잠시 후 채널이 삭제됩니다.`)
        .setTimestamp();
      await channel.send({ embeds: [forceEmbed] });

      // Firestore 업데이트
      if (ticketId) {
        const logUrl = `${config.WEB_BASE_URL}ticket/${ticketId}`;
        try {
          await getDb().collection('tickets').doc(ticketId).update({
            status: 'closed',
            closedAt: new Date().toISOString(),
            closedBy: message.member.user.tag,
            closedById: message.member.id,
            closeType: 'force',
            logUrl,
          });
        } catch {}
        // dmMap에서 제거 (userId 기반)
        if (userId) dmMap.delete(userId);
        // 로그
        logAction(channel.guild, '⚠️ 티켓 강제종료', null, 0xef4444, [
          { name: '채널', value: channel.name, inline: true },
          { name: '닫은 사람', value: message.member.user.tag, inline: true },
          { name: '로그', value: logUrl, inline: false },
        ]);
      }
      setTimeout(() => channel.delete().catch(() => {}), 3000);
      return;
    }

    // ── .느린문의 [초] ──
    if (content.startsWith('.느린문의')) {
      const parts = content.split(' ');
      const seconds = parseInt(parts[1]) || 0;
      try {
        await channel.setRateLimitPerUser(seconds);
        const embed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle('🐢 슬로우모드 설정')
          .setDescription(seconds === 0 ? '슬로우모드가 **해제**되었습니다.' : `슬로우모드가 **${seconds}초**로 설정되었습니다.`)
          .setFooter({ text: 'StoryHUB' })
          .setTimestamp();
        await channel.send({ embeds: [embed] });
      } catch (e) {
        await message.reply({ content: '⚠️ 슬로우모드 설정 실패: ' + e.message });
      }
      await message.react('🐢').catch(() => {});
      return;
    }

    // ── .계좌안내 (전체) ──
    if (content === '.계좌안내') {
      const accounts = [
        '> 💙 **토스뱅크** 1000-0583-1654 ( 수콩 )',
        '> 🏦 **기업은행** 98005533201015 ( 바른각 )',
        '> 💚 **케이뱅크** 100115502126 ( 현성 )',
        '> 🔴 **신한은행** 110440034614 ( 인찬 )',
      ].join('\n');
      if (userId) {
        try {
          const user = await client.users.fetch(userId);
          const embed = new EmbedBuilder()
            .setColor(0x7c3aed)
            .setAuthor({ name: 'StoryHUB 스탭', iconURL: client.user.displayAvatarURL() })
            .setTitle('💳 계좌 안내')
            .setDescription(accounts)
            .setFooter({ text: 'StoryHUB' })
            .setTimestamp();
          await user.send({ embeds: [embed] });
        } catch {}
      }
      await message.react('💳').catch(() => {});
      return;
    }

    // ── .수콩계좌 ──
    if (content === '.수콩계좌') {
      if (userId) {
        try {
          const user = await client.users.fetch(userId);
          const embed = new EmbedBuilder()
            .setColor(0x7c3aed)
            .setAuthor({ name: 'StoryHUB 스탭', iconURL: client.user.displayAvatarURL() })
            .setTitle('💳 계좌 안내')
            .setDescription('> 💙 **토스뱅크** 1000-0583-1654 ( 수콩 )')
            .setFooter({ text: 'StoryHUB' })
            .setTimestamp();
          await user.send({ embeds: [embed] });
        } catch {}
      }
      await message.react('💳').catch(() => {});
      return;
    }

    // ── .바른각계좌 ──
    if (content === '.바른각계좌') {
      if (userId) {
        try {
          const user = await client.users.fetch(userId);
          const embed = new EmbedBuilder()
            .setColor(0x7c3aed)
            .setAuthor({ name: 'StoryHUB 스탭', iconURL: client.user.displayAvatarURL() })
            .setTitle('💳 계좌 안내')
            .setDescription('> 🏦 **기업은행** 98005533201015 ( 바른각 )')
            .setFooter({ text: 'StoryHUB' })
            .setTimestamp();
          await user.send({ embeds: [embed] });
        } catch {}
      }
      await message.react('💳').catch(() => {});
      return;
    }

    // ── .현성계좌 ──
    if (content === '.현성계좌') {
      if (userId) {
        try {
          const user = await client.users.fetch(userId);
          const embed = new EmbedBuilder()
            .setColor(0x7c3aed)
            .setAuthor({ name: 'StoryHUB 스탭', iconURL: client.user.displayAvatarURL() })
            .setTitle('💳 계좌 안내')
            .setDescription('> 💚 **케이뱅크** 100115502126 ( 현성 )')
            .setFooter({ text: 'StoryHUB' })
            .setTimestamp();
          await user.send({ embeds: [embed] });
        } catch {}
      }
      await message.react('💳').catch(() => {});
      return;
    }

    // ── .인찬계좌 ──
    if (content === '.인찬계좌') {
      if (userId) {
        try {
          const user = await client.users.fetch(userId);
          const embed = new EmbedBuilder()
            .setColor(0x7c3aed)
            .setAuthor({ name: 'StoryHUB 스탭', iconURL: client.user.displayAvatarURL() })
            .setTitle('💳 계좌 안내')
            .setDescription('> 🔴 **신한은행** 110440034614 ( 인찬 )')
            .setFooter({ text: 'StoryHUB' })
            .setTimestamp();
          await user.send({ embeds: [embed] });
        } catch {}
      }
      await message.react('💳').catch(() => {});
      return;
    }

    // ── .결제동의서 ──
    if (content === '.결제동의서') {
      const link = await getSetting('결제동의서') || '결제동의서 링크가 설정되지 않았습니다. `/설정 결제동의서`로 설정해주세요.';
      if (userId) {
        try {
          const user = await client.users.fetch(userId);
          const embed = new EmbedBuilder()
            .setColor(0x7c3aed)
            .setAuthor({ name: 'StoryHUB 스탭', iconURL: client.user.displayAvatarURL() })
            .setTitle('📄 결제동의서')
            .setDescription(`아래 링크를 통해 결제동의서를 확인해주세요.\n\n${link}`)
            .setFooter({ text: 'StoryHUB' })
            .setTimestamp();
          await user.send({ embeds: [embed] });
        } catch {}
      }
      await message.react('📄').catch(() => {});
      return;
    }

    // ── 일반 스탭 답변 → 유저 DM 릴레이 ──
    if (!userId) return;
    try {
      const user = await client.users.fetch(userId);
      const replyEmbed = new EmbedBuilder()
        .setColor(0xa78bfa)
        .setAuthor({ name: 'StoryHUB 스탭', iconURL: client.user.displayAvatarURL() })
        .setDescription(message.content || '(첨부파일)')
        .setFooter({ text: 'StoryHUB • 이 메시지에 답장하면 스탭에게 전달됩니다' })
        .setTimestamp();

      const fileAttachments = message.attachments.map(a => new AttachmentBuilder(a.url, { name: a.name }));
      await user.send({ embeds: [replyEmbed], files: fileAttachments.length > 0 ? fileAttachments : [] });
      await message.react('📨').catch(() => {});

      if (ticketId) {
        try {
          const db = getDb();
          const ticketDoc = await db.collection('tickets').doc(ticketId).get();
          if (ticketDoc.exists) {
            const msgs = ticketDoc.data().messages || [];
            msgs.push({
              authorId: message.author.id,
              authorTag: message.author.tag,
              authorAvatar: message.author.displayAvatarURL({ size: 64 }),
              content: message.content || '',
              attachments: message.attachments.map(a => a.url),
              isBot: false,
              from: 'staff',
              timestamp: new Date().toISOString(),
            });
            await db.collection('tickets').doc(ticketId).update({ messages: msgs });
          }
        } catch {}
      }
    } catch {
      await message.reply({ content: '⚠️ 유저 DM 전송 실패 (DM이 차단되어 있을 수 있습니다)' });
    }
  }
});

// ─────────────────────────────────────────────
// 티켓 종료
// ─────────────────────────────────────────────
async function closeTicket(channel, ticketId, member, interaction = null, message = null) {
  const closingEmbed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('🔒 티켓 종료 중')
    .setDescription(`**${member.user.tag}** 님이 티켓을 종료합니다.\n잠시 후 채널이 삭제됩니다.`)
    .setTimestamp();

  if (interaction) await interaction.reply({ embeds: [closingEmbed] });
  else if (message) await channel.send({ embeds: [closingEmbed] });

  const logUrl = `${config.WEB_BASE_URL}ticket/${ticketId}`;
  try {
    await getDb().collection('tickets').doc(ticketId).update({
      status: 'closed',
      closedAt: new Date().toISOString(),
      closedBy: member.user.tag,
      closedById: member.id,
      logUrl,
    });
  } catch (e) {
    console.error('티켓 종료 저장 실패:', e);
  }

  const userId = channel.topic?.match(/userId:(\d+)/)?.[1];
  if (userId) dmMap.delete(userId);

  if (userId) {
    try {
      const user = await client.users.fetch(userId);
      const dmEmbed = new EmbedBuilder()
        .setColor(0x7c3aed)
        .setTitle('✅ 문의 종료')
        .setDescription('문의가 종료되었습니다.\n이용해주셔서 감사합니다 🩷')
        .setFooter({ text: 'StoryHUB' })
        .setTimestamp();
      await user.send({ embeds: [dmEmbed] });
    } catch {}
  }

  const guild = channel.guild;
  const logChannel = guild.channels.cache.get(config.LOG_CHANNEL_ID);
  if (logChannel) {
    const logEmbed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('🔒 티켓 종료 — 로그 저장됨')
      .addFields(
        { name: '📋 채널', value: channel.name, inline: true },
        { name: '👤 닫은 사람', value: member.user.tag, inline: true },
        { name: '🔗 로그 링크', value: logUrl, inline: false },
      )
      .setFooter({ text: 'StoryHUB' })
      .setTimestamp();
    logChannel.send({ embeds: [logEmbed] });
  }

  logAction(guild, `🔒 티켓 닫힘`, null, 0xef4444, [
    { name: '채널', value: channel.name, inline: true },
    { name: '닫은 사람', value: member.user.tag, inline: true },
    { name: '로그', value: logUrl, inline: false },
  ]);

  setTimeout(() => channel.delete().catch(() => {}), 5000);
}

// ─────────────────────────────────────────────
// 로그 헬퍼
// ─────────────────────────────────────────────
async function logAction(guild, title, description, color, fields = []) {
  const logChannel = guild.channels.cache.get(config.LOG_CHANNEL_ID);
  if (!logChannel) return;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: 'StoryHUB' })
    .setTimestamp();
  if (description) embed.setDescription(description);
  if (fields.length > 0) embed.addFields(fields);
  logChannel.send({ embeds: [embed] }).catch(() => {});
}

client.login(config.TOKEN);
