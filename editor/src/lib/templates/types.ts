export interface TemplateConfig {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;

  scene: {
    image: {
      fit: 'cover' | 'contain' | 'fill';
      position: 'center' | 'top' | 'bottom';
      animation:
        | 'ken-burns-in'
        | 'ken-burns-out'
        | 'pan-left'
        | 'pan-right'
        | 'zoom-pulse'
        | 'none';
      animationIntensity: number; // 0-1
    };

    text: {
      enabled: boolean;
      position:
        | 'bottom-third'
        | 'top-third'
        | 'center'
        | 'lower-left'
        | 'full-screen';
      style: {
        fontSize: number;
        fontFamily: string;
        fontWeight: string;
        fill: string;
        stroke?: { color: string; width: number };
        dropShadow?: {
          color: string;
          blur: number;
          distance: number;
          alpha: number;
          angle: number;
        };
        align: 'left' | 'center' | 'right';
        wordWrap: boolean;
        wordWrapWidth: number; // percentage of canvas width (0-100)
        lineHeight: number;
        letterSpacing: number;
        textCase?: 'none' | 'uppercase' | 'lowercase';
      };
      animation: 'fade-in' | 'typewriter' | 'slide-up' | 'word-reveal' | 'none';
      padding: { left: number; right: number; top: number; bottom: number };
      background?: { color: string; opacity: number; borderRadius: number };
    };

    timing: {
      textDelay: number; // seconds after scene start before text appears
      textFadeOut: number; // seconds before scene end to fade out text
    };
  };

  transition: {
    type: string; // GL transition key
    duration: number; // seconds
  };

  canvas: {
    aspectRatio: '9:16' | '16:9' | '1:1';
    backgroundColor: string;
  };
}
