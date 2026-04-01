'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowLeft,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  MapPin,
  Package,
  Users,
  Upload,
  Pencil,
  Check,
  X,
  Lock,
  RotateCcw,
  WandSparkles,
} from 'lucide-react';
import type {
  SeriesWithAssets,
  SeriesAssetType,
  SeriesAssetWithVariants,
  SeriesAssetVariantWithImages,
  SeriesEpisodeWithVariants,
} from '@/lib/supabase/series-service';
import { createClient } from '@/lib/supabase/client';

// ── Image lightbox ─────────────────────────────────────────────────────────────

type LightboxState = {
  url: string;
  alt: string;
  prompt: string;
  seriesId: string;
  assetId: string;
  variantId: string;
  isFinalized: boolean;
};

function getImagePrompt(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const meta = metadata as Record<string, unknown>;

  if (typeof meta.cell_prompt === 'string' && meta.cell_prompt.trim()) {
    return meta.cell_prompt;
  }

  if (typeof meta.prompt === 'string' && meta.prompt.trim()) {
    return meta.prompt;
  }

  return '';
}

function ImageLightbox({
  state,
  onClose,
  onDone,
}: {
  state: LightboxState;
  onClose: () => void;
  onDone: () => void;
}) {
  const [promptDraft, setPromptDraft] = useState(state.prompt || '');
  const [editInstruction, setEditInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isFinalized, setIsFinalized] = useState(state.isFinalized);

  useEffect(() => {
    setPromptDraft(state.prompt || '');
    setEditInstruction('');
    setMessage('');
    setIsFinalized(state.isFinalized);
  }, [state]);

  const callJson = async (url: string, init: RequestInit) => {
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(data?.error || `Request failed (${res.status})`);
    return data;
  };

  const handleRegenerate = async () => {
    if (isFinalized) return;
    setBusy(true);
    setMessage('');
    try {
      await callJson(
        `/api/series/${state.seriesId}/assets/${state.assetId}/variants/${state.variantId}/regenerate`,
        {
          method: 'POST',
          body: JSON.stringify({ prompt: promptDraft.trim() || undefined }),
        }
      );
      setMessage('Regeneration started. Image will update automatically.');
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Regenerate failed');
    } finally {
      setBusy(false);
    }
  };

  const handleEditImage = async () => {
    if (isFinalized) return;
    if (!editInstruction.trim()) {
      setMessage('Write an edit instruction first.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await callJson(
        `/api/series/${state.seriesId}/assets/${state.assetId}/variants/${state.variantId}/edit-image`,
        {
          method: 'POST',
          body: JSON.stringify({
            prompt: editInstruction.trim(),
            model: 'banana',
          }),
        }
      );
      setMessage('Edit started. Image will update automatically.');
      setEditInstruction('');
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Edit failed');
    } finally {
      setBusy(false);
    }
  };

  const handleFinalize = async () => {
    if (isFinalized) return;
    setBusy(true);
    setMessage('');
    try {
      await callJson(
        `/api/series/${state.seriesId}/assets/${state.assetId}/variants/${state.variantId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ is_finalized: true }),
        }
      );
      setIsFinalized(true);
      setMessage('Variant finalized and locked.');
      onDone();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Finalize update failed'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl w-[95vw] p-3 sm:p-4 bg-black/95 border-none">
        <DialogHeader className="sr-only">
          <DialogTitle>{state.alt}</DialogTitle>
          <DialogDescription>
            Inspect, regenerate, finalize, or edit this generated asset image.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {/* biome-ignore lint/a11y/useAltText: lightbox */}
          <img
            src={state.url}
            alt={state.alt}
            className="w-full h-auto max-h-[65vh] object-contain rounded"
          />

          <div className="bg-background/90 rounded p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                Generation prompt (cell)
              </p>
              <Badge variant={isFinalized ? 'secondary' : 'outline'}>
                {isFinalized ? 'Finalized (locked)' : 'Editable'}
              </Badge>
            </div>

            <Textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              placeholder="Cell prompt used to generate this image"
              className="min-h-[96px] text-xs"
              disabled={isFinalized || busy}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={handleRegenerate}
                disabled={busy || isFinalized}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" />
                Regenerate
              </Button>

              {!isFinalized && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleFinalize}
                  disabled={busy}
                >
                  <Lock className="w-3.5 h-3.5 mr-1" />
                  Finalize
                </Button>
              )}
            </div>

            <div className="pt-2 border-t border-border/50 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Edit existing image (variation via edit)
              </p>
              <Textarea
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                placeholder="e.g. Add engraved text '4A' on the key card"
                className="min-h-[72px] text-xs"
                disabled={isFinalized || busy}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={handleEditImage}
                disabled={busy || isFinalized}
              >
                <WandSparkles className="w-3.5 h-3.5 mr-1" />
                Apply Edit
              </Button>
            </div>

            {message && (
              <p className="text-xs text-muted-foreground">{message}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Asset type config ──────────────────────────────────────────────────────────

const ASSET_TYPES: {
  type: SeriesAssetType;
  label: string;
  icon: React.ElementType;
}[] = [
  { type: 'character', label: 'Characters', icon: Users },
  { type: 'location', label: 'Locations', icon: MapPin },
  { type: 'prop', label: 'Props', icon: Package },
];

// ── Variant card ───────────────────────────────────────────────────────────────

function VariantCard({
  variant,
  seriesId,
  assetId,
  onDelete,
  onImageUploaded,
  onImageClick,
  variantInUse,
}: {
  variant: SeriesAssetVariantWithImages;
  seriesId: string;
  assetId: string;
  onDelete: () => void;
  onImageUploaded: () => void;
  onImageClick: (image: {
    url: string;
    prompt: string;
    variantId: string;
    isFinalized: boolean;
  }) => void;
  variantInUse: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [editingImage, setEditingImage] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');
  const [editInstruction, setEditInstruction] = useState('');

  const latestImage = useMemo(() => {
    if (!variant.series_asset_variant_images?.length) return null;
    return [...variant.series_asset_variant_images].sort((a, b) =>
      (b.created_at ?? '').localeCompare(a.created_at ?? '')
    )[0];
  }, [variant.series_asset_variant_images]);

  const latestPrompt = getImagePrompt(latestImage?.metadata);

  const latestModel =
    typeof latestImage?.metadata?.model === 'string'
      ? String(latestImage.metadata.model)
      : '';

  useEffect(() => {
    setPromptDraft(latestPrompt);
  }, [latestPrompt]);

  const isLocked = variant.is_finalized || variantInUse;
  const lockReason = variant.is_finalized
    ? 'Finalized variant — changes are locked'
    : variantInUse
      ? 'Used in an episode — changes are locked'
      : null;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('angle', 'front');
      fd.append('kind', 'reference');
      await fetch(
        `/api/series/${seriesId}/assets/${assetId}/variants/${variant.id}/images`,
        { method: 'POST', body: fd }
      );
      onImageUploaded();
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleDeleteImage = async (imageId: string, storagePath: string) => {
    await fetch(
      `/api/series/${seriesId}/assets/${assetId}/variants/${variant.id}/images?imageId=${imageId}&storagePath=${encodeURIComponent(storagePath)}`,
      { method: 'DELETE' }
    );
    onImageUploaded();
  };

  const handleRegenerateFromPrompt = async () => {
    if (!promptDraft.trim() || isLocked) return;
    setSavingPrompt(true);
    try {
      await fetch(
        `/api/series/${seriesId}/assets/${assetId}/variants/${variant.id}/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptDraft.trim() }),
        }
      );
      onImageUploaded();
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleEditImage = async () => {
    if (!editInstruction.trim() || isLocked) return;
    setEditingImage(true);
    try {
      await fetch(
        `/api/series/${seriesId}/assets/${assetId}/variants/${variant.id}/edit-image`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: editInstruction.trim(),
            model: 'banana',
          }),
        }
      );
      setEditInstruction('');
      onImageUploaded();
    } finally {
      setEditingImage(false);
    }
  };

  const handleFinalize = async () => {
    if (variant.is_finalized) return;
    setIsFinalizing(true);
    try {
      await fetch(
        `/api/series/${seriesId}/assets/${assetId}/variants/${variant.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_finalized: true }),
        }
      );
      onImageUploaded();
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {variant.name ?? variant.label ?? 'Variant'}
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">
              {variant.slug}
            </span>
          </div>
          {variant.is_main && (
            <Badge variant="secondary" className="text-xs">
              Main
            </Badge>
          )}
          {variant.is_finalized && (
            <Badge variant="outline" className="text-xs border-emerald-500/40">
              Finalized
            </Badge>
          )}
          {variantInUse && !variant.is_finalized && (
            <Badge variant="outline" className="text-xs">
              In Use
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!variant.is_finalized && !variantInUse && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={handleFinalize}
              disabled={isFinalizing}
            >
              {isFinalizing ? '...' : 'Finalize'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 sm:h-7 sm:w-7 p-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            ) : (
              <ChevronDown className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 sm:h-7 sm:w-7 p-0 text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={isLocked}
          >
            <Trash2 className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="p-3 space-y-2">
          {variant.description && (
            <p className="text-xs text-muted-foreground">
              {variant.description}
            </p>
          )}
          {variant.prompt && (
            <p className="text-[11px] text-muted-foreground/90 line-clamp-2">
              Prompt: {variant.prompt}
            </p>
          )}

          {/* Images */}
          <div className="flex flex-wrap gap-2">
            {variant.series_asset_variant_images.map((img) => (
              <div key={img.id} className="relative group w-20 h-20">
                {img.url ? (
                  <button
                    type="button"
                    onClick={() =>
                      img.url &&
                      onImageClick({
                        url: img.url,
                        prompt: getImagePrompt(img.metadata),
                        variantId: variant.id,
                        isFinalized: variant.is_finalized || variantInUse,
                      })
                    }
                    className="w-full h-full cursor-pointer"
                  >
                    {/* biome-ignore lint/a11y/useAltText: thumbnail */}
                    <img
                      src={img.url}
                      className="w-full h-full object-cover rounded border border-border/50 hover:border-primary/50 transition-colors"
                    />
                  </button>
                ) : (
                  <div className="w-full h-full bg-muted rounded border border-border/50" />
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteImage(img.id, img.storage_path)}
                  className="absolute -top-1 -right-1 w-6 h-6 sm:w-5 sm:h-5 bg-destructive text-destructive-foreground rounded-full flex md:hidden md:group-hover:flex items-center justify-center text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={isLocked}
                >
                  ×
                </button>
              </div>
            ))}

            {/* Upload button */}
            <label
              className={`w-16 h-16 border-2 border-dashed border-border/50 rounded flex items-center justify-center transition-colors ${
                isLocked
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer hover:border-primary/50'
              }`}
            >
              {uploading ? (
                <span className="text-xs text-muted-foreground">...</span>
              ) : (
                <Upload className="w-4 h-4 text-muted-foreground" />
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading || isLocked}
              />
            </label>
          </div>

          {lockReason && (
            <p className="text-[11px] text-amber-500/90 border border-amber-500/20 rounded px-2 py-1 bg-amber-500/5">
              {lockReason}
            </p>
          )}

          <div className="space-y-2 pt-1 border-t border-border/40">
            <p className="text-xs font-medium">Generation Prompt (Cell)</p>
            <Textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              placeholder="No cell prompt metadata found yet. Add a prompt and regenerate."
              rows={3}
              className="text-xs"
              disabled={isLocked}
            />
            {latestModel && (
              <p className="text-[11px] text-muted-foreground">
                Model: {latestModel}
              </p>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={handleRegenerateFromPrompt}
              disabled={savingPrompt || isLocked || !promptDraft.trim()}
            >
              {savingPrompt ? 'Regenerating...' : 'Regenerate from Prompt'}
            </Button>
          </div>

          <div className="space-y-2 pt-1 border-t border-border/40">
            <p className="text-xs font-medium">Create Variation (Edit-only)</p>
            <Input
              placeholder="Edit instruction (e.g. add a red scarf, warmer lighting)"
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              disabled={isLocked}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 text-xs"
              onClick={handleEditImage}
              disabled={editingImage || isLocked || !editInstruction.trim()}
            >
              {editingImage ? 'Applying Edit...' : 'Apply Edit'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Asset card ─────────────────────────────────────────────────────────────────

function AssetCard({
  asset,
  seriesId,
  onDelete,
  onRefresh,
  usedAssetIds,
}: {
  asset: SeriesAssetWithVariants;
  seriesId: string;
  onDelete: () => void;
  onRefresh: () => void;
  usedAssetIds: Set<string>;
}) {
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [variantLabel, setVariantLabel] = useState('');
  const [variantDesc, setVariantDesc] = useState('');
  const [isMain, setIsMain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lightboxState, setLightboxState] = useState<LightboxState | null>(
    null
  );

  const handleAddVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!variantLabel.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/series/${seriesId}/assets/${asset.id}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: variantLabel.trim(),
          description: variantDesc.trim() || undefined,
          is_main: isMain,
        }),
      });
      setVariantLabel('');
      setVariantDesc('');
      setIsMain(false);
      setShowAddVariant(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVariant = async (variantId: string) => {
    await fetch(
      `/api/series/${seriesId}/assets/${asset.id}/variants/${variantId}`,
      { method: 'DELETE' }
    );
    onRefresh();
  };

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden space-y-0">
      {/* Hero image from first variant's first image */}
      {(() => {
        const firstVariantWithImage = asset.series_asset_variants?.find(
          (v) => (v.series_asset_variant_images?.length ?? 0) > 0
        );
        const firstImage =
          firstVariantWithImage?.series_asset_variant_images?.[0];

        return firstImage?.url ? (
          <button
            type="button"
            onClick={() =>
              firstImage.url &&
              firstVariantWithImage &&
              setLightboxState({
                url: firstImage.url,
                alt: asset.name,
                prompt: getImagePrompt(firstImage.metadata),
                seriesId,
                assetId: asset.id,
                variantId: firstVariantWithImage.id,
                isFinalized:
                  firstVariantWithImage.is_finalized ||
                  usedAssetIds.has(asset.id),
              })
            }
            className="w-full aspect-square overflow-hidden cursor-pointer"
          >
            {/* biome-ignore lint/a11y/useAltText: asset hero */}
            <img
              src={firstImage.url}
              className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
            />
          </button>
        ) : (
          <div className="w-full aspect-square bg-muted/30 flex flex-col items-center justify-center gap-2">
            <span className="text-4xl opacity-20">
              {asset.type === 'character'
                ? '👤'
                : asset.type === 'location'
                  ? '🏠'
                  : '📦'}
            </span>
            <span className="text-xs text-muted-foreground animate-pulse">
              No image yet
            </span>
          </div>
        );
      })()}
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium text-sm">{asset.name}</p>
            {asset.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                {asset.description}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-10 sm:h-7 sm:w-7 p-0 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        {/* Variants */}
        <div className="space-y-2">
          {asset.series_asset_variants.map((v) => (
            <VariantCard
              key={v.id}
              variant={v}
              seriesId={seriesId}
              assetId={asset.id}
              onDelete={() => handleDeleteVariant(v.id)}
              onImageUploaded={onRefresh}
              onImageClick={(image) =>
                setLightboxState({
                  url: image.url,
                  alt: asset.name,
                  prompt: image.prompt,
                  seriesId,
                  assetId: asset.id,
                  variantId: image.variantId,
                  isFinalized: image.isFinalized,
                })
              }
              variantInUse={usedAssetIds.has(asset.id)}
            />
          ))}
        </div>

        {/* Add variant */}
        {showAddVariant ? (
          <form onSubmit={handleAddVariant} className="space-y-2 pt-1">
            <Input
              placeholder="Variant label (e.g. Young, Aged, Undercover)"
              value={variantLabel}
              onChange={(e) => setVariantLabel(e.target.value)}
              required
            />
            <Input
              placeholder="Description (optional)"
              value={variantDesc}
              onChange={(e) => setVariantDesc(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`default-${asset.id}`}
                checked={isMain}
                onChange={(e) => setIsMain(e.target.checked)}
                className="w-4 h-4"
              />
              <label
                htmlFor={`default-${asset.id}`}
                className="text-xs text-muted-foreground"
              >
                Set as default variant
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? 'Saving...' : 'Add'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowAddVariant(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground border border-dashed border-border/50"
            onClick={() => setShowAddVariant(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Variant
          </Button>
        )}
      </div>

      {lightboxState && (
        <ImageLightbox
          state={lightboxState}
          onClose={() => setLightboxState(null)}
          onDone={onRefresh}
        />
      )}
    </div>
  );
}

// ── Episode row ────────────────────────────────────────────────────────────────

type CanonicalScene = {
  id: string;
  episode_id: string;
  order: number;
  prompt: string | null;
  audio_text: string | null;
  audio_url: string | null;
  video_url: string | null;
  status: 'draft' | 'ready' | 'in_progress' | 'done' | 'failed';
  location_variant_slug: string | null;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
  updated_at: string;
};

function normalizeSlugArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function EpisodeRow({
  episode,
  scenes,
  variantLabelBySlug,
  onDelete,
}: {
  episode: SeriesEpisodeWithVariants;
  scenes: CanonicalScene[];
  variantLabelBySlug: Map<string, string>;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const map = episode.asset_variant_map ?? {
    characters: [],
    locations: [],
    props: [],
  };

  const statusLabel: Record<string, string> = {
    draft: 'Draft',
    ready: 'Ready',
    in_progress: 'In Progress',
    done: 'Done',
  };

  const statusClass: Record<string, string> = {
    draft: 'border-muted-foreground/30 text-muted-foreground',
    ready: 'border-blue-500/30 text-blue-400',
    in_progress: 'border-amber-500/30 text-amber-400',
    done: 'border-emerald-500/40 text-emerald-400',
  };

  const sceneStatusClass: Record<string, string> = {
    draft: 'border-muted-foreground/30 text-muted-foreground',
    ready: 'border-blue-500/30 text-blue-400',
    in_progress: 'border-amber-500/30 text-amber-400',
    done: 'border-emerald-500/40 text-emerald-400',
    failed: 'border-destructive/40 text-destructive',
  };

  const slugGroups = [
    { label: 'Characters', values: map.characters ?? [] },
    { label: 'Locations', values: map.locations ?? [] },
    { label: 'Props', values: map.props ?? [] },
  ].filter((group) => group.values.length > 0);

  const doneScenes = scenes.filter((scene) => scene.status === 'done').length;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border border-border/50 rounded-lg">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 text-left flex-1"
          onClick={() => setExpanded((prev) => !prev)}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              Ep {episode.episode_number}
            </span>
            <Badge
              variant="outline"
              className={`text-[10px] h-5 px-1.5 ${statusClass[episode.status] ?? statusClass.draft}`}
            >
              {statusLabel[episode.status] ?? episode.status}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] h-5 px-1.5 border-border/60 text-muted-foreground"
            >
              Scenes {doneScenes}/{scenes.length}
            </Badge>
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            )}
          </div>
          <p className="text-sm font-medium truncate mt-1">
            {episode.title ?? `Episode ${episode.episode_number}`}
          </p>
          {episode.synopsis && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {episode.synopsis}
            </p>
          )}
        </button>

        <Button
          variant="ghost"
          size="sm"
          className="h-10 w-10 sm:h-7 sm:w-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {slugGroups.length > 0 ? (
        <div className="space-y-1.5">
          {slugGroups.map((group) => (
            <div
              key={group.label}
              className="flex flex-wrap items-center gap-1"
            >
              <span className="text-[10px] text-muted-foreground w-16">
                {group.label}
              </span>
              {group.values.map((slug) => (
                <Badge
                  key={`${episode.id}-${group.label}-${slug}`}
                  variant="outline"
                  className="h-5 px-1.5 text-[10px]"
                >
                  {variantLabelBySlug.get(slug) ?? slug}
                </Badge>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground/70 italic">
          No asset variants mapped yet.
        </p>
      )}

      {expanded && (
        <div className="space-y-2 border-t border-border/40 pt-2">
          {scenes.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/70 italic">
              No scenes in this episode yet.
            </p>
          ) : (
            scenes.map((scene) => (
              <div
                key={scene.id}
                className="rounded-md border border-border/40 bg-muted/10 p-2.5 space-y-1.5"
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    Sc {scene.order}
                  </span>
                  <Badge
                    variant="outline"
                    className={`h-5 px-1.5 text-[10px] ${sceneStatusClass[scene.status] ?? sceneStatusClass.draft}`}
                  >
                    {scene.status.replace('_', ' ')}
                  </Badge>
                  {scene.audio_url ? (
                    <Badge
                      variant="outline"
                      className="h-5 px-1.5 text-[10px] border-blue-500/30 text-blue-300"
                    >
                      audio_url
                    </Badge>
                  ) : null}
                  {scene.video_url ? (
                    <Badge
                      variant="outline"
                      className="h-5 px-1.5 text-[10px] border-cyan-500/30 text-cyan-300"
                    >
                      video_url
                    </Badge>
                  ) : null}
                </div>

                {scene.prompt ? (
                  <p className="text-xs text-foreground/90 line-clamp-2">
                    {scene.prompt}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground/70 italic">
                    No prompt yet.
                  </p>
                )}

                {scene.audio_text ? (
                  <p className="text-xs text-foreground/80 line-clamp-2">
                    {scene.audio_text}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground/70 italic">
                    No audio text yet.
                  </p>
                )}

                <div className="flex flex-wrap gap-1">
                  {scene.location_variant_slug ? (
                    <Badge
                      variant="outline"
                      className="h-5 px-1.5 text-[10px] border-violet-500/30 text-violet-300"
                    >
                      L:{' '}
                      {variantLabelBySlug.get(scene.location_variant_slug) ??
                        scene.location_variant_slug}
                    </Badge>
                  ) : null}
                  {scene.character_variant_slugs.map((slug) => (
                    <Badge
                      key={`${scene.id}-char-${slug}`}
                      variant="outline"
                      className="h-5 px-1.5 text-[10px] border-cyan-500/30 text-cyan-300"
                    >
                      C: {variantLabelBySlug.get(slug) ?? slug}
                    </Badge>
                  ))}
                  {scene.prop_variant_slugs.map((slug) => (
                    <Badge
                      key={`${scene.id}-prop-${slug}`}
                      variant="outline"
                      className="h-5 px-1.5 text-[10px] border-amber-500/30 text-amber-300"
                    >
                      P: {variantLabelBySlug.get(slug) ?? slug}
                    </Badge>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main detail page ───────────────────────────────────────────────────────────

interface Props {
  series: SeriesWithAssets;
  episodes: SeriesEpisodeWithVariants[];
  onBack: () => void;
  onRefresh: () => void;
}

export function SeriesDetailPage({
  series,
  episodes,
  onBack,
  onRefresh,
}: Props) {
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [assetType, setAssetType] = useState<SeriesAssetType>('character');
  const [assetName, setAssetName] = useState('');
  const [assetDesc, setAssetDesc] = useState('');
  const [savingAsset, setSavingAsset] = useState(false);

  const [showAddEpisode, setShowAddEpisode] = useState(false);
  const [episodeNumber, setEpisodeNumber] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [episodeSynopsis, setEpisodeSynopsis] = useState('');
  const [savingEpisode, setSavingEpisode] = useState(false);

  const [showBibleDialog, setShowBibleDialog] = useState(false);
  const [scenesByEpisode, setScenesByEpisode] = useState<
    Record<string, CanonicalScene[]>
  >({});
  const [scenesLoading, setScenesLoading] = useState(false);

  const supabaseRef = useRef(createClient('studio'));
  const refreshTimerRef = useRef<number | null>(null);

  const loadScenes = useCallback(async () => {
    const episodeIds = episodes.map((episode) => episode.id);

    if (episodeIds.length === 0) {
      setScenesByEpisode({});
      return;
    }

    setScenesLoading(true);

    const { data, error } = await supabaseRef.current
      .from('scenes')
      .select(
        'id, episode_id, order, prompt, audio_text, audio_url, video_url, status, location_variant_slug, character_variant_slugs, prop_variant_slugs, updated_at'
      )
      .in('episode_id', episodeIds)
      .order('order', { ascending: true });

    if (error) {
      console.error('Failed to load canonical scenes:', error);
      setScenesLoading(false);
      return;
    }

    const grouped: Record<string, CanonicalScene[]> = {};

    for (const row of data ?? []) {
      const episodeId = row.episode_id;
      if (!episodeId) continue;

      grouped[episodeId] ??= [];
      grouped[episodeId].push({
        id: row.id,
        episode_id: episodeId,
        order: Number(row.order ?? 0),
        prompt: row.prompt ?? null,
        audio_text: row.audio_text ?? null,
        audio_url: row.audio_url ?? null,
        video_url: row.video_url ?? null,
        status:
          row.status === 'ready' ||
          row.status === 'in_progress' ||
          row.status === 'done' ||
          row.status === 'failed'
            ? row.status
            : 'draft',
        location_variant_slug: row.location_variant_slug ?? null,
        character_variant_slugs: normalizeSlugArray(
          row.character_variant_slugs
        ),
        prop_variant_slugs: normalizeSlugArray(row.prop_variant_slugs),
        updated_at: row.updated_at ?? new Date().toISOString(),
      });
    }

    setScenesByEpisode(grouped);
    setScenesLoading(false);
  }, [episodes]);

  useEffect(() => {
    void loadScenes();
  }, [loadScenes]);

  useEffect(() => {
    const episodeIdSet = new Set(episodes.map((episode) => episode.id));
    const assetIdSet = new Set(series.series_assets.map((asset) => asset.id));

    const scheduleRefresh = (includeSeriesRefresh: boolean) => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = window.setTimeout(() => {
        void loadScenes();
        if (includeSeriesRefresh) {
          onRefresh();
        }
      }, 250);
    };

    const channel = supabaseRef.current
      .channel(`series-detail-live-${series.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'episodes',
          filter: `series_id=eq.${series.id}`,
        },
        () => {
          scheduleRefresh(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'scenes',
        },
        (payload) => {
          const episodeId =
            (payload.new as { episode_id?: string } | null | undefined)
              ?.episode_id ??
            (payload.old as { episode_id?: string } | null | undefined)
              ?.episode_id ??
            null;

          if (!episodeId || !episodeIdSet.has(episodeId)) return;
          scheduleRefresh(false);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'series_assets',
          filter: `series_id=eq.${series.id}`,
        },
        () => {
          scheduleRefresh(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'studio',
          table: 'series_asset_variants',
        },
        (payload) => {
          const assetId =
            (payload.new as { asset_id?: string } | null | undefined)
              ?.asset_id ??
            (payload.old as { asset_id?: string } | null | undefined)
              ?.asset_id ??
            null;

          if (!assetId || !assetIdSet.has(assetId)) return;
          scheduleRefresh(true);
        }
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      supabaseRef.current.removeChannel(channel);
    };
  }, [episodes, loadScenes, onRefresh, series.id, series.series_assets]);

  // ── Auto-refresh: poll for new images while assets are missing images ─────
  useEffect(() => {
    const assetsWithoutImages = series.series_assets?.filter((a) => {
      const images = a.series_asset_variants?.flatMap(
        (v) => v.series_asset_variant_images ?? []
      );
      return !images?.length;
    });

    // Only poll if there are assets without images (likely generating)
    if (!assetsWithoutImages?.length) return;

    const interval = setInterval(() => {
      onRefresh();
    }, 10_000); // Poll every 10s

    return () => clearInterval(interval);
  }, [series.series_assets, onRefresh]);

  // ── Edit series state ──────────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(series.name);
  const [editGenre, setEditGenre] = useState(series.genre ?? '');
  const [editTone, setEditTone] = useState(series.tone ?? '');
  const [editBible, setEditBible] = useState(series.bible ?? '');
  const [savingEdit, setSavingEdit] = useState(false);

  const startEdit = () => {
    setEditName(series.name);
    setEditGenre(series.genre ?? '');
    setEditTone(series.tone ?? '');
    setEditBible(series.bible ?? '');
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    setSavingEdit(true);
    try {
      await fetch(`/api/series/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          genre: editGenre.trim() || null,
          tone: editTone.trim() || null,
          bible: editBible.trim() || null,
        }),
      });
      setIsEditing(false);
      onRefresh();
    } finally {
      setSavingEdit(false);
    }
  };

  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assetName.trim()) return;
    setSavingAsset(true);
    try {
      await fetch(`/api/series/${series.id}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: assetType,
          name: assetName.trim(),
          description: assetDesc.trim() || undefined,
        }),
      });
      setAssetName('');
      setAssetDesc('');
      setShowAddAsset(false);
      onRefresh();
    } finally {
      setSavingAsset(false);
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    await fetch(`/api/series/${series.id}/assets/${assetId}`, {
      method: 'DELETE',
    });
    onRefresh();
  };

  const handleAddEpisode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!episodeNumber) return;
    setSavingEpisode(true);
    try {
      await fetch(`/api/series/${series.id}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episode_number: Number(episodeNumber),
          title: episodeTitle.trim() || undefined,
          synopsis: episodeSynopsis.trim() || undefined,
        }),
      });
      setEpisodeNumber('');
      setEpisodeTitle('');
      setEpisodeSynopsis('');
      setShowAddEpisode(false);
      onRefresh();
    } finally {
      setSavingEpisode(false);
    }
  };

  const handleDeleteEpisode = async (episodeId: string) => {
    await fetch(`/api/series/${series.id}/episodes/${episodeId}`, {
      method: 'DELETE',
    });
    onRefresh();
  };

  const assetIdByVariantSlug = useMemo(() => {
    const map = new Map<string, string>();

    for (const asset of series.series_assets ?? []) {
      for (const variant of asset.series_asset_variants ?? []) {
        if (variant.slug) {
          map.set(variant.slug, asset.id);
        }
      }
    }

    return map;
  }, [series.series_assets]);

  const variantLabelBySlug = useMemo(() => {
    const map = new Map<string, string>();

    for (const asset of series.series_assets ?? []) {
      for (const variant of asset.series_asset_variants ?? []) {
        if (!variant.slug) continue;
        const label = variant.name?.trim()
          ? `${asset.name} — ${variant.name.trim()}`
          : variant.slug;
        map.set(variant.slug, label);
      }
    }

    return map;
  }, [series.series_assets]);

  const usedAssetIds = useMemo(() => {
    const ids = new Set<string>();

    for (const ep of episodes) {
      const map = ep.asset_variant_map ?? {
        characters: [],
        locations: [],
        props: [],
      };

      for (const slug of [
        ...(map.characters ?? []),
        ...(map.locations ?? []),
        ...(map.props ?? []),
      ]) {
        const assetId = assetIdByVariantSlug.get(slug);
        if (assetId) ids.add(assetId);
      }

      for (const mapRow of ep.episode_assets ?? []) {
        if (mapRow.asset_id) ids.add(mapRow.asset_id);
      }
    }

    return ids;
  }, [assetIdByVariantSlug, episodes]);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Back + title */}
      <div className="flex items-start gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="mt-1 h-10 w-10 sm:h-8 sm:w-8 p-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>

        {isEditing ? (
          /* ── Edit mode ── */
          <div className="flex-1 space-y-3">
            <div className="space-y-2 sm:space-y-0">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-xl font-bold h-10 w-full sm:max-w-sm"
                placeholder="Series name"
                autoFocus
              />
              <div className="flex items-center gap-2 mt-2">
                <Button
                  size="sm"
                  onClick={saveEdit}
                  disabled={savingEdit || !editName.trim()}
                >
                  <Check className="w-3.5 h-3.5 mr-1" />
                  {savingEdit ? 'Saving...' : 'Save'}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEdit}>
                  <X className="w-3.5 h-3.5 mr-1" />
                  Cancel
                </Button>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:max-w-lg">
              <Input
                value={editGenre}
                onChange={(e) => setEditGenre(e.target.value)}
                placeholder="Genre (e.g. Drama)"
                className="h-10 sm:h-8 text-sm sm:text-xs"
              />
              <Input
                value={editTone}
                onChange={(e) => setEditTone(e.target.value)}
                placeholder="Tone (e.g. Dark comedy)"
                className="h-10 sm:h-8 text-sm sm:text-xs"
              />
            </div>
            <Textarea
              value={editBible}
              onChange={(e) => setEditBible(e.target.value)}
              placeholder="Series bible (optional)"
              rows={4}
              className="w-full sm:max-w-lg text-xs"
            />
          </div>
        ) : (
          /* ── View mode ── */
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
                {series.name}
              </h1>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 sm:h-7 sm:w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={startEdit}
                title="Edit series info"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {series.genre && (
                <Badge variant="secondary" className="text-xs">
                  {series.genre}
                </Badge>
              )}
              {series.tone && (
                <Badge variant="outline" className="text-xs">
                  {series.tone}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs capitalize">
                {series.content_mode}
              </Badge>
              <Badge
                variant="outline"
                className="text-xs capitalize border-blue-500/30 text-blue-400"
              >
                {series.plan_status}
              </Badge>
              {series.language && (
                <Badge variant="outline" className="text-xs">
                  {series.language}
                </Badge>
              )}
              {series.aspect_ratio && (
                <Badge variant="outline" className="text-xs">
                  {series.aspect_ratio}
                </Badge>
              )}
              {series.bible && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowBibleDialog(true)}
                >
                  <Clapperboard className="w-3.5 h-3.5 mr-1" />
                  Bible
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {series.creative_brief && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Creative Brief
          </p>
          <pre className="whitespace-pre-wrap break-words text-xs text-foreground/85">
            {JSON.stringify(series.creative_brief, null, 2)}
          </pre>
        </div>
      )}

      <Tabs defaultValue="assets">
        <TabsList>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="episodes">
            Episodes ({episodes.length})
          </TabsTrigger>
        </TabsList>

        {/* ── Assets tab ── */}
        <TabsContent value="assets" className="space-y-6 pt-4">
          {ASSET_TYPES.map(({ type, label, icon: Icon }) => {
            const typeAssets = series.series_assets.filter(
              (a) => a.type === type
            );
            return (
              <div key={type} className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <h3 className="font-semibold text-sm">{label}</h3>
                    <span className="text-xs text-muted-foreground">
                      ({typeAssets.length})
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAssetType(type);
                      setShowAddAsset(true);
                    }}
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Add
                  </Button>
                </div>

                {typeAssets.length === 0 ? (
                  <p className="text-sm text-muted-foreground/60 py-2">
                    No {label.toLowerCase()} yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {typeAssets.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        seriesId={series.id}
                        onDelete={() => handleDeleteAsset(asset.id)}
                        onRefresh={onRefresh}
                        usedAssetIds={usedAssetIds}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </TabsContent>

        {/* ── Episodes tab ── */}
        <TabsContent value="episodes" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Episode List</h3>
            <Button size="sm" onClick={() => setShowAddEpisode(true)}>
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add Episode
            </Button>
          </div>

          {episodes.length === 0 ? (
            <p className="text-sm text-muted-foreground/60 py-4">
              No episodes yet. Add episodes to start building canonical episode
              plans and variant maps.
            </p>
          ) : (
            <div className="space-y-2">
              {scenesLoading && (
                <p className="text-[11px] text-muted-foreground/70 px-1">
                  Syncing scene status in realtime…
                </p>
              )}
              {episodes.map((ep) => (
                <EpisodeRow
                  key={ep.id}
                  episode={ep}
                  scenes={scenesByEpisode[ep.id] ?? []}
                  variantLabelBySlug={variantLabelBySlug}
                  onDelete={() => handleDeleteEpisode(ep.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Asset Dialog */}
      <Dialog open={showAddAsset} onOpenChange={setShowAddAsset}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add {assetType.charAt(0).toUpperCase() + assetType.slice(1)}
            </DialogTitle>
            <DialogDescription>
              Create a new {assetType} and add its first default variant.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddAsset} className="space-y-3">
            <Input
              placeholder="Name"
              value={assetName}
              onChange={(e) => setAssetName(e.target.value)}
              required
            />
            <Input
              placeholder="Description (optional)"
              value={assetDesc}
              onChange={(e) => setAssetDesc(e.target.value)}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAddAsset(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingAsset || !assetName.trim()}>
                {savingAsset ? 'Adding...' : 'Add'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Episode Dialog */}
      <Dialog open={showAddEpisode} onOpenChange={setShowAddEpisode}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Episode</DialogTitle>
            <DialogDescription>
              Add an episode to this series with canonical order/title/synopsis.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddEpisode} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="number"
                placeholder="Episode number"
                value={episodeNumber}
                onChange={(e) => setEpisodeNumber(e.target.value)}
                min={1}
                required
              />
              <Input
                placeholder="Title (optional)"
                value={episodeTitle}
                onChange={(e) => setEpisodeTitle(e.target.value)}
              />
            </div>
            <Textarea
              placeholder="Synopsis (optional)"
              value={episodeSynopsis}
              onChange={(e) => setEpisodeSynopsis(e.target.value)}
              rows={3}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAddEpisode(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingEpisode || !episodeNumber}>
                {savingEpisode ? 'Adding...' : 'Add Episode'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bible Dialog */}
      <Dialog open={showBibleDialog} onOpenChange={setShowBibleDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{series.name} — Series Bible</DialogTitle>
            <DialogDescription>
              Reference document for tone, world, and story direction.
            </DialogDescription>
          </DialogHeader>
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-foreground font-sans leading-relaxed">
              {series.bible}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
