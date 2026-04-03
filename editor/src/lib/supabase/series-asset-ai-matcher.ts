import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { ProjectAssetCandidate } from './project-asset-resolver';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const ASSET_MATCH_MODEL = process.env.ASSET_MATCH_MODEL || 'openai/gpt-5.2-pro';

export type AssetMatchItem = {
  gridPosition: number;
  name: string;
  description?: string | null;
  sceneUsage: Array<{
    sceneIndex: number;
    prompt: string;
  }>;
};

export type AssetMatchDecision = {
  matched: boolean;
  candidate?: ProjectAssetCandidate;
  confidence: number;
  reason: string;
  strategy: 'ai' | 'none';
};

const aiMatchSchema = z.object({
  matches: z.array(
    z.object({
      gridPosition: z.number().int().min(0),
      candidateKey: z.string().nullable(),
      confidence: z.number().min(0).max(1),
      reason: z.string().min(1).max(400),
    })
  ),
});

const TOKEN_ALIAS_GROUPS: string[][] = [
  ['mekke', 'mecca', 'makkah'],
  ['medine', 'medina', 'madinah'],
  ['sevr', 'thawr'],
  ['kuba', 'quba'],
  ['deve', 'camel'],
  ['at', 'horse'],
  ['magara', 'cave'],
  ['cadir', 'tent'],
  ['yol', 'route', 'road', 'path'],
  ['kilic', 'sword'],
  ['parsomen', 'scroll'],
  ['hz', 'hazrat'],
  ['ebu', 'abu'],
  ['mabed', "ma'bed", 'mabad'],
];

const TOKEN_ALIAS_INDEX = new Map<string, string[]>();
for (const group of TOKEN_ALIAS_GROUPS) {
  const normalizedGroup = group.map((token) => normalizeAliasText(token));
  for (const token of normalizedGroup) {
    TOKEN_ALIAS_INDEX.set(
      token,
      normalizedGroup.filter((entry) => entry !== token)
    );
  }
}

function normalizeAliasText(text: string): string {
  return text
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, '')
    .replace(/[/(].*/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitAliasSegments(text: string): string[] {
  const segments = new Set<string>();
  const trimmed = text.trim();
  if (trimmed.length > 0) segments.add(trimmed);

  for (const slashPart of trimmed.split('/')) {
    const normalized = slashPart.trim();
    if (normalized.length > 0) segments.add(normalized);
  }

  const parenMatches = trimmed.matchAll(/\(([^)]+)\)/g);
  for (const match of parenMatches) {
    const value = match[1]?.trim();
    if (value) segments.add(value);
  }

  return Array.from(segments);
}

function buildAliasVariants(value: string | null | undefined): string[] {
  if (!value || value.trim().length === 0) return [];

  const aliasSet = new Set<string>();

  for (const segment of splitAliasSegments(value)) {
    const base = normalizeAliasText(segment);
    if (!base) continue;

    aliasSet.add(base);

    const tokens = base.split(' ').filter(Boolean);
    for (let index = 0; index < tokens.length; index++) {
      const aliases = TOKEN_ALIAS_INDEX.get(tokens[index]);
      if (!aliases || aliases.length === 0) continue;

      for (const alias of aliases) {
        const replaced = [...tokens];
        replaced[index] = alias;
        aliasSet.add(replaced.join(' '));
      }
    }
  }

  return Array.from(aliasSet).slice(0, 12);
}

function buildEntityAliases(params: {
  name: string;
  description?: string | null;
}): string[] {
  const aliases = new Set<string>();

  for (const item of buildAliasVariants(params.name)) {
    aliases.add(item);
  }

  for (const item of buildAliasVariants(params.description ?? null)) {
    aliases.add(item);
  }

  return Array.from(aliases).slice(0, 14);
}

function buildSceneUsageText(item: AssetMatchItem) {
  return item.sceneUsage
    .slice(0, 6)
    .map((usage) => `Scene ${usage.sceneIndex + 1}: ${usage.prompt}`)
    .join('\n');
}

export async function matchAssetsWithAI(params: {
  itemType: 'object' | 'background';
  items: AssetMatchItem[];
  candidates: ProjectAssetCandidate[];
  minConfidence?: number;
}): Promise<Map<number, AssetMatchDecision>> {
  const { itemType, items, candidates, minConfidence = 0.72 } = params;

  const result = new Map<number, AssetMatchDecision>();

  for (const item of items) {
    result.set(item.gridPosition, {
      matched: false,
      confidence: 0,
      reason: 'No match candidate selected.',
      strategy: 'none',
    });
  }

  if (!process.env.OPENROUTER_API_KEY || items.length === 0) {
    return result;
  }

  if (candidates.length === 0) {
    for (const item of items) {
      result.set(item.gridPosition, {
        matched: false,
        confidence: 0,
        reason: 'No reusable series assets found for this type.',
        strategy: 'none',
      });
    }
    return result;
  }

  const limitedCandidates = candidates.slice(0, 80);

  const candidatePayload = limitedCandidates.map((candidate, index) => ({
    candidateKey: `C${index + 1}`,
    variantId: candidate.variantId,
    assetId: candidate.assetId,
    name: candidate.assetName,
    description: candidate.description,
    aliases: buildEntityAliases({
      name: candidate.assetName,
      description: candidate.description,
    }),
    imageUrl: candidate.url,
    type: candidate.type,
  }));

  const candidateByKey = new Map(
    candidatePayload.map((candidate, index) => [
      candidate.candidateKey,
      limitedCandidates[index],
    ])
  );

  const itemPayload = items.map((item) => ({
    gridPosition: item.gridPosition,
    name: item.name,
    description: item.description ?? null,
    aliases: buildEntityAliases({
      name: item.name,
      description: item.description,
    }),
    sceneUsage: buildSceneUsageText(item),
  }));

  const system = `You are an asset retrieval engine for AI video production.
Match requested ${itemType}s to existing series assets.

Hard rules:
- Prefer semantic relevance from name + description + aliases + scene usage context.
- Treat Turkish/English transliterations and aliases as equivalent (e.g. Mekke/Mecca, Medine/Medina, Sevr/Thawr, Ümmü Ma'bed/Umm Mabad).
- Use candidate imageUrl only as a weak hint from metadata (do not hallucinate visual details).
- If no candidate is clearly correct, return candidateKey=null.
- Confidence should reflect trustworthiness:
  - >=0.85: highly reliable
  - 0.70-0.84: plausible but uncertain
  - <0.70: weak
- Never invent candidate keys. Use only provided candidateKey values.

Return strict JSON.`;

  const prompt = `Requested ${itemType}s:\n${JSON.stringify(itemPayload, null, 2)}\n\nCandidate series assets:\n${JSON.stringify(candidatePayload, null, 2)}\n\nReturn matches[] where each entry has:
- gridPosition
- candidateKey (or null)
- confidence (0..1)
- reason (short, concrete)`;

  try {
    const primary = await generateObject({
      model: openrouter.chat(ASSET_MATCH_MODEL, {
        plugins: [{ id: 'response-healing' }],
      }),
      schema: aiMatchSchema,
      system,
      prompt,
      maxOutputTokens: 4096,
    });

    for (const match of primary.object.matches) {
      const item = items.find(
        (entry) => entry.gridPosition === match.gridPosition
      );
      if (!item) continue;

      const candidate =
        match.candidateKey && candidateByKey.get(match.candidateKey)
          ? candidateByKey.get(match.candidateKey)
          : undefined;

      const accepted = !!candidate && match.confidence >= minConfidence;

      result.set(item.gridPosition, {
        matched: accepted,
        candidate: accepted ? candidate : undefined,
        confidence: match.confidence,
        reason: match.reason,
        strategy: 'ai',
      });
    }

    return result;
  } catch (primaryError) {
    const message =
      primaryError instanceof Error
        ? primaryError.message
        : String(primaryError);

    console.warn('[series-asset-ai-matcher] AI match request failed:', message);

    for (const item of items) {
      result.set(item.gridPosition, {
        matched: false,
        confidence: 0,
        reason: `AI matcher unavailable: ${message}`.slice(0, 380),
        strategy: 'none',
      });
    }

    return result;
  }
}
