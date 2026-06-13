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

// userId → ticketId 맵핑 (DM 릴레이용)
// { userId: { ticketId, channelId } }
const dmMap = new Map();

// ─────────────────────────────────────────────
// 봇 준비
// ─────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`✅ ${client.user.tag} 온라인`);
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

  // ── /panel 슬래시 커맨드 ──
  if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
    if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: '❌ 관리자만 사용 가능합니다.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle('🌸 StoryHUB 구매티켓')
      .setDescription(
        '스토리샵은 운영중입니다 편하게 문의주세요 🩷\n' +
        '🐾 구매는 아래 티켓을 눌러 필요한 문의를 선택해주세요.'
      )
      .setFooter({ text: 'StoryHUB • 24시간 운영' })
      .setTimestamp();

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_select')
      .setPlaceholder('선택하기')
      .addOptions(
        config.TICKET_OPTIONS.map((opt) => ({
          label: opt.label,
          description: opt.description,
          value: opt.value,
          emoji: opt.emoji,
        }))
      );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const targetChannel = interaction.guild.channels.cache.get(config.TICKET_PANEL_CHANNEL_ID);

    if (!targetChannel) {
      return interaction.reply({ content: '❌ TICKET_PANEL_CHANNEL_ID를 확인해주세요.', ephemeral: true });
    }

    await targetChannel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: `✅ ${targetChannel} 에 패널 전송 완료!`, ephemeral: true });
  }

  // ── Select Menu: 티켓 유형 선택 ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_select') {
    await interaction.deferReply({ flags: 64 });

    const selectedValue = interaction.values[0];
    const option = config.TICKET_OPTIONS.find((o) => o.value === selectedValue);
    if (!option) return interaction.editReply({ content: '❌ 알 수 없는 옵션입니다.' });

    const guild = interaction.guild;
    const member = interaction.member;
    const categoryId = config.CATEGORIES[option.categoryKey];
    const category = guild.channels.cache.get(categoryId);

    if (!category) {
      return interaction.editReply({ content: `❌ \`${option.label}\` 카테고리를 찾을 수 없습니다.` });
    }

    // 중복 티켓 체크
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

    // 티켓 채널 생성 (스탭만 보임)
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: `ticketId:${ticketId} | userId:${member.id} | type:${option.value}`,
      permissionOverwrites: [
        // @everyone 차단
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        // 스탭 역할 허용
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
        // STAFF_ROLE_ID2도 허용
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
        // 봇 자신 허용
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

    // dmMap에 등록
    dmMap.set(member.id, { ticketId, channelId: ticketChannel.id, type: option.value, typeLabel: option.label });

    // Firestore 저장
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

    // ── 스탭 채널 임베드 ──
    const staffEmbed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setAuthor({
        name: `${member.displayName} (${member.user.tag})`,
        iconURL: member.user.displayAvatarURL({ size: 64 }),
      })
      .setTitle(`${option.emoji} ${option.label} 티켓 #${ticketNum}`)
      .setDescription(
        `<@&${config.STAFF_ROLE_ID}> 새 문의가 접수되었습니다.\n\n` +
        `> 이 채널에서 답변을 입력하면 유저의 DM으로 자동 전달됩니다.\n` +
        `> 채널에서 \`!종료\` 입력 시 티켓이 종료됩니다.`
      )
      .addFields(
        { name: '📋 문의 유형', value: option.label, inline: true },
        { name: '👤 유저', value: `${member.user.tag}`, inline: true },
        { name: '🆔 티켓 ID', value: `\`${ticketId}\``, inline: false },
      )
      .setFooter({ text: 'StoryHUB • 채널에 입력한 메시지가 유저 DM으로 전달됩니다' })
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

    // ── 유저 DM 전송 ──
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
      // DM 차단한 경우
      await ticketChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setDescription(`⚠️ **${member.user.tag}** 님의 DM이 차단되어 있어 메시지를 전송할 수 없습니다.`)
        ]
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

  // ── Button: 클레임 (스탭만) ──
  if (interaction.isButton() && interaction.customId.startsWith('ticket_claim:')) {
    const member = interaction.member;
    const isStaff = (member.roles.cache.has(config.STAFF_ROLE_ID) || member.roles.cache.has(config.STAFF_ROLE_ID2));
    if (!isStaff) {
      return interaction.reply({ content: '❌ 스탭만 클레임할 수 있습니다.', flags: 64 });
    }
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

  // ── Button: 티켓 종료 (스탭만) ──
  if (interaction.isButton() && interaction.customId.startsWith('ticket_close:')) {
    const member = interaction.member;
    const isStaff = (member.roles.cache.has(config.STAFF_ROLE_ID) || member.roles.cache.has(config.STAFF_ROLE_ID2));
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
// 메시지 핸들러 (DM 릴레이 + 스탭 답변 릴레이)
// ─────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // ── DM: 유저 → 스탭 채널 릴레이 ──
  if (message.channel.type === ChannelType.DM) {
    const ticketInfo = dmMap.get(message.author.id);
    if (!ticketInfo) {
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xef4444)
            .setDescription('❌ 진행중인 문의가 없습니다.\n서버에서 티켓을 먼저 생성해주세요.')
        ]
      });
    }

    const guild = client.guilds.cache.get(config.GUILD_ID);
    if (!guild) return;
    const ticketChannel = guild.channels.cache.get(ticketInfo.channelId);
    if (!ticketChannel) return;

    // 스탭 채널에 유저 메시지 릴레이 (일반 텍스트)
    const files = message.attachments.map(a => a.url);
    const relayContent = `<@${message.author.id}>(${message.author.id}) : ${message.content || ''}`.trim();
    await ticketChannel.send({ content: relayContent, files });

    // 유저에게 확인 이모지
    await message.react('✅').catch(() => {});

    // Firestore 메시지 기록
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

  // ── 스탭 채널: 답변 → 유저 DM 릴레이 ──
  if (message.guild && message.guild.id === config.GUILD_ID) {
    const channel = message.channel;
    if (!channel.topic || !channel.topic.includes('ticketId:')) return;

    const isStaff = (
      message.member?.roles.cache.has(config.STAFF_ROLE_ID) ||
      message.member?.roles.cache.has(config.STAFF_ROLE_ID2)
    );
    if (!isStaff) return;

    // !종료 명령어
    if (message.content.trim() === '!종료') {
      const ticketId = channel.topic.match(/ticketId:([a-f0-9-]+)/)?.[1];
      if (ticketId) await closeTicket(channel, ticketId, message.member, null, message);
      return;
    }

    // 스탭 답변 → 유저 DM
    const userId = channel.topic.match(/userId:(\d+)/)?.[1];
    if (!userId) return;

    try {
      const user = await client.users.fetch(userId);
      const replyEmbed = new EmbedBuilder()
        .setColor(0xa78bfa)
        .setAuthor({ name: 'StoryHUB 스탭', iconURL: client.user.displayAvatarURL() })
        .setDescription(message.content || '(첨부파일)')
        .setFooter({ text: 'StoryHUB • 이 메시지에 답장하면 스탭에게 전달됩니다' })
        .setTimestamp();

      // 첨부파일을 Attachment 객체로 변환해서 재전송
      const { AttachmentBuilder } = require('discord.js');
      const fileAttachments = message.attachments.map(a =>
        new AttachmentBuilder(a.url, { name: a.name })
      );
      await user.send({
        embeds: [replyEmbed],
        files: fileAttachments.length > 0 ? fileAttachments : [],
      });

      // 전송 확인 이모지
      await message.react('📨').catch(() => {});

      // Firestore 메시지 기록
      const ticketId = channel.topic.match(/ticketId:([a-f0-9-]+)/)?.[1];
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
              attachments: files,
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
// 티켓 종료 함수
// ─────────────────────────────────────────────
async function closeTicket(channel, ticketId, member, interaction = null, message = null) {
  const closingEmbed = new EmbedBuilder()
    .setColor(0xef4444)
    .setTitle('🔒 티켓 종료 중')
    .setDescription(`**${member.user.tag}** 님이 티켓을 종료합니다.\n잠시 후 채널이 삭제됩니다.`)
    .setTimestamp();

  if (interaction) {
    await interaction.reply({ embeds: [closingEmbed] });
  } else if (message) {
    await channel.send({ embeds: [closingEmbed] });
  }

  // Firestore 업데이트
  const logUrl = `${config.WEB_BASE_URL}/ticket/${ticketId}`;
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

  // dmMap에서 제거
  const userId = channel.topic?.match(/userId:(\d+)/)?.[1];
  if (userId) dmMap.delete(userId);

  // 유저에게 종료 DM (로그 링크 없음)
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

  // 로그 채널에 링크 전송
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
