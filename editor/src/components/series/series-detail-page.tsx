'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  ExternalLink,
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
                Generation prompt
              </p>
              <Badge variant={isFinalized ? 'secondary' : 'outline'}>
                {isFinalized ? 'Finalized (locked)' : 'Editable'}
              </Badge>
            </div>

            <Textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              placeholder="Prompt used to generate this image"
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

  const latestPrompt =
    typeof latestImage?.metadata?.prompt === 'string'
      ? String(latestImage.metadata.prompt)
      : '';

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
          <span className="text-sm font-medium">{variant.label}</span>
          {variant.is_default && (
            <Badge variant="secondary" className="text-xs">
              Default
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
                        prompt:
                          typeof img.metadata?.prompt === 'string'
                            ? String(img.metadata.prompt)
                            : '',
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
            <p className="text-xs font-medium">Generation Prompt</p>
            <Textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              placeholder="No prompt metadata found yet. Add a prompt and regenerate."
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
  usedVariantIds,
}: {
  asset: SeriesAssetWithVariants;
  seriesId: string;
  onDelete: () => void;
  onRefresh: () => void;
  usedVariantIds: Set<string>;
}) {
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [variantLabel, setVariantLabel] = useState('');
  const [variantDesc, setVariantDesc] = useState('');
  const [isDefault, setIsDefault] = useState(false);
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
          is_default: isDefault,
        }),
      });
      setVariantLabel('');
      setVariantDesc('');
      setIsDefault(false);
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
                prompt:
                  typeof firstImage.metadata?.prompt === 'string'
                    ? String(firstImage.metadata.prompt)
                    : '',
                seriesId,
                assetId: asset.id,
                variantId: firstVariantWithImage.id,
                isFinalized:
                  firstVariantWithImage.is_finalized ||
                  usedVariantIds.has(firstVariantWithImage.id),
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
              variantInUse={usedVariantIds.has(v.id)}
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
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
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

function EpisodeRow({
  episode,
  seriesId,
  onDelete,
}: {
  episode: SeriesEpisodeWithVariants;
  seriesId: string;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border border-border/50 rounded-lg">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-xs font-mono text-muted-foreground shrink-0">
          Ep {episode.episode_number}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {episode.title ?? `Episode ${episode.episode_number}`}
          </p>
          {episode.synopsis && (
            <p className="text-xs text-muted-foreground truncate">
              {episode.synopsis}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {episode.project_id && (
          <Link href={`/editor/${episode.project_id}`}>
            <Button
              variant="outline"
              size="sm"
              className="h-9 sm:h-7 gap-1.5 text-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open in Editor</span>
              <span className="sm:hidden">Open</span>
            </Button>
          </Link>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-10 w-10 sm:h-7 sm:w-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
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
  const [projectId, setProjectId] = useState('');
  const [savingEpisode, setSavingEpisode] = useState(false);

  const [showBibleDialog, setShowBibleDialog] = useState(false);

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
    if (!projectId.trim() || !episodeNumber) return;
    setSavingEpisode(true);
    try {
      await fetch(`/api/series/${series.id}/episodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId.trim(),
          episode_number: Number(episodeNumber),
          title: episodeTitle.trim() || undefined,
          synopsis: episodeSynopsis.trim() || undefined,
        }),
      });
      setProjectId('');
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

  const usedVariantIds = useMemo(() => {
    const ids = new Set<string>();
    for (const ep of episodes) {
      for (const ev of ep.episode_asset_variants ?? []) {
        if (ev.variant_id) ids.add(ev.variant_id);
      }
    }
    return ids;
  }, [episodes]);

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
                        usedVariantIds={usedVariantIds}
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
              No episodes yet. Add a project as an episode to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {episodes.map((ep) => (
                <EpisodeRow
                  key={ep.id}
                  episode={ep}
                  seriesId={series.id}
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
            <Input
              placeholder="Project ID (paste from URL)"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              required
            />
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
              <Button
                type="submit"
                disabled={savingEpisode || !projectId.trim() || !episodeNumber}
              >
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
