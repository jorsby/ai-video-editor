import type { TemplateConfig } from '../types';

export const documentary: TemplateConfig = {
  id: 'documentary',
  name: 'Documentary',
  description: 'Clean, professional look for science and educational content',

  scene: {
    image: {
      fit: 'cover',
      position: 'center',
      animation: 'ken-burns-in',
      animationIntensity: 0.3,
    },

    text: {
      enabled: true,
      position: 'bottom-third',
      style: {
        fontSize: 42,
        fontFamily: 'Roboto',
        fontWeight: 'normal',
        fill: '#ffffff',
        dropShadow: {
          color: '#000000',
          blur: 6,
          distance: 2,
          alpha: 0.7,
          angle: Math.PI / 4,
        },
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 85,
        lineHeight: 1.3,
        letterSpacing: 0,
      },
      animation: 'fade-in',
      padding: { left: 40, right: 40, top: 20, bottom: 60 },
    },

    timing: {
      textDelay: 0.3,
      textFadeOut: 0.3,
    },
  },

  transition: {
    type: 'crosswarp',
    duration: 1,
  },

  canvas: {
    aspectRatio: '9:16',
    backgroundColor: '#000000',
  },
};
