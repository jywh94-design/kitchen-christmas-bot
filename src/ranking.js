// 排行榜：排序、取头像和名字、生成图片（60 秒内重复查看会直接用缓存）
const { getAllParticipantsSummary } = require('./db');
const { renderRankImage } = require('./rankImage');
const { resolveMembers } = require('./members');

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
  const top = sorted.slice(0, TOP_N);

  const info = await resolveMembers(guild, top.map((p) => p.userId));
  const entries = await Promise.all(
    top.map(async (p) => {
      const i = info.get(p.userId);
      return { name: i.name, tickets: p.totalTickets, avatar: await fetchAvatar(i.avatarUrl) };
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
