// 幸运转盘开奖的核心逻辑：抽签、在场检查、保存结果、Discord 播报
// 转盘网页只负责「展示和按按钮」，真正抽谁由这里（服务器）决定。
const crypto = require('crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const cfg = require('./config');
const { pool, getAllParticipantsSummary } = require('./db');
const { winnersFor } = require('./rules');
const { resolveMembers } = require('./members');

const ANIM_MS = Number(process.env.WHEEL_ANIM_MS) || 7000; // 转盘转动时间
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const PRIZE_TEXT = {
  ULTIMATE: '🌟 **【主厨豪华至尊大礼】**',
  BLINDBOX: '🎁 **【圣诞神秘盲盒】**',
};

const sessions = new Map(); // token -> session
const logErr = (e) => console.error('开奖流程异常:', e);

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

function buildResultEmbed(winners, extra = {}) {
  winners = [...winners].sort((a, b) => a.place - b.place);
  const lines = winners.map((w) => `**第 ${w.place} 位**：<@${w.userId}> ➔ ${PRIZE_TEXT[w.prize] || PRIZE_TEXT.BLINDBOX}`);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(extra.title || `🎉 2026 圣诞厨房寻宝季 · ${winners.length} 位得奖名单`)
    .setDescription(lines.join('\n') || '（无）');
  if (extra.stats) embed.addFields({ name: '📊 本期统计', value: extra.stats });
  if (extra.footer) embed.setFooter({ text: extra.footer });
  return embed;
}

function closeSession(session) {
  clearTimeout(session.timers.reveal);
  clearTimeout(session.timers.vote);
  clearInterval(session.timers.poll);
  sessions.delete(session.token);
}

// ---------- 抽奖顺序：固定从最后一名往前抽，最后揭晓第 1 名（不再投票） ----------
function initialOrderMode() {
  return 'desc';
}
function placeSequence(session) {
  const seq = [];
  for (let p = session.target; p >= 1; p--) seq.push(p);
  return seq;
}
function nextPlace(session) {
  const have = new Set(session.winners.map((w) => w.place));
  return placeSequence(session).find((p) => !have.has(p)) ?? null;
}

function voteTally(session) {
  let desc = 0;
  let asc = 0;
  for (const v of session.order.votes.values()) v === 'desc' ? desc++ : asc++;
  return { desc, asc };
}

// 在 Discord 频道发起投票（只有已入场的人能投）
async function startVote(session) {
  if (session.order.mode || session.order.endsAt) return;
  const secs = cfg.VOTE_SECONDS;
  session.order.endsAt = Date.now() + secs * 1000;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wheelvote:${session.token}:desc`).setLabel('先抽第 3 名，最后揭晓第 1 名').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`wheelvote:${session.token}:asc`).setLabel('先抽第 1 名').setStyle(ButtonStyle.Success)
  );
  session.order.message = await session.channel
    .send({
      content:
        `🗳️ **前 3 名怎么抽？大家投票决定！**（${secs} 秒内，只有已入场的人能投，可以改票）
` +
        '🔴 先抽第 3 名，最后揭晓冠军\n🟢 先抽第 1 名',
      components: [row],
    })
    .catch((e) => { logErr(e); return null; });
  session.timers.vote = setTimeout(() => finishVote(session).catch(logErr), secs * 1000);
}

async function finishVote(session) {
  if (session.order.mode) return;
  clearTimeout(session.timers.vote);
  const { desc, asc } = voteTally(session);
  session.order.endsAt = null;
  let text;
  if (desc === asc) {
    text = `🗳️ **投票结束：${desc} 对 ${asc}${desc === 0 ? '（没人投票）' : '，平票'}**，由主厨决定抽奖顺序！`;
  } else {
    session.order.mode = desc > asc ? 'desc' : 'asc';
    text = `🗳️ **投票结束（${desc} 比 ${asc}）**：${session.order.mode === 'desc' ? '先抽第 3 名，最后揭晓第 1 名！' : '先抽第 1 名！'}`;
  }
  await closeVoteMessage(session, text);
}

async function closeVoteMessage(session, text) {
  const msg = session.order.message;
  if (msg) await msg.edit({ content: text, components: [] }).catch(logErr);
  else await say(session, text);
}

// 主厨在网页上直接指定顺序（会结束投票）
async function setOrder(session, mode) {
  if (!['asc', 'desc'].includes(mode)) return { ok: false, error: '顺序不正确' };
  if (session.winners.length > 0 || session.status !== 'idle') return { ok: false, error: '已经开始抽了，不能再改顺序' };
  const wasVoting = !!session.order.endsAt;
  clearTimeout(session.timers.vote);
  session.order.mode = mode;
  session.order.endsAt = null;
  if (wasVoting || session.order.message) {
    await closeVoteMessage(session, `🎡 主厨决定：${mode === 'desc' ? '先抽第 3 名，最后揭晓第 1 名！' : '先抽第 1 名！'}`);
  }
  return { ok: true };
}

// 按钮：成员投票
async function handleVoteButton(interaction) {
  const [, token, choice] = interaction.customId.split(':');
  const session = getSession(token);
  if (!session || session.order.mode || !session.order.endsAt) {
    return interaction.reply({ content: '这次投票已经结束了。', flags: MessageFlags.Ephemeral });
  }
  if (!session.testMode && !session.eligible.has(interaction.user.id)) {
    return interaction.reply({ content: '只有已解锁入场的人才能投票哦。', flags: MessageFlags.Ephemeral });
  }
  session.order.votes.set(interaction.user.id, choice === 'desc' ? 'desc' : 'asc');
  return interaction.reply({
    content: `✅ 已记录你的投票：${choice === 'desc' ? '先抽第 3 名，最后揭晓第 1 名' : '先抽第 1 名'}（时间内可以改票）`,
    flags: MessageFlags.Ephemeral,
  });
}

// 创建一场开奖。正式开奖会读取已保存的得奖者，中途断线也能接着抽。
async function createSession({ guild, channel, voiceChannel, testMode }) {
  const { participants, totalServerTickets, totalEntryUsers } = await getAllParticipantsSummary();
  if (participants.length === 0) throw new Error('NO_PARTICIPANTS');

  const target = Math.min(winnersFor(totalEntryUsers), participants.length);
  const upgraded = totalEntryUsers >= cfg.UPGRADE_ENTRY_THRESHOLD;

  let winners = [];
  if (!testMode) {
    const saved = await pool.query(`SELECT place, user_id, prize, tickets FROM draw_results ORDER BY place`);
    winners = saved.rows.map((r) => ({ place: r.place, userId: r.user_id, prize: r.prize, tickets: r.tickets }));
  }
  const winnerIds = new Set(winners.map((w) => w.userId));

  const candidates = participants
    .filter((p) => !winnerIds.has(p.userId))
    .map((p) => ({ userId: p.userId, tickets: p.totalTickets }));
  // 转盘上的排列随机打乱（只打乱一次，之后保持稳定；抽中谁只看签数，和排列无关）
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const info = await resolveMembers(guild, participants.map((p) => p.userId));

  // 同一个服务器同时只保留一场
  for (const s of [...sessions.values()]) if (s.guild.id === guild.id) closeSession(s);

  const session = {
    token: crypto.randomBytes(24).toString('hex'),
    guild,
    channel,
    voiceChannel,
    testMode,
    target,
    upgraded,
    totalServerTickets,
    totalEntryUsers,
    info,
    candidates,
    winners,
    absentCount: 0,
    status: winners.length >= target || candidates.length === 0 ? 'done' : 'idle', // idle | spinning | waiting | done
    order: { mode: initialOrderMode(winners, target), endsAt: null, votes: new Map(), message: null },
    eligible: new Set([...participants.map((p) => p.userId), ...winners.map((w) => w.userId)]),
    current: null,
    lastEvent: null,
    createdAt: Date.now(),
    timers: {},
    checking: false,
  };
  if (session.status !== 'done') sessions.set(session.token, session);
  return session;
}

function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL_MS) {
    closeSession(s);
    return null;
  }
  return s;
}

function nameOf(session, userId) {
  return session.info.get(userId)?.name || '神秘厨师';
}
function avatarOf(session, userId) {
  return session.info.get(userId)?.avatarUrl || null;
}

// 给网页用的状态（不含任何敏感信息）
function sessionState(session) {
  const cur = session.current;
  return {
    mode: session.testMode ? 'test' : 'live',
    status: session.status,
    target: session.target,
    entrants: session.totalEntryUsers,
    upgraded: session.upgraded,
    upgradeTop: cfg.UPGRADE_TOP_COUNT,
    claimSeconds: cfg.DRAW_CLAIM_SECONDS,
    animMs: ANIM_MS,
    channelName: session.voiceChannel?.name || null,
    totalTickets: session.candidates.reduce((s, c) => s + c.tickets, 0),
    participants: session.candidates.map((c) => ({ id: c.userId, name: nameOf(session, c.userId), tickets: c.tickets })),
    order: {
      mode: session.order.mode,
      endsAt: session.order.endsAt,
      votes: voteTally(session),
    },
    nextPlace: nextPlace(session),
    winners: [...session.winners].sort((a, b) => a.place - b.place).map((w) => ({
      place: w.place,
      tickets: w.tickets,
      id: w.userId,
      name: nameOf(session, w.userId),
      avatarUrl: avatarOf(session, w.userId),
      prize: w.prize,
    })),
    current: cur
      ? {
          id: cur.userId,
          name: nameOf(session, cur.userId),
          avatarUrl: avatarOf(session, cur.userId),
          place: cur.place,
          tickets: cur.tickets,
          deadline: cur.deadline,
        }
      : null,
    lastEvent: session.lastEvent,
    absentCount: session.absentCount,
    serverTime: Date.now(),
  };
}

function say(session, payload) {
  return session.channel.send(payload).catch(logErr);
}

function isPresent(session, userId) {
  if (session.testMode) return true;
  const vc = session.guild.channels.cache.get(session.voiceChannel.id);
  return !!vc && vc.members.has(userId);
}

// 网页点「转」：服务器决定抽谁
function spin(session) {
  if (session.status !== 'idle') return { ok: false, error: '现在不能转（正在转或已经开完）' };
  if (session.candidates.length === 0 || session.winners.length >= session.target) {
    return { ok: false, error: '名额已满' };
  }
  if (!session.order.mode) return { ok: false, error: '请先决定前 3 名的抽奖顺序（等投票结束，或在页面上直接选）' };
  const place = nextPlace(session);
  if (place === null) return { ok: false, error: '名额已满' };
  const picked = pickWeighted(session.candidates);
  const now = Date.now();
  session.current = {
    userId: picked.userId,
    tickets: picked.tickets,
    place,
    revealAt: now + ANIM_MS,
    deadline: now + ANIM_MS + cfg.DRAW_CLAIM_SECONDS * 1000,
  };
  session.status = 'spinning';
  session.timers.reveal = setTimeout(() => onReveal(session).catch(logErr), ANIM_MS);
  return { ok: true, userId: picked.userId, animMs: ANIM_MS };
}

// 转盘停下后：检查是否在场
async function onReveal(session) {
  if (!session.current) return;
  session.status = 'waiting';
  const cur = session.current;

  if (isPresent(session, cur.userId)) {
    await confirmWinner(session);
    return;
  }
  await say(
    session,
    `🎲 第 ${cur.place} 位抽到 <@${cur.userId}>！请在 **${cfg.DRAW_CLAIM_SECONDS} 秒**内进入 <#${session.voiceChannel.id}>！`
  );
  session.timers.poll = setInterval(() => checkPresence(session).catch(logErr), 1000);
}

async function checkPresence(session) {
  if (session.checking || session.status !== 'waiting' || !session.current) return;
  session.checking = true;
  try {
    const cur = session.current;
    if (isPresent(session, cur.userId)) {
      clearInterval(session.timers.poll);
      await confirmWinner(session);
    } else if (Date.now() >= cur.deadline) {
      clearInterval(session.timers.poll);
      await markAbsent(session);
    }
  } finally {
    session.checking = false;
  }
}

async function confirmWinner(session) {
  const cur = session.current;
  const place = cur.place;
  const prize = session.upgraded && place <= cfg.UPGRADE_TOP_COUNT ? 'ULTIMATE' : 'BLINDBOX';

  session.winners.push({ place, userId: cur.userId, prize, tickets: cur.tickets });
  session.candidates = session.candidates.filter((c) => c.userId !== cur.userId);
  session.lastEvent = { type: 'win', at: Date.now(), place, tickets: cur.tickets, id: cur.userId, name: nameOf(session, cur.userId), avatarUrl: avatarOf(session, cur.userId), prize };
  session.current = null;

  if (!session.testMode) {
    await pool.query(
      `INSERT INTO draw_results (place, user_id, prize, tickets) VALUES ($1, $2, $3, $4)
       ON CONFLICT (place) DO NOTHING`,
      [place, cur.userId, prize, cur.tickets]
    );
  }
  await say(session, `🎉 **第 ${place} 位**：<@${cur.userId}> ➔ ${PRIZE_TEXT[prize]}`);
  await finishIfDone(session);
}

async function markAbsent(session) {
  const cur = session.current;
  session.absentCount += 1;
  session.candidates = session.candidates.filter((c) => c.userId !== cur.userId);
  session.lastEvent = { type: 'absent', at: Date.now(), place: cur.place, id: cur.userId, name: nameOf(session, cur.userId), avatarUrl: avatarOf(session, cur.userId) };
  session.current = null;
  await say(session, `⏰ <@${cur.userId}> 没有在场，视为放弃，重新抽取！`);
  await finishIfDone(session);
}

async function finishIfDone(session) {
  if (session.winners.length < session.target && session.candidates.length > 0) {
    session.status = 'idle';
    return;
  }
  session.status = 'done';
  let stats =
    `入场总人数：**${session.totalEntryUsers} 人**（${session.upgraded ? `已触发 ${cfg.UPGRADE_ENTRY_THRESHOLD} 人豪华升级` : '未触发豪华升级'}）\n` +
    `签筒总签数：**${session.totalServerTickets} 张**\n` +
    `本期名额：**${session.target} 位**`;
  if (session.absentCount > 0) stats += `\n因不在场重抽：**${session.absentCount} 次**`;
  if (session.winners.length < session.target) stats += `\n⚠️ 有 ${session.target - session.winners.length} 个名额因无人在场而空缺`;

  await say(session, {
    content: session.testMode ? '🧪 **预演结束（结果没有保存）**' : '🎊 **叮咚！圣诞神秘礼物开奖结果正式出炉！**',
    embeds: [
      buildResultEmbed(session.winners, {
        stats,
        footer: session.testMode ? '这是预演结果，不作数' : '恭喜以上幸运伙伴！请等待主厨发放礼物~',
      }),
    ],
  });
}

module.exports = { createSession, getSession, sessionState, spin, buildResultEmbed, closeSession, startVote, setOrder, handleVoteButton };
