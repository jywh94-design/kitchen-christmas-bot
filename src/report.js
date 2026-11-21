const { EmbedBuilder } = require('discord.js');
const cfg = require('./config');
const { getAllParticipantsSummary } = require('./db');
const { winnersFor, nextWinnerStep } = require('./rules');

// 每日 00:00 战报卡片（真实播报和 /test-simulate 预览共用）
async function buildReportEmbed(title) {
  const { totalServerTickets, totalEntryUsers } = await getAllParticipantsSummary();

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

  return new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle(title)
    .setDescription('厨房打烊盘点时间到，看看大家今天往签筒里放了多少签。')
    .addFields(
      { name: '🎟️ 全服累计总签数', value: `**${totalServerTickets} 张**`, inline: true },
      { name: '👨‍🍳 已解锁入场人数', value: `**${totalEntryUsers} 人**`, inline: true },
      { name: '🎁 得奖名额', value: winnerText },
      { name: '🔥 至尊大礼升级进度', value: upgradeText }
    )
    .setFooter({ text: '输入 /my-tickets 查自己的签数 | 输入 /help-event 看规则' });
}

module.exports = { buildReportEmbed };
