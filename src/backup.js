// 每日数据备份：把全部人的签数、活动数据导出成 CSV 表格（Excel 可直接打开），发到管理员私密频道
const { AttachmentBuilder } = require('discord.js');
const { pool, getMYParts } = require('./db');
const { computeTickets } = require('./rules');
const { isExcluded } = require('./excluded');
const { resolveMembers } = require('./members');

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

async function buildBackup(guild, title) {
  const stats = await pool.query(`
    SELECT s.user_id, s.voice_seconds, s.valid_messages, s.has_entry_role,
           COALESCE(d.valid_days, 0) AS valid_days,
           COALESCE(i.cnt, 0) AS verified_invites
    FROM user_stats s
    LEFT JOIN (SELECT user_id, COUNT(*)::int AS valid_days FROM daily_activity WHERE is_valid_day = TRUE GROUP BY user_id) d ON d.user_id = s.user_id
    LEFT JOIN (SELECT inviter_id, COUNT(*)::int AS cnt FROM invite_records
               WHERE is_verified = TRUE AND NOT COALESCE(left_guild, FALSE) GROUP BY inviter_id) i ON i.inviter_id = s.user_id
    ORDER BY s.user_id`);
  const info = await resolveMembers(guild, stats.rows.map((r) => r.user_id));

  const people = [['用户ID', '名字', '有效打卡日', '语音小时', '有效聊天条数', '拉新人数', '入场', '日常签', '拉新签', '总签数', '已排除']];
  for (const r of stats.rows) {
    const t = computeTickets({ validDays: r.valid_days, voiceSeconds: r.voice_seconds, validMessages: r.valid_messages, verifiedInvites: r.verified_invites });
    const ex = isExcluded(r.user_id);
    people.push([
      r.user_id, info.get(r.user_id)?.name || '', r.valid_days, (r.voice_seconds / 3600).toFixed(2), r.valid_messages,
      r.verified_invites, t.unlockedEntry ? '是' : '否', t.baseTickets, t.bonusInviteTickets, ex ? 0 : t.totalTickets, ex ? '是' : '',
    ]);
  }

  const inv = await pool.query(`SELECT invitee_id, inviter_id, invite_code, is_verified, left_guild, joined_date FROM invite_records ORDER BY joined_at`);
  const invites = [['被邀请人ID', '邀请人ID', '邀请码', '已有效', '已退群', '入群日期']];
  for (const r of inv.rows) invites.push([r.invitee_id, r.inviter_id, r.invite_code, r.is_verified ? '是' : '', r.left_guild ? '是' : '', r.joined_date]);

  const draws = await pool.query(`SELECT place, user_id, prize, tickets FROM draw_results ORDER BY place`);
  const drawRows = [['名次', '用户ID', '奖品', '抽中时签数']];
  for (const r of draws.rows) drawRows.push([r.place, r.user_id, r.prize, r.tickets]);

  const stamp = getMYParts().dateString;
  const files = [
    new AttachmentBuilder(Buffer.from(toCsv(people), 'utf8'), { name: `签数备份-${stamp}.csv` }),
    new AttachmentBuilder(Buffer.from(toCsv(invites), 'utf8'), { name: `邀请记录-${stamp}.csv` }),
  ];
  if (draws.rows.length) files.push(new AttachmentBuilder(Buffer.from(toCsv(drawRows), 'utf8'), { name: `开奖结果-${stamp}.csv` }));

  return { content: `${title}\n共 ${stats.rows.length} 人有记录，${inv.rows.length} 条邀请记录。用 Excel 打开 CSV 即可。`, files };
}

module.exports = { buildBackup };
