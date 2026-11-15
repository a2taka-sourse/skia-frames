import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} from 'node:worker_threads';
import { createRequire } from 'node:module';
import { okPng } from './png.mjs';

const CHUNK_SIZE = 16;

export function frameFileName(prefix, frame) {
  return `${prefix}${String(frame).padStart(5, '0')}.png`;
}

/**
 * Render a scene module to a transparent PNG sequence using a pool of worker
 * threads. Resolves with `{ ok, bad, rendered, total, elapsed }`.
 */
export async function renderFrames(options) {
  const {
    sceneUrl,
    config,
    props = {},
    outDir,
    prefix = 'frame-',
    workers: requestedWorkers = os.cpus().length,
    frames,
    resume = false,
    log = console,
  } = options;

  if (!sceneUrl) throw new Error('renderFrames() requires sceneUrl');
  if (!config) throw new Error('renderFrames() requires a scene config');
  if (!outDir) throw new Error('renderFrames() requires outDir');
  if (!Array.isArray(frames)) throw new Error('renderFrames() requires frames');

  fs.mkdirSync(outDir, { recursive: true });

  const fps = config.fps;
  const expected = [...new Set(frames)].sort((a, b) => a - b);

  let todo = expected;
  if (resume) {
    todo = expected.filter(
      (frame) => !okPng(path.join(outDir, frameFileName(prefix, frame)))
    );
  }

  const numWorkers = Math.max(
    1,
    Math.min(todo.length || 1, Math.floor(requestedWorkers) || 1)
  );

  log.log(
    `[skia-frames] frames=${expected.length}, todo=${todo.length}, workers=${numWorkers}, out=${outDir}`
  );

  const startTime = Date.now();
  let completedCount = 0;
  let todoIndex = 0;
  let activeWorkers = 0;
  const fatalErrors = [];
  const frameErrors = [];

  await new Promise((resolve) => {
    if (todo.length === 0) {
      resolve();
      return;
    }

    const finishWorker = () => {
      activeWorkers--;
      if (activeWorkers === 0) resolve();
    };

    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker(new URL(import.meta.url), {
        workerData: {
          workerId: i,
          sceneUrl,
          config,
          props,
          outDir,
          prefix,
        },
      });
      activeWorkers++;

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
          for (const err of msg.errors || []) {
            if (frameErrors.length < 10) frameErrors.push(err);
          }
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = elapsed > 0 ? (completedCount / elapsed).toFixed(1) : '0.0';
          const percent = ((completedCount / todo.length) * 100).toFixed(1);
          process.stdout.write(
            `\r[Skia Renderer] Progress: ${completedCount}/${todo.length} (${percent}%) | Speed: ${speed} fps | Elapsed: ${elapsed.toFixed(1)}s   `
          );
        } else if (msg.type === 'fatal') {
          fatalErrors.push(`Worker ${i}: ${msg.error}`);
        }
      });

      worker.on('error', (err) => {
        fatalErrors.push(`Worker ${i}: ${err?.stack || err}`);
      });

      worker.on('exit', (code) => {
        if (code !== 0 && fatalErrors.length === 0) {
          fatalErrors.push(`Worker ${i} exited with code ${code}`);
        }
        finishWorker();
      });
    }
  });

  if (todo.length > 0) {
    const elapsed = (Date.now() - startTime) / 1000;
    const speed = elapsed > 0 ? (completedCount / elapsed).toFixed(1) : '0.0';
    log.log(
      `\n[skia-frames] Rendered ${completedCount}/${todo.length} frames in ${elapsed.toFixed(2)}s (${speed} fps)`
    );
  }

  if (fatalErrors.length > 0) {
    throw new Error(
      `Rendering failed:\n${fatalErrors.slice(0, 10).join('\n')}`
    );
  }

  for (const err of frameErrors) {
    log.error(
      `[skia-frames] Frame ${err.frame} failed: ${err.error}`
    );
  }

  log.log('[skia-frames] Verifying integrity...');
  const bad = expected.filter(
    (frame) => !okPng(path.join(outDir, frameFileName(prefix, frame)))
  );

  if (bad.length > 0) {
    log.error(
      `[skia-frames] CHECK FAILED: ${bad.length} frame(s) are missing or invalid:`
    );
    for (const frame of bad.slice(0, 10)) {
      log.error(`  ${frameFileName(prefix, frame)}`);
    }
    return {
      ok: false,
      bad,
      rendered: completedCount,
      total: todo.length,
      elapsed: (Date.now() - startTime) / 1000,
      fps,
    };
  }

  log.log(
    `[skia-frames] CHECK PASSED: ${expected.length} frames verified.`
  );
  return {
    ok: true,
    bad,
    rendered: completedCount,
    total: todo.length,
    elapsed: (Date.now() - startTime) / 1000,
    fps,
  };
}

if (!isMainThread) {
  const fail = (err) => {
    parentPort.postMessage({
      type: 'fatal',
      error: String(err?.stack || err),
    });
    setTimeout(() => process.exit(1), 50);
  };

  try {
    const require = createRequire(import.meta.url);
    const { createCanvas } = require('@napi-rs/canvas');

    const { workerId, sceneUrl, config, props, outDir, prefix } = workerData;
    const scene = await import(sceneUrl);

    if (typeof scene.draw !== 'function') {
      throw new Error('Scene module must export a draw() function');
    }

    const canvas = createCanvas(config.width, config.height);
    const ctx = canvas.getContext('2d');

    const state =
      typeof scene.setup === 'function' ? await scene.setup(props) : undefined;

    parentPort.on('message', (msg) => {
      if (msg.type === 'render_chunk') {
        const errors = [];
        for (const frame of msg.frames) {
          try {
            ctx.clearRect(0, 0, config.width, config.height);
            scene.draw(ctx, frame, props, state);
            const buffer = canvas.toBuffer('image/png');
            fs.writeFileSync(
              path.join(outDir, frameFileName(prefix, frame)),
              buffer
            );
          } catch (err) {
            errors.push({
              frame,
              error: String(err?.stack || err),
            });
          }
        }
        parentPort.postMessage({
          type: 'chunk_done',
          count: msg.frames.length,
          errors,
        });
        parentPort.postMessage({ type: 'get_chunk' });
      } else if (msg.type === 'done') {
        process.exit(0);
      }
    });

    parentPort.postMessage({ type: 'get_chunk' });
  } catch (err) {
    fail(err);
  }
}
