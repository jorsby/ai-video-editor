'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  IconAlertTriangle,
  IconCheck,
  IconLoader2,
  IconRefresh,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import {
  DEFAULT_GRID_ASPECT_RATIO,
  DEFAULT_GRID_RESOLUTION,
  GRID_ASPECT_RATIO_OPTIONS,
  GRID_RESOLUTION_OPTIONS,
  type GridAspectRatio,
  type GridResolution,
} from '@/lib/grid-generation-settings';
import type {
  GridImage,
  RefPlan,
  Storyboard,
} from '@/lib/supabase/workflow-service';

interface RefGridImageReviewProps {
  objectsGrid: GridImage;
  bgGrid: GridImage;
  storyboard: Storyboard;
  onApproveComplete: () => void;
  onRegenerateComplete: () => void;
}

export function RefGridImageReview({
  objectsGrid,
  bgGrid,
  storyboard,
  onApproveComplete,
  onRegenerateComplete,
}: RefGridImageReviewProps) {
  const plan = storyboard.plan as RefPlan;
  const [isApproving, setIsApproving] = useState(false);
  const [isRegeneratingTarget, setIsRegeneratingTarget] = useState<
    'objects' | 'backgrounds' | 'both' | null
  >(null);

  const [objectsRows, setObjectsRows] = useState(plan.objects_rows);
  const [objectsCols, setObjectsCols] = useState(plan.objects_cols);
  const [bgRows, setBgRows] = useState(plan.bg_rows);
  const [bgCols, setBgCols] = useState(plan.bg_cols);
  const [objectsPrompt, setObjectsPrompt] = useState(plan.objects_grid_prompt);
  const [backgroundsPrompt, setBackgroundsPrompt] = useState(
    plan.backgrounds_grid_prompt
  );
  const [gridAspectRatio, setGridAspectRatio] = useState<GridAspectRatio>(
    plan.grid_generation_aspect_ratio ?? DEFAULT_GRID_ASPECT_RATIO
  );
  const [gridResolution, setGridResolution] = useState<GridResolution>(
    plan.grid_generation_resolution ?? DEFAULT_GRID_RESOLUTION
  );

  const originalObjectCount = plan.objects_rows * plan.objects_cols;
  const newObjectCount = objectsRows * objectsCols;
  const objectCountChanged = newObjectCount !== originalObjectCount;

  const originalBgCount = plan.bg_rows * plan.bg_cols;
  const newBgCount = bgRows * bgCols;
  const bgCountChanged = newBgCount !== originalBgCount;

  const isValidGrid = (rows: number, cols: number) =>
    rows >= 1 &&
    rows <= 6 &&
    cols >= 1 &&
    cols <= 6 &&
    rows * cols >= 2 &&
    rows * cols <= 36;

  const isValidRange =
    isValidGrid(objectsRows, objectsCols) && isValidGrid(bgRows, bgCols);

  const objectsIsProcessing =
    objectsGrid.status === 'processing' || objectsGrid.status === 'pending';
  const backgroundsIsProcessing =
    bgGrid.status === 'processing' || bgGrid.status === 'pending';
  const isAnyGridProcessing = objectsIsProcessing || backgroundsIsProcessing;
  const bothGenerated =
    objectsGrid.status === 'generated' && bgGrid.status === 'generated';

  const canApprove =
    isValidRange &&
    bothGenerated &&
    !isAnyGridProcessing &&
    !isApproving &&
    !isRegeneratingTarget;
  const canRegenerateObjects =
    !isApproving &&
    !isRegeneratingTarget &&
    !objectsIsProcessing &&
    objectsPrompt.trim().length > 0;

  const canRegenerateBackgrounds =
    !isApproving &&
    !isRegeneratingTarget &&
    !backgroundsIsProcessing &&
    backgroundsPrompt.trim().length > 0;

  const handleApprove = async () => {
    if (!canApprove) return;
    setIsApproving(true);
    try {
      const response = await fetch('/api/storyboard/approve-ref-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboardId: storyboard.id,
          objectsRows,
          objectsCols,
          bgRows,
          bgCols,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to approve grids');
      }
      toast.success('Grids approved! Splitting into objects & backgrounds...');
      onApproveComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to approve grids'
      );
    } finally {
      setIsApproving(false);
    }
  };

  const handleRegenerate = async (target: 'objects' | 'backgrounds') => {
    const canRun =
      target === 'objects' ? canRegenerateObjects : canRegenerateBackgrounds;
    if (!canRun) return;

    setIsRegeneratingTarget(target);

    try {
      const response = await fetch('/api/storyboard/regenerate-ref-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboardId: storyboard.id,
          target,
          objectsPrompt: objectsPrompt.trim(),
          backgroundsPrompt: backgroundsPrompt.trim(),
          gridAspectRatio,
          gridResolution,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to regenerate grid(s)');
      }

      const message =
        target === 'objects'
          ? 'Regenerating objects grid...'
          : 'Regenerating backgrounds grid...';

      toast.success(message);
      onRegenerateComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to regenerate grid(s)'
      );
    } finally {
      setIsRegeneratingTarget(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Objects Grid */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Objects Grid
          </span>
          {objectsIsProcessing ? (
            <span className="text-xs text-blue-400 inline-flex items-center gap-1">
              <IconLoader2 size={12} className="animate-spin" />
              Regenerating...
            </span>
          ) : objectsGrid.status === 'failed' ? (
            <span className="text-xs text-destructive">Failed</span>
          ) : (
            <span className="text-xs text-emerald-400">Ready</span>
          )}
        </div>
        <div className="relative rounded-md overflow-hidden bg-background/50 border border-border/50">
          {objectsGrid.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={objectsGrid.url}
              alt="Objects grid"
              className="w-full h-auto object-contain"
            />
          ) : (
            <div className="w-full aspect-square flex items-center justify-center text-muted-foreground">
              No image
            </div>
          )}
        </div>
        {/* Objects Dimensions Editor */}
        <div className="flex flex-col gap-2 p-3 bg-secondary/20 rounded-md">
          <span className="text-xs font-medium text-muted-foreground">
            Objects Grid Dimensions
          </span>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground">Rows</label>
              <Input
                type="number"
                min={1}
                max={6}
                value={objectsRows}
                onChange={(e) =>
                  setObjectsRows(parseInt(e.target.value, 10) || 1)
                }
                className="w-16 h-8 text-xs"
              />
            </div>
            <span className="text-xs text-muted-foreground">x</span>
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground">Cols</label>
              <Input
                type="number"
                min={1}
                max={6}
                value={objectsCols}
                onChange={(e) =>
                  setObjectsCols(parseInt(e.target.value, 10) || 1)
                }
                className="w-16 h-8 text-xs"
              />
            </div>
            <span className="text-xs text-muted-foreground ml-2">
              = {newObjectCount} objects
            </span>
          </div>
          {!isValidGrid(objectsRows, objectsCols) && (
            <div className="flex items-center gap-1 text-xs text-destructive">
              <IconAlertTriangle size={14} />
              Rows and cols must be between 1 and 6, total cells between 2 and
              36
            </div>
          )}
          {objectCountChanged && isValidGrid(objectsRows, objectsCols) && (
            <div className="flex items-center gap-1 text-xs text-yellow-500">
              <IconAlertTriangle size={14} />
              <span>
                Object count changed from {originalObjectCount} to{' '}
                {newObjectCount}.
                {newObjectCount < originalObjectCount
                  ? ` Last ${originalObjectCount - newObjectCount} object name(s) will be trimmed.`
                  : ` ${newObjectCount - originalObjectCount} placeholder object(s) will be added.`}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 p-3 bg-secondary/20 rounded-md">
          <label className="text-xs font-medium text-muted-foreground">
            Objects Grid Prompt
          </label>
          <Textarea
            value={objectsPrompt}
            onChange={(e) => setObjectsPrompt(e.target.value)}
            rows={3}
            className="text-xs"
            placeholder="Prompt for objects grid generation"
          />
        </div>
      </div>

      {/* Backgrounds Grid */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Backgrounds Grid
          </span>
          {backgroundsIsProcessing ? (
            <span className="text-xs text-blue-400 inline-flex items-center gap-1">
              <IconLoader2 size={12} className="animate-spin" />
              Regenerating...
            </span>
          ) : bgGrid.status === 'failed' ? (
            <span className="text-xs text-destructive">Failed</span>
          ) : (
            <span className="text-xs text-emerald-400">Ready</span>
          )}
        </div>
        <div className="relative rounded-md overflow-hidden bg-background/50 border border-border/50">
          {bgGrid.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bgGrid.url}
              alt="Backgrounds grid"
              className="w-full h-auto object-contain"
            />
          ) : (
            <div className="w-full aspect-square flex items-center justify-center text-muted-foreground">
              No image
            </div>
          )}
        </div>
        {/* Backgrounds Dimensions Editor */}
        <div className="flex flex-col gap-2 p-3 bg-secondary/20 rounded-md">
          <span className="text-xs font-medium text-muted-foreground">
            Backgrounds Grid Dimensions
          </span>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground">Rows</label>
              <Input
                type="number"
                min={1}
                max={6}
                value={bgRows}
                onChange={(e) => setBgRows(parseInt(e.target.value, 10) || 1)}
                className="w-16 h-8 text-xs"
              />
            </div>
            <span className="text-xs text-muted-foreground">x</span>
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground">Cols</label>
              <Input
                type="number"
                min={1}
                max={6}
                value={bgCols}
                onChange={(e) => setBgCols(parseInt(e.target.value, 10) || 1)}
                className="w-16 h-8 text-xs"
              />
            </div>
            <span className="text-xs text-muted-foreground ml-2">
              = {newBgCount} backgrounds
            </span>
          </div>
          {!isValidGrid(bgRows, bgCols) && (
            <div className="flex items-center gap-1 text-xs text-destructive">
              <IconAlertTriangle size={14} />
              Rows and cols must be between 1 and 6, total cells between 2 and
              36
            </div>
          )}
          {bgCountChanged && isValidGrid(bgRows, bgCols) && (
            <div className="flex items-center gap-1 text-xs text-yellow-500">
              <IconAlertTriangle size={14} />
              <span>
                Background count changed from {originalBgCount} to {newBgCount}.
                {newBgCount < originalBgCount
                  ? ` Last ${originalBgCount - newBgCount} background name(s) will be trimmed.`
                  : ` ${newBgCount - originalBgCount} placeholder background(s) will be added.`}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1 p-3 bg-secondary/20 rounded-md">
          <label className="text-xs font-medium text-muted-foreground">
            Backgrounds Grid Prompt
          </label>
          <Textarea
            value={backgroundsPrompt}
            onChange={(e) => setBackgroundsPrompt(e.target.value)}
            rows={3}
            className="text-xs"
            placeholder="Prompt for backgrounds grid generation"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        {isAnyGridProcessing && (
          <div className="text-xs text-muted-foreground bg-secondary/20 rounded-md px-2 py-1.5">
            Generation in progress. You can still regenerate the other grid
            while waiting.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 p-3 bg-secondary/20 rounded-md">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Grid Aspect Ratio
            </label>
            <Select
              value={gridAspectRatio}
              onValueChange={(value) =>
                setGridAspectRatio(value as GridAspectRatio)
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRID_ASPECT_RATIO_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Grid Quality
            </label>
            <Select
              value={gridResolution}
              onValueChange={(value) =>
                setGridResolution(value as GridResolution)
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GRID_RESOLUTION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRegenerate('objects')}
            disabled={!canRegenerateObjects}
            className="h-8"
          >
            {isRegeneratingTarget === 'objects' ? (
              <IconLoader2 className="size-3.5 animate-spin mr-1" />
            ) : (
              <IconRefresh className="size-3.5 mr-1" />
            )}
            Objects
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleRegenerate('backgrounds')}
            disabled={!canRegenerateBackgrounds}
            className="h-8"
          >
            {isRegeneratingTarget === 'backgrounds' ? (
              <IconLoader2 className="size-3.5 animate-spin mr-1" />
            ) : (
              <IconRefresh className="size-3.5 mr-1" />
            )}
            Backgrounds
          </Button>
        </div>

        <Button
          size="sm"
          onClick={handleApprove}
          disabled={!canApprove}
          className="h-9 w-full"
        >
          {isApproving ? (
            <IconLoader2 className="size-3.5 animate-spin mr-1" />
          ) : (
            <IconCheck className="size-3.5 mr-1" />
          )}
          Approve &amp; Split
        </Button>
      </div>
    </div>
  );
}
