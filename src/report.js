const { AttachmentBuilder } = require('discord.js');
const { getAllParticipantsSummary } = require('./db');
const { getRanking } = require('./ranking');

// 每日 00:00 战报：两行数据 + 一张大尺寸排行榜图片（真实播报和 /test-simulate 预览共用）
// 不放进嵌入卡片，直接作为图片附件发送，这样 Discord 会把图片显示得更大
async function buildReport(guild, title) {
  let totalServerTickets;
  let totalEntryUsers;
  const files = [];

  try {
    const data = await getRanking(guild, { force: true });
    totalServerTickets = data.totalServerTickets;
    totalEntryUsers = data.totalEntryUsers;
    files.push(new AttachmentBuilder(data.image, { name: 'ranking.png' }));
  } catch (err) {
    // 图片生成失败也要把文字战报发出去
    console.error('排行榜图片生成失败:', err.message);
    const t = await getAllParticipantsSummary();
    totalServerTickets = t.totalServerTickets;
    totalEntryUsers = t.totalEntryUsers;
  }

  const content =
    `${title}\n` +
    `🎟️ 全服累计总签数：**${totalServerTickets} 张**　　👨‍🍳 已解锁入场人数：**${totalEntryUsers} 人**`;

  return { content, files };
}

module.exports = { buildReport };
