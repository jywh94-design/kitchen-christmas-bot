const { EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const cfg = require('./config');
const {
  pool,
  getUserTicketSummary,
  getEventWindow,
} = require('./db');
const { nextTier, entryNeededForMaxWinners } = require('./rules');
const { createSession, buildResultEmbed, startVote } = require('./draw');
const { buildReport } = require('./report');
const { renderTicketImage } = require('./ticketImage');
const { isExcluded } = require('./excluded');
const { buildBackup } = require('./backup');
const { getRanking, rankOf, invalidateRankCache, fetchAvatar } = require('./ranking');

const EPHEMERAL = MessageFlags.Ephemeral;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hoursText = (sec) => (sec / 3600).toFixed(1);

// 进度百分比（保留 1 位小数，最多 100%）
function pctNum(value, max) {
  return Math.min(100, Math.floor((value / max) * 1000) / 10);
}
// 显示成「50.5/100%」
function pctOf(value, max) {
  return `${pctNum(value, max)}/100%`;
}

// 文字进度条：pct 是 0-100
function progressBar(pct, len = 10) {
  const filled = Math.round((pct / 100) * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

async function handleCommand(interaction) {
  switch (interaction.commandName) {
    case 'my-tickets':
      return cmdMyTickets(interaction);
    case 'rank':
      return cmdRank(interaction);
    case 'help-event':
      return cmdHelpEvent(interaction);
    case 'draw-christmas':
      return cmdDraw(interaction);
    case 'test-simulate':
      return cmdTestSimulate(interaction);
  }
}

// =====================================================================
// /my-tickets
// =====================================================================
async function cmdMyTickets(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  if (isExcluded(interaction.user.id)) {
    return interaction.editReply('这个账号不参与本次活动，所以没有幸运签记录。');
  }
  const s = await getUserTicketSummary(interaction.user.id);
  const maxTotal = cfg.MAX_BASE_TICKETS + cfg.MAX_INVITE_TICKETS;

  // 入场进度：0% - 100% 进度条
  const entryPct = Math.min(100, Math.floor((s.validDays / cfg.ENTRY_VALID_DAYS) * 100));
  const entryText = `${progressBar(entryPct)} **${entryPct}%**${entryPct >= 100 ? ' ✅' : ''}`;

  let progress = null;
  if (s.unlockedEntry) {
    const nd = nextTier(cfg.STREAK_DAY_TIERS, s.validDays);
    progress = [
      nd ? `• 有效打卡日：**${s.validDays}** 天，下一档 ${nd} 天` : `• 有效打卡日：**${s.validDays}** 天（已满档）`,
      `• 有效语音：${pctOf(s.voiceSeconds, cfg.VOICE_HOUR_TIERS[cfg.VOICE_HOUR_TIERS.length - 1] * 3600)}`,
      `• 有效聊天：${pctOf(s.validMessages, cfg.TOTAL_MESSAGE_TIERS[cfg.TOTAL_MESSAGE_TIERS.length - 1])}`,
      `• 有效拉新：**${Math.min(s.verifiedInvites, cfg.MAX_INVITE_TICKETS)}/${cfg.MAX_INVITE_TICKETS}** 位`,
    ].join('\n');
  }

  let hint = '继续保持日常开麦开黑或正常聊天，就能不断往签筒里加签。';
  if (!s.unlockedEntry) {
    hint = '多来语音频道玩几局或聊聊天，先把入场签拿到。';
  } else if (s.totalTickets >= maxTotal) {
    hint = `你已经拿满全部 **${maxTotal} 张**幸运签，等圣诞夜开奖吧。`;
  } else if (s.baseTickets >= cfg.MAX_BASE_TICKETS) {
    hint = `日常签已满 ${cfg.MAX_BASE_TICKETS} 张。邀请朋友入伙并一起互动，还能额外再加最多 ${cfg.MAX_INVITE_TICKETS} 张。`;
  }

  const footer = cfg.TEST_FAST
    ? '快速测试模式已开启，门槛已放宽，仅用于实测'
    : '统计 12月1日-12月23日 | 闭麦挂机与水贴不计入';

  // 优先发图片卡片；出图失败就退回文字卡片，保证一定有回复
  try {
    const nd = s.unlockedEntry ? nextTier(cfg.STREAK_DAY_TIERS, s.validDays) : null;
    // 优先用他在服务器里设置的头像，没有就用个人头像
    const who = interaction.member?.displayAvatarURL ? interaction.member : interaction.user;
    const avatarUrl = who.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true });
    const buf = await renderTicketImage({
      username: interaction.user.username,
      avatar: await fetchAvatar(avatarUrl),
      total: s.totalTickets,
      maxTotal,
      base: s.baseTickets,
      maxBase: cfg.MAX_BASE_TICKETS,
      invite: s.bonusInviteTickets,
      maxInvite: cfg.MAX_INVITE_TICKETS,
      entryPct,
      rows: s.unlockedEntry
        ? [
            nd ? `${s.validDays}/${nd} 天` : `${s.validDays} 天（满档）`,
            `${pctOf(s.voiceSeconds, cfg.VOICE_HOUR_TIERS[cfg.VOICE_HOUR_TIERS.length - 1] * 3600)}`,
            `${pctOf(s.validMessages, cfg.TOTAL_MESSAGE_TIERS[cfg.TOTAL_MESSAGE_TIERS.length - 1])}`,
            `${Math.min(s.verifiedInvites, cfg.MAX_INVITE_TICKETS)}/${cfg.MAX_INVITE_TICKETS} 位`,
          ]
        : null,
      hint,
      footer,
    });
    return await interaction.editReply({ files: [new AttachmentBuilder(buf, { name: 'my-tickets.png' })] });
  } catch (err) {
    console.error('签筒图片生成失败，改发文字卡片:', err.message);
  }

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🎟️ 我的圣诞厨房幸运签筒')
    .setDescription(`你好 **${interaction.user.username}**，这是你目前的攒签状态：`)
    .addFields(
      { name: '当前总幸运签', value: `**${s.totalTickets}/${maxTotal}**`, inline: true },
      { name: '日常签', value: `**${s.baseTickets}/${cfg.MAX_BASE_TICKETS}**`, inline: true },
      { name: '拉新签', value: `**${s.bonusInviteTickets}/${cfg.MAX_INVITE_TICKETS}**`, inline: true },
      { name: '入场进度', value: entryText }
    );
  if (progress) embed.addFields({ name: '下一档进度', value: progress });
  embed
    .addFields({ name: '小贴士', value: hint })
    .setFooter({
      text: cfg.TEST_FAST
        ? '⚠️ 快速测试模式已开启，门槛已放宽，仅用于实测'
        : '统计周期：12月1日 - 12月23日 | 闭麦挂机与水贴不计入统计',
    });

  return interaction.editReply({ embeds: [embed] });
}

// =====================================================================
// /rank：查看排行榜图片和自己的名次
// =====================================================================
async function cmdRank(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const data = await getRanking(interaction.guild);
  const me = rankOf(data, interaction.user.id);
  const line = me
    ? `你目前排第 **${me.rank}** 名，共 **${me.tickets}** 张签（全服 ${data.totalEntryUsers} 人入场）。`
    : '你还没解锁入场，暂时不在排行榜上。';
  return interaction.editReply({
    content: `${line}\n排名只是热度展示，最终得奖仍按签数抽签决定。`,
    files: [new AttachmentBuilder(data.image, { name: 'ranking.png' })],
  });
}

// =====================================================================
// /help-event（数字全部从 config.js 读取，改规则后这里自动同步）
// =====================================================================
async function cmdHelpEvent(interaction) {
  const maxTotal = cfg.MAX_BASE_TICKETS + cfg.MAX_INVITE_TICKETS;
  const first = cfg.WINNERS_FIRST_STEP_ENTRY;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('🎄 圣诞厨房寻宝季 · 活动规则')
    .setDescription(
      `**12月1日 — 12月23日**，常回厨房开麦、聊天或带朋友入伙，就能自动攒幸运签，圣诞夜直播抽奖，最多抽出 **${cfg.CHRISTMAS_WINNERS_COUNT} 份**礼物。`
    )
    .addFields(
      {
        name: '✅ 什么算有效活跃',
        value:
          `当天开麦满 **${cfg.DAILY_VOICE_MINUTES} 分钟**，或有效聊天满 **${cfg.DAILY_MESSAGES} 条**，算 1 个有效打卡日。\n` +
          `开麦指没闭麦、没关听筒，且频道里至少有 ${cfg.MIN_VOICE_HUMANS} 位这样的真人。聊天每条至少 ${cfg.MIN_MESSAGE_LENGTH} 个字，${cfg.MESSAGE_COOLDOWN_SEC} 秒最多记 1 条。`,
      },
      {
        name: `🎟️ 日常签（最多 ${cfg.MAX_BASE_TICKETS} 签）`,
        value: [
          `• 累计 ${cfg.ENTRY_VALID_DAYS} 个有效日：解锁入场，得 1 签，自动获得身份组`,
          `• 累计 ${cfg.STREAK_DAY_TIERS.join('、')} 个有效日：每档 +1 签`,
          `• 累计有效语音 ${cfg.VOICE_HOUR_TIERS.join('、')} 小时：每档 +1 签`,
          `• 累计有效聊天 ${cfg.TOTAL_MESSAGE_TIERS.join('、')} 条：每档 +1 签`,
        ].join('\n'),
      },
      {
        name: `🤝 拉新签（额外最多 +${cfg.MAX_INVITE_TICKETS} 签，个人最高 ${maxTotal} 签）`,
        value: `用你的邀请链接拉朋友入群，朋友入群后有效活跃满 ${cfg.INVITE_VERIFY_DAYS} 天，算 1 位有效拉新，+1 签。朋友在开奖前退群，这张签作废。`,
      },
      {
        name: '🎁 得奖名额与开奖',
        value: [
          `• 入场不满 ${first} 人抽 ${cfg.WINNERS_BASE} 位，满 ${first} 人抽 ${cfg.WINNERS_BASE + 1} 位，之后每多 ${cfg.WINNERS_STEP_USERS} 人加 1 位，满 ${entryNeededForMaxWinners()} 人抽满 ${cfg.CHRISTMAS_WINNERS_COUNT} 位`,
          `• 入场满 ${cfg.UPGRADE_ENTRY_THRESHOLD} 人：最先抽出的 ${cfg.UPGRADE_TOP_COUNT} 位升级为「主厨豪华至尊大礼」`,
          `• **12月24日 20:00** 用幸运转盘在直播语音频道开奖，被抽到后 ${cfg.DRAW_CLAIM_SECONDS} 秒内要在场，否则当场重抽`,
          '• 每人限中 1 份，签越多机会越大',
        ].join('\n'),
      },
      {
        name: '🏆 每日排行',
        value: '每天 00:00 公布签数前 9 名；签数相同时，比有效打卡天数，再比语音时长。排行只是热度展示，得奖仍按签数抽签决定。输入 `/rank` 随时查看自己的名次。',
      },
      {
        name: '⚠️ 公平说明',
        value: '闭麦挂机、一个人占房、刷屏水贴不计入；小号、互刷、恶意拉新取消资格。最终解释权归主厨。',
      }
    );

  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

// =====================================================================
// /draw-christmas：创建一场幸运转盘开奖，把转盘网页链接私下发给管理员
// =====================================================================
function publicBaseUrl() {
  const raw =
    process.env.PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  return raw.replace(/\/+$/, '');
}

async function cmdDraw(interaction) {
  const testMode = interaction.options.getBoolean('test') ?? false;
  let voiceChannel = null;

  if (!testMode) {
    if (Date.now() <= getEventWindow().end) {
      return interaction.reply({
        content: '⏳ 统计还没截止，12月23日 23:59 之后才能正式开奖。想先预演，请把 `test` 选项选 True。',
        flags: EPHEMERAL,
      });
    }
    const channelId = process.env.DRAW_VOICE_CHANNEL_ID;
    if (channelId) voiceChannel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!voiceChannel || !voiceChannel.isVoiceBased()) {
      return interaction.reply({
        content: '❌ 没找到直播语音频道。请在 Railway 变量里设置 `DRAW_VOICE_CHANNEL_ID`（直播开奖的语音频道 ID）。',
        flags: EPHEMERAL,
      });
    }
  }

  const base = publicBaseUrl();
  if (!base) {
    return interaction.reply({
      content:
        '❌ 机器人还没有公网网址，转盘页面打不开。请在 Railway 里点机器人服务 → Settings → Networking → Generate Domain，生成后重新执行这个指令。',
      flags: EPHEMERAL,
    });
  }

  await interaction.deferReply({ flags: EPHEMERAL });

  let session;
  try {
    session = await createSession({ guild: interaction.guild, channel: interaction.channel, voiceChannel, testMode });
  } catch (err) {
    if (err.message === 'NO_PARTICIPANTS') {
      return interaction.editReply('❌ 当前签筒里还没有任何符合资格的参与者！');
    }
    throw err;
  }

  // 已经正式开完奖：直接把当时的结果发到频道，不重新抽
  if (session.status === 'done') {
    await interaction.channel.send({
      content: '📋 **本次活动已经正式开完奖，以下是结果：**',
      embeds: [buildResultEmbed(session.winners)],
    });
    return interaction.editReply('这次活动已经开完奖，结果已发到频道。');
  }

  const link = `${base}/wheel?s=${session.token}`;
  const resumed = session.winners.length > 0 ? `\n（检测到已经抽出 ${session.winners.length} 位，会接着往下抽）` : '';
  await interaction.editReply(
    `🎡 **幸运转盘已准备好${testMode ? '（🧪 预演模式）' : ''}**${resumed}\n` +
      `本次抽 **${session.target}** 位，转盘上共 ${session.candidates.length} 人。\n\n` +
      `👉 ${link}\n\n` +
      '这个链接只有你能看到，**请不要转发**。用浏览器打开后，把这个页面共享到直播里，点「转」就开始。' +
      (testMode ? '\n预演模式不检查是否在场，结果也不会保存。' : '\n被抽到的人需要在直播语音频道里，机器人会自动检查并在频道播报。')
  );
  await interaction.channel.send(
    `🎡 **幸运转盘开奖开始！**${testMode ? '（预演）' : ''}本次抽 **${session.target}** 位` +
      (voiceChannel ? `，大家请待在 <#${voiceChannel.id}>！` : '！')
  );
  await startVote(session); // 前 3 名顺序：已入场的人投票决定
}

// =====================================================================
// /test-simulate
// =====================================================================
async function cmdTestSimulate(interaction) {
  const action = interaction.options.getString('action');
  const maxTotal = cfg.MAX_BASE_TICKETS + cfg.MAX_INVITE_TICKETS;

  if (action === 'seed') {
    await interaction.deferReply({ flags: EPHEMERAL });

    const adminId = interaction.user.id;
    await pool.query(
      `INSERT INTO user_stats (user_id, voice_seconds, valid_messages, has_entry_role)
       VALUES ($1, 72000, 300, TRUE)
       ON CONFLICT (user_id) DO UPDATE SET voice_seconds = 72000, valid_messages = 300`,
      [adminId]
    );
    for (let d = 1; d <= 15; d++) {
      const fakeDate = `2026-11-${String(d).padStart(2, '0')}`;
      await pool.query(
        `INSERT INTO daily_activity (user_id, activity_date, voice_seconds, valid_messages, is_valid_day)
         VALUES ($1, $2, 3600, 20, TRUE)
         ON CONFLICT DO NOTHING`,
        [adminId, fakeDate]
      );
    }

    for (let i = 1; i <= 50; i++) {
      const fakeUserId = `9990000000000000${String(i).padStart(2, '0')}`;
      await pool.query(
        `INSERT INTO user_stats (user_id, voice_seconds, valid_messages, has_entry_role)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT DO NOTHING`,
        [fakeUserId, i * 1000, i * 5]
      );
      for (let d = 1; d <= Math.max(cfg.ENTRY_VALID_DAYS, 6); d++) {
        await pool.query(
          `INSERT INTO daily_activity (user_id, activity_date, voice_seconds, valid_messages, is_valid_day)
           VALUES ($1, $2, 3600, 20, TRUE)
           ON CONFLICT DO NOTHING`,
          [fakeUserId, `2026-11-${String(d).padStart(2, '0')}`]
        );
      }
      if (i <= cfg.MAX_INVITE_TICKETS) {
        await pool.query(
          `INSERT INTO invite_records (invitee_id, inviter_id, invite_code, is_verified, joined_date)
           VALUES ($1, $2, 'TESTCODE', TRUE, '2026-11-01') ON CONFLICT DO NOTHING`,
          [fakeUserId, adminId]
        );
      }
    }

    invalidateRankCache();
    return interaction.editReply(
      `✅ **测试数据注入成功！**\n` +
        `• 你的账号已获得满额 **${maxTotal} 张签**（日常 ${cfg.MAX_BASE_TICKETS} + 拉新 ${cfg.MAX_INVITE_TICKETS}）\n` +
        `• 已生成 **50 名已入场的模拟玩家**（共 51 人入场，会触发 ${cfg.UPGRADE_ENTRY_THRESHOLD} 人豪华升级、名额抽满 ${cfg.CHRISTMAS_WINNERS_COUNT} 位）\n` +
        `• 现在可以试 \`/my-tickets\`、\`/help-event\`、\`/draw-christmas\`（test 选 True）`
    );
  }

  if (action === 'preview_report') {
    await interaction.deferReply({ flags: EPHEMERAL });
    const { content, files } = await buildReport(interaction.guild, '🕛 **【厨房夜宵战报 · 样式预览】00:00 签筒盘点！**');
    return interaction.editReply({
      content: `🧪 *以下是每日 00:00 自动战报的预览：*\n${content}`,
      files,
    });
  }

  if (action === 'send_report') {
    await interaction.deferReply({ flags: EPHEMERAL });
    const channelId = process.env.REPORT_CHANNEL_ID;
    if (!channelId) return interaction.editReply('❌ 还没设置 `REPORT_CHANNEL_ID`（战报频道 ID）。');
    let target;
    try {
      target = await interaction.client.channels.fetch(channelId);
    } catch (err) {
      return interaction.editReply(`❌ 找不到战报频道，或机器人看不到它：${err.message}`);
    }
    const { content, files } = await buildReport(interaction.guild, '🕛 **【厨房夜宵战报 · 测试发送】**');
    try {
      await target.send({ content, files });
    } catch (err) {
      return interaction.editReply(
        `❌ 发送失败：${err.message}\n请检查机器人在该频道有没有「查看频道」「发送消息」「附加文件」权限。`
      );
    }
    return interaction.editReply(`✅ 已发送到 <#${channelId}>，去看看图片和文字显示对不对。`);
  }

  if (action === 'send_backup') {
    await interaction.deferReply({ flags: EPHEMERAL });
    const channelId = process.env.BACKUP_CHANNEL_ID;
    if (!channelId) return interaction.editReply('❌ 还没设置 `BACKUP_CHANNEL_ID`（只有管理员能看到的备份频道 ID）。');
    try {
      const target = await interaction.client.channels.fetch(channelId);
      const { content, files } = await buildBackup(interaction.guild, '🧪 数据备份（测试发送）');
      await target.send({ content, files });
    } catch (err) {
      return interaction.editReply(`❌ 备份发送失败：${err.message}\n请检查机器人在该频道有没有「查看频道」「发送消息」「附加文件」权限。`);
    }
    return interaction.editReply(`✅ 备份表格已发送到 <#${channelId}>。`);
  }

  if (action === 'clear_draw') {
    await pool.query(`TRUNCATE TABLE draw_results`);
    return interaction.reply({ content: '🧹 已清除正式开奖记录，可以重新开奖。', flags: EPHEMERAL });
  }

  if (action === 'reset') {
    const protectFrom = new Date(cfg.PROTECT_RESET_FROM_ISO).getTime();
    if (Date.now() >= protectFrom && process.env.ALLOW_RESET !== 'true') {
      return interaction.reply({
        content: '🛑 正式活动已经开始，为防误操作，清空功能已锁定。确实需要清空的话，先在 Railway 变量里加 `ALLOW_RESET=true`。',
        flags: EPHEMERAL,
      });
    }

    if (interaction.options.getString('confirm') !== 'RESET') {
      return interaction.reply({
        content: '⚠️ 这会清空**全部**活动数据。如果确定，请重新执行，并在 `confirm` 里输入大写英文 `RESET`。',
        flags: EPHEMERAL,
      });
    }

    const drawn = await pool.query(`SELECT 1 FROM draw_results LIMIT 1`);
    if (drawn.rows.length > 0) {
      return interaction.reply({
        content: '🛑 已经有正式开奖记录，不能直接清空。如果确实要清，请先执行「4. 清除正式开奖记录」。',
        flags: EPHEMERAL,
      });
    }

    await pool.query(`TRUNCATE TABLE user_stats, daily_activity, invite_records`);
    invalidateRankCache();
    return interaction.reply({
      content: '🧹 **数据库已清空！** 所有测试数据都已抹除，12月1日 00:00 将从零开始正式统计。',
      flags: EPHEMERAL,
    });
  }
}

module.exports = { handleCommand };
