const crypto = require('crypto');
const { EmbedBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const cfg = require('./config');
const {
  pool,
  getUserTicketSummary,
  getAllParticipantsSummary,
  getEventWindow,
} = require('./db');
const { nextTier, winnersFor, entryNeededForMaxWinners } = require('./rules');
const { buildReport } = require('./report');
const { getRanking, rankOf, invalidateRankCache } = require('./ranking');

const EPHEMERAL = MessageFlags.Ephemeral;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hoursText = (sec) => (sec / 3600).toFixed(1);

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
  const s = await getUserTicketSummary(interaction.user.id);
  const maxTotal = cfg.MAX_BASE_TICKETS + cfg.MAX_INVITE_TICKETS;

  // 入场进度：0% - 100% 进度条
  const entryPct = Math.min(100, Math.floor((s.validDays / cfg.ENTRY_VALID_DAYS) * 100));
  const entryText = `${progressBar(entryPct)} **${entryPct}%**${entryPct >= 100 ? ' ✅' : ''}`;

  let progress = null;
  if (s.unlockedEntry) {
    const nd = nextTier(cfg.STREAK_DAY_TIERS, s.validDays);
    const nv = nextTier(cfg.VOICE_HOUR_TIERS, s.voiceSeconds / 3600);
    const nm = nextTier(cfg.TOTAL_MESSAGE_TIERS, s.validMessages);
    progress = [
      nd ? `• 有效打卡日：**${s.validDays}** 天，下一档 ${nd} 天` : `• 有效打卡日：**${s.validDays}** 天（已满档）`,
      nv
        ? `• 有效语音：**${hoursText(s.voiceSeconds)}** 小时，下一档 ${nv} 小时`
        : `• 有效语音：**${hoursText(s.voiceSeconds)}** 小时（已满档）`,
      nm ? `• 有效聊天：**${s.validMessages}** 条，下一档 ${nm} 条` : `• 有效聊天：**${s.validMessages}** 条（已满档）`,
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

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('🎟️ 我的圣诞厨房幸运签筒')
    .setDescription(`你好 **${interaction.user.username}**，这是你目前的攒签状态：`)
    .addFields(
      { name: '当前总幸运签', value: `**${s.totalTickets} 张**（上限 ${cfg.MAX_BASE_TICKETS}+${cfg.MAX_INVITE_TICKETS}）`, inline: true },
      { name: '签数构成', value: `日常 **${s.baseTickets}/${cfg.MAX_BASE_TICKETS}** + 拉新 **${s.bonusInviteTickets}/${cfg.MAX_INVITE_TICKETS}**`, inline: true },
      { name: '入场进度', value: entryText, inline: true }
    );
  if (progress) embed.addFields({ name: '下一档进度', value: progress });
  embed
    .addFields({ name: '小贴士', value: hint })
    .setFooter({ text: '统计周期：12月1日 - 12月23日 | 闭麦挂机与水贴不计入统计' });

  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
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
          `• **12月24日 20:00** 在直播语音频道开奖，被抽到后 ${cfg.DRAW_CLAIM_SECONDS} 秒内要在场，否则当场重抽`,
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
// /draw-christmas
// =====================================================================
const PRIZE_TEXT = {
  ULTIMATE: '🌟 **【主厨豪华至尊大礼】**',
  BLINDBOX: '🎁 **【圣诞神秘盲盒】**',
};

function buildResultEmbed(winners, extra = {}) {
  const lines = winners.map((w, i) => `**第 ${i + 1} 位**：<@${w.userId}> ➔ ${PRIZE_TEXT[w.prize] || PRIZE_TEXT.BLINDBOX}`);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(extra.title || `🎉 2026 圣诞厨房寻宝季 · ${winners.length} 位得奖名单`)
    .setDescription(lines.join('\n') || '（无）');
  if (extra.stats) embed.addFields({ name: '📊 本期统计', value: extra.stats });
  if (extra.footer) embed.setFooter({ text: extra.footer });
  return embed;
}

// 按签数加权随机抽 1 人（用系统级安全随机数）
function pickWeighted(candidates) {
  const total = candidates.reduce((sum, c) => sum + c.tickets, 0);
  let r = crypto.randomInt(total);
  for (const c of candidates) {
    if (r < c.tickets) return c;
    r -= c.tickets;
  }
  return candidates[candidates.length - 1];
}

// 等待某人出现在指定语音频道里，最多等 seconds 秒
async function waitForPresence(channel, userId, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (true) {
    if (channel.members.has(userId)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(1000);
  }
}

async function cmdDraw(interaction) {
  const testMode = interaction.options.getBoolean('test') ?? false;
  let channel = null;

  if (!testMode) {
    // 已经正式开过奖：直接显示当时的结果，不会重新抽
    const saved = await pool.query(`SELECT user_id, prize FROM draw_results ORDER BY place`);
    if (saved.rows.length > 0) {
      const winners = saved.rows.map((r) => ({ userId: r.user_id, prize: r.prize }));
      return interaction.reply({
        content: '📋 **本次活动已经正式开过奖，以下是当时的结果（不会重新抽）：**',
        embeds: [buildResultEmbed(winners)],
      });
    }

    if (Date.now() <= getEventWindow().end) {
      return interaction.reply({
        content: '⏳ 统计还没截止，12月23日 23:59 之后才能正式开奖。想先预演，请把 `test` 选项选 True。',
        flags: EPHEMERAL,
      });
    }

    const channelId = process.env.DRAW_VOICE_CHANNEL_ID;
    if (channelId) channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) {
      return interaction.reply({
        content: '❌ 没找到直播语音频道。请在 Railway 变量里设置 `DRAW_VOICE_CHANNEL_ID`（直播开奖的语音频道 ID）。',
        flags: EPHEMERAL,
      });
    }
  }

  await interaction.deferReply();

  const { participants, totalServerTickets, totalEntryUsers } = await getAllParticipantsSummary();
  if (participants.length === 0) {
    return interaction.editReply('❌ 当前签筒里还没有任何符合资格的参与者！');
  }

  const target = Math.min(winnersFor(totalEntryUsers), participants.length);
  const upgraded = totalEntryUsers >= cfg.UPGRADE_ENTRY_THRESHOLD;
  let candidates = participants.map((p) => ({ userId: p.userId, tickets: p.totalTickets }));

  const modeTag = testMode ? '（🧪 预演模式）' : '';
  await interaction.editReply(`🎄 **圣诞厨房签筒启动中……${modeTag}** 全服共 \`${totalServerTickets}\` 张幸运签，本次抽 **${target}** 位！🎲`);
  await sleep(2000);
  await interaction.editReply('🥁 **倒计时 3…… 炉火已旺！** ✨');
  await sleep(1500);
  await interaction.editReply(`🥁 **倒计时 2…… 正在锁定 ${target} 位幸运儿！** 🔥`);
  await sleep(1500);
  await interaction.editReply('🥁 **倒计时 1…… 开奖！** 🎊');
  await sleep(1000);

  const winners = [];
  let absentCount = 0;

  while (winners.length < target && candidates.length > 0) {
    const picked = pickWeighted(candidates);
    candidates = candidates.filter((c) => c.userId !== picked.userId);
    const place = winners.length + 1;

    // 正式开奖要检查是否在直播语音频道里
    if (channel && !channel.members.has(picked.userId)) {
      await interaction.followUp(
        `🎲 第 ${place} 位抽到 <@${picked.userId}>！请在 **${cfg.DRAW_CLAIM_SECONDS} 秒**内进入 <#${channel.id}>！`
      );
      const here = await waitForPresence(channel, picked.userId, cfg.DRAW_CLAIM_SECONDS);
      if (!here) {
        absentCount += 1;
        await interaction.followUp(`⏰ <@${picked.userId}> 没有在场，视为放弃，重新抽取！`);
        continue;
      }
    }

    const prize = upgraded && place <= cfg.UPGRADE_TOP_COUNT ? 'ULTIMATE' : 'BLINDBOX';
    winners.push({ userId: picked.userId, prize, tickets: picked.tickets });
    await interaction.followUp(`🎉 **第 ${place} 位**：<@${picked.userId}> ➔ ${PRIZE_TEXT[prize]}`);
    await sleep(1500);
  }

  // 正式开奖：保存结果，之后不会被重复开奖覆盖
  if (!testMode) {
    for (let i = 0; i < winners.length; i++) {
      const w = winners[i];
      await pool.query(
        `INSERT INTO draw_results (place, user_id, prize, tickets) VALUES ($1, $2, $3, $4)
         ON CONFLICT (place) DO NOTHING`,
        [i + 1, w.userId, w.prize, w.tickets]
      );
    }
  }

  let stats =
    `入场总人数：**${totalEntryUsers} 人**（${upgraded ? `已触发 ${cfg.UPGRADE_ENTRY_THRESHOLD} 人豪华升级` : '未触发豪华升级'}）\n` +
    `签筒总签数：**${totalServerTickets} 张**\n` +
    `本期名额：**${target} 位**`;
  if (absentCount > 0) stats += `\n因不在场重抽：**${absentCount} 次**`;
  if (winners.length < target) stats += `\n⚠️ 有 ${target - winners.length} 个名额因无人在场而空缺`;

  return interaction.editReply({
    content: testMode ? '🧪 **预演结束（结果没有保存）**' : '🎊 **叮咚！圣诞神秘礼物开奖结果正式出炉！**',
    embeds: [
      buildResultEmbed(winners, {
        stats,
        footer: testMode ? '这是预演结果，不作数' : '恭喜以上幸运伙伴！请等待主厨发放礼物~',
      }),
    ],
  });
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
    const { embed, files } = await buildReport(interaction.guild, '🕛 【厨房夜宵战报 · 样式预览】00:00 签筒盘点！');
    return interaction.editReply({
      content: '🧪 *以下是每日 00:00 自动战报的预览：*',
      embeds: [embed],
      files,
    });
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
