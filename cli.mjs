#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderFrames, frameFileName } from './src/render.mjs';

const USAGE = `Usage: skia-frames <scene.mjs> [options]

Options:
  --out <dir>        Output directory (default: frames/<sceneName>)
  --workers <N>      Worker threads (default: os.cpus().length)
  --props <file>     JSON props passed to the scene (default: {})
  --from <F>         First frame, inclusive (default: 0)
  --to <F>           Last frame, inclusive (default: durationInFrames - 1)
  --resume           Skip frames whose existing PNG is valid
  --concat           Skip isStatic() frames and write <out>/concat.txt
  --prefix <p>       Output file prefix (default: frame-)
  -h, --help         Show this help

Output files are named <prefix><5-digit frame>.png.`;

function fail(message) {
  console.error(`skia-frames: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    scene: null,
    out: null,
    workers: null,
    props: null,
    from: null,
    to: null,
    resume: false,
    concat: false,
    prefix: null,
    help: false,
  };

  const takeValue = (name, value, index) => {
    if (value !== undefined) return value;
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      fail(`missing value for --${name}`);
    }
    return next;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      if (opts.scene !== null) fail(`unexpected argument: ${arg}`);
      opts.scene = arg;
      continue;
    }

    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    let value = eq === -1 ? undefined : arg.slice(eq + 1);

    switch (name) {
      case 'out':
      case 'workers':
      case 'props':
      case 'from':
      case 'to':
      case 'prefix': {
        value = takeValue(name, value, i);
        if (eq === -1) i++;
        opts[name] = value;
        break;
      }
      case 'resume':
      case 'concat': {
        if (value !== undefined) {
          if (value !== 'true' && value !== 'false') {
            fail(`--${name} does not take a value`);
          }
          opts[name] = value === 'true';
        } else {
          opts[name] = true;
        }
        break;
      }
      default:
        fail(`unknown option: --${name}`);
    }
  }

  return opts;
}

function asInteger(name, value, fallback) {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) fail(`--${name} must be an integer (got "${value}")`);
  return n;
}

function sceneNameFromPath(scenePath) {
  const base = path.basename(scenePath, path.extname(scenePath));
  if (base === 'scene' || base === 'index') {
    return path.basename(path.dirname(path.resolve(scenePath)));
  }
  return base;
}

function formatDuration(frames, fps) {
  return (frames / fps).toFixed(7);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(USAGE);
    return;
  }
  if (!opts.scene) fail(`missing scene module\n\n${USAGE}`);

  const scenePath = path.resolve(opts.scene);
  if (!fs.existsSync(scenePath)) fail(`scene not found: ${scenePath}`);

  let scene;
  try {
    scene = await import(pathToFileURL(scenePath).href);
  } catch (err) {
    fail(`failed to load scene: ${err?.stack || err}`);
  }

  const config = scene.config;
  if (!config || typeof config !== 'object') {
    fail('scene module must export a config object');
  }
  if (typeof scene.draw !== 'function') {
    fail('scene module must export a draw() function');
  }
  for (const key of ['width', 'height', 'fps', 'durationInFrames']) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) {
      fail(`scene config.${key} must be a positive number`);
    }
  }
  const { width, height, fps, durationInFrames } = config;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    fail('scene config.width and config.height must be integers');
  }
  if (!Number.isInteger(durationInFrames)) {
    fail('scene config.durationInFrames must be an integer');
  }

  let props = {};
  if (opts.props) {
    const propsPath = path.resolve(opts.props);
    try {
      props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
    } catch (err) {
      fail(`failed to read props: ${err?.message || err}`);
    }
  }

  const from = asInteger('from', opts.from, 0);
  const to = asInteger('to', opts.to, durationInFrames - 1);
  if (from < 0 || to < 0) fail('--from and --to must be >= 0');
  if (from > to) fail(`--from (${from}) must be <= --to (${to})`);
  if (to >= durationInFrames) {
    fail(`--to (${to}) must be < durationInFrames (${durationInFrames})`);
  }

  const workers = asInteger('workers', opts.workers, os.cpus().length);
  if (workers < 1) fail('--workers must be >= 1');

  const prefix = opts.prefix ?? 'frame-';
  if (!prefix) fail('--prefix must not be empty');

  const outDir = path.resolve(
    opts.out ?? path.join('frames', sceneNameFromPath(scenePath))
  );
  fs.mkdirSync(outDir, { recursive: true });

  const range = [];
  for (let frame = from; frame <= to; frame++) range.push(frame);

  let frames = range;
  let segments = null;

  if (opts.concat) {
    segments = [];
    let current = null;
    for (const frame of range) {
      const isStaticFrame =
        current !== null &&
        typeof scene.isStatic === 'function' &&
        scene.isStatic(frame, props) === true;
      if (isStaticFrame) {
        current.frames++;
      } else {
        if (current) segments.push(current);
        current = { frame, frames: 1 };
      }
    }
    if (current) segments.push(current);
    frames = segments.map((segment) => segment.frame);
    console.log(
      `[skia-frames] concat mode: rendering ${frames.length} of ${range.length} frames (${range.length - frames.length} static)`
    );
  }

  const result = await renderFrames({
    sceneUrl: pathToFileURL(scenePath).href,
    config,
    props,
    outDir,
    prefix,
    workers,
    frames,
    resume: opts.resume,
  });

  if (segments) {
    const lines = [];
    for (const segment of segments) {
      lines.push(`file '${frameFileName(prefix, segment.frame)}'`);
      lines.push(`duration ${formatDuration(segment.frames, fps)}`);
    }
    lines.push(`file '${frameFileName(prefix, segments[segments.length - 1].frame)}'`);
    const concatPath = path.join(outDir, 'concat.txt');
    fs.writeFileSync(concatPath, lines.join('\n') + '\n');
    console.log(`[skia-frames] Wrote ${concatPath}`);
    console.log(
      `ffmpeg -f concat -safe 0 -i ${concatPath} -vsync cfr -r ${fps} -c:v libx264 -pix_fmt yuv420p out.mp4`
    );
  }

  if (!result.ok) {
    console.error(
      `[skia-frames] ${result.bad.length} frame(s) missing or invalid in ${outDir}`
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`skia-frames: ${err?.stack || err}`);
  process.exit(1);
});
