// ZIP sin compresión (método «store») escrito en streaming: suficiente para entregar el proyecto completo.
import fs from 'node:fs';
import path from 'node:path';

const TABLE = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32File(file) {
  let crc = -1;
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) for (let i = 0; i < n; i++) crc = TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  } finally { fs.closeSync(fd); }
  return (crc ^ -1) >>> 0;
}

export function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(f, base));
    else if (!/\.(tmp|part\.mp4|filter\.txt)$/.test(e.name)) out.push(path.relative(base, f).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Escribe un ZIP de `dir` en el stream `ws`. */
export async function zipDir(dir, ws, prefix = '') {
  const entries = [];
  let offset = 0;
  const write = (b) => new Promise((res) => { offset += b.length; if (!ws.write(b)) ws.once('drain', res); else res(); });
  for (const rel of listFiles(dir)) {
    const file = path.join(dir, rel);
    const size = fs.statSync(file).size;
    if (size >= 0xFFFFFFFF) continue;
    const crc = crc32File(file);
    const name = Buffer.from(prefix + rel, 'utf8');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(size, 18); h.writeUInt32LE(size, 22);
    h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    const start = offset;
    await write(h); await write(name);
    for await (const chunk of fs.createReadStream(file)) await write(chunk);
    entries.push({ name, crc, size, start });
  }
  const cdStart = offset;
  for (const e of entries) {
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.size, 20); c.writeUInt32LE(e.size, 24);
    c.writeUInt16LE(e.name.length, 28); c.writeUInt32LE(e.start, 42);
    await write(c); await write(e.name);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16);
  await write(end);
  ws.end();
}
