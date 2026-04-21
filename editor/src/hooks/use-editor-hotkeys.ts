import { useEffect } from 'react';
import hotkeys from 'hotkeys-js';
import { clipToJSON, jsonToClip } from 'openvideo';
import { useTimelineStore } from '@/stores/timeline-store';
import { usePlaybackStore } from '@/stores/playback-store';
import { useStudioStore } from '@/stores/studio-store';
import {
  useClipboardStore,
  type ClipboardEntry,
} from '@/stores/clipboard-store';
import type { TimelineCanvas } from '@/components/editor/timeline/timeline';

interface UseEditorHotkeysProps {
  timelineCanvas: TimelineCanvas | null;
  setZoomLevel?: (zoomLevel: number | ((prev: number) => number)) => void;
}

export function useEditorHotkeys({
  timelineCanvas,
  setZoomLevel,
}: UseEditorHotkeysProps) {
  const { isPlaying, toggle, currentTime, duration, seek } = usePlaybackStore();
  const { studio } = useStudioStore();

  useEffect(() => {
    // Play/Pause
    hotkeys('space', (event, _handler) => {
      event.preventDefault();
      toggle();
    });

    // Split
    hotkeys('command+b, ctrl+b', (event, _handler) => {
      event.preventDefault();
      if (studio) {
        // Studio expects microseconds
        const splitTime = currentTime * 1_000_000;
        studio.splitSelected(splitTime);
      }
    });

    // Delete
    hotkeys('backspace, delete', (_event, _handler) => {
      // Check if active element is input
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (studio) {
        studio.deleteSelected();
      }
    });

    // Select All
    hotkeys('command+a, ctrl+a', (event, _handler) => {
      event.preventDefault();
      const { clips } = useTimelineStore.getState();
      if (timelineCanvas) {
        timelineCanvas.selectClips(Object.keys(clips));
      }
    });

    // Copy selected clips into the in-app clipboard
    hotkeys('command+c, ctrl+c', (event) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      if (!studio) return;

      const selected = Array.from(studio.selection.selectedClips);
      if (selected.length === 0) return;

      event.preventDefault();

      const entries: ClipboardEntry[] = [];
      for (const clip of selected) {
        const sourceTrackId = studio.timeline.findTrackIdByClipId(clip.id);
        if (!sourceTrackId) continue;
        entries.push({
          json: clipToJSON(clip, false),
          sourceTrackId,
          displayFrom: clip.display.from,
          duration: clip.duration,
        });
      }

      useClipboardStore.getState().setEntries(entries);
    });

    // Paste clips from the in-app clipboard
    hotkeys('command+v, ctrl+v', (event) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      if (!studio) return;

      const entries = useClipboardStore.getState().entries;
      if (entries.length === 0) return;

      event.preventDefault();

      void (async () => {
        const anchor = studio.currentTime;
        const baseFrom = entries.reduce(
          (min, e) => Math.min(min, e.displayFrom),
          Number.POSITIVE_INFINITY
        );

        const tracks = studio.timeline.tracks;
        const newClipIds: string[] = [];

        for (const entry of entries) {
          const newClip = await jsonToClip(entry.json);
          newClip.id = `clip_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;

          const newDisplayFrom = anchor + (entry.displayFrom - baseFrom);
          newClip.display = {
            from: newDisplayFrom,
            to: newDisplayFrom + entry.duration,
          };

          const sourceTrack = tracks.find((t) => t.id === entry.sourceTrackId);
          let targetTrackId: string | undefined;

          if (sourceTrack) {
            const newEnd = newDisplayFrom + entry.duration;
            const hasOverlap = sourceTrack.clipIds.some((otherId) => {
              const other = studio.timeline.getClipById(otherId);
              if (!other) return false;
              const otherStart = Math.round(other.display.from);
              const otherEnd = Math.round(other.display.to);
              return newDisplayFrom < otherEnd && newEnd > otherStart;
            });
            if (!hasOverlap) targetTrackId = sourceTrack.id;
          }

          if (!targetTrackId) {
            const type = sourceTrack?.type ?? newClip.type;
            const created = studio.timeline.addTrack({
              name: `${type} Track`,
              type,
            });
            targetTrackId = created.id;
          }

          await studio.timeline.addClip(newClip, { trackId: targetTrackId });
          newClipIds.push(newClip.id);
        }

        if (newClipIds.length > 0) {
          studio.selection.selectClipsByIds(newClipIds);
        }
      })();
    });

    // Duplicate (matches the toolbar tooltip)
    hotkeys('command+d, ctrl+d', (event) => {
      event.preventDefault();
      studio?.duplicateSelected();
    });

    // Lock / Unlock selection (matches the toolbar tooltip)
    hotkeys('command+l, ctrl+l', (event) => {
      event.preventDefault();
      if (!studio) return;
      const selected = Array.from(studio.selection.selectedClips);
      if (selected.length === 0) return;
      const newLocked = !selected.every((c) => c.locked === true);
      for (const clip of selected) studio.lockClip(clip.id, newLocked);
    });

    // Seek to start / end
    hotkeys('home', (event) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      event.preventDefault();
      seek(0);
    });

    hotkeys('end', (event) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      event.preventDefault();
      seek(duration);
    });

    // Zoom In
    hotkeys('command+=, ctrl+=', (event) => {
      event.preventDefault();
      setZoomLevel?.((prev) => Math.min(10, prev + 0.15));
    });

    // Zoom Out
    hotkeys('command+-, ctrl+-', (event) => {
      event.preventDefault();
      setZoomLevel?.((prev) => Math.max(0.1, prev - 0.15));
    });

    // Undo
    hotkeys('command+z, ctrl+z', (event) => {
      event.preventDefault();
      studio?.undo();
    });

    // Redo
    hotkeys('command+shift+z, ctrl+shift+z, command+y, ctrl+y', (event) => {
      event.preventDefault();
      studio?.redo();
    });

    // Move Up
    hotkeys('up, shift+up', (event) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      event.preventDefault();
      const step = event.shiftKey ? 5 : 1;
      studio?.selection.move(0, -step);
    });

    // Move Down
    hotkeys('down, shift+down', (event) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      event.preventDefault();
      const step = event.shiftKey ? 5 : 1;
      studio?.selection.move(0, step);
    });

    // Move Left
    hotkeys('left, shift+left', (event) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      event.preventDefault();
      const step = event.shiftKey ? 5 : 1;
      studio?.selection.move(-step, 0);
    });

    // Move Right
    hotkeys('right, shift+right', (event) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;
      event.preventDefault();
      const step = event.shiftKey ? 5 : 1;
      studio?.selection.move(step, 0);
    });

    // Collapse Gaps
    hotkeys('command+shift+g, ctrl+shift+g', (event) => {
      event.preventDefault();
      studio?.collapseGaps();
    });

    // Last Frame
    hotkeys('command+left, ctrl+left', (event) => {
      event.preventDefault();
      studio?.framePrev();
    });

    // Next Frame
    hotkeys('command+right, ctrl+right', (event) => {
      event.preventDefault();
      studio?.frameNext();
    });

    return () => {
      hotkeys.unbind('space');
      hotkeys.unbind('command+b, ctrl+b');
      hotkeys.unbind('backspace, delete');
      hotkeys.unbind('command+a, ctrl+a');
      hotkeys.unbind('command+c, ctrl+c');
      hotkeys.unbind('command+v, ctrl+v');
      hotkeys.unbind('command+d, ctrl+d');
      hotkeys.unbind('command+l, ctrl+l');
      hotkeys.unbind('home');
      hotkeys.unbind('end');
      hotkeys.unbind('command+=, ctrl+=');
      hotkeys.unbind('command+-, ctrl+-');
      hotkeys.unbind('command+z, ctrl+z');
      hotkeys.unbind('command+shift+z, ctrl+shift+z, command+y, ctrl+y');
      hotkeys.unbind('up, shift+up');
      hotkeys.unbind('down, shift+down');
      hotkeys.unbind('left, shift+left');
      hotkeys.unbind('right, shift+right');
      hotkeys.unbind('command+shift+g, ctrl+shift+g');
      hotkeys.unbind('command+left, ctrl+left');
      hotkeys.unbind('command+right, ctrl+right');
    };
  }, [
    isPlaying,
    timelineCanvas,
    currentTime,
    duration,
    toggle,
    seek,
    setZoomLevel,
    studio,
  ]);
}
