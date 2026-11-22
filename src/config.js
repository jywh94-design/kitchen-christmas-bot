const cfg = {
  // ================= 1. 每日有效打卡判定 =================
  DAILY_VOICE_MINUTES: 30,     // 每天有效开麦满多少分钟算打卡1天
  DAILY_MESSAGES: 25,          // 或者每天有效聊天满多少条算打卡1天

  // ================= 2. 语音与文字防作弊参数 =================
  MIN_VOICE_HUMANS: 2,         // 语音频道内至少有几名「开麦且没关听筒」的真人，才给这些人计时
  MIN_MESSAGE_LENGTH: 4,       // 有效聊天最少需要多少个字
  MESSAGE_COOLDOWN_SEC: 60,    // 有效聊天冷却时间/秒（60 秒最多计 1 条）

  // ================= 3. 幸运签规则与上限 =================
  MAX_BASE_TICKETS: 10,        // 日常签上限
  MAX_INVITE_TICKETS: 5,       // 拉新签上限（额外）

  ENTRY_VALID_DAYS: 5,         // 累计有效打卡满几天解锁入场（得1签 + 身份组）。没解锁入场的人，总签数一律为 0

  STREAK_DAY_TIERS: [7, 9, 11, 13, 14],  // 累计有效日阶梯，每档 +1 签
  VOICE_HOUR_TIERS: [3, 6],              // 累计有效语音（小时）阶梯，每档 +1 签
  TOTAL_MESSAGE_TIERS: [100, 200],       // 累计有效聊天（条）阶梯，每档 +1 签

  // ================= 4. 拉新转正判定 =================
  INVITE_VERIFY_DAYS: 2,       // 新人「入群之后」有效打卡满几天，才算有效拉新

  // ================= 5. 开奖：名额随入场人数增加 =================
  CHRISTMAS_WINNERS_COUNT: 10,   // 得奖名额上限
  WINNERS_BASE: 3,               // 入场人数不满 WINNERS_FIRST_STEP_ENTRY 时的保底名额
  WINNERS_FIRST_STEP_ENTRY: 15,  // 入场满这个人数，名额 +1（即 4 位）
  WINNERS_STEP_USERS: 5,         // 之后每多这么多人入场，名额再 +1，直到上限

  UPGRADE_ENTRY_THRESHOLD: 45,   // 入场人数达到多少人，触发大奖升级
  UPGRADE_TOP_COUNT: 3,          // 触发后，最先抽出的几位升级为「主厨豪华至尊大礼」

  DRAW_CLAIM_SECONDS: 30,        // 被抽中后，多少秒内必须在直播语音频道，否则当场重抽

  // ================= 6. 安全保护 =================
  // 这个时间点之后，/test-simulate 的「清空」会被拒绝（除非 Railway 变量里设置 ALLOW_RESET=true）
  PROTECT_RESET_FROM_ISO: '2026-12-01T00:00:00+08:00',
};

// ================= 7. 快速测试模式（只用于实测）=================
// 在 Railway 变量里加 TEST_FAST=true，门槛就会大幅放宽，几个人一小时内能测完整个流程。
// 安全保护：到 12月1日 00:00 之后，这个开关会自动失效，不会误伤正式活动。
const fastRequested = process.env.TEST_FAST === 'true';
const fastAllowed = Date.now() < new Date(cfg.PROTECT_RESET_FROM_ISO).getTime();
cfg.TEST_FAST = fastRequested && fastAllowed;

if (cfg.TEST_FAST) {
  Object.assign(cfg, {
    DAILY_VOICE_MINUTES: 1,        // 开麦满 1 分钟算 1 个有效日
    DAILY_MESSAGES: 3,             // 聊天满 3 条算 1 个有效日
    MESSAGE_COOLDOWN_SEC: 15,      // 聊天冷却缩短到 15 秒
    ENTRY_VALID_DAYS: 1,           // 1 个有效日就入场
    INVITE_VERIFY_DAYS: 1,         // 朋友 1 个有效日就算有效拉新
    VOICE_HOUR_TIERS: [0.02, 0.05],   // 约 1.2 分钟、3 分钟各 +1 签
    TOTAL_MESSAGE_TIERS: [5, 10],     // 5 条、10 条各 +1 签
    DRAW_CLAIM_SECONDS: 15,        // 被抽到后 15 秒内要在场
  });
  console.warn('⚠️ 快速测试模式已开启（TEST_FAST=true）：规则门槛已放宽，仅用于实测！');
} else if (fastRequested && !fastAllowed) {
  console.warn('⚠️ 已过 12月1日，TEST_FAST 开关自动失效，使用正式规则。请在 Railway 里删掉这个变量。');
}

module.exports = cfg;
