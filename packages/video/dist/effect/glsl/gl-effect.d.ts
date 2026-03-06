export interface GlTransition {
    label: string;
    fragment: string;
    uniforms?: Record<string, {
        value: any;
        type: string;
    }>;
}
export declare const GL_EFFECTS: Record<string, GlTransition>;
export type EffectKey = keyof typeof GL_EFFECTS;
export declare const GL_EFFECT_OPTIONS: Array<{
    key: EffectKey;
    label: string;
    previewStatic: string | undefined;
    previewDynamic: string | undefined;
}>;
