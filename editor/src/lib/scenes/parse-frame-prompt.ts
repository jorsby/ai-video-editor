const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type FramePromptBase =
  | { kind: 'background_slug'; slug: string }
  | { kind: 'use_first_frame' };

export interface ParsedFramePrompt {
  base: FramePromptBase;
  refs: string[];
  edit: string;
}

function extractDirective(
  text: string,
  name: 'BASE' | 'REFS' | 'EDIT'
): string | null {
  if (name === 'EDIT') {
    const match = text.match(/^\s*EDIT:\s*([\s\S]*)$/im);
    return match ? match[1].trim() : null;
  }

  const match = text.match(new RegExp(`^\\s*${name}:\\s*(.*)$`, 'im'));
  return match ? match[1].trim() : null;
}

function parseTaggedSlug(raw: string, fieldName: string): string {
  const token = raw.trim();
  if (!token.startsWith('@')) {
    throw new Error(`${fieldName} must use @slug format.`);
  }

  const slug = token.slice(1).trim().toLowerCase();
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`${fieldName} contains invalid slug "${token}".`);
  }

  return slug;
}

export function parseFramePrompt(text: string): ParsedFramePrompt {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) {
    throw new Error('Frame prompt is required.');
  }

  const baseRaw = extractDirective(normalized, 'BASE');
  const refsRaw = extractDirective(normalized, 'REFS');
  const edit = extractDirective(normalized, 'EDIT');

  if (!baseRaw) {
    throw new Error('Missing BASE: directive.');
  }
  if (refsRaw === null) {
    throw new Error('Missing REFS: directive.');
  }
  if (!edit) {
    throw new Error('Missing EDIT: directive or edit text.');
  }

  const baseToken = baseRaw.trim().toLowerCase();
  const base: FramePromptBase =
    baseToken === 'use_first_frame'
      ? { kind: 'use_first_frame' }
      : {
          kind: 'background_slug',
          slug: parseTaggedSlug(baseRaw, 'BASE'),
        };

  const refs: string[] = [];
  const seen = new Set<string>();

  if (refsRaw.trim().length > 0) {
    for (const token of refsRaw.split(',')) {
      const slug = parseTaggedSlug(token, 'REFS');
      if (!seen.has(slug)) {
        seen.add(slug);
        refs.push(slug);
      }
    }
  }

  return { base, refs, edit };
}
