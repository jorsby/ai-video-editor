import { Application, Sprite, Texture, Container } from 'pixi.js';
import { IClip } from '../clips/iclip';
/**
 * Update sprite transform based on clip properties
 * Utility function for updating standalone sprites (e.g., video sprites from HTMLVideoElement)
 * For sprites managed by PixiSpriteRenderer, use renderer.updateTransforms() instead
 */
export declare function updateSpriteTransform(clip: IClip, sprite: Sprite): void;
/**
 * Renders video frames using Pixi.js
 * Uses a canvas-based approach: draws frames to a canvas and creates texture from it
 * This matches the pattern used in other video rendering libraries
 */
export declare class PixiSpriteRenderer {
    private sprite;
    private targetContainer;
    private pixiSprite;
    private texture;
    private canvas;
    private context;
    private root;
    private strokeGraphics;
    private maskGraphics;
    private shadowGraphics;
    private shadowContainer;
    private resolution;
    private destroyed;
    constructor(_pixiApp: Application | null, sprite: IClip, targetContainer?: Container | null);
    /**
     * Update the sprite with a new video frame or Texture
     * @param frame ImageBitmap, Texture, or null to render
     *              (VideoFrames are converted to ImageBitmap in getFrame)
     */
    updateFrame(frame: ImageBitmap | Texture | null): Promise<void>;
    /**
     * Apply sprite transformations to the Pixi Sprite
     */
    private applySpriteTransforms;
    /**
     * Apply all styles (stroke, borderRadius, dropShadow) to the sprite
     */
    private applyStyle;
    private applyStroke;
    private applyShadow;
    updateTransforms(): void;
    getSprite(): Sprite | null;
    getRoot(): Container | null;
    destroy(): void;
}
