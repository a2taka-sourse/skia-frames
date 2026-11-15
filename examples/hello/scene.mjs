import { Easing, interpolate, spring } from '../../src/anim.mjs';

export const config = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 180,
};

const TITLE = 'skia-frames';
const SUBTITLE = 'parallel Skia PNG sequences';

export function draw(ctx, frame) {
  const { width, height, fps } = config;

  const enter = spring({
    frame,
    fps,
    damping: 12,
    mass: 0.9,
    stiffness: 120,
  });
  const titleFade = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const titleY = interpolate(enter, [0, 1], [height / 2 + 80, height / 2 - 24]);
  const subtitle = interpolate(frame, [16, 46], [0, 1], {
    easing: Easing.outCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const subtitleFade = interpolate(frame, [16, 36], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const subtitleY = interpolate(subtitle, [0, 1], [height / 2 + 70, height / 2 + 62]);
  const ruleWidth = interpolate(subtitle, [0, 1], [0, 460]);
  const exit = interpolate(frame, [158, 179], [1, 0], {
    easing: Easing.inOutCubic,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  ctx.save();
  ctx.globalAlpha = titleFade * exit;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(90, 167, 255, 0.65)';
  ctx.shadowBlur = 48;
  ctx.fillStyle = '#f2f6ff';
  ctx.font = '700 150px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(TITLE, width / 2, titleY);

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  const gradient = ctx.createLinearGradient(
    width / 2 - ruleWidth / 2,
    0,
    width / 2 + ruleWidth / 2,
    0
  );
  gradient.addColorStop(0, 'rgba(90, 167, 255, 0)');
  gradient.addColorStop(0.5, 'rgba(90, 167, 255, 0.9)');
  gradient.addColorStop(1, 'rgba(90, 167, 255, 0)');
  ctx.globalAlpha = subtitle * exit;
  ctx.fillStyle = gradient;
  ctx.fillRect(width / 2 - ruleWidth / 2, height / 2 + 26, ruleWidth, 3);

  ctx.globalAlpha = subtitleFade * exit;
  ctx.fillStyle = '#b8c6dd';
  ctx.font = '400 44px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(SUBTITLE, width / 2, subtitleY);

  ctx.globalAlpha = subtitleFade * exit * 0.7;
  ctx.fillStyle = '#6f819c';
  ctx.font = '500 24px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
  ctx.fillText(
    `${width}x${height} | ${fps} fps | 180 frames`,
    width / 2,
    height / 2 + 126
  );
  ctx.restore();
}
