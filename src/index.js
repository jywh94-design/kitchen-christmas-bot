require('dotenv').config();
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');
const cron = require('node-cron');
const cfg = require('./config');
const { pool, initDB, isEventActive, addActivity, getMYParts } = require('./db');
const { handleCommand } = require('./commands');
const { buildReport } = require('./report');
const { registerCommands } = require('./register');

// 兜底：任何没接住的错误只记录日志，不让机器人崩溃退出
process.on('unhandledRejection', (err) => console.error('未处理的异步错误:', err));

const GUILD_ID = process.env.GUILD_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
  ],
});

// 邀请缓存：code -> { uses, maxUses, inviterId }
let inviteCache = new Map();
const messageCooldowns = new Map();

function snapshotInvites(invites) {
  const map = new Map();
  invites.forEach((inv) => {
    map.set(inv.code, {
      uses: inv.uses ?? 0,
      maxUses: inv.maxUses ?? 0,
      inviterId: inv.inviter?.id ?? null,
    });
  });
  return map;
}

// ---------- 自动发放入场身份组 ----------
async function syncEntryRole(guild, summary) {
  if (!summary || !summary.unlockedEntry || summary.hasEntryRole) return;
  const roleId = process.env.ENTRY_ROLE_ID;
  if (!roleId) return;

  try {
    const member = await guild.members.fetch(summary.userId);
    if (member && !member.roles.cache.has(roleId)) {
      await member.roles.add(roleId);
    }
    await pool.query(`UPDATE user_stats SET has_entry_role = TRUE WHERE user_id = $1`, [summary.userId]);
  } catch (err) {
    console.error(`⚠️ 自动发放身份组失败 (${summary.userId}):`, err.message);
  }
}

// ---------- 语音计时（每 60 秒一次） ----------
let voiceBusy = false;

async function voiceTick(guild) {
  if (voiceBusy || !isEventActive()) return;
  voiceBusy = true;
  try {
    const skipIds = new Set([process.env.AFK_CHANNEL_ID, guild.afkChannelId].filter(Boolean));

    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased() || skipIds.has(channel.id)) continue;

      // 只统计「没闭麦、没关听筒」的真人；这类人数不足 MIN_VOICE_HUMANS 时整个频道都不计时
      const active = channel.members.filter((m) => !m.user.bot && !m.voice.mute && !m.voice.deaf);
      if (active.size < cfg.MIN_VOICE_HUMANS) continue;

      for (const member of active.values()) {
        try {
          const summary = await addActivity(member.id, { voiceSec: 60 });
          await syncEntryRole(guild, summary);
        } catch (err) {
          console.error(`语音计时失败 (${member.id}):`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('语音轮询异常:', err.message);
  } finally {
    voiceBusy = false;
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`🤖 厨房圣诞算签机器人已上线：${client.user.tag}`);
  await initDB();

  try {
    await registerCommands();
    console.log('✅ 斜杠指令已自动注册');
  } catch (err) {
    console.error('⚠️ 斜杠指令注册失败（检查 CLIENT_ID / GUILD_ID / 机器人是否已加入服务器）:', err.message);
  }

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch(); // 把全部频道载入缓存，语音轮询要用
  try {
    inviteCache = snapshotInvites(await guild.invites.fetch());
  } catch (err) {
    console.error('⚠️ 读取邀请列表失败（机器人缺少「管理服务器」权限？）:', err.message);
  }

  setInterval(() => voiceTick(guild), 60 * 1000);

  // 清理过期的聊天冷却记录，避免内存越积越多
  setInterval(() => {
    const limit = Date.now() - cfg.MESSAGE_COOLDOWN_SEC * 1000;
    for (const [id, t] of messageCooldowns) if (t < limit) messageCooldowns.delete(id);
  }, 10 * 60 * 1000);

  // 每天马来西亚时间 00:00 自动发送全服战报（12月1日 - 12月24日）
  cron.schedule(
    '0 0 * * *',
    async () => {
      const { month, day } = getMYParts();
      if (month !== 12 || day < 1 || day > 24) return;

      const reportChannelId = process.env.REPORT_CHANNEL_ID;
      if (!reportChannelId) return;

      try {
        const channel = await client.channels.fetch(reportChannelId);
        const { embed, files } = await buildReport(guild, `🕛 【厨房夜宵战报】12月${day}日 00:00 签筒盘点！`);
        await channel.send({ embeds: [embed], files });
      } catch (err) {
        console.error('每日战报发送失败:', err.message);
      }
    },
    { timezone: 'Asia/Kuala_Lumpur' }
  );
});

// ---------- 文字有效聊天 ----------
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild || message.guild.id !== GUILD_ID) return;
    if (!isEventActive()) return;

    const excluded = (process.env.EXCLUDED_TEXT_CHANNELS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (excluded.includes(message.channel.id)) return;

    const cleanText = message.content.replace(/<a?:\w+:\d+>/g, '').trim();
    if (cleanText.length < cfg.MIN_MESSAGE_LENGTH) return;

    const now = Date.now();
    const last = messageCooldowns.get(message.author.id) || 0;
    if (now - last < cfg.MESSAGE_COOLDOWN_SEC * 1000) return;
    messageCooldowns.set(message.author.id, now);

    const summary = await addActivity(message.author.id, { msgCount: 1 });
    await syncEntryRole(message.guild, summary);
  } catch (err) {
    console.error('聊天统计异常:', err.message);
  }
});

// ---------- 新成员加入：追踪是谁邀请的 ----------
// 用队列一个一个处理，避免两个人同时入群时互相误判
let inviteQueue = Promise.resolve();

client.on(Events.GuildMemberAdd, (member) => {
  inviteQueue = inviteQueue
    .then(() => handleMemberAdd(member))
    .catch((err) => console.error('邀请追踪异常:', err.message));
});

async function handleMemberAdd(member) {
  if (member.user.bot || member.guild.id !== GUILD_ID) return;

  // 之前退过群又回来：恢复他原来的邀请记录（拉新签算回原邀请人，不会换人）
  await pool.query(`UPDATE invite_records SET left_guild = FALSE WHERE invitee_id = $1`, [member.id]);

  let fresh;
  try {
    fresh = snapshotInvites(await member.guild.invites.fetch());
  } catch (err) {
    console.error('读取邀请列表失败:', err.message);
    return;
  }

  // 找出使用次数增加的邀请码
  let used = null;
  for (const [code, info] of fresh) {
    const old = inviteCache.get(code);
    if (old ? info.uses > old.uses : info.uses > 0) {
      used = { code, inviterId: info.inviterId };
      break;
    }
  }
  // 限次邀请码用完会被 Discord 自动删除：找「消失了、且刚好用完」的那个
  if (!used) {
    for (const [code, old] of inviteCache) {
      if (!fresh.has(code) && old.maxUses > 0 && old.uses + 1 >= old.maxUses) {
        used = { code, inviterId: old.inviterId };
        break;
      }
    }
  }
  inviteCache = fresh;

  if (!isEventActive()) return;

  if (used && used.inviterId && used.inviterId !== member.id) {
    await pool.query(
      `INSERT INTO invite_records (invitee_id, inviter_id, invite_code, is_verified, joined_date)
       VALUES ($1, $2, $3, FALSE, $4)
       ON CONFLICT (invitee_id) DO NOTHING`,
      [member.id, used.inviterId, used.code, getMYParts().dateString]
    );
  }
}

// ---------- 成员退群：拉新签暂时作废（他回来就恢复） ----------
client.on(Events.GuildMemberRemove, async (member) => {
  try {
    if (member.guild.id !== GUILD_ID) return;
    await pool.query(`UPDATE invite_records SET left_guild = TRUE WHERE invitee_id = $1`, [member.id]);
  } catch (err) {
    console.error('退群处理异常:', err.message);
  }
});

client.on(Events.InviteCreate, (invite) => {
  inviteCache.set(invite.code, {
    uses: invite.uses ?? 0,
    maxUses: invite.maxUses ?? 0,
    inviterId: invite.inviter?.id ?? null,
  });
});

// ---------- 斜杠指令 ----------
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error('指令执行异常:', err);
    const msg = { content: '⚠️ 厨房算签机刚刚打了个喷嚏，请稍后再试一次！', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else await interaction.reply(msg);
    } catch (e) {
      console.error('回复错误提示失败:', e.message);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
