// 批量查成员的名字和头像（一次请求查一批，避免被 Discord 限速）
const FAKE_PREFIX = '999000'; // /test-simulate 注入的模拟玩家

async function resolveMembers(guild, ids) {
  const result = new Map();
  const real = ids.filter((id) => !id.startsWith(FAKE_PREFIX));
  const found = new Map();

  for (let i = 0; i < real.length; i += 100) {
    try {
      const batch = await guild.members.fetch({ user: real.slice(i, i + 100), time: 15000 });
      batch.forEach((m) => found.set(m.id, m));
    } catch (err) {
      console.error('批量查询成员失败:', err.message);
    }
  }

  for (const id of ids) {
    if (id.startsWith(FAKE_PREFIX)) {
      result.set(id, { name: `模拟玩家${id.slice(-2)}`, avatarUrl: null });
      continue;
    }
    const m = found.get(id) || guild.members.cache.get(id);
    if (m) {
      result.set(id, {
        name: m.displayName,
        avatarUrl: m.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
      });
      continue;
    }
    // 已经退群的人：退而求其次查用户本身
    try {
      const u = await guild.client.users.fetch(id);
      result.set(id, {
        name: u.globalName || u.username,
        avatarUrl: u.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }),
      });
    } catch (e) {
      result.set(id, { name: '神秘厨师', avatarUrl: null });
    }
  }
  return result;
}

module.exports = { resolveMembers };
