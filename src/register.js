const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName('my-tickets')
      .setDescription('🎟️ 查看我当前的圣诞幸运签数量与活跃进度（仅自己可见）'),

    new SlashCommandBuilder()
      .setName('rank')
      .setDescription('🏆 查看今日排行榜和我的名次（仅自己可见）'),

    new SlashCommandBuilder()
      .setName('help-event')
      .setDescription('📖 查看【圣诞厨房寻宝季】活动规则与攒签说明'),

    new SlashCommandBuilder()
      .setName('draw-christmas')
      .setDescription('🎄 【管理员】现场直播开奖（12月23日 23:59 之后才能正式开奖）')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addBooleanOption((o) =>
        o
          .setName('test')
          .setDescription('预演模式：不检查是否在语音频道、不限时间、不保存结果')
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName('test-simulate')
      .setDescription('🧪 【管理员】预演专用：注入测试数据、预览战报、清空数据')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('选择要执行的动作')
          .setRequired(true)
          .addChoices(
            { name: '1. 注入模拟数据（50 人入场 + 你自己满签）', value: 'seed' },
            { name: '2. 预览每日 00:00 全服战报', value: 'preview_report' },
            { name: '3. 清空全部活动数据（需要再填 confirm）', value: 'reset' },
            { name: '4. 清除正式开奖记录（只在需要重新开奖时用）', value: 'clear_draw' }
          )
      )
      .addStringOption((o) =>
        o
          .setName('confirm')
          .setDescription('选「清空全部活动数据」时，这里必须输入大写英文 RESET')
          .setRequired(false)
      ),
  ].map((cmd) => cmd.toJSON());
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), {
    body: buildCommands(),
  });
}

module.exports = { registerCommands };
