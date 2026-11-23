// 运行：npm test
const assert = require('assert');
const { computeTickets, winnersFor, nextWinnerStep, nextTier, entryNeededForMaxWinners } = require('../src/rules');

// ---- 得奖名额 ----
const expectWinners = { 0: 3, 9: 3, 10: 4, 13: 4, 14: 5, 17: 5, 18: 6, 22: 7, 26: 8, 30: 9, 33: 9, 34: 10, 45: 10, 80: 10 };
for (const [entry, want] of Object.entries(expectWinners)) {
  assert.strictEqual(winnersFor(Number(entry)), want, `入场 ${entry} 人应该抽 ${want} 位`);
}
assert.deepStrictEqual(nextWinnerStep(9), { need: 1, count: 4 });
assert.deepStrictEqual(nextWinnerStep(10), { need: 4, count: 5 });
assert.deepStrictEqual(nextWinnerStep(33), { need: 1, count: 10 });
assert.strictEqual(nextWinnerStep(34), null);
assert.strictEqual(entryNeededForMaxWinners(), 34);

// ---- 签数 ----
// 没解锁入场：就算语音、聊天、拉新很多，也一律 0 签
let t = computeTickets({ validDays: 4, voiceSeconds: 99 * 3600, validMessages: 999, verifiedInvites: 9 });
assert.strictEqual(t.totalTickets, 0);
assert.strictEqual(t.unlockedEntry, false);

// 刚好入场：1 签
t = computeTickets({ validDays: 5 });
assert.strictEqual(t.totalTickets, 1);

// 语音阶梯 3 / 6 小时
assert.strictEqual(computeTickets({ validDays: 5, voiceSeconds: 3 * 3600 }).totalTickets, 2);
assert.strictEqual(computeTickets({ validDays: 5, voiceSeconds: 6 * 3600 }).totalTickets, 3);
assert.strictEqual(computeTickets({ validDays: 5, voiceSeconds: 3 * 3600 - 1 }).totalTickets, 1);

// 天数阶梯
assert.strictEqual(computeTickets({ validDays: 7 }).totalTickets, 2);
assert.strictEqual(computeTickets({ validDays: 14 }).totalTickets, 6);

// 全满：日常 10 + 拉新 5 = 15；拉新超过 5 也不会多
t = computeTickets({ validDays: 20, voiceSeconds: 99 * 3600, validMessages: 999, verifiedInvites: 9 });
assert.strictEqual(t.baseTickets, 10);
assert.strictEqual(t.bonusInviteTickets, 5);
assert.strictEqual(t.totalTickets, 15);

// ---- 下一档 ----
assert.strictEqual(nextTier([7, 9, 11], 8), 9);
assert.strictEqual(nextTier([7, 9, 11], 11), null);

console.log('✅ 所有规则测试通过');
