import { Renderer, Texture } from 'pixi.js';
import { TransitionKey } from './glsl/gl-transition';
export interface TransitionOptions {
    name: TransitionKey;
    renderer: Renderer;
}
export interface TransitionRendererOptions {
    from: VideoFrame | Texture;
    to: VideoFrame | Texture;
    progress: number;
    width: number;
    height: number;
}
export interface GLTransition {
    author?: string;
    createdAt?: string;
    glsl?: string;
    fragment?: string;
    license?: string;
    name: string;
    updatedAt?: string;
    defaultParams?: Record<string, any>;
    paramsTypes?: Record<string, any>;
    label?: string;
    uniforms?: Record<string, {
        value: any;
        type: string;
    }>;
}
