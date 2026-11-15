// Skia (@napi-rs/canvas) direct 2D renderer for Koppunshi Chapter composition
// Replaces Chromium/Remotion DOM+SVG rendering with pure native Skia 2D calls.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { createCanvas, GlobalFonts, Image, loadImage, Path2D } = require('@napi-rs/canvas');

export const FPS = 30;
export const W = 1920, H = 1080;
export const STAGE = { x: 300, y: 200, w: 1320, h: 610 };

export const C = {
  ink: '#e9eef7', sub: '#9fb0c8', faint: '#5d6d86',
  panel: 'rgba(10,16,30,0.86)', line: 'rgba(160,190,230,0.35)',
  me: '#f0b93a',
  war: '#ff5a5f', ally: '#47c98b', protect: '#5aa7ff', annex: '#b48cff', betray: '#ff8a3d',
  evidence: '#ffd24a',
};

export const SANS = 'SHSans', SANSB = 'SHSansB', SERIF = 'SHSerif', SERIFB = 'SHSerifB', PIXEL = 'Pixel';

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const ease = (p) => { p = clamp(p); return 1 - Math.pow(1 - p, 3); };
export const easeIO = (p) => { p = clamp(p); return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
export const back = (p) => { p = clamp(p); const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
export const lerp = (a, b, p) => a + (b - a) * p;

const KNOTS = [[2018.0, 0], [2019.0, .13], [2020.0, .40], [2021.0, .70], [2021.75, .87], [2022.0, .895], [2025.0, .945], [2025.9, 1]];
export function dateNum(d) {
  const m = String(d || '').match(/(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return 2018;
  const y = +m[1], mo = m[2] ? +m[2] : 6, da = m[3] ? +m[3] : 15;
  return y + (mo - 1) / 12 + (da - 1) / 365;
}
export function timeX(v) {
  for (let i = 1; i < KNOTS.length; i++) {
    const [a, pa] = KNOTS[i - 1], [b, pb] = KNOTS[i];
    if (v <= b) return lerp(pa, pb, clamp((v - a) / (b - a)));
  }
  return 1;
}
export function fmtDate(d) {
  const m = String(d || '').match(/(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return String(d || '');
  return m[1] + (m[2] ? '.' + m[2].padStart(2, '0') : '') + (m[3] ? '.' + m[3].padStart(2, '0') : '');
}
export function lastBefore(evs, t, f) {
  let r = null;
  for (const e of evs) { if (e.t > t) break; if (f(e)) r = e; }
  return r;
}

const STAGE_CUES = new Set(['写', '図', '語', '表', '事件', '動画', '素材', '対応', '出典', 'ツイート']);

export function buildGroups(events, duration) {
  const st = events.filter(e => STAGE_CUES.has(e.cue));
  const groups = [];
  let lastGraph = null;
  for (const e of st) {
    const g = groups[groups.length - 1];
    const same = g && g.kind === e.cue && (e.cue === '図' || (e.cue === '写' && g.evs[0].img.src === e.img.src));
    if (same) { g.evs.push(e); continue; }
    if (g) g.t1 = e.t;
    groups.push({ kind: e.cue, t0: e.t, t1: duration, evs: [e], prevGraph: e.cue === '図' ? lastGraph : undefined, key: `${e.cue}${e.t}` });
    if (e.cue === '図') lastGraph = null;
    const cur = groups[groups.length - 1];
    if (cur.kind === '図') lastGraph = e.graph;
  }
  let lg = null;
  for (const g of groups) {
    if (g.kind !== '図') continue;
    g.prevGraph = lg; lg = g.evs[g.evs.length - 1].graph;
  }
  return groups;
}

// Register fonts once per thread
let fontsRegistered = false;
export function initFonts(motionDir) {
  if (fontsRegistered) return;
  const fdir = path.join(motionDir, 'fonts_src');
  GlobalFonts.registerFromPath(path.join(fdir, 'SourceHanSansJP-Regular.otf'), SANS);
  GlobalFonts.registerFromPath(path.join(fdir, 'SourceHanSansJP-Bold.otf'), SANSB);
  GlobalFonts.registerFromPath(path.join(fdir, 'SourceHanSerifJP-Regular.otf'), SERIF);
  GlobalFonts.registerFromPath(path.join(fdir, 'SourceHanSerifJP-Bold.otf'), SERIFB);
  GlobalFonts.registerFromPath(path.join(fdir, 'NOTONOTO35HS-Regular.ttf'), PIXEL);
  fontsRegistered = true;
}

// Image cache per worker
const imgCache = new Map();

export async function preloadImages(props, motionDir) {
  // 1. MONO watermark
  try {
    const monoSrc = fs.readFileSync(path.join(motionDir, 'src', 'mono.ts'), 'utf8');
    const m = monoSrc.match(/'(data:image\/png;base64,[^']+)'/);
    if (m) {
      const b64 = m[1].split(',')[1];
      const img = await loadImage(Buffer.from(b64, 'base64'));
      imgCache.set(m[1], img);
      
      const h = 128;
      const w = Math.round(img.width * (h / img.height));
      const c = createCanvas(w, h);
      const cctx = c.getContext('2d');
      cctx.globalAlpha = 0.2;
      cctx.filter = 'brightness(1.9) saturate(0.7)';
      cctx.drawImage(img, 0, 0, w, h);
      monoWatermarkCanvas = c;
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Failed to preload MONO watermark:', e);
  }

  // 2. Scan all events for images
  const targets = new Set();
  for (const e of props.events || []) {
    if (e.img) {
      if (e.img.src) targets.add(e.img.src);
      if (e.img.data) targets.add(e.img.data);
    }
    if (e.person?.iconData) targets.add(e.person.iconData);
    if (e.graph?.nodes) {
      for (const n of e.graph.nodes) {
        if (n.icon) targets.add(n.icon);
      }
    }
  }

  for (const t of targets) {
    if (!t || imgCache.has(t)) continue;
    try {
      let img;
      if (t.startsWith('data:')) {
        const b64 = t.split(',')[1];
        img = await loadImage(Buffer.from(b64, 'base64'));
      } else {
        const p = path.isAbsolute(t) ? t : path.join(motionDir, 'public', t);
        if (fs.existsSync(p)) {
          img = await loadImage(p);
        }
      }
      if (img) imgCache.set(t, img);
    } catch (err) {
      console.error(`Failed to preload image: ${t.slice(0, 50)}...`, err);
    }
  }
}

export function getImage(srcOrData, motionDir) {
  if (!srcOrData) return null;
  return imgCache.get(srcOrData) || null;
}

// Pre-rendered static Shade canvas and pre-processed MONO watermark canvas
let shadeCanvas = null;
let monoWatermarkCanvas = null;

export function getShadeCanvas() {
  if (shadeCanvas) return shadeCanvas;
  shadeCanvas = createCanvas(W, H);
  const sctx = shadeCanvas.getContext('2d');
  // CSS: radial-gradient(ellipse at 50% 45%, rgba(6,10,20,0.45) 0%, rgba(4,7,14,0.82) 75%)
  const cx = W * 0.5, cy = H * 0.45;
  const rx = W * 0.5 * Math.SQRT2, ry = H * 0.55 * Math.SQRT2;
  sctx.save();
  sctx.translate(cx, cy);
  sctx.scale(1, ry / rx);
  const grad = sctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  grad.addColorStop(0, 'rgba(6,10,20,0.45)');
  grad.addColorStop(0.75, 'rgba(4,7,14,0.82)');
  grad.addColorStop(1, 'rgba(4,7,14,0.82)');
  sctx.fillStyle = grad;
  sctx.fillRect(-cx, -cy * (rx / ry), W, H * (rx / ry));
  sctx.restore();
  return shadeCanvas;
}

export function getMonoWatermark(motionDir) {
  if (monoWatermarkCanvas !== null) return monoWatermarkCanvas;
  try {
    const monoSrc = fs.readFileSync(path.join(motionDir, 'src', 'mono.ts'), 'utf8');
    const m = monoSrc.match(/'(data:image\/png;base64,[^']+)'/);
    if (!m) { monoWatermarkCanvas = false; return null; }
    const img = getImage(m[1], motionDir);
    if (!img) { monoWatermarkCanvas = false; return null; }
    const h = 128;
    const w = Math.round(img.width * (h / img.height));
    const c = createCanvas(w, h);
    const cctx = c.getContext('2d');
    cctx.globalAlpha = 0.2;
    cctx.filter = 'brightness(1.9) saturate(0.7)';
    cctx.drawImage(img, 0, 0, w, h);
    monoWatermarkCanvas = c;
    return c;
  } catch {
    monoWatermarkCanvas = false;
    return null;
  }
}

// Helper: draw text with top-left alignment matching CSS div text layout
// In Source Han / Noto fonts, alphabetic baseline is ~0.82 of fontSize from top of line box
function drawTextTop(ctx, text, x, y, fontSize, lineHeight = fontSize * 1.25, align = 'left') {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  const offset = (lineHeight - fontSize) / 2 + fontSize * 0.82;
  ctx.fillText(String(text ?? ''), x, y + offset);
  ctx.restore();
}

// Helper: wrap text into lines fitting maxWidth
function wrapTextLines(ctx, text, maxWidth) {
  const chars = [...String(text ?? '')];
  const lines = [];
  let cur = '';
  for (const ch of chars) {
    if (ch === '\n') { lines.push(cur); cur = ''; continue; }
    const test = cur + ch;
    if (cur.length > 0 && ctx.measureText(test).width > maxWidth) {
      // Avoid starting a line with closing punctuation
      if ('、。，．）」』】〕〉》！？'.includes(ch)) {
        lines.push(test);
        cur = '';
        continue;
      }
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Helper: draw rounded rect fill and stroke
function fillStrokeRoundRect(ctx, x, y, w, h, r, fill, stroke, lineWidth = 2) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke && lineWidth > 0) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

// 1. HUD
function drawHUD(ctx, events, t, motionDir) {
  const huds = events.filter(e => e.cue === 'hud');
  const cur = lastBefore(huds, t, () => true) || huds[0];
  if (!cur) return;
  const i = huds.indexOf(cur);
  const prev = i > 0 ? huds[i - 1] : null;
  const p = prev ? ease((t - cur.t) / .55) : 1;
  const nameChanged = prev && prev.name !== cur.name;
  const flash = nameChanged ? clamp(1 - (t - cur.t) / 1.6) : 0;

  // CSS content-box: left: 24, top: 18, width: 470, padding: 10px 18px 8px, border: 2px
  // Content heights: row1 = max(18*1.25, 20*1.25)=25, row2 = 40*1.25=50, row3 = 2 + 16*1.35=23.6, row4 = 24*1.25=30 -> total content height = 128.6
  // Outer box: x=24, y=18, w=470 + 36 + 4 = 510, h = 128.6 + 18 + 4 = 150.6
  const bx = 24, by = 18, bw = 510, bh = 150;
  const cx = bx + 2 + 18, cy = by + 2 + 10, cw = 470;

  ctx.save();
  if (flash > 0) {
    ctx.shadowColor = C.me;
    ctx.shadowBlur = 30 * flash;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
  }
  ctx.beginPath();
  ctx.roundRect(bx + 1, by + 1, bw - 2, bh - 2, 10);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.restore();

  // Border
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx + 1, by + 1, bw - 2, bh - 2, 10);
  ctx.strokeStyle = flash > 0 ? C.me : C.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // MONO watermark
  const mono = getMonoWatermark(motionDir);
  if (mono) {
    ctx.drawImage(mono, bx + bw - 2 - 10 - mono.width, by + 2 + 6);
  }

  // Helper for HUD animated row
  const drawHudRow = (a, b, x, y, size, font, color, align = 'left', maxW = cw) => {
    const rh = size * 1.25;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx + 2, y, bw - 4, rh);
    ctx.clip();
    ctx.font = `${size}px ${font}`;
    ctx.fillStyle = color;
    if (a && a !== b) {
      ctx.globalAlpha = 1 - p;
      drawTextTop(ctx, a, x, y - p * size, size, rh, align);
      ctx.globalAlpha = p;
      drawTextTop(ctx, b, x, y + (1 - p) * size, size, rh, align);
    } else {
      ctx.globalAlpha = 1;
      drawTextTop(ctx, b, x, y, size, rh, align);
    }
    ctx.restore();
  };

  // Row 1: 名乗り (left)
  ctx.save();
  ctx.font = `18px ${SANS}`;
  ctx.fillStyle = C.sub;
  drawTextTop(ctx, '名乗り', cx, cy, 18, 23, 'left');
  ctx.restore();

  // Row 2: Name
  const y2 = cy + 25;
  drawHudRow(prev?.name, cur.name, cx, y2, 40, PIXEL, C.me, 'left');

  // Row 3: 居場所 label
  const y3 = y2 + 50 + 2;
  ctx.save();
  ctx.font = `16px ${SANS}`;
  ctx.fillStyle = C.sub;
  drawTextTop(ctx, '居場所', cx, y3, 16, 21, 'left');
  ctx.restore();

  // Row 4: Place
  const y4 = y3 + 22;
  drawHudRow(prev?.place, cur.place, cx, y4, 24, SANSB, C.ink, 'left');
}

// 2. Timeline
const TL_X0 = 560, TL_X1 = 1880, TL_Y = 46;
function drawTimeline(ctx, events, t, title, titleEnd) {
  const marks = events.filter(e => e.cue === 'hud' || e.cue === '日');
  const cur = lastBefore(marks, t, () => true) || marks[0];
  const i = cur ? marks.indexOf(cur) : -1;
  const prev = i > 0 ? marks[i - 1] : null;
  const vx = (e) => e ? TL_X0 + timeX(dateNum(e.date)) * (TL_X1 - TL_X0) : TL_X0;
  const x = prev ? lerp(vx(prev), vx(cur), easeIO((t - cur.t) / .9)) : vx(cur);
  const years = [2018, 2019, 2020, 2021, 2022, 2025];
  const dots = events.filter(e => e.cue === '日');

  ctx.save();
  // Base line
  ctx.beginPath();
  ctx.moveTo(TL_X0, TL_Y);
  ctx.lineTo(TL_X1, TL_Y);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Progress line
  ctx.beginPath();
  ctx.moveTo(TL_X0, TL_Y);
  ctx.lineTo(x, TL_Y);
  ctx.strokeStyle = C.me;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Years ticks & labels
  ctx.font = `18px ${PIXEL}`;
  ctx.fillStyle = C.sub;
  ctx.strokeStyle = C.sub;
  ctx.lineWidth = 2;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (const y of years) {
    const yx = TL_X0 + timeX(y) * (TL_X1 - TL_X0);
    ctx.beginPath();
    ctx.moveTo(yx, TL_Y - 8);
    ctx.lineTo(yx, TL_Y + 8);
    ctx.stroke();
    ctx.fillText(String(y), yx + 6, TL_Y - 14);
  }

  // Event dots
  for (const e of dots) {
    const dx = vx(e);
    const lit = e.t <= t;
    ctx.beginPath();
    ctx.arc(dx, TL_Y, lit ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = lit ? C.me : C.faint;
    ctx.fill();
  }

  // Current position marker
  ctx.beginPath();
  ctx.arc(x, TL_Y, 11, 0, Math.PI * 2);
  ctx.strokeStyle = C.me;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, TL_Y, 4, 0, Math.PI * 2);
  ctx.fillStyle = C.me;
  ctx.fill();

  // Chapter title below timeline
  if (t > titleEnd) {
    const op = ease((t - titleEnd) / .6);
    if (op > 0) {
      ctx.globalAlpha = op;
      ctx.font = `22px ${SANSB}`;
      ctx.fillStyle = C.sub;
      drawTextTop(ctx, title, W - 40, 70, 22, 28, 'right');
    }
  }
  ctx.restore();
}

// 3. TitleCard
function drawTitleCard(ctx, title, t, end) {
  if (t > end + .7) return;
  const pin = ease(t / .7), pout = ease((t - end) / .7);
  const op = 1 - pout;
  if (op <= 0) return;

  const [no, ...rest] = String(title || '').split(' ');
  const hasPeriod = rest.length && /\d{4}年/.test(rest[rest.length - 1]);
  const name = (hasPeriod ? rest.slice(0, -1) : rest).join(' ');
  const period = hasPeriod ? rest[rest.length - 1] : '';

  // Compute block total height to center vertically at H/2
  // 骨粉史: 40*1.3=52
  // no: marginTop 16 + 64*1.3=83
  // name: if present, marginTop 6 + 78*1.3=101
  // period: if present, marginTop 10 + (name ? 50 : 78)*1.3 = 65 or 101
  // bar: marginTop 24 + 3 = 27
  let totalH = 52 + 16 + 83 + 27;
  if (name) totalH += 6 + 101;
  if (period) totalH += 10 + (name ? 65 : 101);

  const ty = (1 - pin) * 40 - pout * 30;
  const sc = 1 - pout * 0.15;

  ctx.save();
  ctx.globalAlpha = op;
  ctx.translate(W / 2, H / 2 + ty);
  ctx.scale(sc, sc);

  let curY = -totalH / 2;

  // 骨粉史
  ctx.save();
  ctx.globalAlpha = op * pin;
  ctx.font = `40px ${PIXEL}`;
  ctx.fillStyle = C.me;
  ctx.letterSpacing = '6px';
  drawTextTop(ctx, '骨粉史', 0, curY, 40, 52, 'center');
  ctx.restore();
  curY += 52 + 16;

  // Helper to draw clipped centered text
  const drawClippedCentered = (txt, y, size, lh, font, color, prog) => {
    if (prog <= 0 || !txt) return;
    ctx.save();
    ctx.font = `${size}px ${font}`;
    const tw = ctx.measureText(txt).width + 20;
    const x0 = -tw / 2;
    ctx.beginPath();
    ctx.rect(x0, y - 10, tw * prog, lh + 20);
    ctx.clip();
    ctx.fillStyle = color;
    drawTextTop(ctx, txt, 0, y, size, lh, 'center');
    ctx.restore();
  };

  drawClippedCentered(no, curY, 64, 83, SANSB, C.ink, pin);
  curY += 83;

  if (name) {
    curY += 6;
    drawClippedCentered(name, curY, 78, 101, SERIFB, C.ink, ease((t - .2) / .7));
    curY += 101;
  }
  if (period) {
    curY += 10;
    const pSize = name ? 50 : 78;
    const pLh = name ? 65 : 101;
    drawClippedCentered(period, curY, pSize, pLh, SERIFB, name ? C.sub : C.ink, ease((t - .35) / .7));
    curY += pLh;
  }

  curY += 24;
  const barW = 900 * ease((t - .3) / .8);
  if (barW > 0) {
    ctx.fillStyle = C.me;
    ctx.fillRect(-barW / 2, curY, barW, 3);
  }

  ctx.restore();
}

// 4. DateStamp
function drawDateStamp(ctx, events, t) {
  const e = lastBefore(events, t, x => x.cue === '日');
  if (!e || t - e.t > 3.4) return;
  const dt = t - e.t;
  if (dt < 0) return;
  const pin = back(dt / .5), pout = easeIO((dt - 2.6) / .8);
  const op = (1 - pout) * clamp(dt / .2);
  if (op <= 0) return;
  const tx = TL_X0 + timeX(dateNum(e.date)) * (TL_X1 - TL_X0);
  const x = lerp(520, tx, pout), y = lerp(112, 36, pout);
  const sc = lerp(1, .2, pout);
  const clipP = ease(dt / .45);

  const dStr = fmtDate(e.date);
  const mStr = String(e.mark || '');
  const lStr = String(e.label || '');

  ctx.save();
  ctx.font = `56px ${PIXEL}`;
  const wDate = ctx.measureText(dStr).width;
  ctx.font = `40px ${SANSB}`;
  const wMark = ctx.measureText(mStr).width;
  ctx.font = `34px ${SANSB}`;
  const wLabel = ctx.measureText(lStr).width;

  const padX = 20, padTop = 6, padBot = 8, gap = 18;
  const boxW = padX * 2 + wDate + gap + wMark + gap + wLabel + 4;
  const boxH = padTop + 56 + padBot + 4;

  ctx.globalAlpha = op;
  ctx.translate(x, y);
  ctx.scale(sc, sc);

  // Clip inset(0 (1-clipP)*100% 0 0)
  ctx.beginPath();
  ctx.rect(-2, -2, (boxW + 4) * clipP, boxH + 4);
  ctx.clip();

  fillStrokeRoundRect(ctx, 0, 0, boxW, boxH, 8, 'rgba(5,9,18,0.9)', C.me, 2);

  const baseLineY = padTop + 2 + 48; // baseline for 56px PIXEL
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  let curX = padX + 2;
  ctx.font = `56px ${PIXEL}`;
  ctx.fillStyle = C.ink;
  ctx.fillText(dStr, curX, baseLineY);
  curX += wDate + gap;

  ctx.font = `40px ${SANSB}`;
  ctx.fillStyle = C.me;
  ctx.fillText(mStr, curX, baseLineY - 2);
  curX += wMark + gap;

  ctx.save();
  ctx.translate(curX, baseLineY - 12);
  ctx.scale(pin, pin);
  ctx.font = `34px ${SANSB}`;
  ctx.fillStyle = C.me;
  ctx.fillText(lStr, 0, 10);
  ctx.restore();

  ctx.restore();
}

// 5. NameMorph
function drawNameMorph(ctx, events, t) {
  const e = lastBefore(events, t, x => x.cue === '名乗り');
  if (!e) return;
  const dt = t - e.t;
  if (dt < 0) return;
  if (e.text === '表示') {
    if (dt > 5) return;
    const p = ease(dt / .6), o = 1 - ease((dt - 4.2) / .8);
    if (o <= 0) return;
    ctx.save();
    ctx.globalAlpha = o;

    // Dashed rounded rect around HUD
    ctx.beginPath();
    ctx.roundRect(20, 14, 508, 156, 12);
    ctx.strokeStyle = C.me;
    ctx.lineWidth = 4;
    ctx.setLineDash([1330]);
    ctx.lineDashOffset = 1330 * (1 - p);
    ctx.stroke();
    ctx.setLineDash([]);

    // Quadratic curve
    ctx.beginPath();
    ctx.moveTo(700, 300);
    ctx.quadraticCurveTo(620, 230, lerp(700, 540, p), lerp(300, 150, p));
    ctx.strokeStyle = C.me;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Label
    ctx.globalAlpha = o * p;
    ctx.font = `34px ${SANSB}`;
    ctx.fillStyle = C.ink;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText('その時点の名乗り・居場所・日付', 700, 340);
    ctx.restore();
    return;
  }

  if (dt > 3.2) return;
  const [a, b] = String(e.text || '').split('→');
  const pin = ease(dt / .5), swap = easeIO((dt - .7) / .7), out = easeIO((dt - 2.3) / .8);
  const op = pin * (1 - out * .8);
  if (op <= 0) return;

  const lx = lerp(960, 200, out), ly = lerp(430, 70, out);
  const sc = lerp(1, .35, out);

  ctx.save();
  ctx.translate(lx, ly);
  ctx.scale(sc, sc);

  // Total height ~ 38 (sub) + 120 (main) = 158
  ctx.globalAlpha = op;
  ctx.font = `30px ${SANS}`;
  ctx.fillStyle = C.sub;
  drawTextTop(ctx, '名乗りが変わる', 0, -79, 30, 38, 'center');

  if (1 - swap > 0.01) {
    ctx.save();
    ctx.globalAlpha = op * (1 - swap);
    if (swap * 8 > 0.5) ctx.filter = `blur(${(swap * 8).toFixed(1)}px)`;
    ctx.font = `96px ${PIXEL}`;
    ctx.fillStyle = C.ink;
    drawTextTop(ctx, a, 0, -41 - swap * 40, 96, 120, 'center');
    ctx.restore();
  }

  if (swap > 0.01) {
    ctx.save();
    ctx.globalAlpha = op * swap;
    ctx.font = `96px ${PIXEL}`;
    ctx.fillStyle = C.me;
    drawTextTop(ctx, b, 0, -41 + (1 - swap) * 40, 96, 120, 'center');
    ctx.restore();
  }

  ctx.restore();
}

// 6. PersonCard
function drawPersonCard(ctx, events, t, motionDir) {
  const e = lastBefore(events, t, x => x.cue === '人');
  if (!e) return;
  const dt = t - e.t;
  if (dt < 0 || dt > 7) return;
  const pin = ease(dt / .5), pout = ease((dt - 6.2) / .6);
  const op = pin * (1 - pout);
  if (op <= 0) return;
  const p = e.person;
  if (!p) return;

  const ty = (1 - pin) * 24 + pout * 16;
  // CSS content-box: left: 300, top: 760, width: 1320, height: 156, padding: '0 28px', border: 2px
  const bx = 300, by = 760 + ty, bw = 1320 + 56 + 4, bh = 156 + 4;

  ctx.save();
  ctx.globalAlpha = op;

  // Shadow & background
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 12;
  ctx.beginPath();
  ctx.roundRect(bx + 1, by + 1, bw - 2, bh - 2, 12);
  ctx.fillStyle = 'rgba(8,13,26,0.94)';
  ctx.fill();
  ctx.restore();

  // Border
  ctx.beginPath();
  ctx.roundRect(bx + 1, by + 1, bw - 2, bh - 2, 12);
  ctx.strokeStyle = C.me;
  ctx.lineWidth = 2;
  ctx.stroke();

  let curX = bx + 2 + 28;
  const centerY = by + bh / 2;

  // Icon (120x120)
  if (p.iconData) {
    const ic = getImage(p.iconData, motionDir);
    const ix = curX, iy = centerY - 62;
    ctx.fillStyle = '#000';
    ctx.fillRect(ix, iy, 124, 124);
    if (ic) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ic, ix + 2, iy + 2, 120, 120);
      ctx.restore();
    }
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.strokeRect(ix + 1, iy + 1, 122, 122);
    curX += 124 + 24;
  }

  const maxTextW = bx + bw - 30 - curX;
  const topY = by + 14;

  // Row 1: Badge "初登場" + p.name + p.aka
  const badgeW = 80, badgeH = 29;
  fillStrokeRoundRect(ctx, curX, topY + 18, badgeW, badgeH, 4, C.me, null, 0);
  ctx.font = `20px ${PIXEL}`;
  ctx.fillStyle = '#06101c';
  drawTextTop(ctx, '初登場', curX + badgeW / 2, topY + 20, 20, 25, 'center');

  let nx = curX + badgeW + 16;
  ctx.font = `44px ${SERIFB}`;
  ctx.fillStyle = C.ink;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(String(p.name || ''), nx, topY + 43);
  nx += ctx.measureText(String(p.name || '')).width + 16;

  if (p.aka) {
    ctx.font = `22px ${SANS}`;
    ctx.fillStyle = C.sub;
    ctx.fillText(String(p.aka), nx, topY + 41);
  }

  // Row 2: faction
  const fy = topY + 55;
  ctx.font = `22px ${SANSB}`;
  ctx.fillStyle = C.me;
  drawTextTop(ctx, p.faction || '', curX, fy, 22, 28, 'left');

  // Row 3: sign (up to 2 lines)
  const sy = fy + 32;
  ctx.font = `23px ${SANS}`;
  ctx.fillStyle = C.ink;
  const signLines = wrapTextLines(ctx, p.sign || '', maxTextW).slice(0, 2);
  signLines.forEach((line, idx) => {
    drawTextTop(ctx, line, curX, sy + idx * 31, 23, 31, 'left');
  });

  ctx.restore();
}

// 7. QuoteCard
function drawQuoteCard(ctx, quotes, t) {
  const q = quotes.find(x => t >= x.tIn && t <= x.tOut + .5);
  if (!q) return;
  const pin = ease((t - q.tIn) / .45), pout = ease((t - q.tOut) / .4);
  const op = pin * (1 - pout);
  if (op <= 0) return;

  // Dim background
  ctx.save();
  ctx.fillStyle = `rgba(3,6,12,${(0.5 * op).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const chars = [...String(q.body || '')];
  const shown = Math.floor(clamp((t - q.tVoice) / Math.max(.3, q.tEnd - q.tVoice)) * chars.length * 1.15);
  const src = q.type === '読' ? q.src : q.src.startsWith('会話') ? `${q.src}｜2025年9月の録音の文字起こし` : q.src === '通史' ? '通史｜本人が書いた歴史' : `${q.src}｜本人のメモ`;

  // Box: content width 1200, padding: '26px 40px 30px', borderLeft: 10px
  const contentW = 1200;
  const boxW = contentW + 80 + 10;
  const bx = (W - boxW) / 2;
  const by = 210 + (1 - pin) * -30 + pout * -20;

  ctx.save();
  ctx.globalAlpha = op;
  ctx.font = `46px ${SERIFB}`;

  // Layout characters of 「 + chars + 」 across lines of maxWidth = contentW
  const fullChars = ['「', ...chars, '」'];
  const lines = [];
  let curLine = [];
  let curW = 0;
  for (let idx = 0; idx < fullChars.length; idx++) {
    const ch = fullChars[idx];
    const cw = ctx.measureText(ch).width;
    if (curLine.length > 0 && curW + cw > contentW) {
      if ('、。，．）」』】〕〉》！？'.includes(ch)) {
        curLine.push({ ch, idx, w: cw });
        lines.push(curLine);
        curLine = [];
        curW = 0;
        continue;
      }
      lines.push(curLine);
      curLine = [{ ch, idx, w: cw }];
      curW = cw;
    } else {
      curLine.push({ ch, idx, w: cw });
      curW += cw;
    }
  }
  if (curLine.length) lines.push(curLine);

  const lh = 46 * 1.5; // 69px
  const boxH = 26 + 32 + 14 + lines.length * lh + 30;

  // Box shadow & fill
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 20;
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 6);
  ctx.fillStyle = 'rgba(248,244,233,0.97)';
  ctx.fill();
  ctx.restore();

  // Left border (10px solid C.evidence)
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 6);
  ctx.clip();
  ctx.fillStyle = C.evidence;
  ctx.fillRect(bx, by, 10, boxH);
  ctx.restore();

  const cx = bx + 10 + 40;
  const cy = by + 26;

  // Badge
  const badgeTxt = q.type === '読' ? '読み上げ' : '本人の言葉';
  ctx.font = `20px ${PIXEL}`;
  const bw = ctx.measureText(badgeTxt).width + 24;
  fillStrokeRoundRect(ctx, cx, cy, bw, 31, 4, '#2a2418', null, 0);
  ctx.fillStyle = C.evidence;
  drawTextTop(ctx, badgeTxt, cx + 12, cy + 3, 20, 25, 'left');

  // Source text
  ctx.font = `22px ${SANSB}`;
  ctx.fillStyle = '#5b4a1f';
  drawTextTop(ctx, src, cx + bw + 14, cy + 2, 22, 28, 'left');

  // Quote body
  const bodyY = cy + 32 + 14;
  ctx.font = `46px ${SERIFB}`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  for (let row = 0; row < lines.length; row++) {
    let lx = cx;
    const ly = bodyY + row * lh + (lh - 46) / 2 + 46 * 0.82;
    for (const item of lines[row]) {
      const isBracket = item.idx === 0 || item.idx === fullChars.length - 1;
      const charIdx = item.idx - 1;
      const charAlpha = isBracket ? 1 : (charIdx < shown ? 1 : 0.12);
      ctx.globalAlpha = op * charAlpha;
      ctx.fillStyle = '#1e1a12';
      ctx.fillText(item.ch, lx, ly);
      lx += item.w;
    }
  }

  ctx.restore();
}

// 8. Stage items: Graph, Shot, Cards
const GRAPH_STYLE = {
  操作: { color: C.me, dash: [2, 11], width: 4 }, 命令: { color: C.me, dash: [2, 11], width: 3, label: '命令' },
  取り戻す: { color: C.me, width: 6, label: '取り戻す' },
  同盟: { color: C.ally, width: 4, label: '同盟' }, 加盟: { color: C.ally, width: 3, label: '加盟' }, 仮加盟: { color: C.ally, dash: [10, 8], width: 3, label: '仮加盟' },
  支援: { color: C.ally, dash: [12, 6], width: 3, label: '支援' }, 合併: { color: C.ally, width: 5, label: '合併' },
  敵対: { color: C.war, width: 5, label: '敵対' }, 寝返り: { color: C.betray, dash: [14, 8], width: 5, label: '寝返り' },
  保護: { color: C.protect, width: 4, arrow: true, label: '保護' }, 傀儡: { color: C.protect, width: 4, arrow: true, label: '傀儡' },
  支配: { color: C.protect, width: 5, arrow: true, label: '支配' }, 併合: { color: C.annex, width: 5, arrow: true, label: '併合' },
};
const GRAPH_IN = 70;
const graphPos = (n) => ({ x: GRAPH_IN + n.x / 100 * (STAGE.w - 2 * GRAPH_IN), y: 34 + n.y / 100 * (STAGE.h - 68) });
const graphTextW = (s, size) => [...String(s || '')].reduce((w, c) => w + (c.charCodeAt(0) < 256 ? .56 : 1) * size, 0);
const graphBoxOf = (n) => { const ic = n.icon ? 50 : 0; const w = graphTextW(n.label, n.me ? 28 : 25) + 34 + ic; return { w, h: n.icon ? 58 : n.me ? 52 : 46 }; };
function graphClip(ax, ay, bx, by, bw, bh) {
  const dx = ax - bx, dy = ay - by;
  if (!dx && !dy) return { x: bx, y: by };
  const sx = dx ? (bw / 2) / Math.abs(dx) : Infinity, sy = dy ? (bh / 2) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  return { x: bx + dx * s, y: by + dy * s };
}

function drawGraph(ctx, states, prev, t, baseAlpha, motionDir) {
  let i = 0;
  for (let k = 0; k < states.length; k++) if (states[k].t <= t) i = k;
  const cur = states[i].graph;
  const before = i > 0 ? states[i - 1].graph : (prev || { nodes: [], edges: [] });
  const dt = t - states[i].t;
  const p = easeIO(dt / .9);
  const pNew = ease((dt - .25) / .7);
  const pOld = ease(dt / .4);

  const pm = {}, bm = {};
  for (const n of before.nodes) bm[n.id] = n;
  for (const n of cur.nodes) {
    const b = bm[n.id];
    const a = graphPos(n), o = b ? graphPos(b) : a;
    pm[n.id] = { ...n, x: lerp(o.x, a.x, p), y: lerp(o.y, a.y, p), isNew: !b, oldLabel: b && b.label !== n.label ? b.label : null, wasDim: b?.dim };
  }
  const gone = before.nodes.filter(n => !cur.nodes.find(m => m.id === n.id));
  const ekey = (e) => `${e.a}|${e.b}|${e.type}`;
  const bk = new Set(before.edges.map(ekey));
  const ck = new Set(cur.edges.map(ekey));
  const ring = new Set(cur.edges.filter(e => e.a === '今泉' && (e.type === '操作' || e.type === '取り戻す')).map(e => e.b));

  // Container background & border
  fillStrokeRoundRect(ctx, 0, 0, STAGE.w, STAGE.h, 16, 'rgba(6,11,22,0.72)', C.line, 1);

  // Title "関係図"
  ctx.save();
  ctx.font = `18px ${SANS}`;
  ctx.fillStyle = C.sub;
  ctx.letterSpacing = '2px';
  drawTextTop(ctx, '関係図', 22, 14, 18, 23, 'left');
  ctx.restore();

  // Legend
  const legendItems = [['本人が動かす', C.me, [2, 8]], ['同盟・加盟', C.ally], ['敵対', C.war], ['保護・傀儡', C.protect], ['寝返り', C.betray, [10, 6]], ['併合', C.annex]];
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `17px ${SANS}`;
  legendItems.forEach(([l, c, d], k) => {
    const lx = STAGE.w - 1010 + k * 166;
    ctx.beginPath();
    ctx.moveTo(lx, 26);
    ctx.lineTo(lx + 30, 26);
    ctx.strokeStyle = c;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.setLineDash(d || []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.sub;
    ctx.fillText(l, lx + 38, 32);
  });
  ctx.restore();

  const drawEdge = (e, nodes, mode) => {
    const A = nodes[e.a], B = nodes[e.b];
    if (!A || !B) return;
    const s = GRAPH_STYLE[e.type] || { color: C.sub, width: 3, label: e.type };
    const ba = graphBoxOf(A), bb = graphBoxOf(B);
    const p1 = graphClip(B.x, B.y, A.x, A.y, ba.w + 10, ba.h + 10);
    const p2 = graphClip(A.x, A.y, B.x, B.y, bb.w + 14, bb.h + 14);
    const isNew = mode === 'cur' && !bk.has(ekey(e));
    const grow = isNew ? pNew : 1;
    const op = mode === 'old' ? 1 - pOld : 1;
    if (op <= 0 || grow <= 0) return;

    const x2 = lerp(p1.x, p2.x, grow), y2 = lerp(p1.y, p2.y, grow);
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const pulse = (e.type === '寝返り' || e.type === '敵対') && isNew ? clamp(1 - (t - states[i].t - 1) / 1.5) : 0;

    ctx.save();
    ctx.globalAlpha = baseAlpha * op;
    ctx.lineCap = 'round';

    if (pulse > 0) {
      ctx.save();
      ctx.globalAlpha = baseAlpha * op * 0.25 * pulse;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width + 14 * pulse;
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.setLineDash(s.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);

    if (s.arrow && grow > .95) {
      ctx.save();
      ctx.translate(p2.x, p2.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-18, -9);
      ctx.lineTo(-18, 9);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.restore();
    }

    if (s.label && grow > .6) {
      const lop = ease((grow - .6) / .4);
      if (lop > 0) {
        ctx.globalAlpha = baseAlpha * op * lop;
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2, w = s.label.length * 20 + 14;
        fillStrokeRoundRect(ctx, mx - w / 2, my - 15, w, 28, 6, 'rgba(6,10,20,0.92)', s.color, 1.5);
        ctx.font = `18px ${SANSB}`;
        ctx.fillStyle = s.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(s.label, mx, my + 6);
      }
    }
    ctx.restore();
  };

  const drawNode = (n, mode) => {
    const { w, h } = graphBoxOf(n);
    const sc = mode === 'old' ? 1 - .3 * pOld : n.isNew ? lerp(.6, 1, ease(pNew)) : 1;
    const op = mode === 'old' ? 1 - pOld : n.isNew ? pNew : 1;
    const dim = n.dim ? lerp(n.wasDim ? .35 : 1, .35, p) : 1;
    const nodeAlpha = baseAlpha * op * dim;
    if (nodeAlpha <= 0 || sc <= 0) return;

    const me = n.me, ringed = ring.has(n.id);
    const lab = n.oldLabel && mode === 'cur' ? p : 1;

    ctx.save();
    ctx.globalAlpha = nodeAlpha;
    ctx.translate(n.x, n.y);
    ctx.scale(sc, sc);

    if (ringed) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(-w / 2 - 7, -h / 2 - 7, w + 14, h + 14, 14);
      ctx.strokeStyle = C.me;
      ctx.lineWidth = 3;
      ctx.setLineDash([3, 6]);
      ctx.stroke();
      ctx.restore();
    }

    fillStrokeRoundRect(ctx, -w / 2, -h / 2, w, h, 10, me ? C.me : 'rgba(12,20,38,0.94)', me ? '#fff3c4' : 'rgba(190,210,240,0.55)', 2);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    if (n.oldLabel && mode === 'cur' && 1 - lab > 0.01) {
      ctx.save();
      ctx.globalAlpha = nodeAlpha * (1 - lab);
      ctx.font = `25px ${SANSB}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(n.oldLabel, n.icon ? 25 : 0, 9 - lab * 12);
      ctx.restore();
    }

    if (n.icon) {
      const ic = getImage(n.icon, motionDir);
      const cx = -w / 2 + 31, cy = 0, r = 22;
      if (ic) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(ic, -w / 2 + 9, -22, 44, 44);
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = me ? '#fff3c4' : 'rgba(190,210,240,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();

      if (n.fake) {
        ctx.beginPath();
        ctx.arc(-w / 2 + 48, -18, 13, 0, Math.PI * 2);
        ctx.fillStyle = C.war;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.font = `17px ${SANSB}`;
        ctx.fillStyle = '#fff';
        ctx.fillText('偽', -w / 2 + 48, -12);
      }
    }

    ctx.save();
    ctx.globalAlpha = nodeAlpha * lab;
    ctx.font = `${me ? 28 : 25}px ${me ? PIXEL : SANSB}`;
    ctx.fillStyle = me ? '#1b1405' : C.ink;
    ctx.fillText(n.label, n.icon ? 25 : 0, (me ? 10 : 9) + (1 - lab) * 12);
    ctx.restore();

    ctx.restore();
  };

  const oldNodes = {};
  for (const n of before.nodes) { const q = graphPos(n); oldNodes[n.id] = { ...n, ...q }; }
  for (const id in pm) if (!oldNodes[id]) oldNodes[id] = pm[id];
  const goneEdges = before.edges.filter(e => !ck.has(ekey(e)));

  goneEdges.forEach(e => drawEdge(e, oldNodes, 'old'));
  cur.edges.filter(e => e.type === '操作' || e.type === '命令').forEach(e => drawEdge(e, pm, 'cur'));
  cur.edges.filter(e => e.type !== '操作' && e.type !== '命令').forEach(e => drawEdge(e, pm, 'cur'));
  gone.forEach(n => drawNode({ ...n, ...graphPos(n) }, 'old'));
  Object.values(pm).forEach(n => drawNode(n, 'cur'));
}

// Shot component
const SHOT_CAP = 54, SHOT_MAXS = 3.0, SHOT_VW = STAGE.w, SHOT_VH = STAGE.h - SHOT_CAP;
const shotToPx = (r, w, h) => ({ x: r[0] * w, y: r[1] * h, w: (r[2] - r[0]) * w, h: (r[3] - r[1]) * h });
const shotMix = (a, b, p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) });
function shotCamera(r, focus) {
  const m = focus ? 70 : 24;
  const s = Math.min((SHOT_VW - 2 * m) / r.w, (SHOT_VH - 2 * m) / r.h, SHOT_MAXS);
  return { s, ox: SHOT_VW / 2 - (r.x + r.w / 2) * s, oy: SHOT_VH / 2 - (r.y + r.h / 2) * s };
}

function drawShot(ctx, states, t, baseAlpha, motionDir) {
  const imgInfo = states[0].img;
  const seq = [];
  const full = shotToPx(states[0].full, imgInfo.w, imgInfo.h);
  if (states[0].k > 0) seq.push({ t: states[0].t, r: full, k: 0, note: states[0].note });
  states.forEach((s, j) => seq.push({ t: j === 0 && s.k > 0 ? s.t + .8 : s.t, r: s.k > 0 ? shotToPx(s.rect, imgInfo.w, imgInfo.h) : full, k: s.k, note: s.note }));
  let i = 0;
  for (let j = 0; j < seq.length; j++) if (seq[j].t <= t) i = j;
  const cur = seq[i], prev = i > 0 ? seq[i - 1] : cur;
  const dt = t - cur.t;
  const pm = easeIO(dt / .85);
  const view = shotMix(prev.r, cur.r, pm);
  const cam = shotCamera(view, cur.k > 0 || prev.k > 0);
  const fr = cur.k > 0 ? shotMix(prev.k > 0 ? prev.r : cur.r, cur.r, pm) : null;
  const sp = fr ? { x: cam.ox + fr.x * cam.s, y: cam.oy + fr.y * cam.s, w: fr.w * cam.s, h: fr.h * cam.s } : null;
  const dark = cur.k > 0 ? ease((dt - (prev.k > 0 ? 0 : .3)) / .5) : prev.k > 0 ? 1 - ease(dt / .4) : 0;
  const stroke = cur.k > 0 ? ease((dt - (prev.k > 0 ? .5 : .55)) / .55) : 0;
  const pad = 8;
  const per = sp ? 2 * (sp.w + sp.h + 4 * pad) : 0;
  const glow = .5 * stroke;
  const enter = ease((t - states[0].t) / .5);

  // Viewport shadow & background
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 18;
  ctx.beginPath();
  ctx.roundRect(0, 0, SHOT_VW, SHOT_VH, 14);
  ctx.fillStyle = '#070b14';
  ctx.fill();
  ctx.restore();

  // Clipped viewport content
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, SHOT_VW, SHOT_VH, 14);
  ctx.clip();

  const im = getImage(imgInfo.src || imgInfo.data, motionDir) || getImage(imgInfo.data, motionDir);
  if (im) {
    ctx.save();
    if (enter < 0.99) ctx.filter = `brightness(${lerp(.75, 1, enter).toFixed(2)})`;
    ctx.drawImage(im, cam.ox, cam.oy, imgInfo.w * cam.s, imgInfo.h * cam.s);
    ctx.restore();
  }

  if (sp && dark > 0) {
    const pathStr = `M0 0H${SHOT_VW}V${SHOT_VH}H0Z M${sp.x - pad} ${sp.y - pad}h${sp.w + 2 * pad}v${sp.h + 2 * pad}h${-(sp.w + 2 * pad)}Z`;
    ctx.fillStyle = `rgba(2,4,10,${(0.62 * dark).toFixed(3)})`;
    ctx.fill(new Path2D(pathStr), 'evenodd');
  }

  if (sp && stroke > 0) {
    ctx.save();
    ctx.shadowColor = C.evidence;
    ctx.shadowBlur = 6 + 10 * glow;
    ctx.beginPath();
    ctx.roundRect(sp.x - pad, sp.y - pad, sp.w + 2 * pad, sp.h + 2 * pad, 6);
    ctx.strokeStyle = C.evidence;
    ctx.lineWidth = 5;
    ctx.setLineDash([per]);
    ctx.lineDashOffset = per * (1 - stroke);
    ctx.stroke();
    ctx.restore();

    // Corner brackets
    ctx.save();
    ctx.globalAlpha = baseAlpha * stroke;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    for (const [cx, cy, dx, dy] of [[0, 0, 1, 1], [1, 0, -1, 1], [0, 1, 1, -1], [1, 1, -1, -1]]) {
      const x = sp.x - pad - 10 + cx * (sp.w + 2 * pad + 20);
      const y = sp.y - pad - 10 + cy * (sp.h + 2 * pad + 20);
      const L = 26 * stroke;
      ctx.beginPath();
      ctx.moveTo(x, y + dy * L);
      ctx.lineTo(x, y);
      ctx.lineTo(x + dx * L, y);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();

  // Viewport white border
  ctx.beginPath();
  ctx.roundRect(1, 1, SHOT_VW - 2, SHOT_VH - 2, 14);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Bottom caption
  const capOp = ease((t - states[0].t - .2) / .4);
  if (capOp > 0) {
    ctx.save();
    ctx.globalAlpha = baseAlpha * capOp;
    const cy = SHOT_VH + 8;
    fillStrokeRoundRect(ctx, 0, cy + 5, 68, 34, 4, C.evidence, null, 0);
    ctx.font = `22px ${PIXEL}`;
    ctx.fillStyle = '#1b1405';
    drawTextTop(ctx, '実物', 34, cy + 8, 22, 28, 'center');

    let lx = 68 + 14;
    ctx.font = `18px ${SANS}`;
    ctx.fillStyle = C.sub;
    const fileLabel = `スクリーンショット｜${imgInfo.file}`;
    drawTextTop(ctx, fileLabel, lx, cy + 11, 18, 23, 'left');
    lx += ctx.measureText(fileLabel).width + 24;

    ctx.font = `26px ${SANSB}`;
    ctx.fillStyle = C.ink;
    drawTextTop(ctx, cur.note || '', lx, cy + 6, 26, 33, 'left');
    ctx.restore();
  }
}

// Helper for Panel in Cards.tsx
// CSS content-box: width: w, padding: '30px 44px 36px', border: 2px solid color
function drawPanel(ctx, w, contentH, t, label, color = C.line, drawContent) {
  const p = easeIO(t / .55);
  const labelH = label ? (28 + 12) : 0;
  const outerW = w + 88 + 4;
  const outerH = 30 + labelH + contentH + 36 + 4;
  const bx = (STAGE.w - outerW) / 2;
  const by = (STAGE.h - outerH) / 2;

  const insetRatio = (1 - p) * 0.48;
  const clipY = by + outerH * insetRatio;
  const clipH = outerH * (1 - 2 * insetRatio);
  if (clipH <= 2) return;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(bx, clipY, outerW, clipH, 14);
  ctx.clip();

  fillStrokeRoundRect(ctx, bx + 1, by + 1, outerW - 2, outerH - 2, 14, 'rgba(8,13,26,0.94)', color, 2);

  const cx = bx + 2 + 44;
  let cy = by + 2 + 30;
  if (label) {
    ctx.save();
    ctx.font = `22px ${PIXEL}`;
    ctx.fillStyle = color;
    ctx.letterSpacing = '4px';
    drawTextTop(ctx, label, cx, cy, 22, 28, 'left');
    ctx.restore();
    cy += labelH;
  }

  drawContent(cx, cy, w);
  ctx.restore();
}

function drawTermCard(ctx, e, t, baseAlpha) {
  const parts = String(e.defn || '').split(/(?<=。)/).filter(Boolean);
  const w = 1080;
  ctx.font = `36px ${SANS}`;
  const wrappedParts = parts.map(s => wrapTextLines(ctx, s, w));
  const totalLines = wrappedParts.reduce((acc, l) => acc + l.length, 0);
  const contentH = 77 + 16 + 3 + 20 + totalLines * 56;

  drawPanel(ctx, w, contentH, t, '用語', C.line, (cx, cy) => {
    // Term title clipped horizontally
    const pTerm = ease((t - .3) / .5);
    if (pTerm > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy - 5, w * pTerm, 90);
      ctx.clip();
      ctx.font = `70px ${PIXEL}`;
      ctx.fillStyle = C.ink;
      drawTextTop(ctx, e.term, cx, cy, 70, 77, 'left');
      ctx.restore();
    }
    let y = cy + 77 + 16;

    // Bar
    const pBar = ease((t - .45) / .6);
    if (pBar > 0) {
      ctx.fillStyle = C.me;
      ctx.fillRect(cx, y, w * pBar, 3);
    }
    y += 3 + 20;

    // Defn parts
    wrappedParts.forEach((lines, k) => {
      const pk = ease((t - .7 - k * .35) / .5);
      if (pk > 0) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * pk;
        ctx.font = `36px ${SANS}`;
        ctx.fillStyle = C.ink;
        const ty = (1 - pk) * 14;
        for (const line of lines) {
          drawTextTop(ctx, line, cx, y + ty, 36, 56, 'left');
          y += 56;
        }
        ctx.restore();
      } else {
        y += lines.length * 56;
      }
    });
  });
}

function drawTableCard(ctx, e, t, baseAlpha) {
  const side = (s) => { const [src, ...v] = String(s || '').split('：'); return { src, v: v.join('：') }; };
  const A = side(e.a), B = side(e.b);
  const w = 1180;
  const colW = (w - 60 - 80) / 2;
  ctx.font = `38px ${SANSB}`;
  const linesA = wrapTextLines(ctx, A.v, colW);
  const linesB = wrapTextLines(ctx, B.v, colW);
  const maxLines = Math.max(linesA.length, linesB.length, 1);
  const colH = 30 + 8 + maxLines * 53;
  const contentH = 56 + 26 + Math.max(colH, 100);

  drawPanel(ctx, w, contentH, t, '記録の食い違い', C.betray, (cx, cy) => {
    ctx.font = `44px ${SERIFB}`;
    ctx.fillStyle = C.ink;
    drawTextTop(ctx, e.item, cx, cy, 44, 56, 'left');

    const rowY = cy + 56 + 26;
    const drawCol = (xObj, lines, k, xPos) => {
      const pk = ease((t - .5 - k * .4) / .5);
      if (pk <= 0) return;
      const tx = (1 - pk) * (k ? 30 : -30);
      ctx.save();
      ctx.globalAlpha = baseAlpha * pk;
      ctx.font = `24px ${SANSB}`;
      ctx.fillStyle = C.sub;
      drawTextTop(ctx, xObj.src, xPos + tx, rowY, 24, 30, 'left');
      ctx.font = `38px ${SANSB}`;
      ctx.fillStyle = C.ink;
      lines.forEach((ln, idx) => {
        drawTextTop(ctx, ln, xPos + tx, rowY + 38 + idx * 53, 38, 53, 'left');
      });
      ctx.restore();
    };

    drawCol(A, linesA, 0, cx);

    // ≠ symbol
    const scNeq = back((t - .9) / .4);
    if (scNeq > 0) {
      ctx.save();
      ctx.translate(cx + colW + 30 + 40, rowY + colH / 2);
      ctx.scale(scNeq, scNeq);
      ctx.font = `80px ${SANSB}`;
      ctx.fillStyle = C.betray;
      drawTextTop(ctx, '≠', 0, -50, 80, 100, 'center');
      ctx.restore();
    }

    drawCol(B, linesB, 1, cx + colW + 60 + 80);
  });
}

function drawEventCard(ctx, e, t, baseAlpha) {
  const p = easeIO(t / .6);
  const op = baseAlpha * p;
  if (op <= 0) return;
  const text = [...String(e.text || '')];
  const n = Math.floor(clamp((t - .9) / Math.max(2.5, text.length * .045)) * text.length);

  const bx = 120, by = 10, bw = STAGE.w - 240, bh = STAGE.h - 20;
  const sc = lerp(.9, 1, p);

  ctx.save();
  ctx.globalAlpha = op;
  ctx.translate(bx + bw / 2, by + bh / 2);
  ctx.scale(sc, sc);
  ctx.translate(-bw / 2, -bh / 2);

  // Outer shadow + 6px #14140f border
  ctx.fillStyle = '#14140f';
  ctx.fillRect(-6, -6, bw + 12, bh + 12);

  const bgGrad = ctx.createLinearGradient(0, 0, 0, bh);
  bgGrad.addColorStop(0, '#23241c');
  bgGrad.addColorStop(1, '#191a14');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, bw, bh);

  ctx.strokeStyle = '#8d8158';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, bw - 3, bh - 3);

  // Header
  const hGrad = ctx.createLinearGradient(0, 3, 0, 67);
  hGrad.addColorStop(0, '#3a3626');
  hGrad.addColorStop(1, '#2a2719');
  ctx.fillStyle = hGrad;
  ctx.fillRect(3, 3, bw - 6, 64);

  ctx.beginPath();
  ctx.moveTo(3, 67);
  ctx.lineTo(bw - 3, 67);
  ctx.strokeStyle = '#8d8158';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.font = `38px ${SERIFB}`;
  ctx.fillStyle = '#e8dcb0';
  ctx.letterSpacing = '4px';
  drawTextTop(ctx, e.title, 31, 11, 38, 48, 'left');
  ctx.restore();

  ctx.font = `24px ${PIXEL}`;
  ctx.fillStyle = '#c9b97e';
  drawTextTop(ctx, e.date, bw - 31, 20, 24, 30, 'right');

  // Body text with cursor
  const fSize = text.length > 120 ? 30 : 38;
  const lh = fSize * 1.75;
  const shownStr = text.slice(0, n).join('');
  ctx.font = `${fSize}px ${SERIF}`;
  const bodyLines = wrapTextLines(ctx, shownStr + '▍', bw - 80);
  bodyLines.forEach((ln, idx) => {
    const hasCursor = idx === bodyLines.length - 1 && ln.endsWith('▍');
    const cleanLn = hasCursor ? ln.slice(0, -1) : ln;
    ctx.fillStyle = '#e9e4d0';
    drawTextTop(ctx, cleanLn, 40, 67 + 30 + idx * lh, fSize, lh, 'left');
    if (hasCursor && (Math.floor(t * 2) % 2)) {
      const cw = ctx.measureText(cleanLn).width;
      ctx.fillStyle = '#c9b97e';
      drawTextTop(ctx, '▍', 40 + cw, 67 + 30 + idx * lh, fSize, lh, 'left');
    }
  });

  // Bottom source button
  const btnSc = back((t - 1.6) / .5);
  if (btnSc > 0) {
    const srcTxt = `出典：${e.src}`;
    ctx.font = `24px ${SANSB}`;
    const btnW = ctx.measureText(srcTxt).width + 80;
    const btnH = 52;
    ctx.save();
    ctx.translate(bw / 2, bh - 26 - btnH / 2);
    ctx.scale(btnSc, btnSc);
    ctx.fillStyle = '#3d3926';
    ctx.fillRect(-btnW / 2, -btnH / 2, btnW, btnH);
    ctx.strokeStyle = '#a9996a';
    ctx.lineWidth = 2;
    ctx.strokeRect(-btnW / 2, -btnH / 2, btnW, btnH);
    ctx.fillStyle = '#efe6c2';
    drawTextTop(ctx, srcTxt, 0, -btnH / 2 + 10, 24, 32, 'center');
    ctx.restore();
  }

  ctx.restore();
}

function drawVideoCard(ctx, e) {
  ctx.beginPath();
  ctx.roundRect(-1, -1, STAGE.w + 2, STAGE.h - 50, 14);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const cy = STAGE.h - 46;
  fillStrokeRoundRect(ctx, 0, cy + 4, 68, 34, 4, C.evidence, null, 0);
  ctx.font = `22px ${PIXEL}`;
  ctx.fillStyle = '#1b1405';
  drawTextTop(ctx, '実物', 34, cy + 7, 22, 28, 'center');

  let lx = 68 + 14;
  const fStr = `${e.video.file.startsWith('yt/') ? '本人が上げた動画' : '画面の録画'}｜${e.video.file.replace('yt/yt_', 'YouTube ').replace(/\.\w+$/, '')}`;
  ctx.font = `18px ${SANS}`;
  ctx.fillStyle = C.sub;
  drawTextTop(ctx, fStr, lx, cy + 10, 18, 23, 'left');
  lx += ctx.measureText(fStr).width + 14;

  ctx.font = `26px ${SANSB}`;
  ctx.fillStyle = C.ink;
  drawTextTop(ctx, e.note || '', lx, cy + 5, 26, 33, 'left');
}

function drawBias(ctx, e, t, baseAlpha) {
  const B = e.bias, x0 = 30, x1 = STAGE.w - 150, base = 330, dot = 9;
  const X = (d) => { const [y, m] = d.split('-').map(Number); return x0 + timeX(y + (m - .5) / 12) * (x1 - x0); };
  const p = (k) => ease((t - .5 - k * .03) / .5);
  const w = STAGE.w - 40;
  const contentH = base + 60 + 30;

  drawPanel(ctx, w, contentH, t, '残っているスクリーンショット（日付の分かるもの 1 枚 = 点 1 つ）', C.line, (cx, cy) => {
    ctx.save();
    ctx.translate(cx, cy);
    for (const y of [2018, 2019, 2020, 2021, 2022, 2025]) {
      const x = x0 + timeX(y) * (x1 - x0);
      ctx.beginPath();
      ctx.moveTo(x, 20);
      ctx.lineTo(x, base + 6);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = `20px ${PIXEL}`;
      ctx.fillStyle = C.sub;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillText(String(y), x + 6, base + 34);
    }
    ctx.beginPath();
    ctx.moveTo(x0, base + 6);
    ctx.lineTo(x1, base + 6);
    ctx.strokeStyle = C.sub;
    ctx.lineWidth = 1;
    ctx.stroke();

    let k = 0;
    for (const [d, n] of B.months) {
      for (let j = 0; j < n; j++) {
        const q = p(k++);
        if (q <= 0) continue;
        const col = Math.floor(j / 36), row = j % 36;
        ctx.globalAlpha = baseAlpha * q;
        ctx.fillStyle = C.me;
        ctx.fillRect(X(d) - dot / 2 + col * (dot + 1), base - (row + 1) * (dot - 1) - (1 - q) * 30, dot - 2, dot - 2);
      }
    }
    ctx.globalAlpha = baseAlpha;
    ctx.font = `22px ${SANS}`;
    ctx.fillStyle = C.sub;
    drawTextTop(ctx, `全 ${B.total} 枚のうち、ファイル名の日付と本人が付けた名前から時期が分かる ${B.dated} 枚。`, 0, base + 60, 22, 28, 'left');
    ctx.restore();
  });
}

const MAP_ITEMS = [['神華（2018 櫻宮神華王国）', '大神華連邦ほか神華の国々'], ['神聖大神華帝国（2019）', '下腦の帝国の名前'],
  ['靈榮（2019）', '大靈榮国民共栄国'], ['〜国民共栄国（2020）', '国名の形として'], ['神護（2020）', '神護国'], ['禮天の戒律（2020）', '禮天教'],
  ['竪野（2020）', '竪野半島・竪野国民共和国'], ['皇京条約機構（2021）', '首都 皇京'], ['反神華武装戦線（2021）', '東洋反神華武装戦線'],
  ['犬走椛＋皇京条約機構', '椛京条約機構', true], ['今泉', '今泉游（初代大総統）', true]];

function drawMapping(ctx, t, dur, baseAlpha) {
  const step = Math.min(1.6, Math.max(.6, (dur - 4) / MAP_ITEMS.length));
  const w = STAGE.w - 60;
  const contentH = MAP_ITEMS.length * 46;

  drawPanel(ctx, w, contentH, t, '骨粉 → 下腦', C.line, (cx, cy) => {
    MAP_ITEMS.forEach(([a, b, guess], k) => {
      const p = ease((t - .5 - k * step) / .6), q = easeIO((t - .8 - k * step) / .7);
      if (p <= 0) return;
      const ry = cy + k * 46;
      ctx.save();
      ctx.globalAlpha = baseAlpha * p;
      ctx.font = `28px ${SANSB}`;
      ctx.fillStyle = C.ink;
      drawTextTop(ctx, a, cx + 470, ry + 5, 28, 36, 'right');

      // Arrow
      const ax = cx + 470;
      ctx.beginPath();
      ctx.moveTo(ax + 10, ry + 23);
      ctx.lineTo(ax + 10 + 130 * q, ry + 23);
      ctx.strokeStyle = guess ? C.sub : C.me;
      ctx.lineWidth = 3;
      ctx.setLineDash(guess ? [6, 6] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (q > .95) {
        ctx.beginPath();
        ctx.moveTo(ax + 150, ry + 23);
        ctx.lineTo(ax + 136, ry + 15);
        ctx.lineTo(ax + 136, ry + 31);
        ctx.closePath();
        ctx.fillStyle = guess ? C.sub : C.me;
        ctx.fill();
      }

      if (q > 0) {
        ctx.globalAlpha = baseAlpha * p * q;
        const bx = ax + 160 + (1 - q) * -20;
        ctx.font = `30px ${SERIFB}`;
        ctx.fillStyle = guess ? C.sub : C.me;
        drawTextTop(ctx, b, bx, ry + 4, 30, 38, 'left');
        if (guess) {
          const bw = ctx.measureText(b).width;
          ctx.font = `20px ${SANS}`;
          drawTextTop(ctx, '〔推理〕', bx + bw + 12, ry + 11, 20, 26, 'left');
        }
      }
      ctx.restore();
    });
  });
}

function drawLegendCard(ctx, t, baseAlpha) {
  const rows = [['会話1〜会話10', '2025年9月、本人が友人に骨粉の歴史を話した録音の文字起こし'], ['通史', '本人が書いた骨粉の歴史'],
    ['◎', '原典に日付がある'], ['○', '月・季節まで分かる'], ['△', '推定']];
  const w = 1100;
  const contentH = 260;

  drawPanel(ctx, w, contentH, t, '出典と日付の印', C.line, (cx, cy) => {
    let y = cy;
    rows.forEach(([a, b], k) => {
      y += k === 2 ? 26 : 10;
      const pk = ease((t - .5 - k * .4) / .5);
      if (pk > 0) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * pk;
        ctx.font = `${k >= 2 ? 44 : 30}px ${k >= 2 ? SANSB : PIXEL}`;
        ctx.fillStyle = C.me;
        drawTextTop(ctx, a, cx + 330, y, k >= 2 ? 44 : 30, 48, 'right');
        ctx.font = `32px ${SANS}`;
        ctx.fillStyle = C.ink;
        drawTextTop(ctx, b, cx + 360, y + (k >= 2 ? 6 : 0), 32, 42, 'left');
        ctx.restore();
      }
      y += 44;
    });
  });
}

function drawTweetCard(ctx, e, t, baseAlpha) {
  const p = ease((t - .25) / .5);
  const rawLines = String(e.text || '').split(/(?<=。)/).filter(Boolean);
  const w = 980;
  ctx.font = `38px ${SANS}`;
  const wrappedGroups = rawLines.map(s => wrapTextLines(ctx, s, w));
  const totalLines = wrappedGroups.reduce((acc, l) => acc + l.length, 0);
  const contentH = 76 + 18 + totalLines * 61;

  drawPanel(ctx, w, contentH, t, 'ツイート', C.line, (cx, cy) => {
    if (p > 0) {
      ctx.save();
      ctx.globalAlpha = baseAlpha * p;
      // Avatar circle
      ctx.beginPath();
      ctx.arc(cx + 38, cy + 38, 38, 0, Math.PI * 2);
      ctx.fillStyle = '#33405a';
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx + 38, cy + 38, 38, 0, Math.PI * 2);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(cx + 25 + 13, cy + 12 + 13, 13, 0, Math.PI * 2);
      ctx.fillStyle = '#8b97b1';
      ctx.fill();
      ctx.beginPath();
      ctx.roundRect(cx + 10, cy + 44, 56, 50, 28);
      ctx.fillStyle = '#8b97b1';
      ctx.fill();
      ctx.restore();

      const tx = cx + 76 + 20;
      if (e.name) {
        ctx.font = `34px ${SANSB}`;
        ctx.fillStyle = C.ink;
        drawTextTop(ctx, e.name, tx, cy + 4, 34, 41, 'left');
        ctx.font = `26px ${SANS}`;
        ctx.fillStyle = C.sub;
        drawTextTop(ctx, e.date, tx, cy + 45, 26, 34, 'left');
      } else {
        ctx.font = `26px ${SANS}`;
        ctx.fillStyle = C.sub;
        drawTextTop(ctx, e.date, tx, cy + 21, 26, 34, 'left');
      }
      ctx.restore();
    }

    let y = cy + 76 + 18;
    wrappedGroups.forEach((lines, k) => {
      const pk = ease((t - .55 - k * .3) / .5);
      if (pk > 0) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * pk;
        ctx.font = `38px ${SANS}`;
        ctx.fillStyle = C.ink;
        const ty = (1 - pk) * 12;
        for (const ln of lines) {
          drawTextTop(ctx, ln, cx, y + ty, 38, 61, 'left');
          y += 61;
        }
        ctx.restore();
      } else {
        y += lines.length * 61;
      }
    });
  });
}

function drawStage(ctx, groups, t, motionDir) {
  const visible = groups.filter(g => t >= g.t0 - .01 && t < g.t1 + .45);
  for (const g of visible) {
    const out = ease((t - g.t1) / .4);
    const pin = ease((t - g.t0) / .45);
    const op = pin * (1 - out);
    if (op <= 0) continue;
    const sc = lerp(.965, 1, pin) - out * .03;

    ctx.save();
    ctx.globalAlpha = op;
    ctx.translate(STAGE.x + STAGE.w / 2, STAGE.y + STAGE.h / 2);
    ctx.scale(sc, sc);
    ctx.translate(-STAGE.w / 2, -STAGE.h / 2);
    if (out > 0.02) {
      ctx.filter = `blur(${(out * 6).toFixed(1)}px)`;
    }

    if (g.kind === '図') drawGraph(ctx, g.evs.map(e => ({ t: e.t, graph: e.graph })), g.prevGraph, t, op, motionDir);
    else if (g.kind === '写') drawShot(ctx, g.evs, t, op, motionDir);
    else if (g.kind === '語') drawTermCard(ctx, g.evs[0], t - g.t0, op);
    else if (g.kind === 'ツイート') drawTweetCard(ctx, g.evs[0], t - g.t0, op);
    else if (g.kind === '表') drawTableCard(ctx, g.evs[0], t - g.t0, op);
    else if (g.kind === '事件') drawEventCard(ctx, g.evs[0], t - g.t0, op);
    else if (g.kind === '動画') drawVideoCard(ctx, g.evs[0]);
    else if (g.kind === '素材') drawBias(ctx, g.evs[0], t - g.t0, op);
    else if (g.kind === '対応') drawMapping(ctx, t - g.t0, g.t1 - g.t0, op);
    else if (g.kind === '出典') drawLegendCard(ctx, t - g.t0, op);

    ctx.restore();
  }
}

export function renderChapterFrame(ctx, props, groups, frame, motionDir) {
  const t = frame / FPS;
  const titleEnd = (props.lines[0]?.e ?? 3) + .5;

  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(getShadeCanvas(), 0, 0);
  drawStage(ctx, groups, t, motionDir);
  drawTitleCard(ctx, props.title, t, titleEnd);
  drawTimeline(ctx, props.events, t, props.title, titleEnd);
  drawHUD(ctx, props.events, t, motionDir);
  drawDateStamp(ctx, props.events, t);
  drawNameMorph(ctx, props.events, t);
  drawPersonCard(ctx, props.events, t, motionDir);
  drawQuoteCard(ctx, props.quotes, t);
}
