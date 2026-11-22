// 把前 9 名的头像、名字、签数画到排行榜模板图上
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const ASSETS = path.join(__dirname, '..', 'assets');
const FAMILY = 'KitchenSans';

// ---- 版面坐标（对应 assets/rank-template.png，1672×941）----
// 前三名领奖台：头像圆心/半径 + 名字栏里名字与签数的位置
const PODIUM = [
  { cx: 479, cy: 413, r: 70, plateX: 479, nameY: 570, nameSize: 28, maxW: 190, ticketY: 601 }, // 第 1 名
  { cx: 179, cy: 418, r: 66, plateX: 182, nameY: 570, nameSize: 26, maxW: 150, ticketY: 600 }, // 第 2 名
  { cx: 768, cy: 419, r: 65, plateX: 770, nameY: 570, nameSize: 26, maxW: 150, ticketY: 600 }, // 第 3 名
];
// 第 4-9 名：6 行
const ROW = { firstCy: 182.5, step: 89.4, avatarX: 1081, avatarR: 30, nameX: 1135, nameMaxW: 185, ticketRightX: 1395, size: 31 };

const INK = '#4A1D12';      // 名字：深棕
const RED = '#B3261E';      // 签数：圣诞红
const MUTED = 'rgba(74,29,18,0.4)';

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'KitchenSans-Bold.otf'), FAMILY);
  fontReady = true;
}

let templatePromise = null;
function getTemplate() {
  if (!templatePromise) templatePromise = loadImage(path.join(ASSETS, 'rank-template.png'));
  return templatePromise;
}

// 去掉表情符号等字体里没有的字符，避免出现方块
function cleanName(name) {
  const s = String(name || '')
    .replace(/[\p{Extended_Pictographic}‍️\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s || '厨房伙伴';
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxW) chars.pop();
  return chars.join('') + '…';
}

function drawText(ctx, text, x, y, size, fill, align, maxW) {
  ctx.font = `bold ${size}px ${FAMILY}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const shown = maxW ? fitText(ctx, text, maxW) : text;
  ctx.fillStyle = fill;
  ctx.fillText(shown, x, y);
}

function hashColor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${h % 360}, 45%, 45%)`;
}

async function drawAvatar(ctx, avatarBuf, cx, cy, r, name) {
  let img = null;
  if (avatarBuf) {
    try {
      img = await loadImage(avatarBuf);
    } catch (e) {
      img = null;
    }
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = hashColor(name);
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.round(r * 1.1)}px ${FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Array.from(name)[0] || '?', cx, cy);
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#8B2A1D';
  ctx.stroke();
}

// entries: [{ name, tickets, avatar(Buffer|null) }]，已按名次排好，最多用前 9 个
async function renderRankImage(entries) {
  ensureFont();
  const tpl = await getTemplate();
  const SCALE = 1; // 新模板本身已是 1672×941，不用再放大
  const canvas = createCanvas(tpl.width * SCALE, tpl.height * SCALE);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tpl, 0, 0, tpl.width * SCALE, tpl.height * SCALE);
  ctx.scale(SCALE, SCALE); // 之后所有坐标仍然按原图尺寸写

  // 前三名
  for (let i = 0; i < PODIUM.length && i < entries.length; i++) {
    const p = PODIUM[i];
    const e = entries[i];
    const name = cleanName(e.name);
    await drawAvatar(ctx, e.avatar, p.cx, p.cy, p.r, name);
    drawText(ctx, name, p.plateX, p.nameY, p.nameSize, INK, 'center', p.maxW);
    drawText(ctx, `${e.tickets} 签`, p.plateX, p.ticketY, 22, RED, 'center');
  }

  // 第 4-9 名
  for (let i = 0; i < 6; i++) {
    const cy = ROW.firstCy + ROW.step * i;
    const e = entries[i + 3];
    if (!e) {
      drawText(ctx, '虚位以待', ROW.nameX, cy, 28, MUTED, 'left');
      continue;
    }
    const name = cleanName(e.name);
    await drawAvatar(ctx, e.avatar, ROW.avatarX, cy, ROW.avatarR, name);
    drawText(ctx, name, ROW.nameX, cy, ROW.size, INK, 'left', ROW.nameMaxW);
    drawText(ctx, `${e.tickets} 签`, ROW.ticketRightX, cy, ROW.size, RED, 'right');
  }

  return canvas.toBuffer('image/png');
}

module.exports = { renderRankImage };
