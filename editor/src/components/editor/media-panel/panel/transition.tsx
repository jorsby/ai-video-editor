import { useState, useCallback } from 'react';
import { GL_TRANSITION_OPTIONS } from 'openvideo';
import type { Studio } from 'openvideo';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useStudioStore } from '@/stores/studio-store';
import { toast } from 'sonner';

const TRANSITION_DURATION_DEFAULT = 2_000_000;

function findClipPairsWithoutTransitions(
  studio: Studio
): Array<{ fromClipId: string; toClipId: string }> {
  const pairs: Array<{ fromClipId: string; toClipId: string }> = [];
  const allClips = studio.clips;

  // Collect existing transition pairs for quick lookup
  const existingTransitions = new Set<string>();
  for (const clip of allClips) {
    if (clip.type === 'Transition') {
      const tc = clip as any;
      if (tc.fromClipId && tc.toClipId) {
        existingTransitions.add(`${tc.fromClipId}_${tc.toClipId}`);
      }
    }
  }

  for (const track of studio.tracks) {
    // Get media clips on this track, sorted by position
    const mediaClips = track.clipIds
      .map((id) => allClips.find((c) => c.id === id))
      .filter(
        (c): c is NonNullable<typeof c> =>
          c != null && (c.type === 'Video' || c.type === 'Image')
      )
      .sort((a, b) => a.display.from - b.display.from);

    for (let i = 0; i < mediaClips.length - 1; i++) {
      const clipA = mediaClips[i];
      const clipB = mediaClips[i + 1];
      const key = `${clipA.id}_${clipB.id}`;

      if (!existingTransitions.has(key)) {
        pairs.push({ fromClipId: clipA.id, toClipId: clipB.id });
      }
    }
  }

  return pairs;
}

const PanelTransition = () => {
  const {
    studio,
    selectedTransitionKeys,
    toggleTransitionKey,
    clearTransitionKeys,
    pendingTransitionClipIds,
  } = useStudioStore();

  const [hovered, setHovered] = useState<Record<string, boolean>>({});
  const [isApplying, setIsApplying] = useState(false);

  const handleCardClick = useCallback(
    async (effectKey: string) => {
      // Read pending directly from store at click time (not from closure)
      const pending = useStudioStore.getState().pendingTransitionClipIds;
      if (pending && studio) {
        await studio.addTransition(
          effectKey,
          TRANSITION_DURATION_DEFAULT,
          pending.fromClipId,
          pending.toClipId
        );
        useStudioStore.getState().setPendingTransitionClipIds(null);
        return;
      }

      toggleTransitionKey(effectKey);
    },
    [studio, toggleTransitionKey]
  );

  const handleApplyToAll = useCallback(async () => {
    if (!studio || selectedTransitionKeys.length === 0) return;

    setIsApplying(true);
    try {
      const pairs = findClipPairsWithoutTransitions(studio);

      if (pairs.length === 0) {
        toast.info('All adjacent clips already have transitions');
        return;
      }

      for (const pair of pairs) {
        const key =
          selectedTransitionKeys[
            Math.floor(Math.random() * selectedTransitionKeys.length)
          ];
        await studio.addTransition(
          key,
          TRANSITION_DURATION_DEFAULT,
          pair.fromClipId,
          pair.toClipId
        );
      }

      toast.success(
        `Applied transitions to ${pairs.length} clip ${pairs.length === 1 ? 'pair' : 'pairs'}`
      );
      clearTransitionKeys();
    } catch (error) {
      console.error('Failed to apply transitions:', error);
      toast.error('Failed to apply transitions');
    } finally {
      setIsApplying(false);
    }
  }, [studio, selectedTransitionKeys, clearTransitionKeys]);

  const selectionCount = selectedTransitionKeys.length;

  return (
    <div className="py-4 h-full flex flex-col">
      {selectionCount > 0 && !pendingTransitionClipIds && (
        <div className="px-4 pb-3 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {selectionCount} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={clearTransitionKeys}>
              Clear
            </Button>
            <Button size="sm" onClick={handleApplyToAll} disabled={isApplying}>
              {isApplying ? 'Applying...' : 'Apply to All'}
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="h-full px-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2.5 justify-items-center">
          {GL_TRANSITION_OPTIONS.map((effect) => {
            const isHovered = hovered[effect.key];
            const isSelected = selectedTransitionKeys.includes(effect.key);

            return (
              <div
                key={effect.key}
                className="flex w-full items-center gap-2 flex-col group cursor-pointer"
                onMouseEnter={() =>
                  setHovered((prev) => ({ ...prev, [effect.key]: true }))
                }
                onMouseLeave={() =>
                  setHovered((prev) => ({ ...prev, [effect.key]: false }))
                }
                onClick={() => handleCardClick(effect.key)}
              >
                <div
                  className={`relative w-full aspect-video rounded-md bg-input/30 border overflow-hidden ${
                    isSelected
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : ''
                  }`}
                >
                  <img
                    src={effect.previewStatic}
                    alt={effect.label}
                    loading="lazy"
                    className="
                      absolute inset-0 w-full h-full object-cover rounded-sm
                      transition-opacity duration-150
                      opacity-100 group-hover:opacity-0
                    "
                  />

                  {isHovered && (
                    <img
                      src={effect.previewDynamic}
                      alt={effect.label}
                      className="
                        absolute inset-0 w-full h-full object-cover rounded-sm
                        transition-opacity duration-150
                        opacity-0 group-hover:opacity-100
                      "
                    />
                  )}
                  <div className="absolute bottom-0 left-0 w-full p-2 bg-gradient-to-t from-black/80 to-transparent text-white text-xs font-medium truncate text-center transition-opacity duration-150 group-hover:opacity-0">
                    {effect.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};

export default PanelTransition;
