'use client';

import { useState, useCallback } from 'react';
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
} from 'lucide-react';
import type {
  SeriesWithAssets,
  SeriesAssetType,
  SeriesAssetWithVariants,
  SeriesAssetVariantWithImages,
  SeriesEpisodeWithVariants,
} from '@/lib/supabase/series-service';

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
}: {
  variant: SeriesAssetVariantWithImages;
  seriesId: string;
  assetId: string;
  onDelete: () => void;
  onImageUploaded: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);

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

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{variant.label}</span>
          {variant.is_default && (
            <Badge variant="secondary" className="text-xs">
              Default
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="w-3.5 h-3.5" />
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
              <div key={img.id} className="relative group w-16 h-16">
                {img.url ? (
                  // biome-ignore lint/a11y/useAltText: thumbnail
                  <img
                    src={img.url}
                    className="w-full h-full object-cover rounded border border-border/50"
                  />
                ) : (
                  <div className="w-full h-full bg-muted rounded border border-border/50" />
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteImage(img.id, img.storage_path)}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-destructive text-destructive-foreground rounded-full items-center justify-center text-xs hidden group-hover:flex"
                >
                  ×
                </button>
              </div>
            ))}

            {/* Upload button */}
            <label className="w-16 h-16 border-2 border-dashed border-border/50 rounded flex items-center justify-center cursor-pointer hover:border-primary/50 transition-colors">
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
                disabled={uploading}
              />
            </label>
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
}: {
  asset: SeriesAssetWithVariants;
  seriesId: string;
  onDelete: () => void;
  onRefresh: () => void;
}) {
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [variantLabel, setVariantLabel] = useState('');
  const [variantDesc, setVariantDesc] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

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
    <div className="border border-border/50 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-sm">{asset.name}</p>
          {asset.description && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {asset.description}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
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
    <div className="flex items-center justify-between px-4 py-3 border border-border/50 rounded-lg">
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-muted-foreground w-8">
          Ep {episode.episode_number}
        </span>
        <div>
          <p className="text-sm font-medium">
            {episode.title ?? `Episode ${episode.episode_number}`}
          </p>
          {episode.synopsis && (
            <p className="text-xs text-muted-foreground truncate max-w-xs">
              {episode.synopsis}
            </p>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{series.name}</h1>
          <div className="flex items-center gap-2 mt-0.5">
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
          </div>
        </div>
        {series.bible && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => setShowBibleDialog(true)}
          >
            <Clapperboard className="w-4 h-4 mr-1.5" />
            Series Bible
          </Button>
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
        <DialogContent className="max-w-md">
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
        <DialogContent className="max-w-md">
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
