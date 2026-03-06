import { BaseClip } from './base-clip';
import { IClip } from './iclip';
import { TransitionKey } from '../transition/glsl/gl-transition';
export declare class TransitionClip extends BaseClip {
    readonly type = "Transition";
    ready: IClip['ready'];
    private _meta;
    get meta(): {
        duration: number;
        width: number;
        height: number;
    };
    /**
     * Unique identifier for this clip instance
     */
    id: string;
    /**
     * The transition configuration
     */
    transitionEffect: {
        id: string;
        key: TransitionKey;
        name: string;
    };
    /**
     * ID of the clip from which the transition starts
     */
    fromClipId: string | null;
    /**
     * ID of the clip to which the transition ends
     */
    toClipId: string | null;
    constructor(transitionKey: TransitionKey);
    clone(): Promise<this>;
    tick(_time: number): Promise<{
        video: ImageBitmap | undefined;
        state: 'success';
    }>;
    split(_time: number): Promise<[this, this]>;
    toJSON(main?: boolean): any;
    /**
     * Create a TransitionClip instance from a JSON object
     */
    static fromObject(json: any): Promise<TransitionClip>;
}
