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
  Storyboard,
  StoryboardPlan,
} from '@/lib/supabase/workflow-service';

interface GridImageReviewProps {
  gridImage: GridImage;
  storyboard: Storyboard;
  onApproveComplete: () => void;
  onRegenerateComplete: () => void;
}

export function GridImageReview({
  gridImage,
  storyboard,
  onApproveComplete,
  onRegenerateComplete,
}: GridImageReviewProps) {
  // This component is for i2v grid review; cast plan to StoryboardPlan
  const plan = storyboard.plan as StoryboardPlan;
  const [rows, setRows] = useState(plan.rows);
  const [cols, setCols] = useState(plan.cols);
  const [gridPrompt, setGridPrompt] = useState(plan.grid_image_prompt);
  const [gridAspectRatio, setGridAspectRatio] = useState<GridAspectRatio>(
    plan.grid_generation_aspect_ratio ?? DEFAULT_GRID_ASPECT_RATIO
  );
  const [gridResolution, setGridResolution] = useState<GridResolution>(
    plan.grid_generation_resolution ?? DEFAULT_GRID_RESOLUTION
  );
  const [isApproving, setIsApproving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  const originalSceneCount = plan.rows * plan.cols;
  const newSceneCount = rows * cols;
  const sceneCountChanged = newSceneCount !== originalSceneCount;

  const isValidRange = rows >= 2 && rows <= 8 && cols >= 2 && cols <= 8;
  const canApprove = isValidRange && !isApproving && !isRegenerating;
  const canRegenerate =
    !isApproving && !isRegenerating && gridPrompt.trim().length > 0;

  const handleApprove = async () => {
    if (!canApprove) return;
    setIsApproving(true);
    try {
      const response = await fetch('/api/storyboard/approve-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboardId: storyboard.id,
          gridImageId: gridImage.id,
          rows,
          cols,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to approve grid');
      }
      toast.success('Grid approved! Splitting into scenes...');
      onApproveComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to approve grid'
      );
    } finally {
      setIsApproving(false);
    }
  };

  const handleRegenerate = async () => {
    if (!canRegenerate) return;

    setIsRegenerating(true);
    try {
      const response = await fetch('/api/storyboard/regenerate-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storyboardId: storyboard.id,
          gridImagePrompt: gridPrompt.trim(),
          gridAspectRatio,
          gridResolution,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to regenerate grid');
      }
      toast.success('Regenerating grid image...');
      onRegenerateComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to regenerate grid'
      );
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Grid Image Preview */}
      <div className="relative rounded-md overflow-hidden bg-background/50 border border-border/50">
        {gridImage.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={gridImage.url}
            alt="Generated grid"
            className="w-full h-auto object-contain"
          />
        ) : (
          <div className="w-full aspect-square flex items-center justify-center text-muted-foreground">
            No image
          </div>
        )}
      </div>

      {/* Grid Dimensions Editor */}
      <div className="flex flex-col gap-2 p-3 bg-secondary/20 rounded-md">
        <span className="text-xs font-medium text-muted-foreground">
          Grid Dimensions
        </span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <label className="text-xs text-muted-foreground">Rows</label>
            <Input
              type="number"
              min={2}
              max={8}
              value={rows}
              onChange={(e) => setRows(parseInt(e.target.value, 10) || 2)}
              className="w-16 h-8 text-xs"
            />
          </div>
          <span className="text-xs text-muted-foreground">x</span>
          <div className="flex items-center gap-1">
            <label className="text-xs text-muted-foreground">Cols</label>
            <Input
              type="number"
              min={2}
              max={8}
              value={cols}
              onChange={(e) => setCols(parseInt(e.target.value, 10) || 2)}
              className="w-16 h-8 text-xs"
            />
          </div>
          <span className="text-xs text-muted-foreground ml-2">
            = {newSceneCount} scenes
          </span>
        </div>

        {/* Validation warnings */}
        {!isValidRange && (
          <div className="flex items-center gap-1 text-xs text-destructive">
            <IconAlertTriangle size={14} />
            Rows and cols must be between 2 and 8
          </div>
        )}
        {sceneCountChanged && isValidRange && (
          <div className="flex items-center gap-1 text-xs text-yellow-500">
            <IconAlertTriangle size={14} />
            <span>
              Scene count changed from {originalSceneCount} to {newSceneCount}.
              {newSceneCount < originalSceneCount
                ? ` Last ${originalSceneCount - newSceneCount} voiceover(s) will be dropped.`
                : ` ${newSceneCount - originalSceneCount} scene(s) will duplicate the last entry.`}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 p-3 bg-secondary/20 rounded-md">
        <label className="text-xs font-medium text-muted-foreground">
          Grid Prompt
        </label>
        <Textarea
          value={gridPrompt}
          onChange={(e) => setGridPrompt(e.target.value)}
          rows={4}
          className="text-xs"
          placeholder="Prompt for grid generation"
        />
      </div>

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

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRegenerate}
          disabled={!canRegenerate}
          className="h-8"
        >
          {isRegenerating ? (
            <IconLoader2 className="size-3.5 animate-spin mr-1" />
          ) : (
            <IconRefresh className="size-3.5 mr-1" />
          )}
          Regenerate
        </Button>
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={!canApprove}
          className="h-8 flex-1"
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
