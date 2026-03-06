import { Graphics, Point } from 'pixi.js';
export type Side = 'ml' | 'mr' | 'mt' | 'mb';
type Corner = 'tl' | 'tr' | 'bl' | 'br' | 'rot';
export type HandleKind = Corner | Side;
interface Callbacks {
    beginDrag: (handle: HandleKind, start: Point) => void;
    updateDrag: (handle: HandleKind, pos: Point) => void;
    endDrag: () => void;
}
export declare class Handle extends Graphics {
    #private;
    private handle;
    cursor: string;
    private callbacks;
    constructor(handle: HandleKind, cursor: string, callbacks: Callbacks);
}
export {};
