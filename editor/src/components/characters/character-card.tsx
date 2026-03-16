'use client';

import { User, ImageIcon } from 'lucide-react';
import type { CharacterWithImages } from '@/lib/supabase/character-service';

interface CharacterCardProps {
  character: CharacterWithImages;
  onClick: () => void;
}

export function CharacterCard({ character, onClick }: CharacterCardProps) {
  // Find the best image to display (prefer frontal)
  const displayImage =
    character.character_images.find((img) => img.kind === 'frontal') ??
    character.character_images.find((img) => img.angle === 'front') ??
    character.character_images[0];

  const imageCount = character.character_images.length;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex flex-col rounded-xl border border-border/50 bg-card hover:bg-card/80 hover:border-border transition-all overflow-hidden text-left"
    >
      {/* Image area */}
      <div className="aspect-square relative bg-muted/30 overflow-hidden">
        {displayImage?.url ? (
          <img
            src={displayImage.url}
            alt={character.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <User className="w-16 h-16 text-muted-foreground/20" />
          </div>
        )}

        {/* Image count badge */}
        {imageCount > 0 && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px]">
            <ImageIcon className="w-3 h-3" />
            {imageCount}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        <h3 className="font-medium text-sm truncate">{character.name}</h3>
        {character.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {character.description}
          </p>
        )}
        {character.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {character.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
              >
                {tag}
              </span>
            ))}
            {character.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground">
                +{character.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
