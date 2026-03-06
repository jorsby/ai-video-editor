'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  IconLoader2,
  IconPhoto,
  IconVideo,
  IconCropPortrait,
  IconCrop169,
  IconSquare,
  IconChevronDown,
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { useAssetStore } from '@/stores/asset-store';
import { useProjectId } from '@/contexts/project-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type MediaType = 'image' | 'video';
type AspectRatio = '16:9' | '9:16' | '1:1';

const ASPECT_RATIO_ICONS: Record<AspectRatio, typeof IconCropPortrait> = {
  '9:16': IconCropPortrait,
  '16:9': IconCrop169,
  '1:1': IconSquare,
};

export const VisualsChatPanel = () => {
  const [prompt, setPrompt] = useState('');
  const [mediaType, setMediaType] = useState<MediaType>('image');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [loading, setLoading] = useState(false);
  const { addAsset } = useAssetStore();
  const projectId = useProjectId();

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    try {
      const endpoint =
        mediaType === 'image' ? '/api/fal/image' : '/api/fal/video';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, aspectRatio, project_id: projectId }),
      });

      if (!response.ok) {
        throw new Error(`Failed to generate ${mediaType}`);
      }

      const data = await response.json();

      addAsset({
        id: data.id || crypto.randomUUID(),
        url: data.url,
        name: prompt,
        prompt: prompt,
        type: mediaType,
        createdAt: Date.now(),
      });

      toast.success(`${mediaType === 'image' ? 'Image' : 'Video'} generated!`);
      setPrompt('');
    } catch (error) {
      console.error(error);
      toast.error(`Failed to generate ${mediaType}`);
    } finally {
      setLoading(false);
    }
  };

  const AspectIcon = ASPECT_RATIO_ICONS[aspectRatio];

  return (
    <div className="flex flex-col h-full bg-panel">
      <div className="rounded-xl h-full p-3 flex flex-col gap-2 shadow-sm">
        <div className="flex gap-2 h-full pt-2">
          <Textarea
            placeholder="Describe what you want to generate..."
            className="resize-none text-sm min-h-[24px] h-full !bg-transparent border-0 focus-visible:ring-0 px-1 py-0 shadow-none placeholder:text-muted-foreground"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 pt-2 w-full justify-between">
          <div className="flex items-center gap-2">
            {/* Media Type Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  {mediaType === 'image' ? (
                    <IconPhoto className="size-4" />
                  ) : (
                    <IconVideo className="size-4" />
                  )}
                  {mediaType === 'image' ? 'Image' : 'Video'}
                  <IconChevronDown className="size-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setMediaType('image')}>
                  <IconPhoto className="size-4" />
                  Image
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMediaType('video')}>
                  <IconVideo className="size-4" />
                  Video
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Aspect Ratio Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <AspectIcon className="size-4" />
                  {aspectRatio}
                  <IconChevronDown className="size-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setAspectRatio('9:16')}>
                  <IconCropPortrait className="size-4" />
                  9:16
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAspectRatio('16:9')}>
                  <IconCrop169 className="size-4" />
                  16:9
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setAspectRatio('1:1')}>
                  <IconSquare className="size-4" />
                  1:1
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Button
            className="h-9 w-24 rounded-full text-sm relative"
            size="sm"
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
          >
            {loading ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              'Generate'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
