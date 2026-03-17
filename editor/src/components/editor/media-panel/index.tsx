'use client';

import { TabBar } from './tabbar';
import { useMediaPanelStore, type Tab } from './store';
import { Separator } from '@/components/ui/separator';
import PanelUploads from './panel/uploads';
import PanelImages from './panel/images';
import PanelVideos from './panel/videos';
import PanelEffect from './panel/effects';
import PanelTransition from './panel/transition';
import PanelText from './panel/text';
import PanelCaptions from './panel/captions';
import PanelMusic from './panel/music';
import PanelVoiceovers from './panel/voiceovers';
import PanelSFX from './panel/sfx';
import SeriesAssetsPanel from './panel/series-assets-panel';
import SeriesRoadmapPanel from './panel/series-roadmap-panel';
import PanelRenders from './panel/renders';
import { PropertiesPanel } from '../properties-panel';
import { Assistant } from '@/components/assistant';
import type { IClip } from 'openvideo';
import { useEffect, useState } from 'react';
import { useStudioStore } from '@/stores/studio-store';
import { useAssetStore } from '@/stores/asset-store';
import { useProjectId } from '@/contexts/project-context';

const viewMap: Record<Tab, React.ReactNode> = {
  uploads: <PanelUploads />,
  images: <PanelImages />,
  videos: <PanelVideos />,
  music: <PanelMusic />,
  voiceovers: <PanelVoiceovers />,
  sfx: <PanelSFX />,
  text: <PanelText />,
  captions: <PanelCaptions />,
  transitions: <PanelTransition />,
  effects: <PanelEffect />,
  assistant: <Assistant />,
  assets: <SeriesAssetsPanel />,
  roadmap: <SeriesRoadmapPanel />,
  renders: <PanelRenders />,
};

export function MediaPanel() {
  const { activeTab } = useMediaPanelStore();
  const [selectedClips, setSelectedClips] = useState<IClip[]>([]);
  const { studio, setSelectedClips: setStudioSelectedClips } = useStudioStore();
  const [showProperties, setShowProperties] = useState(false);
  const { fetchAssets } = useAssetStore();
  const projectId = useProjectId();

  useEffect(() => {
    if (projectId) {
      fetchAssets(projectId);
    }
  }, [fetchAssets, projectId]);

  useEffect(() => {
    if (!studio) return;

    const handleSelection = (data: any) => {
      setSelectedClips(data.selected);
      setStudioSelectedClips(data.selected);
      setShowProperties(true);
    };

    const handleClear = () => {
      setSelectedClips([]);
      setShowProperties(false);
    };

    studio.on('selection:created', handleSelection);
    studio.on('selection:updated', handleSelection);
    studio.on('selection:cleared', handleClear);

    return () => {
      studio.off('selection:created', handleSelection);
      studio.off('selection:updated', handleSelection);
      studio.off('selection:cleared', handleClear);
    };
  }, [studio]);

  useEffect(() => {
    if (activeTab) {
      setShowProperties(false);
    }
  }, [activeTab]);

  return (
    <div className="h-full flex flex-col bg-card rounded-sm overflow-hidden w-full">
      <div className="flex-none">
        <TabBar />
      </div>
      <Separator orientation="horizontal" />
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
        {selectedClips.length > 0 && showProperties ? (
          <PropertiesPanel selectedClips={selectedClips} />
        ) : (
          viewMap[activeTab]
        )}
      </div>
    </div>
  );
}
