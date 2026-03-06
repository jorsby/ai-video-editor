/**
 * Create a new HTML element
 * @param tagName - Tag name of the element to create
 * @returns Newly created HTML element
 */
export declare function createEl(tagName: string): HTMLElement;
/**
 * Render text as an image
 * @param text - Text to render
 * @param cssText - CSS styles to apply to the text
 * @returns Rendered image element
 */
export declare function renderTxt2Img(text: string, cssText: string, opts?: {
    font?: {
        name: string;
        url: string;
    };
    onCreated?: (el: HTMLElement) => void;
}): Promise<HTMLImageElement>;
/**
 * Render text as {@link ImageBitmap} for creating {@link ImageClip}
 * @param text - Text to render
 * @param cssText - CSS styles to apply to the text
 * @param opts - Options
 * @param opts.font - Custom font
 * @param opts.onCreated - Callback after creation
 *
 * @example
 * new ImageClip(
 *   await renderTxt2ImgBitmap(
 *     'Watermark',
 *    `font-size:40px; color: white; text-shadow: 2px 2px 6px red; font-family: CustomFont;`,
 *    {
 *      font: {
 *        name: 'CustomFont',
 *        url: '/CustomFont.ttf',
 *      },
 *    },
 *   )
 * )
 */
export declare function renderTxt2ImgBitmap(text: string, cssText: string, opts?: {
    font?: {
        name: string;
        url: string;
    };
    onCreated?: (el: HTMLElement) => void;
}): Promise<ImageBitmap>;
