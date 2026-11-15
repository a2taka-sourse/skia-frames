import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { okPng } from '../src/png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'cli.mjs');
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'skia-frames-test-'));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

function detail(result) {
  return `\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
}

try {
  const helloOut = path.join(tmpBase, 'hello');
  const hello = run([
    path.join('examples', 'hello', 'scene.mjs'),
    '--out',
    helloOut,
    '--workers',
    '2',
  ]);
  assert.equal(hello.status, 0, `hello render failed${detail(hello)}`);

  const helloFiles = fs
    .readdirSync(helloOut)
    .filter((file) => /^frame-\d{5}\.png$/.test(file))
    .sort();
  assert.equal(
    helloFiles.length,
    180,
    `expected 180 PNGs, found ${helloFiles.length}${detail(hello)}`
  );
  const badHello = helloFiles.filter(
    (file) => !okPng(path.join(helloOut, file))
  );
  assert.deepEqual(
    badHello,
    [],
    `invalid PNGs: ${badHello.slice(0, 10).join(', ')}`
  );
  console.log('hello: 180 valid PNGs');

  const lowerOut = path.join(tmpBase, 'lower-third');
  const lower = run([
    path.join('examples', 'lower-third', 'scene.mjs'),
    '--out',
    lowerOut,
    '--workers',
    '2',
    '--concat',
  ]);
  assert.equal(lower.status, 0, `lower-third render failed${detail(lower)}`);

  const concatPath = path.join(lowerOut, 'concat.txt');
  assert.ok(fs.existsSync(concatPath), 'concat.txt was not written');

  const lines = fs.readFileSync(concatPath, 'utf8').split(/\r?\n/);
  const fileLines = lines.filter((line) => line.startsWith('file '));
  const durations = lines
    .filter((line) => line.startsWith('duration '))
    .map((line) => Number(line.split(/\s+/)[1]));

  assert.ok(durations.length > 0, 'concat.txt has no duration entries');
  assert.ok(
    fileLines.length === durations.length + 1,
    'concat.txt must repeat the last file without a duration'
  );

  for (const line of fileLines) {
    const name = line.slice("file '".length, -1);
    assert.ok(
      fs.existsSync(path.join(lowerOut, name)),
      `concat.txt references missing file ${name}`
    );
  }

  const total = durations.reduce((sum, duration) => sum + duration, 0);
  assert.ok(
    Math.abs(total - 6) <= 0.01,
    `concat durations sum to ${total}s, expected 6.0s`
  );
  console.log(
    `lower-third: concat.txt ok, ${fileLines.length - 1} segments, ${total.toFixed(3)}s total`
  );

  console.log('smoke: ok');
} finally {
  fs.rmSync(tmpBase, { recursive: true, force: true });
}
