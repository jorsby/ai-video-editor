import { Container, Point, Graphics } from 'pixi.js';
import { Wireframe } from './parts/wireframe';
import { HandleKind } from './parts/handle';
export declare class Transformer extends Container {
    #private;
    group: Container[];
    wireframe: Wireframe;
    selectionOutlines: Graphics;
    isDragging: boolean;
    lastPointer: Point;
    activeHandle: HandleKind | null;
    opts: {
        group: Container[];
        centeredScaling?: boolean;
        clip?: any;
    };
    constructor(opts: {
        group: Container[];
        centeredScaling?: boolean;
        clip?: any;
    });
    /**
     * Public method to update transformer bounds without recreating it
     * Useful for updating bounds after clip dimensions change
     */
    updateBounds(): void;
}
