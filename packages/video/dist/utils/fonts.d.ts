export interface IFont {
    name: string;
    url: string;
}
export declare class FontManager {
    private static instance;
    private fonts;
    private constructor();
    static getInstance(): FontManager;
    addFont(font: IFont): Promise<void>;
    loadFonts(fonts: IFont[]): Promise<void>;
    removeFont(fontName: string): void;
    clear(): void;
    getLoadedFonts(): string[];
}
export declare const fontManager: FontManager;
