// 圣诞排行榜：使用 assets/rank-template.png (1672 x 941)
// 自动在空白圆框及姓名栏中绘制前九名成员头像、昵称和幸运签数。
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const ASSETS = path.join(__dirname, '..', 'assets');
const FAMILY = 'KitchenSans';

// 原图坐标。前三名依次为：金、银、铜。
const PODIUM = [
  { cx: 475, cy: 411, r: 71, nameX: 474, nameY: 565, ticketY: 602, fontSize: 34, maxNameW: 268, ticketSize: 25 },
  { cx: 176, cy: 414, r: 65, nameX: 179, nameY: 565, ticketY: 599, fontSize: 28, maxNameW: 219, ticketSize: 23 },
  { cx: 758, cy: 416, r: 66, nameX: 757, nameY: 565, ticketY: 599, fontSize: 28, maxNameW: 211, ticketSize: 23 },
];

// 右侧第 4–9 名，保留底图的名次编号、圆框和雪花图案。
const ROW = {
  avatarX: 1065,
  avatarR: 30,
  centersY: [181, 269, 358, 445, 532, 620],
  nameX: 1116,
  nameMaxW: 196,
  ticketX: 1370,
  nameSize: 27,
  ticketSize: 24,
};

const INK = '#64210F';
const RED = '#A92315';
const OUTLINE = 'rgba(255,244,221,0.98)';

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  const ok = GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'KitchenSans-Bold.otf'), FAMILY);
  if (!ok) console.warn('排行榜字体注册失败，将使用系统字体');
  fontReady = true;
}

let templatePromise;
function getTemplate() {
  if (!templatePromise) templatePromise = loadImage(path.join(ASSETS, 'rank-template.png'));
  return templatePromise;
}

function cleanName(name) {
  return String(name || '')
    .replace(/[\p{Extended_Pictographic}\u200D\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim() || '厨房伙伴';
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxW) chars.pop();
  return chars.join('') + '…';
}

function drawLabel(ctx, value, x, y, size, maxW, color = INK, align = 'center') {
  ctx.save();
  ctx.font = `bold ${size}px "${FAMILY}", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUTLINE;
  const label = fitText(ctx, String(value), maxW);
  ctx.strokeText(label, x, y);
  ctx.fillStyle = color;
  ctx.fillText(label, x, y);
  ctx.restore();
}

function hashColor(seed) {
  let h = 0;
  for (const char of String(seed)) h = (h * 31 + char.codePointAt(0)) >>> 0;
  return `hsl(${h % 360}, 44%, 58%)`;
}

async function drawAvatar(ctx, avatarBuffer, cx, cy, radius, name) {
  let img;
  if (avatarBuffer) {
    try { img = await loadImage(avatarBuffer); } catch { /* 使用默认头像 */ }
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    // 裁切为正方形（cover），避免头像被拉长。
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = hashColor(name);
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = '#FFF9E6';
    ctx.font = `bold ${Math.round(radius)}px "${FAMILY}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Array.from(name)[0] || '?', cx, cy);
  }
  ctx.restore();
}

// entries: [{ name, tickets, avatar: Buffer|null }], 第 1–9 名顺序由 ranking.js 处理。
async function renderRankImage(entries) {
  ensureFont();
  const template = await getTemplate();
  // 模板原生已有 1672x941；不再盲目放大到 3344x1882，避免 Discord 附件过大。
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(template, 0, 0);

  // 坐标基于 1672 x 941；若之后更换为不同分辨率的同布局模板，也能自适应。
  ctx.save();
  ctx.scale(template.width / 1672, template.height / 941);

  for (let i = 0; i < 3; i++) {
    const e = entries[i];
    if (!e) continue;
    const p = PODIUM[i];
    const name = cleanName(e.name);
    await drawAvatar(ctx, e.avatar, p.cx, p.cy, p.r, name);
    drawLabel(ctx, name, p.nameX, p.nameY, p.fontSize, p.maxNameW);
    drawLabel(ctx, `${e.tickets} 签`, p.nameX, p.ticketY, p.ticketSize, p.maxNameW, RED);
  }

  for (let i = 0; i < 6; i++) {
    const y = ROW.centersY[i];
    const e = entries[i + 3];
    if (!e) {
      drawLabel(ctx, '虚位以待', ROW.nameX, y, ROW.nameSize, ROW.nameMaxW, '#A27C62', 'left');
      continue;
    }
    const name = cleanName(e.name);
    await drawAvatar(ctx, e.avatar, ROW.avatarX, y, ROW.avatarR, name);
    drawLabel(ctx, name, ROW.nameX, y, ROW.nameSize, ROW.nameMaxW, INK, 'left');
    drawLabel(ctx, `${e.tickets} 签`, ROW.ticketX, y, ROW.ticketSize, 110, RED, 'right');
  }

  ctx.restore();
  return canvas.toBuffer('image/png');
}

module.exports = { renderRankImage };
