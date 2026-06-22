/*
 * app/utils/buildZip.ts
 *
 * Pure TypeScript ZIP file builder — no Node.js `fs`, no native deps.
 * Works identically in the browser and on the server (Cloudflare Workers / Node).
 * Used to package WebContainer build output into a real .zip file for upload
 * to Dokploy via application.dropDeployment (multipart/form-data).
 */

export async function buildZip(files: Record<string, string>): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const crc32Table = makeCrc32Table();

  const entries: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  for (const [rawPath, content] of Object.entries(files)) {
    const filePath = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
    const fileData = encoder.encode(content);
    const crc = crc32(crc32Table, fileData);
    const pathData = encoder.encode(filePath);

    // Local file header
    const localHeader = new DataView(new ArrayBuffer(30 + pathData.length));
    localHeader.setUint32(0, 0x04034b50, true); // signature
    localHeader.setUint16(4, 20, true); // version needed
    localHeader.setUint16(6, 0, true); // flags
    localHeader.setUint16(8, 0, true); // compression (stored)
    localHeader.setUint16(10, 0, true); // mod time
    localHeader.setUint16(12, 0, true); // mod date
    localHeader.setUint32(14, crc, true); // crc32
    localHeader.setUint32(18, fileData.length, true); // compressed size
    localHeader.setUint32(22, fileData.length, true); // uncompressed size
    localHeader.setUint16(26, pathData.length, true); // filename length
    localHeader.setUint16(28, 0, true); // extra field length
    new Uint8Array(localHeader.buffer).set(pathData, 30);

    const localHeaderBytes = new Uint8Array(localHeader.buffer);
    entries.push(localHeaderBytes, fileData);

    // Central directory entry
    const centralEntry = new DataView(new ArrayBuffer(46 + pathData.length));
    centralEntry.setUint32(0, 0x02014b50, true); // signature
    centralEntry.setUint16(4, 20, true); // version made by
    centralEntry.setUint16(6, 20, true); // version needed
    centralEntry.setUint16(8, 0, true); // flags
    centralEntry.setUint16(10, 0, true); // compression
    centralEntry.setUint16(12, 0, true); // mod time
    centralEntry.setUint16(14, 0, true); // mod date
    centralEntry.setUint32(16, crc, true); // crc32
    centralEntry.setUint32(20, fileData.length, true); // compressed size
    centralEntry.setUint32(24, fileData.length, true); // uncompressed size
    centralEntry.setUint16(28, pathData.length, true); // filename length
    centralEntry.setUint16(30, 0, true); // extra field length
    centralEntry.setUint16(32, 0, true); // comment length
    centralEntry.setUint16(34, 0, true); // disk start
    centralEntry.setUint16(36, 0, true); // internal attrs
    centralEntry.setUint32(38, 0, true); // external attrs
    centralEntry.setUint32(42, offset, true); // relative offset
    new Uint8Array(centralEntry.buffer).set(pathData, 46);

    centralDirectory.push(new Uint8Array(centralEntry.buffer));
    offset += localHeaderBytes.length + fileData.length;
  }

  const centralDirSize = centralDirectory.reduce((s, e) => s + e.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // signature
  eocd.setUint16(4, 0, true); // disk number
  eocd.setUint16(6, 0, true); // disk with central dir
  eocd.setUint16(8, centralDirectory.length, true); // entries on disk
  eocd.setUint16(10, centralDirectory.length, true); // total entries
  eocd.setUint32(12, centralDirSize, true); // central dir size
  eocd.setUint32(16, offset, true); // central dir offset
  eocd.setUint16(20, 0, true); // comment length

  const all = [...entries, ...centralDirectory, new Uint8Array(eocd.buffer)];
  const totalSize = all.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(totalSize);
  let pos = 0;

  for (const chunk of all) {
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
}

function makeCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    let c = i;

    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[i] = c;
  }

  return table;
}

function crc32(table: Uint32Array, data: Uint8Array): number {
  let crc = 0xffffffff;

  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}
