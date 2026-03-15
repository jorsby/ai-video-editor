'use client';

import { useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { Upload, Trash2, Loader2, Save, ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import type {
  CharacterWithImages,
  CharacterImageAngle,
  CharacterImageKind,
} from '@/lib/supabase/character-service';

const ANGLE_LABELS: Record<CharacterImageAngle, string> = {
  front: 'Front',
  left_profile: 'Left Profile',
  right_profile: 'Right Profile',
  three_quarter_left: '¾ Left',
  three_quarter_right: '¾ Right',
  back: 'Back',
};

interface CharacterDetailDialogProps {
  character: CharacterWithImages;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
  onDeleted: (id: string) => void;
}

export function CharacterDetailDialog({
  character,
  open,
  onOpenChange,
  onUpdated,
  onDeleted,
}: CharacterDetailDialogProps) {
  const [name, setName] = useState(character.name);
  const [description, setDescription] = useState(character.description ?? '');
  const [tags, setTags] = useState(character.tags.join(', '));
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadAngle, setUploadAngle] = useState<CharacterImageAngle>('front');
  const [uploadKind, setUploadKind] = useState<CharacterImageKind>('reference');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasChanges =
    name !== character.name ||
    description !== (character.description ?? '') ||
    tags !== character.tags.join(', ');

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch(`/api/characters/${character.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          tags: tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });

      if (!res.ok) throw new Error('Failed to update');
      toast.success('Character updated');
      onUpdated();
    } catch (err) {
      console.error('Update error:', err);
      toast.error('Failed to update character');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/characters/${character.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete');
      toast.success(`"${character.name}" deleted`);
      onDeleted(character.id);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Failed to delete character');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('angle', uploadAngle);
      formData.append('kind', uploadKind);

      const res = await fetch(`/api/characters/${character.id}/images`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Failed to upload');
      toast.success('Image added');
      onUpdated();
    } catch (err) {
      console.error('Image upload error:', err);
      toast.error('Failed to upload image');
    } finally {
      setIsUploadingImage(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteImage = async (imageId: string) => {
    try {
      const res = await fetch(`/api/characters/${character.id}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_id: imageId }),
      });

      if (!res.ok) throw new Error('Failed to delete image');
      toast.success('Image removed');
      onUpdated();
    } catch (err) {
      console.error('Delete image error:', err);
      toast.error('Failed to remove image');
    }
  };

  // Sort images: frontal first, then by angle
  const sortedImages = [...character.character_images].sort((a, b) => {
    if (a.kind === 'frontal' && b.kind !== 'frontal') return -1;
    if (b.kind === 'frontal' && a.kind !== 'frontal') return 1;
    return 0;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <span>{character.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Images grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Reference Images ({character.character_images.length})
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={uploadAngle}
                  onChange={(e) =>
                    setUploadAngle(e.target.value as CharacterImageAngle)
                  }
                  className="h-7 text-[10px] rounded-md border border-border bg-background px-2"
                >
                  {Object.entries(ANGLE_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={uploadKind}
                  onChange={(e) =>
                    setUploadKind(e.target.value as CharacterImageKind)
                  }
                  className="h-7 text-[10px] rounded-md border border-border bg-background px-2"
                >
                  <option value="frontal">Frontal</option>
                  <option value="reference">Reference</option>
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[10px]"
                  disabled={isUploadingImage}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isUploadingImage ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : (
                    <ImagePlus className="w-3 h-3 mr-1" />
                  )}
                  Add Image
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </div>
            </div>

            {sortedImages.length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {sortedImages.map((img) => (
                  <div
                    key={img.id}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-border/50 bg-muted/20"
                  >
                    {img.url ? (
                      <img
                        src={img.url}
                        alt={`${character.name} - ${img.angle}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground/30">
                        No URL
                      </div>
                    )}
                    {/* Overlay with info + delete */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end">
                      <div className="w-full p-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-white font-medium">
                            {ANGLE_LABELS[img.angle]}
                          </span>
                          <span className="text-[9px] text-white/70">
                            {img.kind} · {img.source}
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteImage(img.id);
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {/* Kind badge */}
                    {img.kind === 'frontal' && (
                      <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500/80 text-white">
                        FRONTAL
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 rounded-lg border border-dashed border-border/50 bg-muted/10">
                <Upload className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">
                  No images yet. Upload a frontal reference to get started.
                </p>
              </div>
            )}
          </div>

          {/* Character info */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="detail-name" className="text-xs">
                Name
              </label>
              <Input
                id="detail-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="detail-desc" className="text-xs">
                Description
              </label>
              <Textarea
                id="detail-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Physical appearance, personality, role..."
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="detail-tags" className="text-xs">
                Tags
              </label>
              <Input
                id="detail-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Comma-separated tags"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-border/50">
            <Button
              variant="destructive"
              size="sm"
              disabled={isDeleting}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete "${character.name}"? This will permanently remove this character and all reference images.`
                  )
                ) {
                  handleDelete();
                }
              }}
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Trash2 className="w-4 h-4 mr-1" />
              )}
              Delete Character
            </Button>

            <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <Save className="w-4 h-4 mr-1" />
              )}
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
