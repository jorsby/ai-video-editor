'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconAlertTriangle, IconCheck, IconLoader2 } from '@tabler/icons-react';
import { toast } from 'sonner';
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
}

export function RefGridImageReview({
  objectsGrid,
  bgGrid,
  storyboard,
  onApproveComplete,
}: RefGridImageReviewProps) {
  const plan = storyboard.plan as RefPlan;
  const [isApproving, setIsApproving] = useState(false);

  const [objectsRows, setObjectsRows] = useState(plan.objects_rows);
  const [objectsCols, setObjectsCols] = useState(plan.objects_cols);
  const [bgRows, setBgRows] = useState(plan.bg_rows);
  const [bgCols, setBgCols] = useState(plan.bg_cols);

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

  const canApprove = isValidRange && !isApproving;

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

  return (
    <div className="flex flex-col gap-3">
      {/* Objects Grid */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Objects Grid
        </span>
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
      </div>

      {/* Backgrounds Grid */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          Backgrounds Grid
        </span>
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
      </div>

      {/* Action Button */}
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
  );
}
