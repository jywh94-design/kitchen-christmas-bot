// 排行榜：排序、取头像和名字、生成图片（60 秒内重复查看会直接用缓存）
const { getAllParticipantsSummary } = require('./db');
const { renderRankImage } = require('./rankImage');

const CACHE_MS = 60 * 1000;
const TOP_N = 9;
let cache = null;

function invalidateRankCache() {
  cache = null;
}

// 排序规则：签数多的在前；签数相同，比有效打卡天数，再比语音时长，再比聊天数
function compare(a, b) {
  return (
    b.totalTickets - a.totalTickets ||
    b.validDays - a.validDays ||
    b.voiceSeconds - a.voiceSeconds ||
    b.validMessages - a.validMessages ||
    (a.userId < b.userId ? -1 : 1)
  );
}

async function resolveMember(guild, userId) {
  // 测试数据里的模拟玩家
  if (userId.startsWith('999000')) {
    return { name: `模拟玩家${userId.slice(-2)}`, avatarUrl: null };
  }
  try {
    const m = await guild.members.fetch(userId);
    return { name: m.displayName, avatarUrl: m.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }) };
  } catch (e) {
    try {
      const u = await guild.client.users.fetch(userId);
      return { name: u.globalName || u.username, avatarUrl: u.displayAvatarURL({ extension: 'png', size: 128, forceStatic: true }) };
    } catch (e2) {
      return { name: '神秘厨师', avatarUrl: null };
    }
  }
}

async function fetchAvatar(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return null;
  }
}

async function getRanking(guild, { force = false } = {}) {
  if (!force && cache && Date.now() - cache.ts < CACHE_MS) return cache.data;

  const { participants, totalServerTickets, totalEntryUsers } = await getAllParticipantsSummary();
  const sorted = [...participants].sort(compare);

  const entries = await Promise.all(
    sorted.slice(0, TOP_N).map(async (p) => {
      const info = await resolveMember(guild, p.userId);
      return { name: info.name, tickets: p.totalTickets, avatar: await fetchAvatar(info.avatarUrl) };
    })
  );

  const image = await renderRankImage(entries);
  const data = { image, sorted, totalServerTickets, totalEntryUsers };
  cache = { ts: Date.now(), data };
  return data;
}

// 某个人当前的名次（没解锁入场则返回 null）
function rankOf(data, userId) {
  const i = data.sorted.findIndex((p) => p.userId === userId);
  return i === -1 ? null : { rank: i + 1, tickets: data.sorted[i].totalTickets };
}

module.exports = { getRanking, rankOf, invalidateRankCache };
