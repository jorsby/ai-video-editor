export const STORYBOARD_CONTENT_TEMPLATE_OPTIONS = [
  {
    value: 'ahlak',
    label: 'Ahlak',
    description:
      'Ethics/moral storytelling with values-driven character arcs and grounded social lessons.',
  },
  {
    value: 'dizi_hikaye',
    label: 'Dizi / Hikâye',
    description:
      'Video-style narrative storytelling with plot progression, dramatic turns, and chapter-like pacing.',
  },
] as const;

export type StoryboardContentTemplate =
  (typeof STORYBOARD_CONTENT_TEMPLATE_OPTIONS)[number]['value'];

export const DEFAULT_STORYBOARD_CONTENT_TEMPLATE: StoryboardContentTemplate =
  'ahlak';

export function isStoryboardContentTemplate(
  value: unknown
): value is StoryboardContentTemplate {
  return STORYBOARD_CONTENT_TEMPLATE_OPTIONS.some(
    (option) => option.value === value
  );
}

export function getStoryboardTemplateInstruction(
  template: StoryboardContentTemplate
): string {
  if (template === 'dizi_hikaye') {
    return `
TEMPLATE STYLE: Dizi / Hikâye (Video Storytelling)
- Build scenes like a coherent episodic narrative: setup → tension → progression → payoff.
- Keep characters emotionally consistent across scenes and show clear cause/effect between beats.
- Prefer cinematic storytelling over didactic messaging.
- Use strong visual continuity and recurring motifs between scenes.
- Avoid generic motivational/corporate marketing tone.
- Keep narration and visuals specific to the chosen storyline and audience intent.`.trim();
  }

  return `
TEMPLATE STYLE: Ahlak (Ethics / Moral Story)
- Keep a values-driven arc grounded in daily life, empathy, and social responsibility.
- Emphasize clear moral causality and character learning moments.
- Favor culturally grounded, respectful realism over abstract motivational slogans.
- Use practical, relatable environments and emotionally readable character actions.
- Keep outputs specific and story-like; avoid generic marketing language.`.trim();
}

export function applyStoryboardTemplateToSystemPrompt(
  baseSystemPrompt: string,
  template: StoryboardContentTemplate
): string {
  return `${baseSystemPrompt}\n\n${getStoryboardTemplateInstruction(template)}`;
}
