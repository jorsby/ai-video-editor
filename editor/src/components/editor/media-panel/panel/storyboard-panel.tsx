'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectId } from '@/contexts/project-context';
import { createClient } from '@/lib/supabase/client';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  IconChevronDown,
  IconChevronUp,
  IconMovie,
  IconPhoto,
  IconVolume,
  IconVideo,
  IconMapPin,
  IconUser,
  IconBox,
  IconLoader2,
  IconPlayerPlay,
  IconPlayerPause,
  IconEye,
  IconX,
} from '@tabler/icons-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SceneData {
  id: string;
  order: number;
  title: string | null;
  prompt: string | null;
  audio_text: string | null;
  audio_url: string | null;
  video_url: string | null;
  status: string | null;
  duration: number | null;
  location_variant_slug: string | null;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
}

interface EpisodeData {
  id: string;
  order: number;
  title: string | null;
  synopsis: string | null;
  status: string | null;
  audio_content: string | null;
  visual_outline: string | null;
  asset_variant_map: {
    characters?: string[];
    locations?: string[];
    props?: string[];
  } | null;
  scenes: SceneData[];
}

/** slug → image_url lookup */
type VariantImageMap = Map<string, string>;

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: string | null): string {
  switch (status) {
    case 'done':
      return 'border-green-500/40 bg-green-500/10 text-green-400';
    case 'ready':
    case 'in_progress':
      return 'border-blue-500/40 bg-blue-500/10 text-blue-400';
    case 'failed':
      return 'border-red-500/40 bg-red-500/10 text-red-400';
    default:
      return 'border-border/60 bg-secondary/20 text-muted-foreground';
  }
}

function slugToLabel(slug: string): string {
  return slug
    .replace(/-main$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
}

// ── Image Lightbox ─────────────────────────────────────────────────────────────

function ImageLightbox({
  url,
  label,
  onClose,
}: {
  url: string;
  label: string;
  onClose: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={() => {}}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 size-7 rounded-full bg-black/60 border border-white/20 flex items-center justify-center hover:bg-black/80 transition-colors"
        >
          <IconX className="size-4 text-white" />
        </button>
        <img
          src={url}
          alt={label}
          className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg shadow-2xl"
        />
        <span className="text-sm text-white/80 font-medium">{label}</span>
      </div>
    </div>
  );
}

// ── Variant Avatar ─────────────────────────────────────────────────────────────

function VariantAvatar({
  slug,
  imageMap,
  size = 'sm',
}: {
  slug: string;
  imageMap: VariantImageMap;
  size?: 'sm' | 'md';
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const url = imageMap.get(slug);
  const px = size === 'md' ? 'size-7' : 'size-4';

  if (!url) {
    return (
      <div
        className={`${px} rounded-full bg-muted/40 border border-border/30 flex items-center justify-center shrink-0`}
        title={slugToLabel(slug)}
      >
        <span className="text-[6px] text-muted-foreground">?</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setLightboxOpen(true);
        }}
        className={`${px} rounded-full overflow-hidden border border-border/40 shrink-0 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all`}
        title={`Click to expand: ${slugToLabel(slug)}`}
      >
        <img
          src={url}
          alt={slugToLabel(slug)}
          className="w-full h-full object-cover"
        />
      </button>
      {lightboxOpen && (
        <ImageLightbox
          url={url}
          label={slugToLabel(slug)}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

// ── Mini Audio Player ──────────────────────────────────────────────────────────

function MiniAudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
    } else {
      el.play();
    }
    setPlaying(!playing);
  }, [playing]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTimeUpdate = () => {
      if (el.duration) setProgress(el.currentTime / el.duration);
    };
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
    };

    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('ended', onEnded);
    };
  }, []);

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* biome-ignore lint/a11y/useMediaCaption: internal tool audio */}
      <audio ref={audioRef} src={url} preload="none" />
      <button
        type="button"
        onClick={toggle}
        className="size-5 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center hover:bg-blue-500/30 transition-colors shrink-0"
        title={playing ? 'Pause' : 'Play audio'}
      >
        {playing ? (
          <IconPlayerPause className="size-2.5 text-blue-400" />
        ) : (
          <IconPlayerPlay className="size-2.5 text-blue-400 ml-px" />
        )}
      </button>
      {/* Progress bar */}
      <div className="flex-1 h-1 bg-muted/30 rounded-full overflow-hidden min-w-[40px]">
        <div
          className="h-full bg-blue-400/60 rounded-full transition-all duration-200"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}

// ── Video Thumbnail ────────────────────────────────────────────────────────────

function VideoThumbnail({ url }: { url: string }) {
  const [showPlayer, setShowPlayer] = useState(false);

  if (showPlayer) {
    return (
      <div className="relative rounded-md overflow-hidden border border-border/30 bg-black">
        {/* biome-ignore lint/a11y/useMediaCaption: internal tool video */}
        <video
          src={url}
          controls
          autoPlay
          className="w-full max-h-[200px] object-contain"
          onEnded={() => setShowPlayer(false)}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setShowPlayer(true)}
      className="relative w-full h-16 rounded-md overflow-hidden border border-border/30 bg-black/60 hover:bg-black/40 transition-colors group"
      title="Play video"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="size-8 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/30 transition-colors">
          <IconPlayerPlay className="size-4 text-white ml-0.5" />
        </div>
      </div>
      <div className="absolute bottom-1 right-1">
        <Badge variant="outline" className="text-[8px] bg-black/60 border-white/20 text-white/80">
          <IconVideo className="size-2 mr-0.5" />
          Video
        </Badge>
      </div>
    </button>
  );
}

// ── Prompt Highlighter ─────────────────────────────────────────────────────────

function HighlightedPrompt({
  prompt,
  locationSlug,
  characterSlugs,
  propSlugs,
  imageMap,
}: {
  prompt: string;
  locationSlug: string | null;
  characterSlugs: string[];
  propSlugs: string[];
  imageMap: VariantImageMap;
}) {
  const colorMap = new Map<string, string>();
  if (locationSlug) colorMap.set(locationSlug, 'text-emerald-400 bg-emerald-500/15');
  for (const s of characterSlugs) colorMap.set(s, 'text-blue-400 bg-blue-500/15');
  for (const s of propSlugs) colorMap.set(s, 'text-amber-400 bg-amber-500/15');

  const pattern = /@([a-z0-9]+(?:-[a-z0-9]+)*)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(prompt)) !== null) {
    if (match.index > lastIndex) {
      parts.push(prompt.slice(lastIndex, match.index));
    }
    const slug = match[1];
    const color = colorMap.get(slug);
    if (color) {
      parts.push(
        <span key={match.index} className={`${color} rounded px-0.5 font-medium inline-flex items-center gap-0.5`}>
          <VariantAvatar slug={slug} imageMap={imageMap} />
          @{slugToLabel(slug)}
        </span>
      );
    } else {
      parts.push(
        <span key={match.index} className="text-purple-400 bg-purple-500/15 rounded px-0.5 font-medium">
          @{slug}
        </span>
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < prompt.length) {
    parts.push(prompt.slice(lastIndex));
  }

  return <>{parts}</>;
}

// ── Scene Card ─────────────────────────────────────────────────────────────────

function SceneCard({
  scene,
  index,
  imageMap,
}: {
  scene: SceneData;
  index: number;
  imageMap: VariantImageMap;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasAudio = !!scene.audio_url;
  const hasVideo = !!scene.video_url;
  const hasPrompt = !!scene.prompt;
  const charCount = scene.character_variant_slugs?.length ?? 0;
  const hasLocation = !!scene.location_variant_slug;
  const propCount = scene.prop_variant_slugs?.length ?? 0;

  // Collect all slugs for this scene
  const allSlugs: string[] = [];
  if (scene.location_variant_slug) allSlugs.push(scene.location_variant_slug);
  if (scene.character_variant_slugs) allSlugs.push(...scene.character_variant_slugs);
  if (scene.prop_variant_slugs) allSlugs.push(...scene.prop_variant_slugs);

  return (
    <div className="border border-border/40 rounded-md bg-card/50 overflow-hidden">
      {/* Scene header — clickable */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border/30 hover:bg-muted/40 transition-colors text-left"
      >
        {isExpanded ? (
          <IconChevronUp className="size-3 text-muted-foreground shrink-0" />
        ) : (
          <IconChevronDown className="size-3 text-muted-foreground shrink-0" />
        )}
        <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0">
          S{index + 1}
        </span>
        <span className="text-xs font-medium truncate flex-1">
          {scene.title || `Scene ${index + 1}`}
        </span>

        {/* Mini variant avatars in header */}
        <div className="flex -space-x-1 shrink-0">
          {allSlugs.slice(0, 4).map((slug) => (
            <VariantAvatar key={slug} slug={slug} imageMap={imageMap} />
          ))}
          {allSlugs.length > 4 && (
            <span className="size-4 rounded-full bg-muted/60 border border-border/40 flex items-center justify-center text-[7px] text-muted-foreground shrink-0">
              +{allSlugs.length - 4}
            </span>
          )}
        </div>

        <Badge variant="outline" className={`text-[9px] ${statusColor(scene.status)}`}>
          {scene.status || 'draft'}
        </Badge>
        {scene.duration && (
          <span className="text-[10px] text-muted-foreground">{formatDuration(scene.duration)}</span>
        )}
      </button>

      {/* Scene summary (always visible) */}
      <div className="px-3 py-2 space-y-2">
        {/* Narration */}
        {scene.audio_text && (
          <p className="text-[11px] text-muted-foreground leading-relaxed italic line-clamp-2">
            &ldquo;{scene.audio_text}&rdquo;
          </p>
        )}

        {/* Media row — audio player + video thumbnail */}
        {(hasAudio || hasVideo) && (
          <div className="flex flex-col gap-1.5">
            {hasAudio && <MiniAudioPlayer url={scene.audio_url!} />}
            {hasVideo && <VideoThumbnail url={scene.video_url!} />}
          </div>
        )}

        {/* Asset refs with avatars */}
        <div className="flex flex-wrap gap-1">
          {hasLocation && (
            <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <VariantAvatar slug={scene.location_variant_slug!} imageMap={imageMap} />
              <IconMapPin className="size-2.5" />
              {slugToLabel(scene.location_variant_slug!)}
            </span>
          )}
          {scene.character_variant_slugs?.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20"
            >
              <VariantAvatar slug={slug} imageMap={imageMap} />
              <IconUser className="size-2.5" />
              {slugToLabel(slug)}
            </span>
          ))}
          {scene.prop_variant_slugs?.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20"
            >
              <VariantAvatar slug={slug} imageMap={imageMap} />
              <IconBox className="size-2.5" />
              {slugToLabel(slug)}
            </span>
          ))}
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className={hasPrompt ? 'text-green-400' : 'opacity-30'} title="Visual prompt">
            <IconPhoto className="size-3 inline mr-0.5" />
            Prompt
          </span>
          <span className={hasAudio ? 'text-green-400' : 'opacity-30'} title="Audio/TTS">
            <IconVolume className="size-3 inline mr-0.5" />
            Audio
          </span>
          <span className={hasVideo ? 'text-green-400' : 'opacity-30'} title="Video">
            <IconVideo className="size-3 inline mr-0.5" />
            Video
          </span>
          <span className="ml-auto opacity-50">
            {charCount}ch {hasLocation ? '1loc' : '0loc'} {propCount}pr
          </span>
        </div>
      </div>

      {/* Expanded: Full prompt with highlighted slugs + avatars */}
      {isExpanded && hasPrompt && (
        <div className="px-3 pb-3 pt-1 border-t border-border/20">
          <p className="text-[10px] font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
            Visual Prompt
          </p>
          <div className="text-[11px] leading-relaxed text-foreground/80 bg-muted/20 rounded-md p-2.5 border border-border/20">
            <HighlightedPrompt
              prompt={scene.prompt!}
              locationSlug={scene.location_variant_slug}
              characterSlugs={scene.character_variant_slugs ?? []}
              propSlugs={scene.prop_variant_slugs ?? []}
              imageMap={imageMap}
            />
          </div>
        </div>
      )}

      {isExpanded && !hasPrompt && (
        <div className="px-3 pb-3 pt-1 border-t border-border/20">
          <p className="text-[10px] text-muted-foreground/50 italic">
            No visual prompt written yet.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Gallery Card (expandable) ──────────────────────────────────────────────────

function GalleryCard({
  slug,
  imageMap,
  fallbackIcon: FallbackIcon,
}: {
  slug: string;
  imageMap: VariantImageMap;
  fallbackIcon: React.FC<{ className?: string }>;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const url = imageMap.get(slug);

  return (
    <div className="flex flex-col items-center gap-1">
      {url ? (
        <>
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="w-full aspect-[9/16] rounded-md overflow-hidden border border-border/30 cursor-pointer hover:ring-2 hover:ring-primary/50 hover:brightness-110 transition-all relative group"
          >
            <img
              src={url}
              alt={slugToLabel(slug)}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <IconEye className="size-4 text-white opacity-0 group-hover:opacity-80 transition-opacity" />
            </div>
          </button>
          {lightboxOpen && (
            <ImageLightbox
              url={url}
              label={slugToLabel(slug)}
              onClose={() => setLightboxOpen(false)}
            />
          )}
        </>
      ) : (
        <div className="w-full aspect-[9/16] rounded-md bg-muted/30 border border-border/30 flex items-center justify-center">
          <FallbackIcon className="size-4 text-muted-foreground/30" />
        </div>
      )}
      <span className="text-[8px] text-muted-foreground text-center leading-tight truncate w-full">
        {slugToLabel(slug)}
      </span>
    </div>
  );
}

// ── Asset Gallery ──────────────────────────────────────────────────────────────

function AssetGallery({
  slugs,
  role,
  imageMap,
}: {
  slugs: string[];
  role: 'character' | 'location' | 'prop';
  imageMap: VariantImageMap;
}) {
  if (slugs.length === 0) return null;

  const roleConfig = {
    character: { icon: IconUser, color: 'blue', label: 'Characters' },
    location: { icon: IconMapPin, color: 'emerald', label: 'Locations' },
    prop: { icon: IconBox, color: 'amber', label: 'Props' },
  }[role];

  const Icon = roleConfig.icon;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Icon className="size-3" />
        <span className="font-medium">{roleConfig.label}</span>
        <span className="opacity-50">({slugs.length})</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {slugs.map((slug) => (
          <GalleryCard key={slug} slug={slug} imageMap={imageMap} fallbackIcon={Icon} />
        ))}
      </div>
    </div>
  );
}

// ── Episode Accordion ──────────────────────────────────────────────────────────

function EpisodeAccordion({
  episode,
  imageMap,
}: {
  episode: EpisodeData;
  imageMap: VariantImageMap;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const sceneCount = episode.scenes.length;
  const doneCount = episode.scenes.filter((s) => s.status === 'done').length;
  const hasAnyVideo = episode.scenes.some((s) => !!s.video_url);
  const hasAnyAudio = episode.scenes.some((s) => !!s.audio_url);
  const totalDuration = episode.scenes.reduce((sum, s) => sum + (s.duration || 0), 0);

  // Collect unique slugs per role across all scenes
  const locationSlugs = [...new Set(
    episode.scenes.map((s) => s.location_variant_slug).filter(Boolean) as string[]
  )];
  const characterSlugs = [...new Set(
    episode.scenes.flatMap((s) => s.character_variant_slugs ?? [])
  )];
  const propSlugs = [...new Set(
    episode.scenes.flatMap((s) => s.prop_variant_slugs ?? [])
  )];
  const totalAssets = locationSlugs.length + characterSlugs.length + propSlugs.length;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors rounded-md text-left"
        >
          {isOpen ? (
            <IconChevronUp className="size-3.5 text-muted-foreground shrink-0" />
          ) : (
            <IconChevronDown className="size-3.5 text-muted-foreground shrink-0" />
          )}

          <span className="text-[10px] font-mono text-muted-foreground w-8 shrink-0">
            EP{episode.order}
          </span>

          <span className="text-xs font-medium truncate flex-1">
            {episode.title?.replace(/^EP\d+\s*[-—]\s*/, '') || `Episode ${episode.order}`}
          </span>

          {/* Scene progress */}
          <span className="text-[10px] text-muted-foreground shrink-0">
            {doneCount}/{sceneCount}
          </span>

          <Badge variant="outline" className={`text-[9px] shrink-0 ${statusColor(episode.status)}`}>
            {episode.status || 'draft'}
          </Badge>
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pl-4 pr-1 pb-3 space-y-2">
          {/* Episode summary bar */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground px-2 py-1.5 bg-muted/15 rounded">
            <span>{sceneCount} scenes</span>
            {totalDuration > 0 && <span>{formatDuration(totalDuration)}</span>}
            <span className={hasAnyAudio ? 'text-green-400' : 'opacity-30'}>
              <IconVolume className="size-3 inline" /> Audio
            </span>
            <span className={hasAnyVideo ? 'text-green-400' : 'opacity-30'}>
              <IconVideo className="size-3 inline" /> Video
            </span>
            {totalAssets > 0 && (
              <button
                type="button"
                onClick={() => setShowAssets(!showAssets)}
                className={`ml-auto flex items-center gap-0.5 hover:text-foreground transition-colors ${showAssets ? 'text-foreground' : ''}`}
                title="Toggle asset gallery"
              >
                <IconEye className="size-3" />
                <span>{totalAssets} assets</span>
              </button>
            )}
          </div>

          {/* Synopsis */}
          {episode.synopsis && (
            <p className="text-[10px] text-muted-foreground/70 px-2 line-clamp-2">
              {episode.synopsis}
            </p>
          )}

          {/* Asset Gallery (toggle) */}
          {showAssets && (
            <div className="px-2 py-2 bg-muted/10 rounded-md border border-border/20 space-y-3">
              <AssetGallery slugs={locationSlugs} role="location" imageMap={imageMap} />
              <AssetGallery slugs={characterSlugs} role="character" imageMap={imageMap} />
              <AssetGallery slugs={propSlugs} role="prop" imageMap={imageMap} />
            </div>
          )}

          {/* Scenes */}
          {episode.scenes.length > 0 ? (
            <div className="space-y-1.5">
              {episode.scenes.map((scene, i) => (
                <SceneCard key={scene.id} scene={scene} index={i} imageMap={imageMap} />
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/50 px-2 py-4 text-center">
              No scenes yet
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export default function StoryboardPanel() {
  const projectId = useProjectId();
  const [episodes, setEpisodes] = useState<EpisodeData[]>([]);
  const [seriesName, setSeriesName] = useState<string | null>(null);
  const [imageMap, setImageMap] = useState<VariantImageMap>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!projectId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      const supabase = createClient('studio');

      try {
        // Find series for this project
        const { data: seriesRow } = await supabase
          .from('series')
          .select('id, name')
          .eq('project_id', projectId)
          .limit(1)
          .maybeSingle();

        if (!seriesRow) {
          if (!cancelled) {
            setEpisodes([]);
            setIsLoading(false);
          }
          return;
        }

        if (!cancelled) setSeriesName(seriesRow.name);

        // Fetch episodes
        const { data: epRows, error: epError } = await supabase
          .from('episodes')
          .select(
            'id, "order", title, synopsis, status, audio_content, visual_outline, asset_variant_map'
          )
          .eq('series_id', seriesRow.id)
          .order('"order"', { ascending: true });

        if (epError) throw new Error(epError.message);

        // Fetch all scenes for these episodes
        const epIds = (epRows ?? []).map((e: { id: string }) => e.id);
        let allScenes: SceneData[] = [];
        if (epIds.length > 0) {
          const { data: sceneRows, error: scError } = await supabase
            .from('scenes')
            .select(
              'id, episode_id, "order", title, prompt, audio_text, audio_url, video_url, status, duration, location_variant_slug, character_variant_slugs, prop_variant_slugs'
            )
            .in('episode_id', epIds)
            .order('"order"', { ascending: true });

          if (scError) throw new Error(scError.message);
          allScenes = (sceneRows ?? []) as unknown as (SceneData & { episode_id: string })[];
        }

        // Collect all unique variant slugs across scenes
        const slugSet = new Set<string>();
        for (const s of allScenes as (SceneData & { episode_id: string })[]) {
          if (s.location_variant_slug) slugSet.add(s.location_variant_slug);
          for (const c of s.character_variant_slugs ?? []) slugSet.add(c);
          for (const p of s.prop_variant_slugs ?? []) slugSet.add(p);
        }

        // Fetch variant images for all referenced slugs
        const newImageMap = new Map<string, string>();
        if (slugSet.size > 0) {
          const { data: variantRows } = await supabase
            .from('series_asset_variants')
            .select('slug, image_url')
            .in('slug', [...slugSet])
            .not('image_url', 'is', null);

          for (const v of variantRows ?? []) {
            if (v.slug && v.image_url) {
              newImageMap.set(v.slug, v.image_url);
            }
          }
        }

        // Group scenes by episode
        const scenesByEp = new Map<string, SceneData[]>();
        for (const s of allScenes as (SceneData & { episode_id: string })[]) {
          const arr = scenesByEp.get(s.episode_id) ?? [];
          arr.push(s);
          scenesByEp.set(s.episode_id, arr);
        }

        const parsed: EpisodeData[] = (epRows ?? []).map((ep: any) => ({
          id: ep.id,
          order: ep.order,
          title: ep.title,
          synopsis: ep.synopsis,
          status: ep.status,
          audio_content: ep.audio_content,
          visual_outline: ep.visual_outline,
          asset_variant_map: ep.asset_variant_map,
          scenes: scenesByEp.get(ep.id) ?? [],
        }));

        if (!cancelled) {
          setEpisodes(parsed);
          setImageMap(newImageMap);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load');
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-xs text-destructive text-center">{error}</p>
      </div>
    );
  }

  if (episodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center px-4 text-center gap-2">
        <IconMovie className="size-8 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">No episodes yet.</p>
        <p className="text-[10px] text-muted-foreground/50">
          Create episodes via API to see the storyboard.
        </p>
      </div>
    );
  }

  // Stats
  const totalScenes = episodes.reduce((s, e) => s + e.scenes.length, 0);
  const doneScenes = episodes.reduce(
    (s, e) => s + e.scenes.filter((sc) => sc.status === 'done').length,
    0
  );
  const totalDuration = episodes.reduce(
    (s, e) => s + e.scenes.reduce((ss, sc) => ss + (sc.duration || 0), 0),
    0
  );
  const totalVariantImages = imageMap.size;

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold">{seriesName || 'Storyboard'}</h3>
            <p className="text-[10px] text-muted-foreground">
              {episodes.length} episodes · {totalScenes} scenes
              {totalDuration > 0 && ` · ${formatDuration(totalDuration)}`}
              {totalVariantImages > 0 && ` · ${totalVariantImages} images`}
            </p>
          </div>
          <Badge variant="outline" className="text-[9px]">
            {doneScenes}/{totalScenes} done
          </Badge>
        </div>

        {/* Episode list */}
        {episodes.map((ep) => (
          <EpisodeAccordion key={ep.id} episode={ep} imageMap={imageMap} />
        ))}
      </div>
    </ScrollArea>
  );
}
