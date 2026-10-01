/**
 * tar-extract.js — 真正流式的 ustar(.gz) 解压器（固定内存，O(n)）
 *
 * 为什么独立成模块：
 *   旧版 main.js 的 extractTarGz 号称「流式」，却要求把**整个 tar 条目**连续缓冲进一块
 *   Buffer 后才落盘（`if (buf.length < paddedEnd) break`），每收到一个 gunzip chunk 都
 *   Buffer.concat 全量复制 → 对超大条目（如 170MB 的 libreoffice-kit.exe）退化为 O(n²)
 *   内存拷贝，真机单核 100% 且永不结束。本模块用「header / data / padding」状态机，
 *   header 最多缓冲 512 字节，文件数据随到随写，全程不随条目大小增长内存。
 *
 * 可测性：
 *   createUstarParser() 是纯解析器（字节流进、回调出），不依赖 fs / 设备；
 *   extractTarGz() 注入 fs/zlib/path，宿主机即可用临时目录做端到端测试（对齐 market-runtime.js
 *   的依赖注入风格）。
 */
'use strict';

const HEADER_SIZE = 512;

/** 读取 ustar 头，规整为 { name, type, size }；仅识别文件 / 目录，其余按载荷跳过。 */
function readHeader(header) {
  const cstr = (start, end) =>
    header.subarray(start, end).toString('utf8').replace(/\0[\s\S]*$/, '');
  const rawName = cstr(0, 100);
  const prefix = cstr(345, 500);
  const sizeStr = cstr(124, 136).trim();
  const size = parseInt(sizeStr, 8) || 0;
  const typeflag = String.fromCharCode(header[156]);

  let fullName = prefix ? prefix + '/' + rawName : rawName;
  // tar 由 `-C <proj> dsh-dist` 打包，条目带 dsh-dist/ 前缀；目标目录已含该层，剥掉避免双重前缀。
  fullName = fullName.replace(/^\.\//, '').replace(/^dsh-dist\//, '');

  let type;
  if (typeflag === '5') {
    type = 'dir';
  } else if (typeflag === '0' || typeflag === '\u0000' || typeflag === '') {
    type = 'file';
  } else {
    type = 'skip'; // 硬链接 / 符号链接 / pax 扩展头等：本构建不含，出现则仅跳过其载荷
  }
  return { name: fullName, type, size };
}

/**
 * 纯流式 ustar 解析器。
 * @param {object} handlers
 *   onDirectory(name)：目录条目（末尾斜杠已由 name 携带与否由调用方判断）
 *   onFile(name)：文件条目，必须返回 { write(buf), end() } 数据池
 *   onSkip(name, size)：未知条目（可选），其载荷被丢弃
 * @returns {{ push(chunk:Buffer):void, finish():void, count:number }}
 */
function createUstarParser(handlers = {}) {
  const parser = { count: 0 };
  let state = 'header'; // 'header' | 'data' | 'padding'
  let carry = Buffer.alloc(0);
  let current = null; // { sink, remaining, padding }
  let finished = false;

  parser.push = function push(chunk) {
    if (finished || !chunk || chunk.length === 0) return;
    // carry 只会是「不足 512 的 header 残片」或 padding 残片（均 < 512 字节），拼接有界。
    const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
    let pos = 0;

    while (pos < buf.length) {
      if (state === 'header') {
        if (buf.length - pos < HEADER_SIZE) break;
        const header = buf.subarray(pos, pos + HEADER_SIZE);
        pos += HEADER_SIZE;
        if (header[0] === 0) {
          // ustar 结束块（通常两块全 0）；忽略其后所有字节。
          finished = true;
          return;
        }
        const meta = readHeader(header);
        if (!meta.name) {
          state = 'header';
          continue;
        }
        if (meta.type === 'dir') {
          if (handlers.onDirectory) handlers.onDirectory(meta.name);
          state = 'header';
          continue;
        }
        let sink;
        if (meta.type === 'file') {
          sink = handlers.onFile ? handlers.onFile(meta.name) : createNullSink();
          parser.count += 1; // onFile 已为该条目建立数据池；空文件同样计 1
        } else {
          if (handlers.onSkip) handlers.onSkip(meta.name, meta.size);
          sink = createNullSink();
        }
        current = {
          sink,
          remaining: meta.size,
          padding: (HEADER_SIZE - (meta.size % HEADER_SIZE)) % HEADER_SIZE,
        };
        state = 'data';
        continue;
      }

      if (state === 'data') {
        if (current.remaining > 0) {
          const n = Math.min(current.remaining, buf.length - pos);
          if (n > 0) {
            current.sink.write(buf.subarray(pos, pos + n));
            pos += n;
            current.remaining -= n;
          }
        }
        if (current.remaining === 0) {
          current.sink.end();
          state = 'padding';
          continue;
        }
        break; // 条目数据未到齐，等待下一个 chunk
      }

      // state === 'padding'
      const n = Math.min(current.padding, buf.length - pos);
      pos += n;
      current.padding -= n;
      if (current.padding === 0) {
        current = null;
        state = 'header';
      } else {
        break;
      }
    }

    carry = pos < buf.length ? Buffer.from(buf.subarray(pos)) : Buffer.alloc(0);
  };

  parser.finish = function finish() {
    if (finished) return;
    if (state !== 'header' || carry.length > 0) {
      throw new Error('tar 数据不完整：流结束时仍有条目未写完');
    }
  };

  return parser;
}

function createNullSink() {
  return { write() {}, end() {} };
}

/**
 * 流式解压 ustar tar.gz 到目标目录。
 * @param {string} archivePath  .tar.gz 路径
 * @param {string} destBase     解压根目录（条目里的 dsh-dist/ 前缀已剥离）
 * @param {object} deps         可选依赖注入（fs / zlib / path），默认用 node 内置实现
 * @returns {Promise<number>}   写出的文件数
 */
function extractTarGz(archivePath, destBase, deps = {}) {
  const fs = deps.fs || require('node:fs');
  const zlib = deps.zlib || require('node:zlib');
  const nodePath = deps.path || require('node:path');

  return new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const input = fs.createReadStream(archivePath);

    const parser = createUstarParser({
      onDirectory(name) {
        fs.mkdirSync(nodePath.join(destBase, name), { recursive: true });
      },
      onFile(name) {
        const destPath = nodePath.join(destBase, name);
        fs.mkdirSync(nodePath.dirname(destPath), { recursive: true });
        const fd = fs.openSync(destPath, 'w');
        return {
          write(buf) {
            fs.writeSync(fd, buf);
          },
          end() {
            fs.closeSync(fd);
          },
        };
      },
    });

    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    gunzip.on('data', (chunk) => {
      try {
        parser.push(chunk);
      } catch (err) {
        fail(err);
      }
    });
    gunzip.on('end', () => {
      if (settled) return;
      try {
        parser.finish();
        resolve(parser.count);
      } catch (err) {
        reject(err);
      }
    });
    gunzip.on('error', fail);
    input.on('error', fail);
    input.pipe(gunzip);
  });
}

module.exports = { createUstarParser, readHeader, extractTarGz };
