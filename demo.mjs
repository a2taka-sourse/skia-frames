import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const workers = Number(process.argv[2] ?? 4);
if (!Number.isSafeInteger(workers) || workers < 1 || workers > 32) {
  throw new Error('Pass a worker count from 1 to 32.');
}

const project = fileURLToPath(new URL('.', import.meta.url));
const fixture = {
  title: 'Sample chapter',
  duration: 6,
  durationInFrames: 180,
  lines: [{ s: 0, e: 2 }],
  events: [],
  quotes: [],
};
const serialized = JSON.stringify(fixture, null, 2) + '\n';
const propsDir = new URL('./props/', import.meta.url);
const propsPath = new URL('ch-demo.json', propsDir);
await mkdir(propsDir, { recursive: true });
try {
  await writeFile(propsPath, serialized, { flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  if (await readFile(propsPath, 'utf8') !== serialized) {
    throw new Error('The demo path already holds a different props file.');
  }
}

const render = spawnSync(process.execPath, ['render_skia.mjs', 'ch-demo', String(workers)], {
  cwd: project,
  env: { ...process.env, STEP: '1', OVERWRITE: '1', OUT: 'frames/demo-' + workers },
  stdio: 'inherit',
});
if (render.error) throw render.error;
process.exitCode = render.status ?? 1;
