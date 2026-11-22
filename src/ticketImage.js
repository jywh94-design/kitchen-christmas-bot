// 把「我的幸运签筒」画成一张圣诞风图片（坐标对应 assets/tickets/template.png，1346×758）
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const DIR = path.join(__dirname, '..', 'assets');
const FAMILY = 'KitchenSans';

const INK = '#4A1D12';       // 深棕
const RED = '#B3261E';       // 圣诞红
const CREAM = '#FFF1D6';     // 红色横幅上的字
const MUTED = 'rgba(74,29,18,0.45)';

// ---- 版面坐标 ----
const L = {
  greeting: { x: 566, y: 136, size: 24, maxW: 545 },
  cards: [
    { cx: 642, cy: 252, size: 46, color: RED }, // 当前总幸运签
    { cx: 900, cy: 252, size: 40, color: INK }, // 日常签
    { cx: 1150, cy: 252, size: 40, color: INK }, // 拉新签
  ],
  bar: { sx: 681, sy: 307, innerLeft: 693, innerW: 402 }, // 进度条素材左上角、绿色区域起点和宽度
  pct: { cx: 1160, cy: 336, size: 30 },
  check: { x: 1213, y: 307 },
  rowsY: [470, 506, 543, 580],
  rowsX: 668,
  rowsMaxW: 190,
  tip: { x: 925, y: 487, lineH: 32, size: 22, maxW: 250, maxLines: 4 },
  footer: { cx: 840, cy: 655, size: 25, maxW: 560 },
};

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  if (typeof GlobalFonts.has !== 'function' || !GlobalFonts.has(FAMILY)) {
    GlobalFonts.registerFromPath(path.join(DIR, 'fonts', 'KitchenSans-Bold.otf'), FAMILY);
  }
  fontReady = true;
}

let assets = null;
function getAssets() {
  if (!assets) {
    assets = Promise.all([
      loadImage(path.join(DIR, 'tickets', 'template.png')),
      loadImage(path.join(DIR, 'tickets', 'bar-full.png')),
      loadImage(path.join(DIR, 'tickets', 'check.png')),
    ]).then(([template, barFull, check]) => ({ template, barFull, check }));
  }
  return assets;
}

function clean(s) {
  return String(s ?? '')
    .replace(/[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function setFont(ctx, size) {
  ctx.font = `bold ${size}px ${FAMILY}`;
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxW) chars.pop();
  return chars.join('') + '…';
}

function text(ctx, str, x, y, size, fill, align = 'left', maxW = 0) {
  setFont(ctx, size);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fill;
  ctx.fillText(maxW ? fit(ctx, str, maxW) : str, x, y);
}

// 按宽度自动换行（中文一个字一个字量）
function wrap(ctx, str, size, maxW, maxLines) {
  setFont(ctx, size);
  const lines = [];
  let cur = '';
  for (const ch of Array.from(str)) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = fit(ctx, lines[maxLines - 1] + '…', maxW);
  }
  return lines;
}

/**
 * v = {
 *   username, total, maxTotal, base, maxBase, invite, maxInvite,
 *   entryPct (0-100), rows: [string x4] | null, hint, footer
 * }
 */
async function renderTicketImage(v) {
  ensureFont();
  const { template, barFull, check } = await getAssets();
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(template, 0, 0);

  // 1) 问候语（红色横幅）
  setFont(ctx, L.greeting.size);
  const prefix = '你好 ';
  const suffix = '，这是你目前的攒签状态：';
  const room = L.greeting.maxW - ctx.measureText(prefix + suffix).width;
  const name = fit(ctx, clean(v.username) || '厨房伙伴', Math.max(80, room));
  text(ctx, `${prefix}${name}${suffix}`, L.greeting.x, L.greeting.y, L.greeting.size, CREAM, 'left', L.greeting.maxW);

  // 2) 三张数字卡片
  const nums = [`${v.total}/${v.maxTotal}`, `${v.base}/${v.maxBase}`, `${v.invite}/${v.maxInvite}`];
  nums.forEach((s, i) => {
    const c = L.cards[i];
    text(ctx, s, c.cx, c.cy, c.size, c.color, 'center');
  });

  // 3) 入场进度条：先画好的「空槽」在模板里，这里把绿色填充按比例盖上去
  const pct = Math.max(0, Math.min(100, Math.round(v.entryPct)));
  if (pct > 0) {
    ctx.save();
    ctx.beginPath();
    const clipRight = pct >= 100 ? L.bar.sx + barFull.width : L.bar.innerLeft + (L.bar.innerW * pct) / 100;
    ctx.rect(L.bar.sx, L.bar.sy, clipRight - L.bar.sx, barFull.height);
    ctx.clip();
    ctx.drawImage(barFull, L.bar.sx, L.bar.sy);
    ctx.restore();
  }
  text(ctx, `${pct}%`, L.pct.cx, L.pct.cy, L.pct.size, INK, 'center');
  if (pct >= 100) ctx.drawImage(check, L.check.x, L.check.y);

  // 4) 下一档进度（四行）
  for (let i = 0; i < 4; i++) {
    const y = L.rowsY[i];
    if (v.rows) text(ctx, v.rows[i], L.rowsX, y, 24, INK, 'left', L.rowsMaxW);
    else text(ctx, '入场后解锁', L.rowsX, y, 22, MUTED, 'left', L.rowsMaxW);
  }

  // 5) 小贴士
  const lines = wrap(ctx, clean(v.hint), L.tip.size, L.tip.maxW, L.tip.maxLines);
  lines.forEach((ln, i) => text(ctx, ln, L.tip.x, L.tip.y + i * L.tip.lineH, L.tip.size, INK, 'left'));

  // 6) 底部提示条
  text(ctx, clean(v.footer), L.footer.cx, L.footer.cy, L.footer.size, CREAM, 'center', L.footer.maxW);

  return canvas.toBuffer('image/png');
}

module.exports = { renderTicketImage };
