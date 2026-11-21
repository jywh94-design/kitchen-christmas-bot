const { Pool } = require('pg');
const cfg = require('./config');
const { computeTickets } = require('./rules');

// Railway 的公网数据库地址需要 SSL；内网地址（railway.internal）不需要
const dbUrl = process.env.DATABASE_URL || '';
const useSsl =
  process.env.DATABASE_SSL === 'true' ||
  ((dbUrl.includes('rlwy.net') || dbUrl.includes('railway.app')) && !dbUrl.includes('railway.internal'));

const pool = new Pool({
  connectionString: dbUrl,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => console.error('数据库连接池异常:', err.message));

// 启动时自动建表（可重复执行，不会清掉已有数据）
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_stats (
      user_id VARCHAR(32) PRIMARY KEY,
      voice_seconds INT DEFAULT 0,
      valid_messages INT DEFAULT 0,
      has_entry_role BOOLEAN DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS daily_activity (
      user_id VARCHAR(32),
      activity_date VARCHAR(10),
      voice_seconds INT DEFAULT 0,
      valid_messages INT DEFAULT 0,
      is_valid_day BOOLEAN DEFAULT FALSE,
      PRIMARY KEY (user_id, activity_date)
    );

    CREATE TABLE IF NOT EXISTS invite_records (
      invitee_id VARCHAR(32) PRIMARY KEY,
      inviter_id VARCHAR(32) NOT NULL,
      invite_code VARCHAR(32),
      is_verified BOOLEAN DEFAULT FALSE,
      joined_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE invite_records ADD COLUMN IF NOT EXISTS joined_date VARCHAR(10);
    ALTER TABLE invite_records ADD COLUMN IF NOT EXISTS left_guild BOOLEAN DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_invite_inviter ON invite_records (inviter_id);

    CREATE TABLE IF NOT EXISTS draw_results (
      place INT PRIMARY KEY,
      user_id VARCHAR(32) NOT NULL,
      prize VARCHAR(16) NOT NULL,
      tickets INT DEFAULT 0,
      drawn_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ PostgreSQL 数据库表结构初始化完成');
}

// ---------- 马来西亚时间工具 ----------
const MY_TZ = 'Asia/Kuala_Lumpur';

function getMYParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((p) => p.type === type).value;
  const year = Number(pick('year'));
  const month = Number(pick('month'));
  const day = Number(pick('day'));
  return {
    year,
    month,
    day,
    dateString: `${pick('year')}-${pick('month')}-${pick('day')}`,
  };
}

// 当前马来西亚日期 YYYY-MM-DD
function getMYDateString() {
  return getMYParts().dateString;
}

function getEventWindow() {
  return {
    start: new Date(process.env.EVENT_START_ISO || '2026-12-01T00:00:00+08:00').getTime(),
    end: new Date(process.env.EVENT_END_ISO || '2026-12-23T23:59:59+08:00').getTime(),
  };
}

// 是否在活动统计期内
function isEventActive() {
  const now = Date.now();
  const { start, end } = getEventWindow();
  return now >= start && now <= end;
}

// ---------- 活跃数据累加 ----------
async function addActivity(userId, { voiceSec = 0, msgCount = 0 }) {
  if (!isEventActive()) return null;
  const dateStr = getMYDateString();
  const reqVoiceSec = cfg.DAILY_VOICE_MINUTES * 60;
  const reqMsgCount = cfg.DAILY_MESSAGES;

  await pool.query(
    `INSERT INTO user_stats (user_id, voice_seconds, valid_messages)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       voice_seconds = user_stats.voice_seconds + $2,
       valid_messages = user_stats.valid_messages + $3,
       updated_at = NOW()`,
    [userId, voiceSec, msgCount]
  );

  const res = await pool.query(
    `INSERT INTO daily_activity (user_id, activity_date, voice_seconds, valid_messages, is_valid_day)
     VALUES ($1, $2, $3, $4, ($3 >= $5 OR $4 >= $6))
     ON CONFLICT (user_id, activity_date) DO UPDATE SET
       voice_seconds = daily_activity.voice_seconds + $3,
       valid_messages = daily_activity.valid_messages + $4,
       is_valid_day = ((daily_activity.voice_seconds + $3) >= $5 OR (daily_activity.valid_messages + $4) >= $6)
     RETURNING is_valid_day`,
    [userId, dateStr, voiceSec, msgCount, reqVoiceSec, reqMsgCount]
  );

  // 如果这个人是被邀请来的：只统计他「入群之后」的有效日，满 INVITE_VERIFY_DAYS 天才算有效拉新
  if (res.rows[0]?.is_valid_day) {
    const inv = await pool.query(
      `SELECT joined_date FROM invite_records WHERE invitee_id = $1 AND is_verified = FALSE`,
      [userId]
    );
    if (inv.rows[0]) {
      const since = inv.rows[0].joined_date || '0000-00-00';
      const cnt = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM daily_activity
         WHERE user_id = $1 AND is_valid_day = TRUE AND activity_date >= $2`,
        [userId, since]
      );
      if (cnt.rows[0].cnt >= cfg.INVITE_VERIFY_DAYS) {
        await pool.query(`UPDATE invite_records SET is_verified = TRUE WHERE invitee_id = $1`, [userId]);
      }
    }
  }

  return await getUserTicketSummary(userId);
}

// ---------- 签数汇总 ----------
const SUMMARY_SQL = `
  SELECT s.user_id, s.voice_seconds, s.valid_messages, s.has_entry_role,
         COALESCE(d.valid_days, 0) AS valid_days,
         COALESCE(i.cnt, 0) AS verified_invites
  FROM user_stats s
  LEFT JOIN (
    SELECT user_id, COUNT(*)::int AS valid_days
    FROM daily_activity WHERE is_valid_day = TRUE GROUP BY user_id
  ) d ON d.user_id = s.user_id
  LEFT JOIN (
    SELECT inviter_id, COUNT(*)::int AS cnt
    FROM invite_records
    WHERE is_verified = TRUE AND NOT COALESCE(left_guild, FALSE)
    GROUP BY inviter_id
  ) i ON i.inviter_id = s.user_id
`;

function toSummary(row) {
  const t = computeTickets({
    validDays: row.valid_days,
    voiceSeconds: row.voice_seconds,
    validMessages: row.valid_messages,
    verifiedInvites: row.verified_invites,
  });
  return {
    userId: row.user_id,
    ...t,
    hasEntryRole: row.has_entry_role,
    validDays: row.valid_days,
    voiceSeconds: row.voice_seconds,
    validMessages: row.valid_messages,
    verifiedInvites: row.verified_invites,
  };
}

async function getUserTicketSummary(userId) {
  const res = await pool.query(`${SUMMARY_SQL} WHERE s.user_id = $1`, [userId]);
  if (res.rows[0]) return toSummary(res.rows[0]);
  // 还没有任何记录的新用户
  return toSummary({
    user_id: userId,
    voice_seconds: 0,
    valid_messages: 0,
    has_entry_role: false,
    valid_days: 0,
    verified_invites: 0,
  });
}

// 全服统计：只有已解锁入场的人才算参与者
async function getAllParticipantsSummary() {
  const res = await pool.query(SUMMARY_SQL);
  const participants = [];
  let totalServerTickets = 0;
  let totalEntryUsers = 0;

  for (const row of res.rows) {
    const summary = toSummary(row);
    if (summary.unlockedEntry && summary.totalTickets > 0) {
      participants.push(summary);
      totalServerTickets += summary.totalTickets;
      totalEntryUsers += 1;
    }
  }

  return { participants, totalServerTickets, totalEntryUsers };
}

module.exports = {
  pool,
  initDB,
  getMYParts,
  getMYDateString,
  getEventWindow,
  isEventActive,
  addActivity,
  getUserTicketSummary,
  getAllParticipantsSummary,
};
