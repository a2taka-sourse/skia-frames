// High-speed parallel Skia renderer for Koppunshi Chapter frames
// Usage: node render_skia.mjs <chapter: e.g. ch00 or 0> [threads: default 12]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const okPng = (p) => {
  try {
    const s = fs.statSync(p).size;
    if (s < 100) return false;
    const fd = fs.openSync(p, 'r');
    const b = Buffer.alloc(12);
    fs.readSync(fd, b, 0, 12, s - 12);
    fs.closeSync(fd);
    return b.includes('IEND');
  } catch {
    return false;
  }
};

if (isMainThread) {
  const rawCh = process.argv[2] || 'ch00';
  const c = rawCh.startsWith('ch') ? rawCh : `ch${String(rawCh).padStart(2, '0')}`;
  const numWorkers = Math.max(1, +(process.argv[3] || Math.min(14, os.cpus().length)));
  const step = +(process.env.STEP || 2);
  const overwrite = process.env.OVERWRITE === '1';

  const propsPath = path.resolve(__dirname, 'props', `${c}.json`);
  if (!fs.existsSync(propsPath)) {
    console.error(`Props file not found: ${propsPath}`);
    process.exit(1);
  }
  const props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
  const outDir = path.resolve(__dirname, process.env.OUT || `frames/${c}`);
  fs.mkdirSync(outDir, { recursive: true });

  const want = props.durationInFrames;
  const spans = (props.active?.length ? props.active : [[0, props.duration]]).map(([a, b]) => [
    Math.max(0, Math.floor(a * 30)),
    Math.min(want - 1, Math.floor(b * 30) + 2)
  ]);

  const need = new Set([0]);
  for (const [lo, hi] of spans) {
    for (let f = lo; f <= hi; f += step) need.add(f);
    need.add(lo);
    need.add(hi);
    if (hi + 1 < want) need.add(hi + 1);
  }

  // Check existing frames
  const have = new Set();
  if (!overwrite) {
    for (const f of fs.readdirSync(outDir)) {
      const m = /-([0-9]+)\.png$/.exec(f);
      if (m && okPng(path.join(outDir, f))) {
        have.add(+m[1]);
      }
    }
  }

  const todo = [...need].filter(f => !have.has(f)).sort((a, b) => a - b);
  console.log(`[Skia Renderer] Chapter ${c}: total frames=${want}, needed=${need.size}, existing=${have.size}, todo=${todo.length}, workers=${numWorkers}`);

  if (todo.length === 0) {
    console.log(`[Skia Renderer] Chapter ${c}: all frames already rendered.`);
    checkIntegrity(c, outDir, spans, want);
    process.exit(0);
  }

  const startTime = Date.now();
  let completedCount = 0;
  let todoIndex = 0;
  const CHUNK_SIZE = 16;

  let activeWorkers = numWorkers;

  for (let i = 0; i < numWorkers; i++) {
    const worker = new Worker(__filename, {
      workerData: {
        workerId: i,
        c,
        propsPath,
        outDir,
        motionDir: __dirname,
      }
    });

    worker.on('message', (msg) => {
      if (msg.type === 'get_chunk') {
        if (todoIndex < todo.length) {
          const chunk = todo.slice(todoIndex, todoIndex + CHUNK_SIZE);
          todoIndex += CHUNK_SIZE;
          worker.postMessage({ type: 'render_chunk', frames: chunk });
        } else {
          worker.postMessage({ type: 'done' });
        }
      } else if (msg.type === 'chunk_done') {
        completedCount += msg.count;
        const elapsed = (Date.now() - startTime) / 1000;
        const fps = (completedCount / elapsed).toFixed(1);
        const percent = ((completedCount / todo.length) * 100).toFixed(1);
        process.stdout.write(`\r[Skia Renderer] Progress: ${completedCount}/${todo.length} (${percent}%) | Speed: ${fps} fps | Elapsed: ${elapsed.toFixed(1)}s   `);
      }
    });

    worker.on('error', (err) => {
      console.error(`\nWorker ${i} error:`, err);
    });

    worker.on('exit', (code) => {
      activeWorkers--;
      if (activeWorkers === 0) {
        const totalElapsed = (Date.now() - startTime) / 1000;
        console.log(`\n[Skia Renderer] Finished rendering in ${totalElapsed.toFixed(2)}s (${(completedCount / totalElapsed).toFixed(1)} fps)`);
        checkIntegrity(c, outDir, spans, want);
      }
    });
  }

  function checkIntegrity(c, outDir, spans, want) {
    console.log(`[Skia Renderer] Verifying integrity for ${c}...`);
    const validFrames = [];
    for (const f of fs.readdirSync(outDir)) {
      const m = /-([0-9]+)\.png$/.exec(f);
      if (m && okPng(path.join(outDir, f))) {
        validFrames.push(+m[1]);
      }
    }
    validFrames.sort((a, b) => a - b);
    const validSet = new Set(validFrames);

    const bad = [];
    for (const [lo, hi] of spans) {
      if (!validSet.has(lo) && !validFrames.some(f => f <= lo)) {
        bad.append ? bad.append(['start_missing', lo]) : bad.push(['start_missing', lo]);
      }
      const inside = validFrames.filter(f => f >= lo && f <= hi);
      if (!inside.length) {
        bad.push(['empty_span', lo, hi]);
        continue;
      }
      const seq = [lo, ...inside, hi];
      for (let i = 0; i < seq.length - 1; i++) {
        if (seq[i + 1] - seq[i] > 5) {
          bad.push(['gap_too_wide', seq[i], seq[i + 1]]);
          break;
        }
      }
    }

    if (bad.length > 0) {
      console.error(`[Skia Renderer] CHECK FAILED: Found issues in frame sequence:`, bad.slice(0, 5));
      process.exit(1);
    }
    console.log(`[Skia Renderer] CHECK PASSED: ${validFrames.length} frames verified. Spans coverage is valid.`);
  }

} else {
  // WORKER THREAD
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { createCanvas } = require('@napi-rs/canvas');
  const { initFonts, buildGroups, renderChapterFrame, preloadImages, W, H } = await import('./skia_renderer.mjs');

  const { workerId, propsPath, outDir, motionDir } = workerData;

  initFonts(motionDir);

  const props = JSON.parse(fs.readFileSync(propsPath, 'utf8'));
  await preloadImages(props, motionDir);
  const groups = buildGroups(props.events, props.duration);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  parentPort.on('message', (msg) => {
    if (msg.type === 'render_chunk') {
      const frames = msg.frames;
      for (const frame of frames) {
        try {
          renderChapterFrame(ctx, props, groups, frame, motionDir);
          const buf = canvas.toBuffer('image/png');
          const fname = `element-${String(frame).padStart(5, '0')}.png`;
          const filePath = path.join(outDir, fname);
          fs.writeFileSync(filePath, buf);
        } catch (err) {
          console.error(`Worker ${workerId} failed rendering frame ${frame}:`, err);
        }
      }
      parentPort.postMessage({ type: 'chunk_done', count: frames.length });
      parentPort.postMessage({ type: 'get_chunk' });
    } else if (msg.type === 'done') {
      process.exit(0);
    }
  });

  // Request first chunk
  parentPort.postMessage({ type: 'get_chunk' });
}
