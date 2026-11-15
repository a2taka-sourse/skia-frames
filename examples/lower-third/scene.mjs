import { Easing, interpolate, spring } from '../../src/anim.mjs';

export const config = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 180,
};

const NAME = 'Aoi Takagi';
const ROLE = 'Creative Technologist';

const ENTER_END = 30;
const HOLD_END = 150;
const EXIT_END = config.durationInFrames - 1;

const BAR = { x: 120, y: 800, w: 760, h: 156, r: 18 };

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

export function isStatic(frame) {
  return frame > ENTER_END && frame <= HOLD_END;
}

export function draw(ctx, frame) {
  const entryFrame = Math.min(frame, ENTER_END);
  const enter = spring({
    frame: entryFrame,
    fps: config.fps,
    damping: 14,
    mass: 0.8,
    stiffness: 140,
  });

  const slideIn = interpolate(enter, [0, 1], [-120, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const fadeIn = interpolate(entryFrame, [0, 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const barReveal = interpolate(enter, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const exit = interpolate(frame, [HOLD_END, EXIT_END], [0, 1], {
    easing: Easing.inOutCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const slideOut = interpolate(exit, [0, 1], [0, -120]);
  const fadeOut = 1 - exit;

  const x = BAR.x + slideIn + slideOut;
  const y = BAR.y;
  const opacity = fadeIn * fadeOut;

  ctx.save();
  ctx.globalAlpha = opacity;

  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 32;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = 'rgba(10, 16, 30, 0.88)';
  roundRect(ctx, x, y, BAR.w, BAR.h, BAR.r);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.save();
  roundRect(ctx, x, y, BAR.w, BAR.h, BAR.r);
  ctx.clip();
  const accentWidth = BAR.w * barReveal;
  const accent = ctx.createLinearGradient(x, y, x + 12, y + BAR.h);
  accent.addColorStop(0, '#f0b93a');
  accent.addColorStop(1, '#ff8a3d');
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, 12 * barReveal, BAR.h);

  ctx.strokeStyle = 'rgba(160, 190, 230, 0.28)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + accentWidth, y + 1);
  ctx.lineTo(x + BAR.w - BAR.r, y + 1);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#f2f6ff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 58px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(NAME, x + 48, y + 76);

  ctx.fillStyle = '#9fb0c8';
  ctx.font = '400 32px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(ROLE, x + 48, y + 122);

  ctx.fillStyle = '#f0b93a';
  ctx.fillRect(x + 48, y + 96, 34, 3);
  ctx.restore();
}
