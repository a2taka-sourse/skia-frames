import fs from 'node:fs';

/**
 * Check that `path` looks like a complete PNG file: at least 100 bytes and an
 * IEND chunk in the trailing 12 bytes.
 */
export function okPng(path) {
  try {
    const size = fs.statSync(path).size;
    if (size < 100) return false;
    const fd = fs.openSync(path, 'r');
    try {
      const tail = Buffer.alloc(12);
      fs.readSync(fd, tail, 0, 12, size - 12);
      return tail.includes('IEND');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

export default okPng;
