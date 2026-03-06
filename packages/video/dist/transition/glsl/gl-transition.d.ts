export interface GlTransition {
    label: string;
    fragment: string;
    uniforms?: Record<string, {
        value: any;
        type: string;
    }>;
    previewDynamic?: string;
    previewStatic?: string;
}
export declare const GL_TRANSITIONS: Record<string, GlTransition>;
export type TransitionKey = keyof typeof GL_TRANSITIONS;
export declare const GL_TRANSITION_OPTIONS: Array<{
    key: TransitionKey;
    label: string;
    previewStatic: string | undefined;
    previewDynamic: string | undefined;
}>;
