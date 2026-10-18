import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProvisioningApplyException } from "./provisioning-apply-contracts";
import { bytesHash, type FileIdentity, type FileEffectIntent, type FileEffectReceipt, type ManagedCreatePreview } from "./managed-create";

export function managedFailure(code: string): never { throw new ProvisioningApplyException({ code, message: "Managed creation failed: " + code }); }
export function identity(stat: fs.Stats | fs.BigIntStats): FileIdentity {
  if (typeof stat.ino === "number" && !Number.isSafeInteger(stat.ino) || typeof stat.dev === "number" && !Number.isSafeInteger(stat.dev) || stat.ino === 0 || stat.ino === 0n) managedFailure("UNSUPPORTED_FILESYSTEM_IDENTITY");
  return { device: String(stat.dev), inode: String(stat.ino) };
}
const pathIdentity = (location: string) => identity(fs.lstatSync(location, { bigint: true }));
const handleIdentity = (fd: number) => identity(fs.fstatSync(fd, { bigint: true }));
export const sameIdentity = (a: FileIdentity, b: FileIdentity) => a.device === b.device && a.inode === b.inode;
export const safeLeaf = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_. -]{0,127}$/.test(value) && !value.includes("..") && !/[. ]$/.test(value) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
/** Vendor bundle members may start with '_'; client-selected directory/world names retain safeLeaf. */
export const safeBundleSegment = (value: string) => safeLeaf(value) || /^_[A-Za-z0-9_. -]{0,127}$/.test(value) && !value.includes("..") && !/[. ]$/.test(value);
export const pathOverlaps = (a: string, b: string) => {
  const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  const inside = (root: string, target: string) => { const r = path.relative(normalize(root), normalize(target)); return !r || (r !== ".." && !r.startsWith(".." + path.sep) && !path.isAbsolute(r)); };
  return inside(a, b) || inside(b, a);
};
export function canonicalManagedPath(value: string): string {
  if (!path.isAbsolute(value) || value.startsWith("\\\\") || value.startsWith("//") || value.split(/[\\/]/).includes("..")) managedFailure("UNSAFE_PATH");
  const absolute = path.resolve(value); let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    if (part.includes(":")) managedFailure("UNSAFE_PATH");
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) managedFailure("UNSAFE_PATH");
  }
  return fs.realpathSync.native(absolute);
}
export function existingStat(location: string): fs.Stats | undefined {
  try { return fs.lstatSync(location); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
export function hashFile(location: string, maxBytes = 256 * 1024 * 1024): { sha256: string; size: number; identity: FileIdentity } {
  const canonical = canonicalManagedPath(location); const before = fs.lstatSync(canonical);
  const beforeIdentity = pathIdentity(canonical);
  if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes) managedFailure("ARTIFACT_UNAVAILABLE");
  const fd = fs.openSync(canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!sameIdentity(beforeIdentity, handleIdentity(fd))) managedFailure("ARTIFACT_DRIFT");
    const hash = createHash("sha256"), chunk = Buffer.alloc(64 * 1024); let total = 0, read: number;
    while ((read = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) { total += read; if (total > maxBytes) managedFailure("ARTIFACT_UNAVAILABLE"); hash.update(chunk.subarray(0, read)); }
    const after = fs.fstatSync(fd), current = fs.lstatSync(canonical);
    if (!sameIdentity(beforeIdentity, pathIdentity(canonical)) || current.isSymbolicLink() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || total !== before.size) managedFailure("ARTIFACT_DRIFT");
    return { sha256: hash.digest("hex"), size: total, identity: beforeIdentity };
  } finally { fs.closeSync(fd); }
}

/** These synchronous primitives may ONLY be invoked inside repository.managedGuard.
 * The SQLite writer lock spans the fence check, syscall(s), and observed receipt.
 * No async syscall or callback is permitted to outlive that lock. */
export class ManagedFilesystem {
  constructor(private readonly preview: ManagedCreatePreview, private readonly duringCopy?: () => void,
    private readonly ownedDirectories?: () => Array<{ relativePath: string; receipt: FileEffectReceipt }>) {}
  private target(relative: string) {
    const safePart = this.preview.bundle ? safeBundleSegment : safeLeaf;
    if (relative && (relative.includes("\\") || relative.length > 768 || !relative.split("/").every((part, index, parts) => safePart(part) || parts.length === 1 && index === 0 && /^(?:\.jbgh-owner\.json|\.jbgh-file-\d+)$/.test(part)))) managedFailure("UNSAFE_PATH");
    const parent = canonicalManagedPath(this.preview.rootPath);
    if (!sameIdentity(pathIdentity(parent), this.preview.rootIdentity)) managedFailure("ROOT_DRIFT");
    return relative ? path.join(this.preview.runtimePath, relative) : this.preview.runtimePath;
  }
  private ancestors(relative: string): void {
    if (!this.ownedDirectories) { if (relative.includes("/")) managedFailure("OWNERSHIP_UNVERIFIED"); return; }
    const owned = this.ownedDirectories();
    const parts = relative.split("/").slice(0, -1);
    for (const parent of ["", ...parts.map((_, index) => parts.slice(0, index + 1).join("/"))]) {
      const receipt = owned.find((directory) => directory.relativePath === parent)?.receipt;
      const location = this.target(parent), stat = existingStat(location);
      if (!receipt || !stat?.isDirectory() || stat.isSymbolicLink() || !sameIdentity(pathIdentity(location), receipt.identity) || canonicalManagedPath(location) !== location) managedFailure("OWNERSHIP_UNVERIFIED");
    }
  }
  private parent(directory: FileEffectReceipt | undefined) {
    const location = this.target(""); const stat = existingStat(location);
    if (!directory || !stat?.isDirectory() || stat.isSymbolicLink() || !sameIdentity(pathIdentity(location), directory.identity) || canonicalManagedPath(location) !== location) managedFailure("OWNERSHIP_UNVERIFIED");
  }
  inspect(intent: FileEffectIntent, receipt: FileEffectReceipt, validateContents?: (bytes: Uint8Array) => void, requireSingleLink = false): void {
    if (intent.relativePath) this.ancestors(intent.relativePath);
    const location = this.target(intent.relativePath); const stat = existingStat(location);
    if (!stat || stat.isSymbolicLink() || !sameIdentity(pathIdentity(location), receipt.identity)) managedFailure("ARTIFACT_DRIFT");
    if (intent.kind === "directory") { if (!stat.isDirectory()) managedFailure("ARTIFACT_DRIFT"); return; }
    if (!stat.isFile() || stat.nlink > 2 || requireSingleLink && stat.nlink !== 1) managedFailure("ARTIFACT_DRIFT");
    if (validateContents) {
      // Mutable provider configuration retains its owned identity and must be a single-link regular file.
      const maxBytes = 64 * 1024;
      if (stat.nlink !== 1 || stat.size > maxBytes) managedFailure("ARTIFACT_DRIFT");
      const fd = fs.openSync(location, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const before = fs.fstatSync(fd);
        if (!before.isFile() || before.nlink !== 1 || !sameIdentity(handleIdentity(fd), receipt.identity)) managedFailure("ARTIFACT_DRIFT");
        const bytes = Buffer.alloc(maxBytes + 1); let total = 0, count: number;
        while ((count = fs.readSync(fd, bytes, total, bytes.length - total, null)) > 0) {
          total += count; if (total > maxBytes) managedFailure("ARTIFACT_DRIFT");
        }
        const after = fs.fstatSync(fd), current = fs.lstatSync(location);
        if (current.isSymbolicLink() || current.nlink !== 1 || !sameIdentity(pathIdentity(location), receipt.identity) || before.size !== after.size || total !== before.size || before.mtimeMs !== after.mtimeMs) managedFailure("ARTIFACT_DRIFT");
        validateContents(bytes.subarray(0, total));
      } finally { fs.closeSync(fd); }
      return;
    }
    // A fully written temp can be linked to its final path before the publication receipt.
    if (intent.kind !== "temporary" && receipt.sha256 && this.hashOwned(location) !== receipt.sha256) managedFailure("ARTIFACT_DRIFT");
  }
  private hashOwned(location: string) {
    const before = fs.lstatSync(location), expectedIdentity = pathIdentity(location);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink > 2 || before.size > 256 * 1024 * 1024) managedFailure("ARTIFACT_DRIFT");
    const fd = fs.openSync(location, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!sameIdentity(handleIdentity(fd), expectedIdentity)) managedFailure("ARTIFACT_DRIFT");
      const hash = createHash("sha256"), chunk = Buffer.alloc(64 * 1024); let total = 0, count: number;
      while ((count = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) { total += count; if (total > 256 * 1024 * 1024) managedFailure("ARTIFACT_DRIFT"); hash.update(chunk.subarray(0, count)); }
      const after = fs.fstatSync(fd);
      if (total !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || !sameIdentity(pathIdentity(location), expectedIdentity)) managedFailure("ARTIFACT_DRIFT");
      return hash.digest("hex");
    } finally { fs.closeSync(fd); }
  }
  effect(intent: FileEffectIntent, receipts: FileEffectReceipt[], intents: FileEffectIntent[]): FileEffectReceipt {
    const location = this.target(intent.relativePath);
    const directory = receipts.find((r) => r.intentId === "directory" && !r.compensated);
    const prior = receipts.find((r) => r.intentId === intent.id && !r.compensated);
    if (prior) { if (intent.kind === "remove-temp") { if (existingStat(location)) managedFailure("PATH_COLLISION"); } else this.inspect(intent, prior); return prior; }
    if (intent.kind === "directory") {
      if (intent.relativePath) this.ancestors(intent.relativePath);
      if (existingStat(location)) managedFailure("OWNERSHIP_UNVERIFIED");
      fs.mkdirSync(location, { mode: 0o700 });
      return { intentId: intent.id, identity: pathIdentity(location) };
    }
    this.parent(directory);
    this.ancestors(intent.relativePath);
    if (intent.kind === "temporary") {
      if (existingStat(location)) managedFailure("OWNERSHIP_UNVERIFIED");
      const fd = fs.openSync(location, "wx", 0o600);
      try { fs.fsyncSync(fd); return { intentId: intent.id, identity: handleIdentity(fd), sha256: bytesHash(Buffer.alloc(0)), size: 0 }; } finally { fs.closeSync(fd); }
    }
    const temporary = receipts.find((r) => r.intentId === `temp-${intent.fileIndex}` && !r.compensated);
    const tempIntent = intents.find((i) => i.id === `temp-${intent.fileIndex}`)!;
    if (!temporary || !tempIntent) managedFailure("OWNERSHIP_UNVERIFIED");
    const tempPath = this.target(tempIntent.relativePath), tempStat = existingStat(tempPath);
    const file = this.preview.files[intent.fileIndex!];
    if (intent.kind === "remove-temp") {
      const published = receipts.find((r) => r.intentId === `publish-${intent.fileIndex}` && !r.compensated);
      if (!published) managedFailure("OWNERSHIP_UNVERIFIED");
      if (tempStat) {
        if (tempStat.isSymbolicLink() || !sameIdentity(pathIdentity(tempPath), published.identity) || this.hashOwned(tempPath) !== file.sha256) managedFailure("ARTIFACT_DRIFT");
        fs.unlinkSync(tempPath);
      }
      return { intentId: intent.id, identity: published.identity, sha256: file.sha256, size: file.size };
    }
    if (intent.kind === "publish") {
      const written = receipts.find((r) => r.intentId === `write-${intent.fileIndex}` && !r.compensated);
      if (!written) managedFailure("OWNERSHIP_UNVERIFIED");
      const final = existingStat(location);
      if (final) {
        if (final.isSymbolicLink() || !sameIdentity(pathIdentity(location), written.identity) || this.hashOwned(location) !== file.sha256) managedFailure("PATH_COLLISION");
      } else {
        if (!tempStat || !sameIdentity(pathIdentity(tempPath), written.identity) || this.hashOwned(tempPath) !== file.sha256) managedFailure("ARTIFACT_DRIFT");
        fs.linkSync(tempPath, location); // Exclusive, atomic no-clobber publication. Same local filesystem required.
      }
      return { intentId: intent.id, identity: written.identity, sha256: file.sha256, size: file.size };
    }
    if (!tempStat || tempStat.isSymbolicLink() || tempStat.nlink !== 1 || !sameIdentity(pathIdentity(tempPath), temporary.identity)) managedFailure("OWNERSHIP_UNVERIFIED");
    // An owned private scratch file may be incomplete after a interrupted write; never truncate a published file.
    const fd = fs.openSync(tempPath, fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      if (!sameIdentity(handleIdentity(fd), temporary.identity)) managedFailure("ARTIFACT_DRIFT");
      fs.ftruncateSync(fd, 0);
      if (file.sourcePath) {
        if (hashFile(file.sourcePath).sha256 !== file.sha256) managedFailure("ARTIFACT_DRIFT");
        const source = fs.openSync(file.sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        try {
          const sourceStat = fs.fstatSync(source);
          if (!file.sourceIdentity || !sameIdentity(handleIdentity(source), file.sourceIdentity) || sourceStat.nlink !== 1 || sourceStat.size !== file.size) managedFailure("ARTIFACT_DRIFT");
          const chunk = Buffer.alloc(64 * 1024); let count: number, copied = 0;
          while ((count = fs.readSync(source, chunk, 0, chunk.length, null)) > 0) {
            copied += count; if (copied > file.size) managedFailure("ARTIFACT_DRIFT");
            let offset = 0; while (offset < count) offset += fs.writeSync(fd, chunk, offset, count - offset);
            this.duringCopy?.();
          }
          if (copied !== file.size || fs.fstatSync(source).mtimeMs !== sourceStat.mtimeMs) managedFailure("ARTIFACT_DRIFT");
        } finally { fs.closeSync(source); }
      } else { const bytes = Buffer.from(file.content!); let offset = 0; while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset); }
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    if (this.hashOwned(tempPath) !== file.sha256) managedFailure("ARTIFACT_DRIFT");
    return { intentId: intent.id, identity: temporary.identity, sha256: file.sha256, size: file.size };
  }
  /** Explicit operator recovery only: authenticate an unpublished, interrupted write against its approved bytes. */
  inspectRollback(intent: FileEffectIntent, receipt: FileEffectReceipt): void {
    this.inspect(intent, receipt);
    if (intent.kind !== "directory" && receipt.sha256 && this.hashOwned(this.target(intent.relativePath)) !== receipt.sha256) managedFailure("ARTIFACT_DRIFT");
  }
  /** A durable empty-file receipt must still identify this private, single-link scratch file. */
  partialScratchReceipt(intent: FileEffectIntent, receipt: FileEffectReceipt): FileEffectReceipt {
    const file = this.preview.files[intent.fileIndex!], location = this.target(intent.relativePath);
    if (intent.kind !== "temporary" || !file || intent.id !== `temp-${intent.fileIndex}` || intent.relativePath !== `.jbgh-file-${intent.fileIndex}` || intent.hash !== file.sha256 || receipt.size !== 0 || receipt.sha256 !== bytesHash(Buffer.alloc(0))) managedFailure("OWNERSHIP_UNVERIFIED");
    this.inspect(intent, receipt, undefined, true);
    const before = fs.lstatSync(location);
    if (before.size > file.size || file.size > 256 * 1024 * 1024 || existingStat(this.target(file.relativePath))) managedFailure("ARTIFACT_DRIFT");
    const fd = fs.openSync(location, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fs.fstatSync(fd);
      if (!sameIdentity(handleIdentity(fd), receipt.identity) || !opened.isFile() || opened.nlink !== 1 || opened.size !== before.size) managedFailure("ARTIFACT_DRIFT");
      const hash = createHash("sha256"), scratch = Buffer.alloc(64 * 1024);
      const compare = (expected: Buffer, position: number) => {
        const count = Math.min(expected.length, Math.max(0, before.size - position));
        let offset = 0;
        while (offset < count) { const read = fs.readSync(fd, scratch, offset, count - offset, null); if (!read) managedFailure("ARTIFACT_DRIFT"); offset += read; }
        if (!scratch.subarray(0, count).equals(expected.subarray(0, count))) managedFailure("ARTIFACT_DRIFT");
        hash.update(scratch.subarray(0, count));
      };
      if (file.sourcePath) {
        const sourcePath = canonicalManagedPath(file.sourcePath), source = fs.openSync(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        try {
          const sourceBefore = fs.fstatSync(source), sourceIdentity = handleIdentity(source);
          if (!file.sourceIdentity || !sameIdentity(sourceIdentity, file.sourceIdentity) || !sourceBefore.isFile() || sourceBefore.nlink !== 1 || sourceBefore.size !== file.size) managedFailure("ARTIFACT_DRIFT");
          const sourceHash = createHash("sha256"), chunk = Buffer.alloc(64 * 1024); let total = 0, count: number;
          while ((count = fs.readSync(source, chunk, 0, chunk.length, null)) > 0) {
            if (total + count > file.size) managedFailure("ARTIFACT_DRIFT");
            const bytes = chunk.subarray(0, count); compare(bytes, total); sourceHash.update(bytes); total += count;
          }
          const after = fs.fstatSync(source);
          if (total !== file.size || sourceHash.digest("hex") !== file.sha256 || sourceBefore.mtimeMs !== after.mtimeMs || after.size !== sourceBefore.size || !sameIdentity(pathIdentity(sourcePath), sourceIdentity) || fs.lstatSync(sourcePath).isSymbolicLink()) managedFailure("ARTIFACT_DRIFT");
        } finally { fs.closeSync(source); }
      } else {
        const content = Buffer.from(file.content ?? "");
        if (content.length !== file.size || bytesHash(content) !== file.sha256) managedFailure("ARTIFACT_DRIFT");
        for (let offset = 0; offset < content.length; offset += scratch.length) compare(content.subarray(offset, offset + scratch.length), offset);
      }
      const after = fs.fstatSync(fd), current = fs.lstatSync(location);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || current.isSymbolicLink() || current.nlink !== 1 || !sameIdentity(pathIdentity(location), receipt.identity)) managedFailure("ARTIFACT_DRIFT");
      return { ...receipt, sha256: hash.digest("hex"), size: before.size };
    } finally { fs.closeSync(fd); }
  }
  remove(intent: FileEffectIntent, receipt: FileEffectReceipt, directory: FileEffectReceipt | undefined): void {
    const location = this.target(intent.relativePath); const current = existingStat(location);
    if (!current) return;
    if (intent.relativePath) this.ancestors(intent.relativePath);
    if (intent.kind !== "directory") this.parent(directory);
    if (current.isSymbolicLink() || !sameIdentity(pathIdentity(location), receipt.identity)) managedFailure("OWNERSHIP_UNVERIFIED");
    if (intent.kind === "directory") { fs.rmdirSync(location); return; }
    if (!current.isFile() || current.nlink > 2) managedFailure("OWNERSHIP_UNVERIFIED");
    // Temp and write intents address the same object; the newest write hash is used by the coordinator.
    if (receipt.sha256 && this.hashOwned(location) !== receipt.sha256) managedFailure("ARTIFACT_DRIFT");
    fs.unlinkSync(location);
  }
}
