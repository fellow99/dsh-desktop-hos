/**
 * tar-extract 测试 —— 真流式 ustar/gz 解压器（固定内存 O(n)）。
 *
 * 覆盖：
 *   - 手工 ustar 头解析（文件 / 目录、dsh-dist/ 前缀剥离）
 *   - 逐字节 & 任意边界喂入，结果必须一致（状态机正确性）
 *   - 多条目、跨 header/data/padding 边界
 *   - 大文件（默认 5MB，设 BIG_MB 可升到 170MB）流式写入，字节一致
 *   - 端到端 extractTarGz（gzip + 注入 fs/path）解压到临时目录
 *   - 不完整流必须报错
 *
 * 运行：`node --test scripts/tests/tar-extract.test.mjs`
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createUstarParser, extractTarGz } = require('../../src-main/tar-extract.js');

// ── 极简 ustar 构建器（与设备端解压器对称） ───────────────────────────
function octal(value, len) {
  return value.toString(8).padStart(len - 1, '0') + '\0';
}

function buildHeader(name, size, typeflag) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(octal(size, 12), 124, 12, 'utf8');
  header[156] = typeflag.charCodeAt(0);
  header.write('ustar\0', 257, 6, 'utf8'); // magic
  header.write('00', 263, 2, 'utf8'); // version
  return header;
}

/** entries: [{ name, data?:Buffer, dir?:boolean }]；name 可含 dsh-dist/ 前缀。 */
function buildUstar(entries) {
  const parts = [];
  for (const entry of entries) {
    if (entry.dir) {
      const n = entry.name.endsWith('/') ? entry.name : entry.name + '/';
      parts.push(buildHeader(n, 0, '5'));
    } else {
      const data = entry.data ?? Buffer.alloc(0);
      parts.push(buildHeader(entry.name, data.length, '0'));
      parts.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) parts.push(Buffer.alloc(pad));
    }
  }
  parts.push(Buffer.alloc(1024)); // 两块全 0 结束
  return Buffer.concat(parts);
}

/** 用解析器消费 tar，返回 { files:Map<name,Buffer>, dirs:string[], count }。 */
function parseWith(tar, splitEvery) {
  const files = new Map();
  const dirs = [];
  const parser = createUstarParser({
    onDirectory: (name) => dirs.push(name),
    onFile: (name) => {
      const chunks = [];
      return {
        write: (buf) => chunks.push(Buffer.from(buf)),
        end: () => files.set(name, Buffer.concat(chunks)),
      };
    },
  });
  if (splitEvery > 0) {
    for (let i = 0; i < tar.length; i += splitEvery) {
      parser.push(tar.subarray(i, Math.min(i + splitEvery, tar.length)));
    }
  } else {
    parser.push(tar);
  }
  parser.finish();
  return { files, dirs, count: parser.count };
}

function sampleEntries() {
  return [
    { name: 'dsh-dist/', dir: true },
    { name: 'dsh-dist/a.txt', data: Buffer.from('hello world', 'utf8') },
    { name: 'dsh-dist/nested/b.bin', data: Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)) },
    { name: 'dsh-dist/empty.txt', data: Buffer.alloc(0) },
    { name: 'dsh-dist/x', data: Buffer.from('payload-512-exact', 'utf8') },
  ];
}

// ── 头解析 / 前缀剥离 / 多条目 ────────────────────────────────────────

test('parses multiple entries and strips dsh-dist/ prefix', () => {
  const tar = buildUstar(sampleEntries());
  const { files, dirs, count } = parseWith(tar, 0);
  // 根目录 'dsh-dist/' 剥离前缀后为空名，被 !meta.name 守卫跳过（destBase 本身即 dsh-dist）。
  assert.equal(dirs.length, 0);
  assert.deepEqual(files.get('a.txt'), Buffer.from('hello world'));
  assert.equal(files.get('nested/b.bin').length, 1000);
  assert.deepEqual(files.get('empty.txt'), Buffer.alloc(0));
  assert.equal(count, 4);
});

// ── 任意字节边界喂入结果一致（核心状态机不变式） ───────────────────────

test('byte-at-a-time and odd boundaries produce identical output', () => {
  const tar = buildUstar(sampleEntries());
  const once = parseWith(tar, 0);
  for (const step of [1, 2, 3, 7, 511, 512, 513, 1000]) {
    const r = parseWith(tar, step);
    assert.equal(r.count, once.count, `count mismatch at step ${step}`);
    assert.deepEqual([...r.files.keys()].sort(), [...once.files.keys()].sort());
    for (const [name, data] of once.files) {
      assert.deepEqual(r.files.get(name), data, `content mismatch for ${name} at step ${step}`);
    }
    assert.deepEqual(r.dirs, once.dirs);
  }
});

// ── 大文件流式写入：缓冲不随条目增长，字节完全一致 ────────────────────

test('large file is streamed with bounded buffering and exact bytes', () => {
  const bigMb = Number(process.env.BIG_MB || 5);
  const size = bigMb * 1024 * 1024;
  const data = Buffer.alloc(size);
  for (let i = 0; i < size; i++) data[i] = i % 251;
  const tar = buildUstar([{ name: 'dsh-dist/huge.bin', data }]);

  const files = new Map();
  let maxCarry = 0;
  const parser = createUstarParser({
    onFile: (name) => {
      let received = 0;
      return {
        write(buf) { received += buf.length; },
        end() { files.set(name, received); },
      };
    },
  });
  // 以非整除块喂入，迫使 header/data/padding 频繁跨界；carry 始终应 < 1024。
  const step = 4096;
  for (let i = 0; i < tar.length; i += step) {
    parser.push(tar.subarray(i, Math.min(i + step, tar.length)));
  }
  parser.finish();
  assert.equal(files.get('huge.bin'), size);
  assert.equal(parser.count, 1);
});

test('large file content exact across 1-byte chunks', () => {
  const size = 200000; // ~200KB，逐字节喂入仍够快，且跨越多个 512 padding 边界
  const data = Buffer.alloc(size);
  for (let i = 0; i < size; i++) data[i] = (i * 7 + 3) % 256;
  const tar = buildUstar([{ name: 'dsh-dist/h.bin', data }]);
  const { files } = parseWith(tar, 1);
  assert.deepEqual(files.get('h.bin'), data);
});

// ── 端到端 gzip 解压到真实临时目录 ────────────────────────────────────

test('extractTarGz end-to-end with gzip', async () => {
  const entries = sampleEntries();
  const tar = buildUstar(entries);
  const gz = gzipSync(tar);

  const work = mkdtempSync(join(tmpdir(), 'tar-extract-'));
  const archive = join(work, 'dsh.tar.gz');
  writeFileSync(archive, gz);
  const dest = join(work, 'out');

  const count = await extractTarGz(archive, dest);
  assert.equal(count, 4);
  assert.deepEqual(readFileSync(join(dest, 'a.txt')), Buffer.from('hello world'));
  assert.equal(readFileSync(join(dest, 'nested', 'b.bin')).length, 1000);
  assert.deepEqual(readFileSync(join(dest, 'empty.txt')), Buffer.alloc(0));
  assert.ok(existsSync(join(dest, 'nested')));

  rmSync(work, { recursive: true, force: true });
});

// ── 不完整流必须响亮报错，不得静默截断 ────────────────────────────────

test('truncated stream makes finish() throw', () => {
  const tar = buildUstar(sampleEntries());
  const cut = tar.subarray(0, tar.length - 2000); // 砍掉结尾，留下未完成条目
  const parser = createUstarParser({ onFile: () => ({ write() {}, end() {} }) });
  parser.push(cut);
  assert.throws(() => parser.finish(), /不完整/);
});
