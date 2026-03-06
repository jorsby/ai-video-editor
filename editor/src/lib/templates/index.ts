import type { TemplateConfig } from './types';
import { documentary } from './presets/documentary';
import { boldImpact } from './presets/bold-impact';
import { minimal } from './presets/minimal';

export type { TemplateConfig } from './types';

export const TEMPLATE_REGISTRY: Record<string, TemplateConfig> = {
  documentary,
  'bold-impact': boldImpact,
  minimal,
};

export const TEMPLATE_LIST: TemplateConfig[] = Object.values(TEMPLATE_REGISTRY);

export function getTemplate(id: string): TemplateConfig | undefined {
  return TEMPLATE_REGISTRY[id];
}
