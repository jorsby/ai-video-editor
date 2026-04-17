export interface PresetEntry {
  label: string;
  value: string;
}

export interface PresetCategory {
  label: string;
  presets: PresetEntry[];
  /** Only show for these clip types; undefined = show for all */
  clipTypes?: string[];
}

function camelToLabel(s: string): string {
  return s
    .replace(/([A-Z0-9])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function p(value: string): PresetEntry {
  return { label: camelToLabel(value), value };
}

// ─── IN PRESETS ─────────────────────────────────────────────

export const IN_PRESET_CATEGORIES: PresetCategory[] = [
  {
    label: 'Basic',
    presets: [
      p('fadeIn'),
      p('zoomIn'),
      p('slideIn'),
      p('blurIn'),
      p('motionBlurIn'),
      p('pulse'),
      p('slideRotateIn'),
      p('slideBlurIn'),
      p('slideZoomIn'),
      p('zoomRotateIn'),
      p('zoomBlurIn'),
    ],
  },
  {
    label: 'Cinematic',
    presets: [
      p('cinematicZoomSlideIn'),
      p('cinematicSlideZoomBlurIn'),
      p('ultraCinematicIn'),
      p('heavyCinematicIn'),
      p('dramaticSpinSlideIn'),
      p('flashZoomIn'),
      p('flashSlideIn'),
      p('overexposedZoomIn'),
    ],
  },
  {
    label: 'Blur & Slide',
    presets: [
      p('blurSlideRightIn'),
      p('blurSlideLeftIn'),
      p('blurSlideRightStrongIn'),
      p('darkSlideBlurIn'),
      p('verticalBlurIn'),
      p('rotateBlurIn'),
      p('tiltZoomBlurIn'),
      p('dropBlurIn'),
      p('diagonalBlurZoomIn'),
    ],
  },
  {
    label: 'Spin & Rotate',
    presets: [
      p('spinZoomIn'),
      p('spinFadeIn'),
      p('zoomSpinIn'),
      p('wobbleZoomIn'),
      p('elasticTwistIn'),
      p('tiltSlideRightIn'),
      p('tiltZoomIn'),
      p('dropRotateIn'),
      p('diagonalSlideRotateIn'),
      p('collapseRotateZoomIn'),
      p('liftZoomRotateIn'),
      p('slideUpRotateZoomIn'),
    ],
  },
  {
    label: 'Advanced',
    presets: [
      p('brightnessZoomIn'),
      p('brightnessSlideIn'),
      p('rotateBrightnessIn'),
      p('zoomBrightnessBlurIn'),
      p('twistSlideBrightnessIn'),
      p('fallZoomIn'),
      p('fallBlurRotateIn'),
      p('glitchSlideIn'),
      p('spiralIn'),
      p('sideStretchZoomIn'),
      p('pushDownZoomBlurIn'),
    ],
  },
  {
    label: 'Character',
    clipTypes: ['Text', 'Caption'],
    presets: [p('charFadeIn'), p('charSlideUp'), p('charTypewriter')],
  },
  {
    label: 'By Word',
    clipTypes: ['Text', 'Caption'],
    presets: [
      p('fadeByWord'),
      p('slideFadeByWord'),
      p('popByWord'),
      p('scaleFadeByWord'),
      p('bounceByWord'),
      p('rotateInByWord'),
      p('slideRightByWord'),
      p('slideLeftByWord'),
      p('fadeRotateByWord'),
      p('skewByWord'),
      p('waveByWord'),
      p('blurInByWord'),
      p('dropSoftByWord'),
      p('elasticPopByWord'),
      p('flipUpByWord'),
      p('spinInByWord'),
      p('stretchInByWord'),
      p('revealZoomByWord'),
      p('floatWaveByWord'),
    ],
  },
  {
    label: 'Caption',
    clipTypes: ['Caption'],
    presets: [
      p('popCaption'),
      p('bounceCaption'),
      p('scaleCaption'),
      p('scaleMidCaption'),
      p('scaleDownCaption'),
      p('fadeCaption'),
      p('slideLeftCaption'),
      p('slideRightCaption'),
      p('slideUpCaption'),
      p('slideDownCaption'),
      p('upDownCaption'),
      p('upLeftCaption'),
    ],
  },
];

// ─── OUT PRESETS ─────────────────────────────────────────────

export const OUT_PRESET_CATEGORIES: PresetCategory[] = [
  {
    label: 'Basic',
    presets: [
      p('fadeOut'),
      p('zoomOut'),
      p('slideOut'),
      p('blurOut'),
      p('motionBlurOut'),
      p('pulse'),
      p('slideRotateOut'),
      p('slideBlurOut'),
      p('slideZoomOut'),
      p('zoomRotateOut'),
      p('zoomBlurOut'),
    ],
  },
  {
    label: 'Cinematic',
    presets: [
      p('cinematicZoomSlideOut'),
      p('cinematicSlideZoomBlurOut'),
      p('ultraCinematicOut'),
      p('heavyCinematicOut'),
      p('dramaticSpinSlideOut'),
      p('flashZoomOut'),
      p('flashSlideOut'),
      p('overexposedZoomOut'),
    ],
  },
  {
    label: 'Blur & Slide',
    presets: [
      p('blurSlideRightOut'),
      p('blurSlideLeftOut'),
      p('blurSlideRightStrongOut'),
      p('darkSlideBlurOut'),
      p('verticalBlurOut'),
      p('rotateBlurOut'),
      p('tiltZoomBlurOut'),
      p('dropBlurOut'),
      p('diagonalBlurZoomOut'),
    ],
  },
  {
    label: 'Spin & Rotate',
    presets: [
      p('spinZoomOut'),
      p('spinFadeOut'),
      p('zoomSpinOut'),
      p('wobbleZoomOut'),
      p('elasticTwistOut'),
      p('tiltSlideRightOut'),
      p('tiltZoomOut'),
      p('dropRotateOut'),
      p('diagonalSlideRotateOut'),
      p('collapseRotateZoomOut'),
      p('liftZoomRotateOut'),
      p('slideUpRotateZoomOut'),
    ],
  },
  {
    label: 'Advanced',
    presets: [
      p('brightnessZoomOut'),
      p('brightnessSlideOut'),
      p('rotateBrightnessOut'),
      p('zoomBrightnessBlurOut'),
      p('twistSlideBrightnessOut'),
      p('fallZoomOut'),
      p('fallBlurRotateOut'),
      p('glitchSlideOut'),
      p('spiralOut'),
      p('sideStretchZoomOut'),
      p('pushDownZoomBlurOut'),
    ],
  },
];

// ─── COMBO / LOOPING PRESETS ────────────────────────────────

export const COMBO_PRESETS: PresetEntry[] = [
  p('comboZoom1'),
  p('comboZoom2'),
  p('comboPendulum1'),
  p('comboPendulum2'),
  p('comboRightDistort'),
  p('comboLeftDistort'),
  p('comboWobble'),
  p('comboSpinningTop1'),
  p('comboSpinningTop2'),
  p('comboSwayOut'),
  p('comboSwayIn'),
  p('comboBounce1'),
];

// ─── HELPERS ────────────────────────────────────────────────

/** Get all In presets filtered by clip type */
export function getInPresets(clipType?: string): PresetCategory[] {
  return IN_PRESET_CATEGORIES.filter(
    (cat) => !cat.clipTypes || (clipType && cat.clipTypes.includes(clipType))
  );
}

/** Get all Out presets filtered by clip type */
export function getOutPresets(clipType?: string): PresetCategory[] {
  return OUT_PRESET_CATEGORIES.filter(
    (cat) => !cat.clipTypes || (clipType && cat.clipTypes.includes(clipType))
  );
}

/** Flat list of all unique preset values (for the custom tab) */
export function getAllPresetValues(clipType?: string): PresetEntry[] {
  const seen = new Set<string>();
  const result: PresetEntry[] = [];
  const cats = [...getInPresets(clipType), ...getOutPresets(clipType)];
  for (const cat of cats) {
    for (const p of cat.presets) {
      if (!seen.has(p.value)) {
        seen.add(p.value);
        result.push(p);
      }
    }
  }
  // Add combo presets
  for (const p of COMBO_PRESETS) {
    if (!seen.has(p.value)) {
      seen.add(p.value);
      result.push(p);
    }
  }
  return result;
}
