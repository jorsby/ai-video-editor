import { Application, Container, Graphics } from 'pixi.js';
import { IClip } from '../clips/iclip';
import { Transformer } from '../transfomer/transformer';
import { Studio } from '../studio';
export declare class SelectionManager {
    private studio;
    selectedClips: Set<IClip>;
    activeTransformer: Transformer | null;
    interactiveClips: Set<IClip>;
    selectionGraphics: Graphics | null;
    isDragSelecting: boolean;
    private dragSelectionStart;
    private isUpdatingTextClipRealtime;
    private textClipResizedWidth;
    private textClipResizeHandle;
    private textClipResizedSx;
    private textClipResizedSy;
    constructor(studio: Studio);
    init(app: Application, artboard: Container): void;
    private onStagePointerDown;
    private onStagePointerMove;
    private onStagePointerUp;
    /**
     * Setup sprite interactivity for click selection
     */
    setupSpriteInteractivity(clip: IClip): void;
    /**
     * Find the topmost clip (highest zIndex) at a given point
     */
    getTopmostClipAtPoint(globalPoint: {
        x: number;
        y: number;
    }): IClip | null;
    /**
     * Select a clip and show transform controls
     */
    selectClip(clip: IClip, addToSelection?: boolean): void;
    selectClipsByIds(ids: string[]): void;
    setSelection(clips: IClip[]): void;
    deselectClip(): void;
    clear(): void;
    private recreateTransformer;
    private destroyTransformer;
    private createTransformer;
    private syncSelectedClipsTransformsRealtime;
    private syncSelectedClipsTransforms;
    private syncSpriteToClipProperties;
    deleteSelected(): Promise<void>;
}
