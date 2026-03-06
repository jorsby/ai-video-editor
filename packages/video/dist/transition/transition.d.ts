import { RenderTexture } from 'pixi.js';
import { TransitionOptions, TransitionRendererOptions } from './types';
export declare function makeTransition({ name, renderer }: TransitionOptions): {
    render({ width, height, from, to, progress }: TransitionRendererOptions): RenderTexture;
    destroy(): void;
};
