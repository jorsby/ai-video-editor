import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { SeriesAssetCandidate } from './series-asset-resolver';

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
  candidate?: SeriesAssetCandidate;
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

function buildSceneUsageText(item: AssetMatchItem) {
  return item.sceneUsage
    .slice(0, 6)
    .map((usage) => `Scene ${usage.sceneIndex + 1}: ${usage.prompt}`)
    .join('\n');
}

export async function matchAssetsWithAI(params: {
  itemType: 'object' | 'background';
  items: AssetMatchItem[];
  candidates: SeriesAssetCandidate[];
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
    sceneUsage: buildSceneUsageText(item),
  }));

  const system = `You are an asset retrieval engine for AI video production.
Match requested ${itemType}s to existing series assets.

Hard rules:
- Prefer semantic relevance from name + description + scene usage context.
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
