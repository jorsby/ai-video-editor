/**
 * Decode image stream, return an array of video frames.
 *
 * @param stream - Readable stream containing image data.
 * @param type - MIME type of the image, e.g. 'image/jpeg'.
 *
 * @returns Returns a Promise that resolves to an array of {@link VideoFrame} after decoding completes.
 *
 * @example
 *
 * const frames = await decodeImg(
 *   (await fetch('<gif url>')).body!,
 *   `image/gif`,
 * );
 */
export declare function decodeImg(stream: ReadableStream<Uint8Array>, type: string): Promise<VideoFrame[]>;
