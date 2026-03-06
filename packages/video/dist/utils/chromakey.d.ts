interface IChromakeyOpts {
    keyColor: [number, number, number];
    similarity: number;
    smoothness: number;
    spill: number;
}
type ImgSource = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement | ImageBitmap | OffscreenCanvas | VideoFrame;
/**
 * Green screen keying
 * keyColor Background color to remove, if not provided will use first pixel
 * similarity Background color similarity threshold, too small may retain background, too large may remove more non-background pixels
 * smoothness Smoothness; too small may cause jagged edges, too large causes overall transparency
 * spill Saturation; too small may retain green spill, too large causes image to become grayscale
 * @param opts: {
 *   keyColor?: [r, g, b]
 *   similarity: number
 *   smoothness: number
 *   spill: number
 * }
 */
export declare const createChromakey: (opts: Omit<IChromakeyOpts, "keyColor"> & {
    keyColor?: [number, number, number];
}) => (imgSource: ImgSource) => Promise<ImageBitmap | VideoFrame>;
export {};
