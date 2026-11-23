// 把「我的幸运签筒」画成一张圣诞风图片（坐标对应 assets/tickets/template.png，1672×941）
const path = require('path');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');

const DIR = path.join(__dirname, '..', 'assets');
const FAMILY = 'KitchenSans';

const INK = '#4A1D12';       // 深棕
const RED = '#B3261E';       // 圣诞红
const CREAM = '#FFF1D6';     // 红色横幅上的字
const GOLD = '#FFE27A';      // 问候语里的名字
const MUTED = 'rgba(74,29,18,0.45)';

// ---- 版面坐标 ----
const L = {
  avatar: { x: 148, y: 227, size: 323 }, // 头像先画成方形，再用 avatar-mask.png 裁成圆形
  greeting: { x: 645, y: 210, size: 31, maxW: 660, nameMaxW: 300 },
  cards: [
    { cx: 700, cy: 322, size: 48, color: RED }, // 当前总幸运签
    { cx: 1013, cy: 322, size: 46, color: INK }, // 日常签
    { cx: 1311, cy: 322, size: 46, color: INK }, // 拉新签
  ],
  bar: { sx: 803, sy: 381, innerLeft: 805, innerW: 449 }, // 进度条素材左上角、填充区起点和宽度
  pct: { cx: 1326, cy: 401, size: 36 },
  check: { x: 1386, y: 381 },
  rowsY: [518, 554, 590, 626],
  pillLeft: [758, 742, 742, 742], // 每行底色块的左边（标签文字后面）
  rowsSize: 25,
  rowsMaxW: 190,
  pillHalfH: 16,
  tip: { x: 1042, y: 520, lineH: 38, size: 27, maxW: 270, maxLines: 4 },
  footer: { cx: 975, cy: 703, size: 28, maxW: 680 },
};
const PILL_DAYS = { fill: 'rgb(252,205,195)', text: 'rgb(150,40,35)' };
const PILL_OTHER = { fill: 'rgb(190,232,150)', text: INK };

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
      loadImage(path.join(DIR, 'tickets', 'avatar-mask.png')),
    ]).then(([template, barFull, check, mask]) => ({ template, barFull, check, mask }));
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

function hashColor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return `hsl(${h % 360}, 45%, 45%)`;
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

// 画文字，返回实际画出来的宽度
function text(ctx, str, x, y, size, fill, align = 'left', maxW = 0) {
  setFont(ctx, size);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fill;
  const shown = maxW ? fit(ctx, str, maxW) : str;
  ctx.fillText(shown, x, y);
  return ctx.measureText(shown).width;
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

function pill(ctx, x, y, w, h, fill) {
  const r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * v = {
 *   username, avatar(Buffer|null), total, maxTotal, base, maxBase, invite, maxInvite,
 *   entryPct (0-100), rows: [string x4] | null, hint, footer
 * }
 */
async function renderTicketImage(v) {
  ensureFont();
  const { template, barFull, check, mask } = await getAssets();
  const canvas = createCanvas(template.width, template.height);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(template, 0, 0);

  // 0) 头像：贴进左边的圆框（形状由 avatar-mask.png 决定，缎带和星星保留在前面）
  {
    const tmp = createCanvas(template.width, template.height);
    const t = tmp.getContext('2d');
    t.imageSmoothingEnabled = true;
    let img = null;
    if (v.avatar) {
      try {
        img = await loadImage(v.avatar);
      } catch (e) {
        img = null;
      }
    }
    const A = L.avatar;
    if (img) {
      t.drawImage(img, A.x, A.y, A.size, A.size);
    } else {
      t.fillStyle = hashColor(v.username);
      t.fillRect(A.x, A.y, A.size, A.size);
      setFont(t, 150);
      t.fillStyle = '#FFFFFF';
      t.textAlign = 'center';
      t.textBaseline = 'middle';
      t.fillText(Array.from(clean(v.username) || '厨')[0], A.x + A.size / 2, A.y + A.size / 2);
    }
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(mask, 0, 0);
    ctx.drawImage(tmp, 0, 0);
  }

  // 1) 问候语（红色横幅）：名字用金黄色突出
  {
    const g = L.greeting;
    setFont(ctx, g.size);
    const prefix = '你好 ';
    const suffix = '，这是你目前的攒签状态：';
    const room = g.maxW - ctx.measureText(prefix + suffix).width;
    const name = fit(ctx, clean(v.username) || '厨房伙伴', Math.max(80, Math.min(g.nameMaxW, room)));
    let x = g.x;
    x += text(ctx, prefix, x, g.y, g.size, CREAM);
    x += text(ctx, name, x, g.y, g.size, GOLD);
    text(ctx, suffix, x, g.y, g.size, CREAM);
  }

  // 2) 三张数字卡片
  const nums = [`${v.total}/${v.maxTotal}`, `${v.base}/${v.maxBase}`, `${v.invite}/${v.maxInvite}`];
  nums.forEach((s, i) => {
    const c = L.cards[i];
    text(ctx, s, c.cx, c.cy, c.size, c.color, 'center');
  });

  // 3) 入场进度条：「空槽」在模板里，这里把绿色填充按比例盖上去
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

  // 4) 下一档进度（四行，带彩色底）
  for (let i = 0; i < 4; i++) {
    const y = L.rowsY[i];
    if (v.rows) {
      const style = i === 0 ? PILL_DAYS : PILL_OTHER;
      setFont(ctx, L.rowsSize);
      const shown = fit(ctx, v.rows[i], L.rowsMaxW);
      const w = ctx.measureText(shown).width;
      const left = L.pillLeft[i];
      pill(ctx, left, y - L.pillHalfH, w + 24, L.pillHalfH * 2, style.fill);
      text(ctx, shown, left + 12, y, L.rowsSize, style.text);
    } else {
      text(ctx, '入场后解锁', L.pillLeft[i] + 4, y, 24, MUTED, 'left', L.rowsMaxW);
    }
  }

  // 5) 小贴士
  const lines = wrap(ctx, clean(v.hint), L.tip.size, L.tip.maxW, L.tip.maxLines);
  lines.forEach((ln, i) => text(ctx, ln, L.tip.x, L.tip.y + i * L.tip.lineH, L.tip.size, INK));

  // 6) 底部提示条
  text(ctx, clean(v.footer), L.footer.cx, L.footer.cy, L.footer.size, CREAM, 'center', L.footer.maxW);

  return canvas.toBuffer('image/png');
}

module.exports = { renderTicketImage };
