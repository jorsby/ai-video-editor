import { Filter, RenderTexture } from 'pixi.js';
import { EffectOptions, EffectRendererOptions } from './types';
export declare function makeEffect({ name, renderer }: EffectOptions): {
    filter: Filter;
    render({ width, height, canvasTexture, progress }: EffectRendererOptions): RenderTexture;
};
