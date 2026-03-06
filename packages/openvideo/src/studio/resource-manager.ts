import type { file } from 'opfs-tools';
import { AssetManager } from '../utils/asset-manager';

export enum ResourceStatus {
  PENDING = 'pending',
  LOADING = 'loading',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface ResourceItem {
  url: string;
  status: ResourceStatus;
  localFile?: ReturnType<typeof file>;
  error?: Error;
}

/**
 * ResourceManager handles asset preloading and caching in OPFS.
 * It ensures that resources are downloaded only once and reused across sessions.
 */
export class ResourceManager {
  private resources = new Map<string, ResourceItem>();
  private loadingPromises = new Map<string, Promise<ResourceItem>>();

  /**
   * Preload a batch of URLs in parallel.
   * @param urls Array of URLs to preload
   */
  async preload(urls: string[]): Promise<void> {
    const uniqueUrls = [...new Set(urls)].filter((url) => {
      // Skip data URLs and blob URLs
      return url && !url.startsWith('data:') && !url.startsWith('blob:');
    });

    const promises = uniqueUrls.map((url) => this.loadResource(url));
    await Promise.allSettled(promises);
  }

  /**
   * Get a ReadableStream for the given URL, with transparent caching.
   * @param url URL to fetch
   */
  static async getReadableStream(
    url: string
  ): Promise<ReadableStream<Uint8Array>> {
    const cachedFile = await AssetManager.get(url);
    if (cachedFile) {
      try {
        const originFile = await cachedFile.getOriginFile();
        if (originFile) return originFile.stream();
      } catch {
        // Corrupted cache entry — remove and re-fetch
        console.warn(`ResourceManager: Removing corrupted cache for ${url}`);
        await AssetManager.remove(url).catch(() => {});
      }
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch: ${response.status} ${response.statusText}`
      );
    }

    const stream = response.body;
    if (!stream) throw new Error('Response body is null');

    // Skip caching for data/blob URLs
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      return stream;
    }

    // Download fully as blob to avoid back-pressure issues
    // with concurrent OPFS writes
    const blob = await new Response(stream).blob();

    // Background cache using an independent stream
    AssetManager.put(url, blob.stream(), blob.size).catch((err) => {
      console.error(`ResourceManager: Failed to cache ${url}`, err);
      // Clean up failed cache entry
      AssetManager.remove(url).catch(() => {});
    });

    return blob.stream();
  }

  /**
   * Get an ImageBitmap for the given URL, with transparent caching.
   */
  static async getImageBitmap(url: string): Promise<ImageBitmap> {
    const cachedFile = await AssetManager.get(url);
    if (cachedFile) {
      const originFile = await cachedFile.getOriginFile();
      if (originFile) return await createImageBitmap(originFile);
    }

    if (url.startsWith('data:') || url.startsWith('blob:')) {
      const response = await fetch(url);
      const blob = await response.blob();
      return await createImageBitmap(blob);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch: ${response.status} ${response.statusText}`
      );
    }

    const stream = response.body;
    if (!stream) throw new Error('Response body is null');

    // Download fully as blob to avoid tee() back-pressure issues
    const blob = await new Response(stream).blob();

    // Background cache using an independent stream
    AssetManager.put(url, blob.stream(), blob.size).catch((err) => {
      console.error(`ResourceManager: Failed to cache ${url}`, err);
    });

    return await createImageBitmap(blob);
  }

  /**
   * Load a single resource, using cache if available.
   * @param url URL to load
   */
  async loadResource(url: string): Promise<ResourceItem> {
    // If already loading or loaded, return the existing promise or result
    const existingPromise = this.loadingPromises.get(url);
    if (existingPromise) return existingPromise;

    if (this.resources.has(url)) {
      const res = this.resources.get(url)!;
      if (res.status === ResourceStatus.COMPLETED) return res;
    }

    const loadPromise = (async (): Promise<ResourceItem> => {
      const item: ResourceItem = { url, status: ResourceStatus.LOADING };
      this.resources.set(url, item);

      try {
        const localFile = await AssetManager.get(url);
        if (localFile) {
          item.status = ResourceStatus.COMPLETED;
          item.localFile = localFile;
          return item;
        }

        // Fetch and cache in background
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

        const stream = response.body;
        if (!stream) throw new Error('No body');

        // Read full blob so we know the size for cache validation
        const blob = await new Response(stream).blob();
        const file = await AssetManager.put(url, blob.stream(), blob.size);

        item.status = ResourceStatus.COMPLETED;
        item.localFile = file;
        return item;
      } catch (err) {
        item.status = ResourceStatus.FAILED;
        item.error = err instanceof Error ? err : new Error(String(err));
        return item;
      } finally {
        this.loadingPromises.delete(url);
      }
    })();

    this.loadingPromises.set(url, loadPromise);
    return loadPromise;
  }

  /**
   * Resolve a URL to its local OPFS file if available.
   * @param url URL to resolve
   */
  async resolve(url: string): Promise<ReturnType<typeof file> | string> {
    // If it's not a remote URL, return as is
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
      return url;
    }

    const item = await this.loadResource(url);
    if (item.status === ResourceStatus.COMPLETED && item.localFile) {
      return item.localFile;
    }

    return url;
  }

  /**
   * Get the status of a specific resource.
   */
  getStatus(url: string): ResourceItem | undefined {
    return this.resources.get(url);
  }

  /**
   * Clear instance state (not OPFS cache).
   */
  clear(): void {
    this.resources.clear();
    this.loadingPromises.clear();
  }
}
