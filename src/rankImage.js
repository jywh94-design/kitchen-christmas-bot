// 把前 9 名的头像、名字、签数画到排行榜模板图上
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const ASSETS = path.join(__dirname, '..', 'assets');
const FAMILY = 'KitchenSans';

// ---- 版面坐标（对应 assets/rank/template.png，1672×941）----
// 头像位置和形状来自 assets/rank/slots.json（9 个圆）和 assets/rank/mask.png（把头像裁进圆圈）
// 前三名名字栏里名字与签数的位置：
const PODIUM = [
  { plateX: 488, nameY: 566, size: 28, maxW: 160, ticketY: 626 }, // 第 1 名
  { plateX: 187, nameY: 567, size: 26, maxW: 104, ticketY: 619 }, // 第 2 名
  { plateX: 767, nameY: 567, size: 26, maxW: 108, ticketY: 619 }, // 第 3 名
];
// 第 4-9 名：6 行；名字在奶油色条里，签数在右边红色区
const ROW = { nameX: 1163, nameMaxW: 235, ticketCx: 1510, size: 31, ticketSize: 30 };

const INK = '#4A1D12';      // 名字：深棕
const RED = '#B3261E';      // 签数：圣诞红
const MUTED = 'rgba(74,29,18,0.4)';
const CREAM = '#FFF1D6';

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  GlobalFonts.registerFromPath(path.join(ASSETS, 'fonts', 'KitchenSans-Bold.otf'), FAMILY);
  fontReady = true;
}

const SLOTS = require(path.join(ASSETS, 'rank', 'slots.json')); // [第1,第2,第3,第4..第9名]

let assetsPromise = null;
function getAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      loadImage(path.join(ASSETS, 'rank', 'template.png')),
      loadImage(path.join(ASSETS, 'rank', 'mask.png')),
    ]).then(([template, mask]) => ({ template, mask }));
  }
  return assetsPromise;
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

// 把头像画成方形铺满这个位置（之后统一用 mask.png 裁成圆形）
async function drawAvatarSquare(ctx, avatarBuf, slot, name) {
  let img = null;
  if (avatarBuf) {
    try {
      img = await loadImage(avatarBuf);
    } catch (e) {
      img = null;
    }
  }
  const x = slot.cx - slot.R;
  const y = slot.cy - slot.R;
  const size = slot.R * 2;
  if (img) {
    ctx.drawImage(img, x, y, size, size);
  } else {
    ctx.fillStyle = hashColor(name);
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.round(slot.R * 1.1)}px ${FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(Array.from(name)[0] || '?', slot.cx, slot.cy);
  }
}

// entries: [{ name, tickets, avatar(Buffer|null) }]，已按名次排好，最多用前 9 个
async function renderRankImage(entries) {
  ensureFont();
  const { template, mask } = await getAssets();
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(template, 0, 0);

  // 1) 头像：先全部画到一张透明图层上，再用 mask.png 一次裁成 9 个圆（缎带和星星不会被盖住）
  const layer = createCanvas(template.width, template.height);
  const lctx = layer.getContext('2d');
  lctx.imageSmoothingEnabled = true;
  lctx.imageSmoothingQuality = 'high';
  for (let i = 0; i < 9 && i < entries.length; i++) {
    await drawAvatarSquare(lctx, entries[i].avatar, SLOTS[i], cleanName(entries[i].name));
  }
  lctx.globalCompositeOperation = 'destination-in';
  lctx.drawImage(mask, 0, 0);
  ctx.drawImage(layer, 0, 0);

  // 2) 前三名：名字写在名牌里（自动缩小到放得下），签数放在名牌下面的小红牌里
  for (let i = 0; i < PODIUM.length && i < entries.length; i++) {
    const p = PODIUM[i];
    const e = entries[i];
    const name = cleanName(e.name);
    let size = p.size;
    ctx.font = `bold ${size}px ${FAMILY}`;
    while (size > 18 && ctx.measureText(name).width > p.maxW) {
      size -= 1;
      ctx.font = `bold ${size}px ${FAMILY}`;
    }
    drawText(ctx, name, p.plateX, p.nameY, size, INK, 'center', p.maxW);
    const label = `${e.tickets} 签`;
    ctx.font = `bold 22px ${FAMILY}`;
    const w = ctx.measureText(label).width + 30;
    const x0 = p.plateX - w / 2;
    const y0 = p.ticketY - 15;
    ctx.beginPath();
    ctx.moveTo(x0 + 15, y0);
    ctx.lineTo(x0 + w - 15, y0);
    ctx.arc(x0 + w - 15, y0 + 15, 15, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x0 + 15, y0 + 30);
    ctx.arc(x0 + 15, y0 + 15, 15, Math.PI / 2, (Math.PI * 3) / 2);
    ctx.closePath();
    ctx.fillStyle = RED;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = CREAM;
    ctx.stroke();
    drawText(ctx, label, p.plateX, p.ticketY + 1, 22, CREAM, 'center');
  }

  // 3) 第 4-9 名
  for (let i = 0; i < 6; i++) {
    const cy = SLOTS[i + 3].cy;
    const e = entries[i + 3];
    if (!e) {
      drawText(ctx, '虚位以待', ROW.nameX, cy, 28, MUTED, 'left');
      continue;
    }
    drawText(ctx, cleanName(e.name), ROW.nameX, cy, ROW.size, INK, 'left', ROW.nameMaxW);
    drawText(ctx, `${e.tickets} 签`, ROW.ticketCx, cy, ROW.ticketSize, CREAM, 'center');
  }

  return canvas.toBuffer('image/png');
}

module.exports = { renderRankImage };
