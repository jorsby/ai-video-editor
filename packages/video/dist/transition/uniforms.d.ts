import { GLTransition } from './types';
export declare const uniforms: {
    custom: (transition: GLTransition) => {
        [k: string]: {
            value: any;
            type: string;
        };
    };
    basics: {
        _fromR: {
            value: number;
            type: string;
        };
        _toR: {
            value: number;
            type: string;
        };
        ratio: {
            value: number;
            type: string;
        };
        progress: {
            value: number;
            type: string;
        };
        customUniform: {
            value: number;
            type: string;
        };
        center: {
            value: number[];
            type: string;
        };
    };
};
