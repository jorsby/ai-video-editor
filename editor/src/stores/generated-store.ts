import { create } from 'zustand';
// OLD: localStorage persistence (replaced with Supabase)
// import { persist } from 'zustand/middleware';

export interface GeneratedAsset {
  id: string;
  url: string;
  text: string; // The prompt
  type: 'voiceover' | 'sfx' | 'music' | 'image' | 'video';
  createdAt: number;
}

interface GeneratedState {
  voiceovers: GeneratedAsset[];
  sfx: GeneratedAsset[];
  music: GeneratedAsset[];
  images: GeneratedAsset[];
  videos: GeneratedAsset[];

  // Track in-progress generations
  isGenerating: {
    voiceover: boolean;
    sfx: boolean;
    music: boolean;
    image: boolean;
    video: boolean;
  };

  // Loading state for fetching from Supabase
  isLoading: boolean;
  hasFetched: boolean;
  currentProjectId: string | null;

  addAsset: (asset: GeneratedAsset) => void;
  removeAsset: (id: string, type: GeneratedAsset['type']) => void;
  setGenerating: (type: GeneratedAsset['type'], isGenerating: boolean) => void;

  // NEW: Supabase integration
  fetchAssets: (projectId: string) => Promise<void>;
  deleteAsset: (id: string, type: GeneratedAsset['type']) => Promise<void>;
  setAssets: (assets: GeneratedAsset[]) => void;
  setCurrentProject: (projectId: string) => void;
  resetForProject: (projectId: string) => void;
}

const getArrayKey = (type: GeneratedAsset['type']) => {
  switch (type) {
    case 'voiceover':
      return 'voiceovers';
    case 'sfx':
      return 'sfx';
    case 'music':
      return 'music';
    case 'image':
      return 'images';
    case 'video':
      return 'videos';
  }
};

// NEW: Supabase implementation
export const useGeneratedStore = create<GeneratedState>()((set, get) => ({
  voiceovers: [],
  sfx: [],
  music: [],
  images: [],
  videos: [],
  isGenerating: {
    voiceover: false,
    sfx: false,
    music: false,
    image: false,
    video: false,
  },
  isLoading: false,
  hasFetched: false,
  currentProjectId: null,

  addAsset: (asset) =>
    set((state) => {
      const key = getArrayKey(asset.type);
      return { [key]: [asset, ...state[key]] };
    }),

  removeAsset: (id, type) =>
    set((state) => {
      const key = getArrayKey(type);
      return { [key]: state[key].filter((a) => a.id !== id) };
    }),

  setGenerating: (type, isGenerating) =>
    set((state) => ({
      isGenerating: {
        ...state.isGenerating,
        [type]: isGenerating,
      },
    })),

  // NEW: Fetch all assets from Supabase for a project
  fetchAssets: async (projectId: string) => {
    const state = get();
    // Don't fetch if already fetched for this project
    if (state.hasFetched && state.currentProjectId === projectId) return;

    set({ isLoading: true, currentProjectId: projectId });
    try {
      const response = await fetch(`/api/assets?project_id=${projectId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch assets');
      }
      const { assets } = await response.json();

      // Transform Supabase assets to GeneratedAsset format and categorize
      const voiceovers: GeneratedAsset[] = [];
      const sfx: GeneratedAsset[] = [];
      const music: GeneratedAsset[] = [];
      const images: GeneratedAsset[] = [];
      const videos: GeneratedAsset[] = [];

      for (const asset of assets) {
        const generatedAsset: GeneratedAsset = {
          id: asset.id,
          url: asset.url,
          text: asset.prompt || asset.name,
          type: asset.type as GeneratedAsset['type'],
          createdAt: new Date(asset.created_at).getTime(),
        };

        switch (asset.type) {
          case 'voiceover':
            voiceovers.push(generatedAsset);
            break;
          case 'sfx':
            sfx.push(generatedAsset);
            break;
          case 'music':
            music.push(generatedAsset);
            break;
          case 'image':
            images.push(generatedAsset);
            break;
          case 'video':
            videos.push(generatedAsset);
            break;
        }
      }

      set({ voiceovers, sfx, music, images, videos, hasFetched: true });
    } catch (error) {
      console.error('Failed to fetch assets:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  // NEW: Delete asset from Supabase
  deleteAsset: async (id, type) => {
    try {
      const response = await fetch(`/api/assets?id=${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete asset');
      }

      // Remove from local state
      const key = getArrayKey(type);
      set((state) => ({
        [key]: state[key].filter((a) => a.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete asset:', error);
      throw error;
    }
  },

  // NEW: Set assets directly (used after generation)
  setAssets: (assets) => {
    const voiceovers: GeneratedAsset[] = [];
    const sfx: GeneratedAsset[] = [];
    const music: GeneratedAsset[] = [];
    const images: GeneratedAsset[] = [];
    const videos: GeneratedAsset[] = [];

    for (const asset of assets) {
      switch (asset.type) {
        case 'voiceover':
          voiceovers.push(asset);
          break;
        case 'sfx':
          sfx.push(asset);
          break;
        case 'music':
          music.push(asset);
          break;
        case 'image':
          images.push(asset);
          break;
        case 'video':
          videos.push(asset);
          break;
      }
    }

    set({ voiceovers, sfx, music, images, videos });
  },

  // Set current project without fetching
  setCurrentProject: (projectId: string) => {
    set({ currentProjectId: projectId });
  },

  // Reset store for a new project
  resetForProject: (projectId: string) => {
    set({
      voiceovers: [],
      sfx: [],
      music: [],
      images: [],
      videos: [],
      hasFetched: false,
      currentProjectId: projectId,
    });
  },
}));
