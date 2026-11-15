import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  W,
  H,
  FPS,
  initFonts,
  preloadImages,
  buildGroups,
  renderChapterFrame,
} from './skia_renderer.mjs';

const motionDir = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  width: W,
  height: H,
  fps: FPS,
  durationInFrames: 180,
};

const DEFAULT_PROPS = {
  title: 'Sample chapter',
  duration: 6,
  durationInFrames: 180,
  lines: [{ s: 0, e: 2 }],
  events: [],
  quotes: [],
};

export async function setup(props) {
  const merged = {
    ...DEFAULT_PROPS,
    ...props,
    lines: props?.lines ?? DEFAULT_PROPS.lines,
    events: props?.events ?? DEFAULT_PROPS.events,
    quotes: props?.quotes ?? DEFAULT_PROPS.quotes,
  };

  try {
    initFonts(motionDir);
  } catch (err) {
    console.warn(
      `[timeline] fonts_src unavailable, using system fallback fonts: ${err.message}`
    );
  }
  await preloadImages(merged, motionDir);

  return {
    props: merged,
    groups: buildGroups(merged.events, merged.duration),
  };
}

export function draw(ctx, frame, props, state) {
  renderChapterFrame(ctx, state.props, state.groups, frame, motionDir);
}
