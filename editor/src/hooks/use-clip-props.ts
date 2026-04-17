import { useState, useEffect } from 'react';
import type { IClip } from 'openvideo';

/**
 * Subscribes to a clip's propsChange event and triggers a re-render
 * whenever clip properties are updated (position, size, style, etc.).
 *
 * Usage: call useClipProps(clip) at the top of any component that reads
 * mutable clip properties. No return value — it simply forces the
 * component to re-render when the clip emits propsChange.
 */
export function useClipProps(clip: IClip | null | undefined): void {
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!clip) return;

    const bump = () => setVersion((v) => v + 1);

    const events = ['propsChange', 'moving', 'scaling', 'rotating'] as const;
    for (const ev of events) {
      (clip as any).on?.(ev, bump);
    }
    return () => {
      for (const ev of events) {
        (clip as any).off?.(ev, bump);
      }
    };
  }, [clip]);
}
