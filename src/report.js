const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const cfg = require('./config');
const { getAllParticipantsSummary } = require('./db');
const { winnersFor, nextWinnerStep } = require('./rules');
const { getRanking } = require('./ranking');

// 每日 00:00 战报：文字卡片 + 排行榜图片（真实播报和 /test-simulate 预览共用）
async function buildReport(guild, title) {
  let totalServerTickets;
  let totalEntryUsers;
  const files = [];
  let hasImage = false;

  try {
    const data = await getRanking(guild, { force: true });
    totalServerTickets = data.totalServerTickets;
    totalEntryUsers = data.totalEntryUsers;
    files.push(new AttachmentBuilder(data.image, { name: 'ranking.png' }));
    hasImage = true;
  } catch (err) {
    // 图片生成失败也要把文字战报发出去
    console.error('排行榜图片生成失败:', err.message);
    const t = await getAllParticipantsSummary();
    totalServerTickets = t.totalServerTickets;
    totalEntryUsers = t.totalEntryUsers;
  }

  const winners = winnersFor(totalEntryUsers);
  const step = nextWinnerStep(totalEntryUsers);
  const winnerText = step
    ? `目前得奖名额 **${winners} 位**，再有 **${step.need} 人**解锁入场，名额加到 **${step.count} 位**！`
    : `得奖名额已满 **${winners} 位**（上限）！`;

  const diff = Math.max(0, cfg.UPGRADE_ENTRY_THRESHOLD - totalEntryUsers);
  const upgradeText =
    diff > 0
      ? `入场人数再差 **${diff} 人**到 ${cfg.UPGRADE_ENTRY_THRESHOLD} 人，最先抽出的 **${cfg.UPGRADE_TOP_COUNT} 份**将升级为「主厨豪华至尊大礼」！`
      : `已突破 ${cfg.UPGRADE_ENTRY_THRESHOLD} 人，最先抽出的 **${cfg.UPGRADE_TOP_COUNT} 份**升级为「主厨豪华至尊大礼」！`;

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(title)
    .setDescription('厨房打烊盘点时间到，看看大家今天往签筒里放了多少签。')
    .addFields(
      { name: '🎟️ 全服累计总签数', value: `**${totalServerTickets} 张**`, inline: true },
      { name: '👨‍🍳 已解锁入场人数', value: `**${totalEntryUsers} 人**`, inline: true },
      { name: '🎁 得奖名额', value: winnerText },
      { name: '🔥 至尊大礼升级进度', value: upgradeText }
    )
    .setFooter({ text: '输入 /rank 查自己的名次 | /my-tickets 查签数 | /help-event 看规则' });

  if (hasImage) embed.setImage('attachment://ranking.png');

  return { embed, files };
}

module.exports = { buildReport };
