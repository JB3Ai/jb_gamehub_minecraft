import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createInflateRaw, inflateRawSync } from "node:zlib";
import path from "node:path";
import { CONTENT_SCAN_LIMITS } from "./types";

/**
 * Minimal, read-only ZIP central-directory reader.
 *
 * This intentionally does NOT extract archives to disk. It only lists entry
 * names and, for small entries under `CONTENT_SCAN_LIMITS.maxInspectedEntryBytes`,
 * reads their bytes into memory so the classifier can look for marker files
 * (e.g. `pack.mcmeta`, `manifest.json`, `plugin.yml`, `level.dat`) without ever
 * writing content into a live server directory. Malformed archives raise
 * `ZipReadError` so callers can classify them as UNKNOWN/WARNING rather than
 * crashing the scan.
 */
export class ZipReadError extends Error {}

export interface ZipEntry {
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
  localHeaderOffset: number;
  externalFileAttributes: number;
  /** True when the entry path escapes its archive root (zip-slip candidate). */
  unsafePath: boolean;
}

export interface ZipListing {
  entries: ZipEntry[];
  /** True when the central directory was too large to parse safely and was truncated. */
  truncated: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65557; // 22-byte EOCD + max 65535-byte comment
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;

function isUnsafeEntryPath(name: string): boolean {
  const normalized = name.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return true;
  return normalized.split("/").some((segment) => segment === "..");
}

async function readTail(filePath: string, size: number): Promise<{ buffer: Buffer; start: number }> {
  const fileStat = await stat(filePath);
  const readSize = Math.min(size, fileStat.size);
  const start = fileStat.size - readSize;
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, start);
    return { buffer, start };
  } finally {
    await handle.close();
  }
}

async function readAt(filePath: string, position: number, length: number): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Lists ZIP entries by reading only the end-of-central-directory tail plus the central directory. */
export async function listZipEntries(filePath: string): Promise<ZipListing> {
  const { buffer: tail, start: tailStart } = await readTail(filePath, MAX_EOCD_SEARCH);

  let eocdIndex = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdIndex = i;
      break;
    }
  }
  if (eocdIndex === -1) {
    throw new ZipReadError(`No end-of-central-directory record found in ${filePath}`);
  }

  const totalEntries = tail.readUInt16LE(eocdIndex + 10);
  const centralDirSize = tail.readUInt32LE(eocdIndex + 12);
  const centralDirOffset = tail.readUInt32LE(eocdIndex + 16);

  if (centralDirSize > MAX_CENTRAL_DIRECTORY_BYTES) {
    return { entries: [], truncated: true };
  }

  let centralDir: Buffer;
  const tailCoversCentralDir = centralDirOffset >= tailStart;
  if (tailCoversCentralDir) {
    centralDir = tail.subarray(centralDirOffset - tailStart, centralDirOffset - tailStart + centralDirSize);
  } else {
    centralDir = await readAt(filePath, centralDirOffset, centralDirSize);
  }

  const entries: ZipEntry[] = [];
  let offset = 0;
  let parsed = 0;
  while (offset + 46 <= centralDir.length && parsed < totalEntries) {
    if (centralDir.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) {
      throw new ZipReadError(`Central directory entry signature mismatch in ${filePath}`);
    }
    const compressionMethod = centralDir.readUInt16LE(offset + 10);
    const compressedSize = centralDir.readUInt32LE(offset + 20);
    const uncompressedSize = centralDir.readUInt32LE(offset + 24);
    const nameLength = centralDir.readUInt16LE(offset + 28);
    const extraLength = centralDir.readUInt16LE(offset + 30);
    const commentLength = centralDir.readUInt16LE(offset + 32);
    const externalFileAttributes = centralDir.readUInt32LE(offset + 38);
    const localHeaderOffset = centralDir.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > centralDir.length) {
      throw new ZipReadError(`Truncated central directory entry in ${filePath}`);
    }
    const name = centralDir.toString("utf8", nameStart, nameEnd);
    entries.push({
      name,
      isDirectory: name.endsWith("/"),
      compressedSize,
      uncompressedSize,
      compressionMethod,
      localHeaderOffset,
      externalFileAttributes,
      unsafePath: isUnsafeEntryPath(name),
    });
    offset = nameEnd + extraLength + commentLength;
    parsed += 1;
  }

  return { entries, truncated: false };
}

/**
 * Reads a single small entry's decompressed bytes into memory. Refuses to
 * read entries larger than `CONTENT_SCAN_LIMITS.maxInspectedEntryBytes` so
 * classification never requires unbounded memory.
 */
export async function readZipEntryBytes(filePath: string, entry: ZipEntry): Promise<Buffer | undefined> {
  if (entry.isDirectory) return undefined;
  if (
    entry.uncompressedSize > CONTENT_SCAN_LIMITS.maxInspectedEntryBytes ||
    entry.compressedSize > CONTENT_SCAN_LIMITS.maxInspectedEntryBytes
  ) {
    return undefined;
  }

  const localHeader = await readAt(filePath, entry.localHeaderOffset, 30);
  if (localHeader.length < 30 || localHeader.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
    throw new ZipReadError(`Local file header signature mismatch for ${entry.name}`);
  }
  const nameLength = localHeader.readUInt16LE(26);
  const extraLength = localHeader.readUInt16LE(28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = await readAt(filePath, dataStart, entry.compressedSize);

  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) {
    try {
      return inflateRawSync(compressed);
    } catch (error) {
      throw new ZipReadError(`Failed to inflate ${entry.name}: ${(error as Error).message}`);
    }
  }
  return undefined; // Unsupported compression method; classifier treats absence as "not found".
}

function destinationForEntry(destinationRoot: string, entryName: string): string {
  const normalizedName = entryName.replace(/\\/g, "/");
  if (isUnsafeEntryPath(normalizedName)) {
    throw new ZipReadError(`Unsafe archive path rejected: ${entryName}`);
  }
  const destination = path.resolve(destinationRoot, ...normalizedName.split("/"));
  const boundary = `${path.resolve(destinationRoot)}${path.sep}`;
  if (destination !== path.resolve(destinationRoot) && !destination.startsWith(boundary)) {
    throw new ZipReadError(`Archive path escapes destination boundary: ${entryName}`);
  }
  return destination;
}

/**
 * Extracts a pre-validated ZIP entry using streaming I/O. The caller must
 * enforce archive-wide entry/size limits before invoking this helper.
 * Symlinks are rejected and every remaining entry is materialized as a
 * regular file beneath destinationRoot.
 */
class ByteLimitTransform extends Transform {
  private bytes = 0;

  constructor(private readonly maximumBytes: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.bytes += chunk.length;
    if (this.bytes > this.maximumBytes) {
      callback(new ZipReadError(`Archive entry exceeds actual extraction limit of ${this.maximumBytes} bytes.`));
      return;
    }
    callback(null, chunk);
  }

  get byteCount(): number {
    return this.bytes;
  }
}

export async function extractZipEntryToDirectory(
  filePath: string,
  entry: ZipEntry,
  destinationRoot: string,
  maximumOutputBytes = CONTENT_SCAN_LIMITS.maxArchiveEntryBytes,
): Promise<number> {
  if (entry.isDirectory) {
    await mkdir(destinationForEntry(destinationRoot, entry.name), { recursive: true });
    return 0;
  }
  if (entry.unsafePath) {
    throw new ZipReadError(`Unsafe archive path rejected: ${entry.name}`);
  }
  if ((entry.externalFileAttributes >>> 16 & 0o170000) === 0o120000) {
    throw new ZipReadError(`Symbolic-link archive entry rejected: ${entry.name}`);
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new ZipReadError(`Unsupported compression method ${entry.compressionMethod} for ${entry.name}`);
  }

  const localHeader = await readAt(filePath, entry.localHeaderOffset, 30);
  if (localHeader.length < 30 || localHeader.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
    throw new ZipReadError(`Local file header signature mismatch for ${entry.name}`);
  }
  const nameLength = localHeader.readUInt16LE(26);
  const extraLength = localHeader.readUInt16LE(28);
  const dataStart = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const destination = destinationForEntry(destinationRoot, entry.name);
  await mkdir(path.dirname(destination), { recursive: true });
  if (entry.compressedSize === 0) {
    await writeFile(destination, Buffer.alloc(0), { flag: "wx" });
    return 0;
  }

  const source = createReadStream(filePath, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
  const outputLimiter = new ByteLimitTransform(maximumOutputBytes);
  if (entry.compressionMethod === 0) {
    await pipeline(source, outputLimiter, createWriteStream(destination, { flags: "wx" }));
    return outputLimiter.byteCount;
  }
  await pipeline(source, createInflateRaw(), outputLimiter, createWriteStream(destination, { flags: "wx" }));
  return outputLimiter.byteCount;
}

export async function zipContainsAny(filePath: string, markerNames: string[]): Promise<{ found: string[]; entries: ZipEntry[]; truncated: boolean }> {
  const { entries, truncated } = await listZipEntries(filePath);
  const found = markerNames.filter((marker) =>
    entries.some((entry) => !entry.isDirectory && entry.name.replace(/\\/g, "/").split("/").pop() === marker),
  );
  return { found, entries, truncated };
}
