// 不参与活动的账号（已知小号、不参加的管理员等）
// 在 Railway 变量里设置：EXCLUDED_USER_IDS=用户ID1,用户ID2,用户ID3
function list() {
  return (process.env.EXCLUDED_USER_IDS || '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{5,25}$/.test(s));
}

function isExcluded(userId) {
  return list().includes(String(userId));
}

// 给 SQL 用的列表（已确认全是数字，安全）；没有名单时给一个不会匹配的占位值
function sqlList() {
  const ids = list();
  return ids.length ? ids.map((id) => `'${id}'`).join(',') : "'0'";
}

module.exports = { isExcluded, excludedIds: list, sqlList };
