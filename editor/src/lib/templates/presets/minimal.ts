import type { TemplateConfig } from '../types';

export const minimal: TemplateConfig = {
  id: 'minimal',
  name: 'Minimal',
  description: 'Subtle, modern style for storytelling',

  scene: {
    image: {
      fit: 'cover',
      position: 'center',
      animation: 'pan-left',
      animationIntensity: 0.2,
    },

    text: {
      enabled: true,
      position: 'lower-left',
      style: {
        fontSize: 32,
        fontFamily: 'Roboto',
        fontWeight: 'normal',
        fill: '#ffffff',
        dropShadow: {
          color: '#000000',
          blur: 4,
          distance: 1,
          alpha: 0.5,
          angle: Math.PI / 4,
        },
        align: 'left',
        wordWrap: true,
        wordWrapWidth: 70,
        lineHeight: 1.4,
        letterSpacing: 0.5,
      },
      animation: 'fade-in',
      padding: { left: 40, right: 40, top: 20, bottom: 80 },
    },

    timing: {
      textDelay: 0.5,
      textFadeOut: 0.5,
    },
  },

  transition: {
    type: 'fade',
    duration: 0.8,
  },

  canvas: {
    aspectRatio: '9:16',
    backgroundColor: '#000000',
  },
};
