import { file, write } from 'opfs-tools';

export class AssetManager {
  private static async getCacheKey(url: string): Promise<string> {
    // Basic hash for URL to use as filename
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private static getPath(key: string): string {
    return `assets/${key}`;
  }

  private static getSizePath(key: string): string {
    return `assets/${key}.size`;
  }

  static async get(url: string) {
    const key = await AssetManager.getCacheKey(url);
    const path = AssetManager.getPath(key);
    const sizePath = AssetManager.getSizePath(key);
    const f = file(path);
    if (await f.exists()) {
      // Validate size against sidecar metadata
      const sizeFile = file(sizePath);
      if (await sizeFile.exists()) {
        try {
          const originFile = await sizeFile.getOriginFile();
          if (!originFile) throw new Error('no origin file');
          const expectedSize = parseInt(await originFile.text(), 10);
          const cachedFile = await f.getOriginFile();
          if (!cachedFile) throw new Error('no cached file');
          if (!Number.isNaN(expectedSize) && cachedFile.size === expectedSize) {
            return f;
          }
        } catch {
          // Sidecar read failed — treat as invalid
        }
      }
      // Missing or mismatched sidecar — invalidate cache
      await f.remove().catch(() => {});
      await file(sizePath)
        .remove()
        .catch(() => {});
      return null;
    }
    return null;
  }

  static async put(
    url: string,
    stream: ReadableStream<Uint8Array>,
    expectedSize?: number
  ) {
    const key = await AssetManager.getCacheKey(url);
    const path = AssetManager.getPath(key);
    const sizePath = AssetManager.getSizePath(key);
    const f = file(path);
    await write(f, stream as any);

    // Determine actual written size
    const originFile = await f.getOriginFile();
    if (!originFile) throw new Error('Failed to read back cached file');
    const actualSize = originFile.size;

    // If expectedSize provided, verify it matches
    if (expectedSize !== undefined && actualSize !== expectedSize) {
      await f.remove().catch(() => {});
      await file(sizePath)
        .remove()
        .catch(() => {});
      throw new Error(
        `Cache write size mismatch: expected ${expectedSize}, got ${actualSize}`
      );
    }

    // Write sidecar with actual size
    const sizeFile = file(sizePath);
    const sizeBlob = new Blob([String(actualSize)]);
    await write(sizeFile, sizeBlob.stream() as any);

    return f;
  }

  static async remove(url: string) {
    const key = await AssetManager.getCacheKey(url);
    const path = AssetManager.getPath(key);
    const sizePath = AssetManager.getSizePath(key);
    const f = file(path);
    if (await f.exists()) {
      await f.remove();
    }
    const sizeFile = file(sizePath);
    if (await sizeFile.exists()) {
      await sizeFile.remove();
    }
  }
}
