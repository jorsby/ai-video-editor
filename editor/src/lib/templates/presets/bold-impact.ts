import type { TemplateConfig } from '../types';

export const boldImpact: TemplateConfig = {
  id: 'bold-impact',
  name: 'Bold Impact',
  description: 'Eye-catching social media style for reels and shorts',

  scene: {
    image: {
      fit: 'cover',
      position: 'center',
      animation: 'zoom-pulse',
      animationIntensity: 0.5,
    },

    text: {
      enabled: true,
      position: 'center',
      style: {
        fontSize: 56,
        fontFamily: 'Roboto',
        fontWeight: 'bold',
        fill: '#ffffff',
        stroke: { color: '#000000', width: 4 },
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 80,
        lineHeight: 1.2,
        letterSpacing: 2,
        textCase: 'uppercase',
      },
      animation: 'slide-up',
      padding: { left: 30, right: 30, top: 0, bottom: 0 },
    },

    timing: {
      textDelay: 0.1,
      textFadeOut: 0.2,
    },
  },

  transition: {
    type: 'directionalwarp',
    duration: 0.5,
  },

  canvas: {
    aspectRatio: '9:16',
    backgroundColor: '#000000',
  },
};
