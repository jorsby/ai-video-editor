import { EventEmitter } from 'node:events';
import type { RenderConfig, RenderEventMap } from './types.js';
export declare class Renderer extends EventEmitter {
    private config;
    private browser;
    private page;
    private server;
    constructor(config: RenderConfig);
    /**
     * Get the HTML template from file
     */
    private getHtmlTemplate;
    /**
     * Start a local static server to serve the HTML and core files
     */
    private startLocalServer;
    /**
     * Emit a progress event
     */
    private emitProgress;
    /**
     * Render the video
     */
    render(): Promise<string>;
    /**
     * Clean up resources
     */
    private cleanup;
    /**
     * Type-safe event listener
     */
    on<K extends keyof RenderEventMap>(event: K, listener: (...args: RenderEventMap[K]) => void): this;
    /**
     * Type-safe event emitter
     */
    emit<K extends keyof RenderEventMap>(event: K, ...args: RenderEventMap[K]): boolean;
}
//# sourceMappingURL=renderer.d.ts.map