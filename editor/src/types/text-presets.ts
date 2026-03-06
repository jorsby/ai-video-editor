export interface TextPresetStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle?: string;
  fontUrl?: string;
  fill: string;
  align?: 'left' | 'center' | 'right';
  textCase?: 'none' | 'uppercase' | 'lowercase';
  letterSpacing?: number;
  lineHeight?: number;
  wordWrap?: boolean;
  wordWrapWidth?: number;
  stroke?: {
    color: string;
    width: number;
    join?: 'round' | 'bevel' | 'miter';
  };
  dropShadow?: {
    color: string;
    alpha: number;
    blur: number;
    angle: number;
    distance: number;
  };
}

export interface TextPresetClipProperties {
  opacity?: number;
  angle?: number;
  duration?: number;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export interface SavedTextPreset {
  id: string;
  name: string;
  style: TextPresetStyle;
  clipProperties: TextPresetClipProperties;
  createdAt: string;
}

export interface SavedTextPresetsData {
  presets: SavedTextPreset[];
  lastModified: string;
}
