import { BaseClip } from './base-clip';
import { IClip } from './iclip';
import { EffectKey } from '../effect/glsl/gl-effect';
export declare class EffectClip extends BaseClip {
    readonly type = "Effect";
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
     * The effect configuration
     */
    effect: {
        id: string;
        key: EffectKey;
        name: string;
    };
    constructor(effectKey: EffectKey);
    clone(): Promise<this>;
    tick(_time: number): Promise<{
        video: ImageBitmap | undefined;
        state: 'success';
    }>;
    split(_time: number): Promise<[this, this]>;
    toJSON(main?: boolean): any;
    /**
     * Create an EffectClip instance from a JSON object
     */
    static fromObject(json: any): Promise<EffectClip>;
}
