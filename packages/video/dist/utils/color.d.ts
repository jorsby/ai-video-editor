/**
 * Convert color string or number to PixiJS color number
 */
export declare function parseColor(color: string | number | undefined): number | undefined;
export declare const isTransparent: (color?: any) => boolean;
export declare const resolveColor: (color?: string, fallback?: number) => {
    color: number;
    alpha: number;
};
