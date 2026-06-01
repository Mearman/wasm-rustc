import type { Manifest, ManifestFile } from "./manifest.js";

/**
 * Cache Storage wrapper for release artefacts.
 *
 * Stores each file from a release as a separate cache entry keyed by
 * the version + file path. On init, checks whether all files are already
 * cached and skips downloading if so.
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
   * Check whether a specific file is already cached.
   */
  async has(file: ManifestFile): Promise<boolean> {
    const cache = this.getCache();
    const response = await cache.match(this.cacheKey(file));
    return response !== undefined;
  }

  /**
   * Get a cached file as an ArrayBuffer, or undefined if not cached.
   */
  async get(file: ManifestFile): Promise<ArrayBuffer | undefined> {
    const cache = this.getCache();
    const response = await cache.match(this.cacheKey(file));
    if (response === undefined) {
      return undefined;
    }
    return response.arrayBuffer();
  }

  /**
   * Download all missing files from the manifest, storing each in
   * Cache Storage. Calls onProgress with cumulative bytes downloaded
   * and total expected bytes.
   */
  async downloadAll(
    manifest: Manifest,
    baseUrl: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const cache = this.getCache();
    let loaded = 0;
    const total = manifest.totalSize;

    for (const file of manifest.files) {
      const cached = await this.get(file);
      if (cached !== undefined) {
        loaded += file.size;
        onProgress?.(loaded, total);
        continue;
      }

      const url = `${baseUrl}/${this.version}/${file.path}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to download ${url}: ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      // Store in cache
      const cachedResponse = new Response(buffer, {
        headers: { "Content-Length": String(buffer.byteLength) },
      });
      await cache.put(this.cacheKey(file), cachedResponse);

      loaded += file.size;
      onProgress?.(loaded, total);
    }
  }

  /**
   * Get all cached files as a map from path to ArrayBuffer.
   * Only includes files that are actually in the cache.
   */
  async getAll(manifest: Manifest): Promise<Map<string, ArrayBuffer>> {
    const result = new Map<string, ArrayBuffer>();
    for (const file of manifest.files) {
      const buffer = await this.get(file);
      if (buffer !== undefined) {
        result.set(file.path, buffer);
      }
    }
    return result;
  }

  private cacheKey(file: ManifestFile): string {
    return `wasm-rustc://${this.version}/${file.path}`;
  }

  private getCache(): Cache {
    if (this.cache === undefined) {
      throw new Error("ReleaseCache not initialised — call init() first");
    }
    return this.cache;
  }
}
