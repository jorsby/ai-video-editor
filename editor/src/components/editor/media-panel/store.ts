import {
  IconFolder,
  IconLetterT,
  IconSubtitles,
  IconMusic,
  IconMicrophone,
  IconWaveSine,
  IconArrowsLeftRight,
  IconSparkles,
  type IconProps,
  IconPhoto,
  IconVideo,
  IconMessageCircle,
  IconLayoutGrid,
  IconDeviceTv,
} from '@tabler/icons-react';
import { create } from 'zustand';

export type Tab =
  | 'uploads'
  | 'images'
  | 'videos'
  | 'music'
  | 'text'
  | 'captions'
  | 'effects'
  // | 'elements'
  | 'voiceovers'
  | 'sfx'
  | 'transitions'
  | 'assistant'
  | 'storyboard'
  | 'renders';

export const tabs: {
  [key in Tab]: { icon: React.FC<IconProps>; label: string };
} = {
  storyboard: {
    icon: IconLayoutGrid,
    label: 'Storyboard',
  },
  renders: {
    icon: IconDeviceTv,
    label: 'Renders',
  },
  uploads: {
    icon: IconFolder,
    label: 'Uploads',
  },
  images: {
    icon: IconPhoto,
    label: 'Images',
  },
  videos: {
    icon: IconVideo,
    label: 'Videos',
  },
  text: {
    icon: IconLetterT,
    label: 'Text',
  },
  // elements: {
  //   icon: IconCircleSquare,
  //   label: 'Elements',
  // },
  captions: {
    icon: IconSubtitles,
    label: 'Captions',
  },
  music: {
    icon: IconMusic,
    label: 'Music',
  },
  voiceovers: {
    icon: IconMicrophone,
    label: 'Voiceovers',
  },
  sfx: {
    icon: IconWaveSine,
    label: 'SFX',
  },
  transitions: {
    icon: IconArrowsLeftRight,
    label: 'Transitions',
  },
  effects: {
    icon: IconSparkles,
    label: 'Effects',
  },
  assistant: {
    icon: IconMessageCircle,
    label: 'Assistant',
  },
};

interface MediaPanelStore {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  highlightMediaId: string | null;
  requestRevealMedia: (mediaId: string) => void;
  clearHighlight: () => void;
  showProperties: boolean;
  setShowProperties: (show: boolean) => void;
}

export const useMediaPanelStore = create<MediaPanelStore>((set) => ({
  activeTab: 'storyboard',
  setActiveTab: (tab) => set({ activeTab: tab, showProperties: false }),
  highlightMediaId: null,
  requestRevealMedia: (mediaId) =>
    set({
      activeTab: 'uploads',
      highlightMediaId: mediaId,
      showProperties: false,
    }),
  clearHighlight: () => set({ highlightMediaId: null }),
  showProperties: false,
  setShowProperties: (show) => set({ showProperties: show }),
}));
