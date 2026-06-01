import type { Manifest, ManifestFile } from "./manifest.js";
import { extractTarGzip } from "./tar.js";

/**
 * Cache Storage wrapper for release artefacts.
 *
 * Stores each file from a release as a separate cache entry keyed by
 * the version + file path. On init, checks whether the tarball is already
 * cached (via a sentinel entry) and skips downloading if so.
 */
export class ReleaseCache {
  private readonly cacheName: string;
  private cache: Cache | undefined;

  constructor(private readonly version: string) {
    this.cacheName = `wasm-rustc-${version}`;
  }

  async init(): Promise<void> {
    this.cache = await caches.open(this.cacheName);
  }

  /**
   * Check whether all files for this version are already cached.
   */
  async isCached(manifest: Manifest): Promise<boolean> {
    const sentinel = await this.cache?.match(this.sentinelKey());
    return sentinel !== undefined;
  }

  /**
   * Download the tarball from the release, extract all files, and cache them.
   * Calls onProgress with cumulative bytes downloaded and total expected bytes.
   */
  async downloadAll(
    manifest: Manifest,
    tarballUrl: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const cache = this.getCache();

    // Fetch the tarball with progress tracking
    const response = await fetch(tarballUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download tarball from ${tarballUrl}: ${response.status}`,
      );
    }

    const total = manifest.totalSize;
    let loaded = 0;

    // Read the response body with progress
    const reader = response.body?.getReader();
    if (reader === undefined) {
      throw new Error("Failed to get readable stream from fetch response");
    }

    const chunks: Uint8Array[] = [];
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      loaded += result.value.length;
      onProgress?.(loaded, total);
    }

    // Merge chunks into a single buffer
    let totalLength = 0;
    for (const chunk of chunks) {
      totalLength += chunk.length;
    }
    const gzipBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      gzipBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    // Extract the tar archive
    const files = await extractTarGzip(gzipBuffer.buffer);

    // Cache each extracted file
    for (const file of manifest.files) {
      const data = files.get(file.path);
      if (data !== undefined) {
        await cache.put(this.cacheKey(file.path), new Response(data.buffer as ArrayBuffer, {
          headers: { "Content-Length": String(data.byteLength) },
        }));
      }
    }

    // Write sentinel to mark this version as fully cached
    await cache.put(this.sentinelKey(), new Response("ok"));
  }

  /**
   * Get all cached files as a map from path to ArrayBuffer.
   * Only includes files that are actually in the cache.
   */
  async getAll(manifest: Manifest): Promise<Map<string, ArrayBuffer>> {
    const result = new Map<string, ArrayBuffer>();
    for (const file of manifest.files) {
      const buffer = await this.get(file.path);
      if (buffer !== undefined) {
        result.set(file.path, buffer);
      }
    }
    return result;
  }

  /**
   * Get a specific cached file as ArrayBuffer.
   */
  async get(path: string): Promise<ArrayBuffer | undefined> {
    const cache = this.getCache();
    const response = await cache.match(this.cacheKey(path));
    if (response === undefined) {
      return undefined;
    }
    return response.arrayBuffer();
  }

  private cacheKey(path: string): string {
    return `wasm-rustc://${this.version}/${path}`;
  }

  private sentinelKey(): string {
    return `wasm-rustc://${this.version}/.cached`;
  }

  private getCache(): Cache {
    if (this.cache === undefined) {
      throw new Error("ReleaseCache not initialised — call init() first");
    }
    return this.cache;
  }
}
