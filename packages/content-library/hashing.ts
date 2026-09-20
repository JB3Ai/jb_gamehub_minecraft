import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { CONTENT_SCAN_LIMITS } from "./types";

/**
 * Streams a file through SHA-256 without loading the whole file into memory.
 * Safe to call on multi-gigabyte sources; memory usage stays bounded by the
 * stream's internal buffer (`highWaterMark`), not by file size.
 */
export function hashFileStreamed(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath, { highWaterMark: CONTENT_SCAN_LIMITS.hashChunkBytes });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
