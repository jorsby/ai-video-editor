'use client';

import { ProviderIcon } from './provider-icon';

interface PlatformFilterProps {
  platforms: string[];
  selectedPlatforms: Set<string>;
  onTogglePlatform: (platform: string) => void;
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  facebook_page: 'Facebook',
  youtube: 'YouTube',
};

export function PlatformFilter({
  platforms,
  selectedPlatforms,
  onTogglePlatform,
}: PlatformFilterProps) {
  if (platforms.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-muted-foreground">Platform:</span>
      {platforms.map((platform) => {
        const isSelected = selectedPlatforms.has(platform);
        return (
          <button
            key={platform}
            type="button"
            onClick={() => onTogglePlatform(platform)}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs transition-colors ${
              isSelected
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <ProviderIcon provider={platform} className="h-3 w-3" />
            {PLATFORM_LABELS[platform] || platform}
          </button>
        );
      })}
    </div>
  );
}
