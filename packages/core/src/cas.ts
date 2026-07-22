import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzip, gunzipSync, gzip, gzipSync } from "node:zlib";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Content-addressable store for file snapshots and offloaded large payloads.
 *
 * Objects are keyed by the sha256 of their *raw* (uncompressed) content, so
 * identical content collapses to a single object regardless of how many events
 * reference it. On disk they are gzip-compressed at `<root>/<hash[0:2]>/<hash>`.
 * Writes are atomic (temp file + rename) so a crash or a racing hook process
 * never leaves a half-written, corrupt object.
 */
export class ContentStore {
  constructor(private readonly root: string) {}

  private pathFor(hash: string): string {
    return join(this.root, hash.slice(0, 2), hash);
  }

  /** Store content, returning its hash. A no-op (deduped) if already present. */
  async put(data: Buffer | string): Promise<string> {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const hash = createHash("sha256").update(buf).digest("hex");
    const dest = this.pathFor(hash);
    if (existsSync(dest)) return hash; // dedup: identical content already stored

    await mkdir(dirname(dest), { recursive: true });
    const compressed = await gzipAsync(buf);
    const tmp = `${dest}.tmp-${randomUUID()}`;
    await writeFile(tmp, compressed);
    await rename(tmp, dest);
    return hash;
  }

  /**
   * Synchronous {@link put}. Used on the store's append path, which is sync
   * end-to-end (see store.ts) — offloading a payload must not force every
   * caller of `appendEvent` to become async.
   */
  putSync(data: Buffer | string): string {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const hash = createHash("sha256").update(buf).digest("hex");
    const dest = this.pathFor(hash);
    if (existsSync(dest)) return hash; // dedup: identical content already stored

    mkdirSync(dirname(dest), { recursive: true });
    const tmp = `${dest}.tmp-${randomUUID()}`;
    writeFileSync(tmp, gzipSync(buf));
    renameSync(tmp, dest);
    return hash;
  }

  /** Retrieve and decompress content by hash. Throws if the object is missing. */
  async get(hash: string): Promise<Buffer> {
    const compressed = await readFile(this.pathFor(hash));
    return gunzipAsync(compressed);
  }

  /** Synchronous {@link get}; counterpart to {@link putSync}. */
  getSync(hash: string): Buffer {
    return gunzipSync(readFileSync(this.pathFor(hash)));
  }

  /** Synchronous {@link getText}. */
  getTextSync(hash: string): string {
    return this.getSync(hash).toString("utf8");
  }

  /** Retrieve content as a UTF-8 string. */
  async getText(hash: string): Promise<string> {
    return (await this.get(hash)).toString("utf8");
  }

  async has(hash: string): Promise<boolean> {
    try {
      await stat(this.pathFor(hash));
      return true;
    } catch {
      return false;
    }
  }
}
