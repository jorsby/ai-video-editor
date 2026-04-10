'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useProjectId } from '@/contexts/project-context';
import { createClient } from '@/lib/supabase/client';
import {
  IconLoader2,
  IconDeviceFloppy,
  IconSettings,
} from '@tabler/icons-react';
import { toast } from 'sonner';

interface ImageModels {
  character: string;
  location: string;
  prop: string;
  character_i2i?: string;
  location_i2i?: string;
  prop_i2i?: string;
}

interface ProjectSettings {
  voice_id?: string;
  tts_speed?: number;
  video_model?: string;
  video_resolution?: string;
  image_models?: ImageModels;
  aspect_ratio?: string;
  visual_style?: string;
  genre?: string;
  tone?: string;
  language?: string;
}

const DEFAULT_IMAGE_MODELS: ImageModels = {
  character: 'z-image',
  location: 'gpt-image/1.5-text-to-image',
  prop: 'z-image',
};

const VOICE_OPTIONS = [
  { value: 'Rachel', label: 'Rachel (Calm, Narrator)' },
  { value: 'Drew', label: 'Drew (Deep, Male)' },
  { value: 'Clyde', label: 'Clyde (War Veteran)' },
  { value: 'Paul', label: 'Paul (News Anchor)' },
  { value: 'Domi', label: 'Domi (Strong, Female)' },
  { value: 'Dave', label: 'Dave (British, Conversational)' },
  { value: 'Fin', label: 'Fin (Irish, Male)' },
  { value: 'Sarah', label: 'Sarah (Soft, Female)' },
  { value: 'Antoni', label: 'Antoni (Well-Rounded)' },
  { value: 'Thomas', label: 'Thomas (Calm, Male)' },
  { value: 'Charlie', label: 'Charlie (Casual, Australian)' },
  { value: 'George', label: 'George (Warm, British)' },
  { value: 'Emily', label: 'Emily (Calm, Female)' },
  { value: 'Elli', label: 'Elli (Emotional, Female)' },
  { value: 'Callum', label: 'Callum (Intense, Transatlantic)' },
  { value: 'Patrick', label: 'Patrick (Shouty, Male)' },
  { value: 'Harry', label: 'Harry (Anxious, Male)' },
  { value: 'Liam', label: 'Liam (Articulate, Male)' },
  { value: 'Dorothy', label: 'Dorothy (Pleasant, Female)' },
  { value: 'Josh', label: 'Josh (Deep, Young Male)' },
  { value: 'Arnold', label: 'Arnold (Crisp, Male)' },
  { value: 'Charlotte', label: 'Charlotte (Swedish, Female)' },
  { value: 'Matilda', label: 'Matilda (Warm, Female)' },
  { value: 'Matthew', label: 'Matthew (Audiobook, Male)' },
  { value: 'James', label: 'James (Calm, Australian)' },
  { value: 'Joseph', label: 'Joseph (British, Male)' },
  { value: 'Jeremy', label: 'Jeremy (Excited, Male)' },
  { value: 'Michael', label: 'Michael (Audiobook, Male)' },
  { value: 'Serena', label: 'Serena (Pleasant, Female)' },
  { value: 'Adam', label: 'Adam (Deep, Male)' },
  { value: 'Nicole', label: 'Nicole (Whisper, Female)' },
  { value: 'Bill', label: 'Bill (Documentary, Male)' },
  { value: 'Jessie', label: 'Jessie (Fast, Female)' },
  { value: 'Sam', label: 'Sam (Raspy, Male)' },
  { value: 'Glinda', label: 'Glinda (Witch, Female)' },
  { value: 'Giovanni', label: 'Giovanni (Foreigner, Male)' },
  { value: 'Mimi', label: 'Mimi (Childish, Female)' },
  { value: 'KoQQbl9zjAdLgKZjm8Ol', label: 'Sunu (Turkish)' },
];

const VIDEO_MODEL_OPTIONS = [
  { value: 'grok-imagine/image-to-video', label: 'Grok Imagine (Image→Video)' },
  { value: 'kling/v2.0/image-to-video', label: 'Kling v2.0 (Image→Video)' },
  { value: 'kling/v1.6/image-to-video', label: 'Kling v1.6 (Image→Video)' },
];

const VIDEO_RESOLUTION_OPTIONS = [
  { value: '480p', label: '480p (Fast, Lower Quality)' },
  { value: '720p', label: '720p (Slower, Higher Quality)' },
];

const IMAGE_MODEL_OPTIONS = [
  { value: 'z-image', label: 'Z-Image' },
  { value: 'gpt-image/1.5-text-to-image', label: 'GPT Image 1.5' },
  { value: 'flux-2/pro-text-to-image', label: 'Flux 2 Pro (2K)' },
  { value: 'nano-banana-2', label: 'Nano Banana 2' },
];

const I2I_MODEL_OPTIONS = [
  { value: 'flux-2/pro-image-to-image', label: 'Flux 2 Pro (I2I)' },
  { value: 'gpt-image/1.5-image-to-image', label: 'GPT Image 1.5 (I2I)' },
  { value: 'nano-banana-2', label: 'Nano Banana 2 (I2I)' },
];

const DEFAULT_I2I_IMAGE_MODELS: Record<string, string> = {
  character_i2i: 'flux-2/pro-image-to-image',
  location_i2i: 'gpt-image/1.5-image-to-image',
  prop_i2i: 'flux-2/pro-image-to-image',
};

const ASPECT_RATIO_OPTIONS = [
  { value: '9:16', label: '9:16 (Vertical)' },
  { value: '16:9', label: '16:9 (Horizontal)' },
  { value: '1:1', label: '1:1 (Square)' },
  { value: '4:5', label: '4:5 (Portrait)' },
  { value: '3:4', label: '3:4 (Portrait)' },
];

function SettingRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

const SETTINGS_DEFAULTS: Required<ProjectSettings> = {
  voice_id: 'Rachel',
  tts_speed: 1.0,
  video_model: 'grok-imagine/image-to-video',
  video_resolution: '480p',
  image_models: { ...DEFAULT_IMAGE_MODELS },
  aspect_ratio: '9:16',
  visual_style: '',
  genre: '',
  tone: '',
  language: '',
};

export default function VideoSettingsPanel() {
  const projectId = useProjectId();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Draft state for editing
  const [draft, setDraft] = useState<Partial<ProjectSettings>>({});

  const load = useCallback(async () => {
    if (!projectId) return;

    const supabase = createClient('studio');

    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('name, settings')
      .eq('id', projectId)
      .maybeSingle();

    if (fetchError || !project) {
      setError('Project not found');
      setIsLoading(false);
      return;
    }

    setProjectName(project.name ?? 'Untitled');
    const saved = (project.settings ?? {}) as ProjectSettings;
    setSettings(saved);
    setDraft({});
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const merged = settings
    ? { ...SETTINGS_DEFAULTS, ...settings, ...draft }
    : null;

  const hasChanges = Object.keys(draft).length > 0;

  const save = async () => {
    if (!projectId || !hasChanges) return;

    setIsSaving(true);
    try {
      const supabase = createClient('studio');
      const newSettings = { ...settings, ...draft };

      const { error: updateError } = await supabase
        .from('projects')
        .update({ settings: newSettings })
        .eq('id', projectId);

      if (updateError) {
        toast.error('Failed to save settings');
        return;
      }

      toast.success('Project settings saved');
      setSettings(newSettings);
      setDraft({});
    } catch {
      toast.error('Network error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateDraft = (field: keyof ProjectSettings, value: unknown) => {
    setDraft((prev) => {
      // If value matches original, remove from draft
      if (settings && settings[field] === value) {
        const next = { ...prev };
        delete next[field];
        return next;
      }
      return { ...prev, [field]: value };
    });
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !merged) {
    return (
      <div className="h-full flex items-center justify-center p-4">
        <p className="text-xs text-destructive text-center">
          {error ?? 'Settings unavailable'}
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-3 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSettings className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Project Settings</h3>
          </div>
          {hasChanges && (
            <Badge variant="secondary" className="text-[9px] animate-pulse">
              Unsaved
            </Badge>
          )}
        </div>

        {/* Project name (read-only display) */}
        <div className="px-2 py-1.5 bg-muted/20 rounded border border-border/30">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Project
          </p>
          <p className="text-xs font-medium">{projectName}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            New videos inherit these defaults
          </p>
        </div>

        {/* ── TTS Settings ─────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/30 pb-1">
            🎤 Text-to-Speech
          </p>

          <SettingRow label="Voice" required>
            <select
              value={merged.voice_id}
              onChange={(e) => updateDraft('voice_id', e.target.value)}
              className="w-full h-8 text-xs rounded border border-border bg-background px-2"
            >
              {VOICE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
              {!VOICE_OPTIONS.some((opt) => opt.value === merged.voice_id) && (
                <option value={merged.voice_id}>
                  {merged.voice_id} (Custom)
                </option>
              )}
            </select>
          </SettingRow>

          <SettingRow label="Speed" required>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0.7}
                max={1.2}
                step={0.05}
                value={merged.tts_speed}
                onChange={(e) =>
                  updateDraft('tts_speed', Number.parseFloat(e.target.value))
                }
                className="flex-1"
              />
              <span className="text-xs font-mono w-8 text-right">
                {merged.tts_speed.toFixed(2)}
              </span>
            </div>
          </SettingRow>

          <SettingRow label="Language">
            <Input
              value={merged.language ?? ''}
              onChange={(e) => updateDraft('language', e.target.value || null)}
              placeholder="e.g. tr, en, ar"
              className="h-8 text-xs"
            />
          </SettingRow>
        </div>

        {/* ── Video Settings ───────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/30 pb-1">
            🎬 Video Generation
          </p>

          <SettingRow label="Video Model" required>
            <select
              value={merged.video_model}
              onChange={(e) => updateDraft('video_model', e.target.value)}
              className="w-full h-8 text-xs rounded border border-border bg-background px-2"
            >
              {VIDEO_MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
              {!VIDEO_MODEL_OPTIONS.some(
                (opt) => opt.value === merged.video_model
              ) && (
                <option value={merged.video_model}>
                  {merged.video_model} (Custom)
                </option>
              )}
            </select>
          </SettingRow>

          <SettingRow label="Aspect Ratio">
            <select
              value={merged.aspect_ratio ?? '9:16'}
              onChange={(e) => updateDraft('aspect_ratio', e.target.value)}
              className="w-full h-8 text-xs rounded border border-border bg-background px-2"
            >
              {ASPECT_RATIO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingRow>

          <SettingRow label="Video Resolution">
            <select
              value={merged.video_resolution ?? '480p'}
              onChange={(e) => updateDraft('video_resolution', e.target.value)}
              className="w-full h-8 text-xs rounded border border-border bg-background px-2"
            >
              {VIDEO_RESOLUTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </SettingRow>
        </div>

        {/* ── Image Settings ───────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/30 pb-1">
            🖼️ Image Generation
          </p>

          {(['character', 'location', 'prop'] as const).map((assetType) => {
            const currentModels: Record<string, string> = {
              ...DEFAULT_IMAGE_MODELS,
              ...DEFAULT_I2I_IMAGE_MODELS,
              ...merged.image_models,
            };
            const t2iValue = currentModels[assetType];
            const i2iKey = `${assetType}_i2i`;
            const i2iValue =
              currentModels[i2iKey] ?? DEFAULT_I2I_IMAGE_MODELS[i2iKey];
            const label =
              assetType === 'character'
                ? 'Character'
                : assetType === 'location'
                  ? 'Location'
                  : 'Prop';

            return (
              <div key={assetType} className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  {label}
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <span className="text-[9px] text-muted-foreground/70">
                      Generate
                    </span>
                    <select
                      value={t2iValue}
                      onChange={(e) => {
                        const updated = {
                          ...currentModels,
                          [assetType]: e.target.value,
                        };
                        updateDraft('image_models', updated);
                      }}
                      className="w-full h-7 text-[11px] rounded border border-border bg-background px-1.5"
                    >
                      {IMAGE_MODEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                      {!IMAGE_MODEL_OPTIONS.some(
                        (opt) => opt.value === t2iValue
                      ) && (
                        <option value={t2iValue}>{t2iValue} (Custom)</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <span className="text-[9px] text-muted-foreground/70">
                      Variation
                    </span>
                    <select
                      value={i2iValue}
                      onChange={(e) => {
                        const updated = {
                          ...currentModels,
                          [i2iKey]: e.target.value,
                        };
                        updateDraft('image_models', updated);
                      }}
                      className="w-full h-7 text-[11px] rounded border border-border bg-background px-1.5"
                    >
                      {I2I_MODEL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                      {!I2I_MODEL_OPTIONS.some(
                        (opt) => opt.value === i2iValue
                      ) && (
                        <option value={i2iValue}>{i2iValue} (Custom)</option>
                      )}
                    </select>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Style Settings ───────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/30 pb-1">
            🎨 Style
          </p>

          <SettingRow label="Genre">
            <Input
              value={merged.genre ?? ''}
              onChange={(e) => updateDraft('genre', e.target.value || null)}
              placeholder="e.g. Historical, Drama, Sci-Fi"
              className="h-8 text-xs"
            />
          </SettingRow>

          <SettingRow label="Tone">
            <Input
              value={merged.tone ?? ''}
              onChange={(e) => updateDraft('tone', e.target.value || null)}
              placeholder="e.g. Cinematic, Warm, Dark"
              className="h-8 text-xs"
            />
          </SettingRow>

          <SettingRow label="Visual Style">
            <Input
              value={merged.visual_style ?? ''}
              onChange={(e) =>
                updateDraft('visual_style', e.target.value || null)
              }
              placeholder="e.g. Realistic cinematic, warm earth tones"
              className="h-8 text-xs"
            />
          </SettingRow>
        </div>

        {/* Save button */}
        <Button
          onClick={() => void save()}
          disabled={!hasChanges || isSaving}
          className="w-full h-9 text-xs gap-1.5"
        >
          {isSaving ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : (
            <IconDeviceFloppy className="size-3.5" />
          )}
          {isSaving ? 'Saving...' : 'Save Project Defaults'}
        </Button>
      </div>
    </ScrollArea>
  );
}
