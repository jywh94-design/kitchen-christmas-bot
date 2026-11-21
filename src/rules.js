// 纯计算规则（不碰数据库、不碰 Discord），方便单独测试
const cfg = require('./config');

// 根据一个人的统计数据，算出他的签数
function computeTickets({ validDays = 0, voiceSeconds = 0, validMessages = 0, verifiedInvites = 0 }) {
  const unlockedEntry = validDays >= cfg.ENTRY_VALID_DAYS;

  // 没解锁入场：所有签都不算（避免有人没入场却进了抽奖池）
  if (!unlockedEntry) {
    return { unlockedEntry: false, baseTickets: 0, bonusInviteTickets: 0, totalTickets: 0 };
  }

  let raw = 1; // 入场签
  raw += cfg.STREAK_DAY_TIERS.filter((d) => validDays >= d).length;
  raw += cfg.VOICE_HOUR_TIERS.filter((h) => voiceSeconds >= h * 3600).length;
  raw += cfg.TOTAL_MESSAGE_TIERS.filter((m) => validMessages >= m).length;

  const baseTickets = Math.min(raw, cfg.MAX_BASE_TICKETS);
  const bonusInviteTickets = Math.min(verifiedInvites, cfg.MAX_INVITE_TICKETS);

  return {
    unlockedEntry: true,
    baseTickets,
    bonusInviteTickets,
    totalTickets: baseTickets + bonusInviteTickets,
  };
}

// 下一个还没达到的档位（已全部达到则返回 null）
function nextTier(tiers, value) {
  const t = tiers.find((x) => value < x);
  return t === undefined ? null : t;
}

// 根据全服入场人数，算出得奖名额
function winnersFor(entryUsers) {
  const max = cfg.CHRISTMAS_WINNERS_COUNT;
  if (entryUsers < cfg.WINNERS_FIRST_STEP_ENTRY) return Math.min(cfg.WINNERS_BASE, max);
  const extra = Math.floor((entryUsers - cfg.WINNERS_FIRST_STEP_ENTRY) / cfg.WINNERS_STEP_USERS) + 1;
  return Math.min(max, cfg.WINNERS_BASE + extra);
}

// 再有多少人入场，名额会 +1（名额已满则返回 null）
function nextWinnerStep(entryUsers) {
  const current = winnersFor(entryUsers);
  if (current >= cfg.CHRISTMAS_WINNERS_COUNT) return null;
  const first = cfg.WINNERS_FIRST_STEP_ENTRY;
  const step = cfg.WINNERS_STEP_USERS;
  const nextThreshold =
    entryUsers < first ? first : first + (Math.floor((entryUsers - first) / step) + 1) * step;
  return { need: nextThreshold - entryUsers, count: current + 1 };
}

// 名额封顶需要的入场人数（给 /help-event 显示用）
function entryNeededForMaxWinners() {
  const stepsNeeded = cfg.CHRISTMAS_WINNERS_COUNT - cfg.WINNERS_BASE - 1;
  return cfg.WINNERS_FIRST_STEP_ENTRY + Math.max(0, stepsNeeded) * cfg.WINNERS_STEP_USERS;
}

module.exports = { computeTickets, nextTier, winnersFor, nextWinnerStep, entryNeededForMaxWinners };
