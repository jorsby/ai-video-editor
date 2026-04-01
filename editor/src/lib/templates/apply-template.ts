import type { Studio } from 'openvideo';
import { Image, Text, Audio, Transition } from 'openvideo';
import type { TransitionKey } from 'openvideo';
import type { TemplateConfig } from './types';
import type { Scene } from '@/lib/supabase/workflow-service';

const DEFAULT_SCENE_DURATION = 5e6; // 5 seconds in microseconds

interface ApplyTemplateOptions {
  /** Language code to pick the right voiceover */
  language?: string;
}

/**
 * Apply a template to scenes, creating Image + Text + Audio + Transition clips on the timeline.
 */
export async function applyTemplate(
  template: TemplateConfig,
  scenes: Scene[],
  studio: Studio,
  canvasSize: { width: number; height: number },
  options: ApplyTemplateOptions = {}
): Promise<void> {
  const { language } = options;
  const sorted = [...scenes].sort((a, b) => a.order - b.order);

  let runningEnd = 0;
  let imageTrackId: string | undefined;
  let textTrackId: string | undefined;
  let audioTrackId: string | undefined;
  let prevImageClipId: string | undefined;

  for (let i = 0; i < sorted.length; i++) {
    const scene = sorted[i];

    // --- 1. Find image URL (first_frame or fallback) ---
    const imageUrl = getSceneImageUrl(scene);
    if (!imageUrl) continue;

    // --- 2. Scene duration ---
    let sceneDurationUs: number;
    if (scene.audio_duration) {
      sceneDurationUs = scene.audio_duration * 1e6; // seconds → microseconds
    } else if (scene.duration) {
      sceneDurationUs = scene.duration * 1e6;
    } else {
      sceneDurationUs = DEFAULT_SCENE_DURATION;
    }

    // --- 4. Create image clip ---
    const imageClip = await Image.fromUrl(imageUrl);
    await imageClip.ready;

    // Scale image to cover the canvas
    scaleImageToCanvas(imageClip, canvasSize, template.scene.image.fit);

    imageClip.display.from = runningEnd;
    imageClip.display.to = runningEnd + sceneDurationUs;
    imageClip.duration = sceneDurationUs;

    // Apply Ken Burns / animation
    applyImageAnimation(
      imageClip,
      template.scene.image.animation,
      template.scene.image.animationIntensity,
      sceneDurationUs,
      canvasSize
    );

    await studio.addClip(imageClip, { trackId: imageTrackId });
    if (!imageTrackId) {
      const track = studio.tracks.find(
        (t) => t.type === 'Image' && t.clipIds.includes(imageClip.id)
      );
      imageTrackId = track?.id;
    }

    // --- 5. Add transition between scenes ---
    if (i > 0 && prevImageClipId && template.transition.duration > 0) {
      const transitionDurationUs = template.transition.duration * 1e6;
      const transClip = new Transition(
        template.transition.type as TransitionKey
      );
      transClip.duration = transitionDurationUs;
      transClip.display.from = runningEnd - transitionDurationUs;
      transClip.display.to = runningEnd;
      transClip.fromClipId = prevImageClipId;
      transClip.toClipId = imageClip.id;

      await studio.addClip(transClip);
    }

    prevImageClipId = imageClip.id;

    // --- 6. Create text overlay ---
    if (template.scene.text.enabled) {
      const textContent = getSceneText(scene, language);
      if (textContent) {
        const ts = template.scene.text.style;
        const wrapWidthPx = (ts.wordWrapWidth / 100) * canvasSize.width;

        const textClip = new Text(textContent, {
          fontSize: ts.fontSize,
          fontFamily: ts.fontFamily,
          fontWeight: ts.fontWeight,
          fill: ts.fill,
          stroke: ts.stroke
            ? { color: ts.stroke.color, width: ts.stroke.width }
            : undefined,
          dropShadow: ts.dropShadow,
          align: ts.align,
          wordWrap: ts.wordWrap,
          wordWrapWidth: wrapWidthPx,
          lineHeight: ts.lineHeight,
          letterSpacing: ts.letterSpacing,
          textCase: ts.textCase,
        });
        await textClip.ready;

        const textDelayUs = template.scene.timing.textDelay * 1e6;
        const textFadeOutUs = template.scene.timing.textFadeOut * 1e6;
        const textStart = runningEnd + textDelayUs;
        const textEnd = runningEnd + sceneDurationUs - textFadeOutUs;

        textClip.display.from = textStart;
        textClip.display.to = Math.max(textEnd, textStart + 1e6); // at least 1s
        textClip.duration = textClip.display.to - textClip.display.from;

        // Position text
        positionText(textClip, template.scene.text, canvasSize);

        await studio.addClip(textClip, { trackId: textTrackId });
        if (!textTrackId) {
          const track = studio.tracks.find(
            (t) => t.type === 'Text' && t.clipIds.includes(textClip.id)
          );
          textTrackId = track?.id;
        }
      }
    }

    // --- 7. Add audio ---
    if (scene.audio_url) {
      const audioClip = await Audio.fromUrl(scene.audio_url);
      audioClip.display.from = runningEnd;
      audioClip.display.to = runningEnd + audioClip.duration;

      await studio.addClip(audioClip, {
        trackId: audioTrackId,
        audioSource: scene.audio_url,
      });
      if (!audioTrackId) {
        const track = studio.tracks.find(
          (t) => t.type === 'Audio' && t.clipIds.includes(audioClip.id)
        );
        audioTrackId = track?.id;
      }
    }

    runningEnd += sceneDurationUs;
  }
}

// --- Helpers ---

function getSceneImageUrl(scene: Scene): string | null {
  // Use video_url as the primary source (video still/thumbnail)
  if (scene.video_url) return scene.video_url;
  return null;
}

function getSceneText(scene: Scene, _language?: string): string | null {
  return scene.audio_text || null;
}

function scaleImageToCanvas(
  clip: InstanceType<typeof Image>,
  canvasSize: { width: number; height: number },
  fit: 'cover' | 'contain' | 'fill'
) {
  const meta = clip.meta;
  const imgW = meta.width || clip.width;
  const imgH = meta.height || clip.height;
  if (imgW === 0 || imgH === 0) return;

  if (fit === 'fill') {
    clip.width = canvasSize.width;
    clip.height = canvasSize.height;
    clip.left = 0;
    clip.top = 0;
    return;
  }

  const scaleX = canvasSize.width / imgW;
  const scaleY = canvasSize.height / imgH;
  const scale =
    fit === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);

  clip.width = Math.round(imgW * scale);
  clip.height = Math.round(imgH * scale);
  clip.left = Math.round((canvasSize.width - clip.width) / 2);
  clip.top = Math.round((canvasSize.height - clip.height) / 2);
}

function positionText(
  clip: InstanceType<typeof Text>,
  textConfig: TemplateConfig['scene']['text'],
  canvasSize: { width: number; height: number }
) {
  const pad = textConfig.padding;

  switch (textConfig.position) {
    case 'bottom-third':
      clip.left = pad.left;
      clip.top = canvasSize.height - canvasSize.height / 3 + pad.top;
      break;
    case 'top-third':
      clip.left = pad.left;
      clip.top = pad.top;
      break;
    case 'center':
      clip.left = Math.round((canvasSize.width - clip.width) / 2);
      clip.top = Math.round((canvasSize.height - clip.height) / 2);
      break;
    case 'lower-left':
      clip.left = pad.left;
      clip.top = canvasSize.height - clip.height - pad.bottom;
      break;
    case 'full-screen':
      clip.left = pad.left;
      clip.top = pad.top;
      break;
  }
}

function applyImageAnimation(
  clip: InstanceType<typeof Image>,
  animation: TemplateConfig['scene']['image']['animation'],
  intensity: number,
  durationUs: number,
  _canvasSize: { width: number; height: number }
) {
  if (animation === 'none') return;

  const s = 1 + intensity * 0.15; // scale factor, e.g. 1.045 for 0.3 intensity

  switch (animation) {
    case 'ken-burns-in':
      clip.setAnimation(
        { '0%': { scale: 1 }, '100%': { scale: s } },
        { duration: durationUs, iterCount: 1 }
      );
      break;
    case 'ken-burns-out':
      clip.setAnimation(
        { '0%': { scale: s }, '100%': { scale: 1 } },
        { duration: durationUs, iterCount: 1 }
      );
      break;
    case 'pan-left':
      clip.setAnimation(
        { '0%': { x: 0 }, '100%': { x: -intensity * 100 } },
        { duration: durationUs, iterCount: 1 }
      );
      break;
    case 'pan-right':
      clip.setAnimation(
        { '0%': { x: 0 }, '100%': { x: intensity * 100 } },
        { duration: durationUs, iterCount: 1 }
      );
      break;
    case 'zoom-pulse':
      clip.setAnimation(
        {
          '0%': { scale: 1 },
          '50%': { scale: s },
          '100%': { scale: 1 },
        },
        { duration: durationUs, iterCount: 1 }
      );
      break;
  }
}
