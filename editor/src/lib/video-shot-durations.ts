type MultiShotInput = Array<{ duration?: string }> | null | undefined;

const MIN_SHOT_DURATION_SECONDS = 3;
const MAX_SHOT_DURATION_SECONDS = 15;

function parseMultiShotDurations(
  multiShots: MultiShotInput,
  shotCount: number
): number[] | null {
  if (!Array.isArray(multiShots) || multiShots.length !== shotCount) {
    return null;
  }

  const parsed = multiShots.map((shot) => {
    const value = Number(shot?.duration ?? 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  });

  return parsed.some((value) => value > 0) ? parsed : null;
}

function clampDuration(value: number): number {
  return Math.max(
    MIN_SHOT_DURATION_SECONDS,
    Math.min(MAX_SHOT_DURATION_SECONDS, Math.round(value))
  );
}

function rebalanceToTarget(
  durations: number[],
  targetTotal: number,
  minPerShot: number,
  maxPerShot: number
): number[] {
  const next = [...durations];

  let current = next.reduce((sum, value) => sum + value, 0);

  while (current < targetTotal) {
    let bestIndex = -1;
    let smallest = Number.POSITIVE_INFINITY;

    for (let index = 0; index < next.length; index++) {
      if (next[index] >= maxPerShot) continue;
      if (next[index] < smallest) {
        smallest = next[index];
        bestIndex = index;
      }
    }

    if (bestIndex === -1) break;

    next[bestIndex] += 1;
    current += 1;
  }

  while (current > targetTotal) {
    let bestIndex = -1;
    let largest = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < next.length; index++) {
      if (next[index] <= minPerShot) continue;
      if (next[index] > largest) {
        largest = next[index];
        bestIndex = index;
      }
    }

    if (bestIndex === -1) break;

    next[bestIndex] -= 1;
    current -= 1;
  }

  return next;
}

export function buildKlingMultiPromptPayload(params: {
  prompts: string[];
  targetTotalSeconds: number;
  multiShots?: MultiShotInput;
}): Array<{ prompt: string; duration: string }> {
  const normalizedPrompts = params.prompts
    .map((prompt) => prompt.trim())
    .filter((prompt) => prompt.length > 0);

  if (normalizedPrompts.length === 0) {
    return [];
  }

  const requestedTotal = Math.max(1, Math.ceil(params.targetTotalSeconds));

  // If total is too short for the number of shots, keep only the earliest shots.
  const maxShotsByTotal = Math.max(
    1,
    Math.floor(requestedTotal / MIN_SHOT_DURATION_SECONDS)
  );
  const effectivePrompts =
    normalizedPrompts.length > maxShotsByTotal
      ? normalizedPrompts.slice(0, maxShotsByTotal)
      : [...normalizedPrompts];

  // If total is too large for current shot count, duplicate the last shot so we can
  // still match the target while keeping each shot <= 15s.
  while (requestedTotal > effectivePrompts.length * MAX_SHOT_DURATION_SECONDS) {
    effectivePrompts.push(effectivePrompts[effectivePrompts.length - 1]);
  }

  const minTotal = effectivePrompts.length * MIN_SHOT_DURATION_SECONDS;
  const maxTotal = effectivePrompts.length * MAX_SHOT_DURATION_SECONDS;
  const targetTotal = Math.max(minTotal, Math.min(maxTotal, requestedTotal));

  const preferred = parseMultiShotDurations(
    params.multiShots,
    effectivePrompts.length
  );

  let durations: number[];

  if (preferred) {
    const preferredSum = preferred.reduce((sum, value) => sum + value, 0);
    durations = preferred.map((value) =>
      clampDuration((value / preferredSum) * targetTotal)
    );
    durations = rebalanceToTarget(
      durations,
      targetTotal,
      MIN_SHOT_DURATION_SECONDS,
      MAX_SHOT_DURATION_SECONDS
    );
  } else {
    const count = effectivePrompts.length;
    const base = Math.floor(targetTotal / count);
    const remainder = targetTotal - base * count;

    durations = effectivePrompts.map((_, index) =>
      clampDuration(base + (index < remainder ? 1 : 0))
    );
    durations = rebalanceToTarget(
      durations,
      targetTotal,
      MIN_SHOT_DURATION_SECONDS,
      MAX_SHOT_DURATION_SECONDS
    );
  }

  return effectivePrompts.map((prompt, index) => ({
    prompt,
    duration: String(durations[index]),
  }));
}
