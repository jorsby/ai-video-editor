'use client';

import { useEffect, useState } from 'react';
import { type VariantImageMap, slugToLabel } from '../../shared/scene-types';
import { IconX } from '@tabler/icons-react';

// ── Image Lightbox ─────────────────────────────────────────────────────────────

export function ImageLightbox({
  url,
  label,
  onClose,
}: {
  url: string;
  label: string;
  onClose: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={() => {}}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 size-7 rounded-full bg-black/60 border border-white/20 flex items-center justify-center hover:bg-black/80 transition-colors"
        >
          <IconX className="size-4 text-white" />
        </button>
        <img
          src={url}
          alt={label}
          className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl"
        />
        <span className="text-sm text-white/80 font-medium">{label}</span>
      </div>
    </div>
  );
}

// ── Video Lightbox ────────────────────────────────────────────────────────────

export function VideoLightbox({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={() => {}}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-3 -right-3 z-10 size-7 rounded-full bg-black/70 border border-white/20 flex items-center justify-center hover:bg-black/90 transition-colors"
        >
          <IconX className="size-3.5 text-white" />
        </button>
        {/* biome-ignore lint/a11y/useMediaCaption: lightbox video player */}
        <video
          src={url}
          controls
          autoPlay
          className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl"
        />
      </div>
    </div>
  );
}

// ── Variant Avatar ─────────────────────────────────────────────────────────────

export function VariantAvatar({
  slug,
  imageMap,
  size = 'sm',
}: {
  slug: string;
  imageMap: VariantImageMap;
  size?: 'sm' | 'md';
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const info = imageMap.get(slug);
  const url = info?.image_url;
  const px = size === 'md' ? 'size-7' : 'size-4';

  if (!url) {
    return (
      <div
        className={`${px} rounded-full bg-muted/40 border border-border/30 flex items-center justify-center shrink-0`}
        title={slugToLabel(slug)}
      >
        <span className="text-[6px] text-muted-foreground">?</span>
      </div>
    );
  }

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          setLightboxOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            setLightboxOpen(true);
          }
        }}
        className={`${px} rounded-full overflow-hidden border border-border/40 shrink-0 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all`}
        title={`Click to expand: ${slugToLabel(slug)}`}
      >
        <img
          src={url}
          alt={slugToLabel(slug)}
          className="w-full h-full object-cover"
        />
      </div>
      {lightboxOpen && (
        <ImageLightbox
          url={url}
          label={slugToLabel(slug)}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
