'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, Users } from 'lucide-react';
import { CharacterCard } from './character-card';
import { CreateCharacterDialog } from './create-character-dialog';
import { CharacterDetailDialog } from './character-detail-dialog';
import type { CharacterWithImages } from '@/lib/supabase/character-service';

export function CharactersContent() {
  const [characters, setCharacters] = useState<CharacterWithImages[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [selectedCharacter, setSelectedCharacter] =
    useState<CharacterWithImages | null>(null);

  const fetchCharacters = useCallback(async () => {
    try {
      const res = await fetch('/api/characters');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setCharacters(data.characters ?? []);
    } catch (err) {
      console.error('Failed to fetch characters:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCharacters();
  }, [fetchCharacters]);

  const filteredCharacters = searchQuery
    ? characters.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.tags.some((t) =>
            t.toLowerCase().includes(searchQuery.toLowerCase())
          )
      )
    : characters;

  const handleCreated = () => {
    setShowCreateDialog(false);
    fetchCharacters();
  };

  const handleUpdated = () => {
    fetchCharacters();
  };

  const handleDeleted = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    setSelectedCharacter(null);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Character Library
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create and manage reusable characters across your projects and
            series.
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Character
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search characters..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-pulse text-muted-foreground">
            Loading characters...
          </div>
        </div>
      ) : filteredCharacters.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="w-12 h-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">
            {searchQuery ? 'No characters found' : 'No characters yet'}
          </h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">
            {searchQuery
              ? 'Try a different search term.'
              : 'Create your first character to start building consistent series with reusable actors.'}
          </p>
          {!searchQuery && (
            <Button className="mt-4" onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Character
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredCharacters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              onClick={() => setSelectedCharacter(character)}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <CreateCharacterDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleCreated}
      />

      {/* Detail Dialog */}
      {selectedCharacter && (
        <CharacterDetailDialog
          character={selectedCharacter}
          open={!!selectedCharacter}
          onOpenChange={(open) => {
            if (!open) setSelectedCharacter(null);
          }}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
