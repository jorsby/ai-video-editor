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

interface VideoSettings {
  id: string;
  name: string;
  language: string | null;
  voice_id: string;
  tts_speed: number;
  video_model: string;
  image_model: string;
  aspect_ratio: string | null;
  visual_style: string | null;
  genre: string | null;
  tone: string | null;
}

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
];

const VIDEO_MODEL_OPTIONS = [
  { value: 'grok-imagine/image-to-video', label: 'Grok Imagine (Image→Video)' },
  { value: 'kling/v2.0/image-to-video', label: 'Kling v2.0 (Image→Video)' },
  { value: 'kling/v1.6/image-to-video', label: 'Kling v1.6 (Image→Video)' },
];

const IMAGE_MODEL_OPTIONS = [
  { value: 'nano-banana-2', label: 'Nano Banana 2' },
  { value: 'flux-1.1-pro', label: 'Flux 1.1 Pro' },
];

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

export default function VideoSettingsPanel() {
  const projectId = useProjectId();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<VideoSettings | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Draft state for editing
  const [draft, setDraft] = useState<Partial<VideoSettings>>({});

  const load = useCallback(async () => {
    if (!projectId) return;

    const supabase = createClient('studio');

    const { data: project } = await supabase
      .from('projects')
      .select('settings')
      .eq('id', projectId)
      .maybeSingle();

    const projectSettings = project?.settings as Record<string, unknown> | null;
    const resolvedVideoId =
      typeof projectSettings?.video_id === 'string'
        ? projectSettings.video_id
        : null;

    if (!resolvedVideoId) {
      setError('No video linked to this project');
      setIsLoading(false);
      return;
    }

    const { data: video, error: fetchError } = await supabase
      .from('videos')
      .select(
        'id, name, language, voice_id, tts_speed, video_model, image_model, aspect_ratio, visual_style, genre, tone'
      )
      .eq('id', resolvedVideoId)
      .maybeSingle();

    if (fetchError || !video) {
      setError('Failed to load video settings');
      setIsLoading(false);
      return;
    }

    setVideoId(resolvedVideoId);
    setSettings(video as VideoSettings);
    setDraft({});
    setIsLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const merged = settings ? { ...settings, ...draft } : null;

  const hasChanges = Object.keys(draft).length > 0;

  const save = async () => {
    if (!videoId || !hasChanges) return;

    setIsSaving(true);
    try {
      const res = await fetch(`/api/v2/videos/${videoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to save settings');
        return;
      }

      toast.success('Video settings saved');
      setSettings((prev) => (prev ? { ...prev, ...draft } : prev));
      setDraft({});
    } catch {
      toast.error('Network error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateDraft = (field: keyof VideoSettings, value: unknown) => {
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
          {error ?? 'No settings available'}
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
            <h3 className="text-sm font-semibold">Video Settings</h3>
          </div>
          {hasChanges && (
            <Badge variant="secondary" className="text-[9px] animate-pulse">
              Unsaved
            </Badge>
          )}
        </div>

        {/* Video name (read-only display) */}
        <div className="px-2 py-1.5 bg-muted/20 rounded border border-border/30">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Video
          </p>
          <p className="text-xs font-medium">{merged.name}</p>
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
        </div>

        {/* ── Image Settings ───────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/30 pb-1">
            🖼️ Image Generation
          </p>

          <SettingRow label="Image Model" required>
            <select
              value={merged.image_model}
              onChange={(e) => updateDraft('image_model', e.target.value)}
              className="w-full h-8 text-xs rounded border border-border bg-background px-2"
            >
              {IMAGE_MODEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
              {!IMAGE_MODEL_OPTIONS.some(
                (opt) => opt.value === merged.image_model
              ) && (
                <option value={merged.image_model}>
                  {merged.image_model} (Custom)
                </option>
              )}
            </select>
          </SettingRow>
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
          {isSaving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </ScrollArea>
  );
}
