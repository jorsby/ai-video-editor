'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Compositor, Log } from 'openvideo';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Cloud, Check, Download, Send, Layers } from 'lucide-react';
import { useStudioStore } from '@/stores/studio-store';
import { useLanguageStore } from '@/stores/language-store';
import { SUPPORTED_LANGUAGES } from '@/lib/constants/languages';
import { useProjectId } from '@/contexts/project-context';
import { smartUpload } from '@/lib/upload-utils';
import { remuxToInstagramMp4 } from '@/lib/remux';
import type { RenderedVideo } from '@/types/rendered-video';
import { loadTimeline, reconstructProjectJSON, saveTimeline, getAvailableLanguages } from '@/lib/supabase/timeline-service';
import { waitForSave } from '@/hooks/use-auto-save';
import type { LanguageCode } from '@/lib/constants/languages';

// Transform external URLs to proxy through our API to avoid CORS errors during export
function proxyClipUrl(src: string): string {
  if (
    !src ||
    src.startsWith('blob:') ||
    src.startsWith('data:') ||
    src.startsWith('/')
  ) {
    return src;
  }
  return `/api/proxy/media?url=${encodeURIComponent(src)}`;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RenderVariantRow({ render }: { render: RenderedVideo }) {
  const date = new Date(render.created_at);
  const dateStr = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/5 px-3 py-2">
      <span className="shrink-0 rounded bg-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
        {render.language}
      </span>
      <div className="flex-1 min-w-0 text-xs text-zinc-400">
        {render.resolution && <span>{render.resolution}</span>}
        {render.resolution && <span className="mx-1.5">·</span>}
        <span>{dateStr}</span>
        {render.file_size && (
          <>
            <span className="mx-1.5">·</span>
            <span>{formatFileSize(render.file_size)}</span>
          </>
        )}
      </div>
      <a
        href={render.url}
        download
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 rounded p-1.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <Download className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: 'download' | 'cloud';
}

export function ExportModal({
  open,
  onOpenChange,
  mode = 'download',
}: ExportModalProps) {
  const { studio, setIsExporting: setStoreIsExporting } = useStudioStore();
  const activeLanguage = useLanguageStore((s) => s.activeLanguage);
  const availableLanguages = useLanguageStore((s) => s.availableLanguages);
  const projectId = useProjectId();
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportBlobUrl, setExportBlobUrl] = useState<string | null>(null);
  const [exportStartTime, setExportStartTime] = useState<number | null>(null);
  const [exportCombinator, setExportCombinator] = useState<Compositor | null>(
    null
  );
  const [selectedLanguage, setSelectedLanguage] = useState(activeLanguage);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isRemuxing, setIsRemuxing] = useState(false);
  const [remuxProgress, setRemuxProgress] = useState(0);
  const [renderStarted, setRenderStarted] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [allRenders, setAllRenders] = useState<RenderedVideo[]>([]);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [isBatchRender, setIsBatchRender] = useState(false);
  const [batchQueue, setBatchQueue] = useState<LanguageCode[]>([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const batchCancelledRef = useRef(false);

  const maxDuration = studio?.getMaxDuration() || 0;

  const resetState = () => {
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      uploadAbortRef.current = null;
    }
    if (exportCombinator) {
      exportCombinator.destroy();
      setExportCombinator(null);
    }
    if (exportBlobUrl) {
      URL.revokeObjectURL(exportBlobUrl);
      setExportBlobUrl(null);
    }
    setExportStartTime(null);
    setIsExporting(false);
    setStoreIsExporting(false);
    setExportProgress(0);
    setIsUploading(false);
    setUploadProgress(0);
    setIsRemuxing(false);
    setRemuxProgress(0);
    setRenderStarted(false);
    setShowCompletion(false);
    setAllRenders([]);
    setIsBatchRender(false);
    setBatchQueue([]);
    setBatchIndex(0);
    batchCancelledRef.current = true; // signal any running batch loop to stop
  };

  const handleClose = () => {
    onOpenChange(false);
    resetState();
  };

  // Sync selectedLanguage when activeLanguage changes (e.g. switched elsewhere)
  useEffect(() => {
    setSelectedLanguage(activeLanguage);
  }, [activeLanguage]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open]);

  const startExport = async () => {
    if (!studio) return;

    try {
      setIsExporting(true);
      setStoreIsExporting(true);
      setExportProgress(0);
      setExportBlobUrl(null);
      setExportStartTime(Date.now());
      setRenderStarted(true);

      // Export current studio to JSON
      const json = studio.exportToJSON();

      if (!json.clips || json.clips.length === 0) {
        throw new Error('No clips to export');
      }

      // Filter out clips with empty sources (except Text, Caption, and Effect)
      const validClips = json.clips.filter((clipJSON: any) => {
        if (
          clipJSON.type === 'Text' ||
          clipJSON.type === 'Caption' ||
          clipJSON.type === 'Effect' ||
          clipJSON.type === 'Transition' ||
          clipJSON.type === 'Audio'
        ) {
          return true;
        }
        return clipJSON.src && clipJSON.src.trim() !== '';
      });

      if (validClips.length === 0) {
        throw new Error('No valid clips to export');
      }

      // Use default settings
      const settings = json.settings || {};
      const combinatorOpts: any = {
        width: settings.width || 1920,
        height: settings.height || 1080,
        fps: settings.fps || 30,
        bgColor: settings.bgColor || '#000000',
        videoCodec: 'avc1.640028',
        bitrate: 3_500_000, // 3.5 Mbps — Instagram Reels recommended max
        audio: true,
      };

      const com = new Compositor(combinatorOpts);
      await com.initPixiApp();
      setExportCombinator(com);

      com.on('OutputProgress', (v) => {
        setExportProgress(v);
      });

      const proxiedClips = validClips.map((clip: any) => ({
        ...clip,
        src: clip.src ? proxyClipUrl(clip.src) : clip.src,
      }));
      const validJson = { ...json, clips: proxiedClips };
      await com.loadFromJSON(validJson);

      const stream = com.output();
      const rawBlob = await new Response(stream).blob();
      setIsExporting(false);

      // Free GPU/memory resources before remux begins
      com.destroy();
      setExportCombinator(null);

      // Remux fMP4 → standard faststart MP4 for Instagram compatibility
      setIsRemuxing(true);
      setRemuxProgress(0);
      const blob = await remuxToInstagramMp4(rawBlob, (p) =>
        setRemuxProgress(p)
      );
      setIsRemuxing(false);

      const blobUrl = URL.createObjectURL(blob);
      setExportBlobUrl(blobUrl);

      if (mode === 'download') {
        // Download mode: auto-download and close
        setTimeout(() => {
          handleDownload(blobUrl);
          toast.success('Rendering complete! Your download has started.');
          setTimeout(() => {
            handleClose();
          }, 1500);
        }, 500);
      } else {
        // Cloud mode: upload to R2
        await handleCloudUpload(blob, combinatorOpts);
      }
    } catch (error) {
      Log.error('Export error:', error);
      alert(`Failed to export: ${(error as Error).message}`);
      setIsExporting(false);
      setStoreIsExporting(false);
    }
  };

  const handleCloudUpload = async (
    blob: Blob,
    settings: any,
    opts: { language?: LanguageCode; skipCompletion?: boolean } = {}
  ) => {
    const lang = opts.language ?? selectedLanguage;
    try {
      setIsUploading(true);
      uploadAbortRef.current = new AbortController();

      const file = new File(
        [blob],
        `render-${lang}-${Date.now()}.mp4`,
        { type: 'video/mp4' }
      );

      const uploadResult = await smartUpload(
        file,
        (progress) => setUploadProgress(progress),
        uploadAbortRef.current.signal
      );

      await fetch('/api/rendered-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          language: lang,
          url: uploadResult.url,
          file_size: file.size,
          duration: maxDuration / 1e6,
          resolution: `${settings.width}x${settings.height}`,
        }),
      });

      toast.success(`${lang.toUpperCase()} uploaded to cloud!`);

      if (!opts.skipCompletion) {
        // Fetch all renders for this project to show in completion screen
        try {
          const res = await fetch(`/api/rendered-videos?project_id=${projectId}`);
          if (res.ok) {
            const { rendered_videos } = await res.json();
            setAllRenders(rendered_videos || []);
          }
        } catch {
          // Non-critical — completion screen still works without the list
        }

        setShowCompletion(true);
      }
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') {
        Log.info('Cloud upload cancelled by user');
        if (opts.skipCompletion) throw error; // propagate so batch loop can stop
      } else {
        Log.error('Cloud upload error:', error);
        toast.error(`Cloud upload failed: ${(error as Error).message}`);
      }
    } finally {
      uploadAbortRef.current = null;
      setIsUploading(false);
      if (!opts.skipCompletion) {
        setStoreIsExporting(false);
      }
    }
  };

  const startMultiRender = async () => {
    if (!studio) return;

    // 1. Flush any in-flight auto-save, then persist active language to DB
    await waitForSave();
    await saveTimeline(projectId, studio.tracks, studio.clips, activeLanguage);

    // 2. Discover which languages have saved timeline data
    const langs = await getAvailableLanguages(projectId);
    if (langs.length === 0) {
      toast.error('No language timelines found in database');
      return;
    }

    // 3. Initialize batch state
    setBatchQueue(langs);
    setBatchIndex(0);
    setIsBatchRender(true);
    setRenderStarted(true);
    setStoreIsExporting(true);
    batchCancelledRef.current = false;

    for (let i = 0; i < langs.length; i++) {
      if (batchCancelledRef.current) break;

      const lang = langs[i];
      setBatchIndex(i);
      setSelectedLanguage(lang); // drives "Language" row on progress screen

      // Reset per-language progress
      setIsExporting(true);
      setExportProgress(0);
      setIsRemuxing(false);
      setIsUploading(false);
      setExportStartTime(Date.now());

      try {
        // 4. Build project JSON for this language
        let json: any;
        if (lang === activeLanguage) {
          json = studio.exportToJSON(); // already in memory
        } else {
          const tracks = await loadTimeline(projectId, lang);
          if (!tracks || tracks.length === 0) {
            toast.warning(`No timeline saved for ${lang.toUpperCase()} — skipping`);
            continue;
          }
          const studioOpts = studio.getOptions();
          // reconstructProjectJSON returns {clips, tracks} — inject settings from active studio
          json = {
            ...reconstructProjectJSON(tracks),
            settings: {
              width: studioOpts.width,
              height: studioOpts.height,
              fps: studioOpts.fps,
              bgColor: studioOpts.bgColor ?? '#000000',
            },
          };
        }

        // 5. Filter valid clips (same logic as startExport)
        if (!json.clips || json.clips.length === 0) {
          toast.warning(`No clips in ${lang.toUpperCase()} — skipping`);
          continue;
        }
        const validClips = json.clips.filter((clipJSON: any) => {
          if (['Text', 'Caption', 'Effect', 'Transition', 'Audio'].includes(clipJSON.type)) return true;
          return clipJSON.src && clipJSON.src.trim() !== '';
        });
        if (validClips.length === 0) {
          toast.warning(`No valid clips in ${lang.toUpperCase()} — skipping`);
          continue;
        }

        // 6. Render
        const settings = json.settings || {};
        const combinatorOpts: any = {
          width: settings.width || 1920,
          height: settings.height || 1080,
          fps: settings.fps || 30,
          bgColor: settings.bgColor || '#000000',
          videoCodec: 'avc1.640028',
          bitrate: 3_500_000,
          audio: true,
        };

        const com = new Compositor(combinatorOpts);
        await com.initPixiApp();
        setExportCombinator(com);
        com.on('OutputProgress', (v) => setExportProgress(v));

        const proxiedClips = validClips.map((clip: any) => ({
          ...clip,
          src: clip.src ? proxyClipUrl(clip.src) : clip.src,
        }));
        await com.loadFromJSON({ ...json, clips: proxiedClips });
        const stream = com.output();
        const rawBlob = await new Response(stream).blob();
        setIsExporting(false);
        com.destroy();
        setExportCombinator(null);

        // 7. Remux
        setIsRemuxing(true);
        setRemuxProgress(0);
        const blob = await remuxToInstagramMp4(rawBlob, (p) => setRemuxProgress(p));
        setIsRemuxing(false);

        // 8. Upload — pass explicit language, skip per-language completion logic
        await handleCloudUpload(blob, combinatorOpts, { language: lang, skipCompletion: true });

      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') {
          break; // user cancelled — stop batch
        }
        Log.error(`Render failed for ${lang}:`, error);
        toast.error(`Failed to render ${lang.toUpperCase()}: ${(error as Error).message}`);
        // continue to next language
      }
    }

    // 9. Show completion with all renders
    try {
      const res = await fetch(`/api/rendered-videos?project_id=${projectId}`);
      if (res.ok) {
        const { rendered_videos } = await res.json();
        setAllRenders(rendered_videos || []);
      }
    } catch { /* non-critical */ }

    setShowCompletion(true);
    setStoreIsExporting(false);
    // Note: isBatchRender stays true until resetState() so completion screen title is correct
  };

  // Auto-start export when modal opens (download mode only)
  useEffect(() => {
    if (open && mode === 'download' && !isExporting && !exportBlobUrl) {
      startExport();
    }
  }, [open]);

  const handleDownload = (url?: string) => {
    const downloadUrl = url || exportBlobUrl;
    if (!downloadUrl) return;
    const aEl = document.createElement('a');
    document.body.appendChild(aEl);
    aEl.setAttribute('href', downloadUrl);
    aEl.setAttribute('download', `designcombo-export-${Date.now()}.mp4`);
    aEl.setAttribute('target', '_self');
    aEl.click();
    setTimeout(() => {
      if (document.body.contains(aEl)) {
        document.body.removeChild(aEl);
      }
    }, 100);
  };

  // Cloud mode: post-render completion screen
  if (mode === 'cloud' && showCompletion) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent
          className="max-w-[520px] overflow-hidden border-zinc-800 bg-[#0c0c0e]/95 p-0 text-white backdrop-blur-xl"
          showCloseButton={false}
        >
          <div className="flex flex-col p-8 pt-10">
            <DialogTitle className="mb-2 text-center text-xl font-medium tracking-tight">
              {isBatchRender ? 'All Renders Complete' : 'Render Complete'}
            </DialogTitle>
            <p className="mb-6 text-center text-sm text-zinc-400">
              {isBatchRender
                ? `All ${batchQueue.length} language timelines rendered and uploaded.`
                : 'Your video has been rendered and uploaded to the cloud.'}
            </p>

            {/* Video preview */}
            {exportBlobUrl && (
              <div className="mb-6 overflow-hidden rounded-xl border border-white/10">
                <video
                  src={exportBlobUrl}
                  controls
                  className="w-full"
                  style={{ maxHeight: 240 }}
                />
              </div>
            )}

            {/* All language variants */}
            {allRenders.length > 0 && (
              <div className="mb-6">
                <h3 className="mb-3 text-xs font-medium text-zinc-400">
                  All Language Variants
                </h3>
                <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                  {allRenders.map((rv) => (
                    <RenderVariantRow key={rv.id} render={rv} />
                  ))}
                </div>
              </div>
            )}

            <div className="flex w-full gap-3">
              {!isBatchRender && (
                <Button
                  variant="outline"
                  disabled
                  className="flex-1 h-11 rounded-xl border-zinc-800 bg-zinc-900/50 text-[13px] font-medium text-white opacity-50 cursor-not-allowed"
                >
                  Render Another Language
                </Button>
              )}
              {allRenders.length > 1 && (
                <Button
                  onClick={() => window.open(`/workflow/${projectId}`, '_blank')}
                  className="flex-1 h-11 gap-2 rounded-xl text-[13px] font-medium"
                >
                  <Layers className="h-4 w-4" />
                  Publish All Languages
                </Button>
              )}
              {allRenders.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const latestRender = allRenders[0];
                    if (latestRender) {
                      window.open(`/post/${latestRender.id}`, '_blank');
                    }
                  }}
                  className="flex-1 h-11 gap-2 rounded-xl border-zinc-800 bg-zinc-900/50 text-[13px] font-medium text-white hover:bg-zinc-800 hover:text-white"
                >
                  <Send className="h-4 w-4" />
                  Publish to Social
                </Button>
              )}
              <Button
                onClick={handleClose}
                className="flex-1 h-11 rounded-xl text-[13px] font-medium"
              >
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Cloud mode: pre-render screen with language selector
  if (mode === 'cloud' && !renderStarted) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
        <DialogContent
          className="max-w-[480px] border-zinc-800 bg-[#0c0c0e]/95 p-0 text-white backdrop-blur-xl"
          showCloseButton={false}
        >
          <div className="flex flex-col items-center p-8 pt-10">
            <DialogTitle className="mb-2 text-xl font-medium tracking-tight">
              Render to Cloud
            </DialogTitle>
            <p className="mb-8 text-sm text-zinc-400">
              Select a language and start rendering. The video will be uploaded
              to the cloud automatically.
            </p>

            <div className="mb-8 w-full">
              <label className="mb-3 block text-xs font-medium text-zinc-400">
                Language
              </label>
              <div className="flex flex-wrap gap-2">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => setSelectedLanguage(lang.code)}
                    className={`flex h-10 w-12 items-center justify-center rounded-lg border text-sm font-medium transition-all ${
                      selectedLanguage === lang.code
                        ? 'border-white bg-white text-black'
                        : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    {selectedLanguage === lang.code && (
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex w-full gap-3">
              <Button
                variant="outline"
                onClick={handleClose}
                className="flex-1 h-11 rounded-xl border-zinc-800 bg-zinc-900/50 text-[13px] font-medium text-white hover:bg-zinc-800 hover:text-white"
              >
                Cancel
              </Button>
              <Button
                onClick={() => startExport()}
                className="flex-1 h-11 gap-2 rounded-xl text-[13px] font-medium"
              >
                <Cloud className="h-4 w-4" />
                Start Render
              </Button>
            </div>

            {availableLanguages.length > 1 && (
              <>
                <div className="mt-4 flex w-full items-center gap-3">
                  <div className="flex-1 border-t border-zinc-800" />
                  <span className="shrink-0 text-xs text-zinc-600">or</span>
                  <div className="flex-1 border-t border-zinc-800" />
                </div>
                <Button
                  variant="outline"
                  onClick={startMultiRender}
                  className="mt-4 w-full h-11 gap-2 rounded-xl border-zinc-700 bg-zinc-900/50 text-[13px] font-medium text-zinc-300 hover:border-zinc-500 hover:bg-zinc-800 hover:text-white"
                >
                  <Layers className="h-4 w-4" />
                  Render All Languages ({availableLanguages.length})
                </Button>
                <p className="mt-2 text-center text-[11px] text-zinc-600">
                  Renders each language timeline sequentially and uploads to cloud
                </p>
                <p className="mt-1 text-center text-[11px] text-zinc-500">
                  {availableLanguages
                    .map((code) => SUPPORTED_LANGUAGES.find((l) => l.code === code)?.label ?? code.toUpperCase())
                    .join(', ')}
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent
        className="max-w-[480px] border-zinc-800 bg-[#0c0c0e]/95 p-0 text-white backdrop-blur-xl"
        showCloseButton={false}
      >
        <div className="flex flex-col items-center p-8 pt-10">
          <DialogTitle className="mb-8 text-xl font-medium tracking-tight">
            {mode === 'cloud'
              ? 'Rendering & Uploading'
              : 'Exporting Composition'}
          </DialogTitle>

          <div className="mb-8 w-full rounded-2xl border border-white/5 bg-white/5 p-5 shadow-2xl backdrop-blur-md">
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Duration</span>
                <span className="font-medium">
                  {(maxDuration / 1e6).toFixed(2)}s
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Video Codec</span>
                <span className="font-medium">avc</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Resolution</span>
                <span className="font-medium">
                  {studio?.getOptions().width} x {studio?.getOptions().height}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Container</span>
                <span className="font-medium">MP4</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Bitrate</span>
                <span className="font-medium">high</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Audio Codec</span>
                <span className="font-medium">aac</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Frame rate</span>
                <span className="font-medium">30 FPS</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Sample Rate</span>
                <span className="font-medium">48 KHz</span>
              </div>
              {mode === 'cloud' && (
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Language</span>
                  <span className="font-medium uppercase">
                    {isBatchRender
                      ? `${selectedLanguage} (${batchIndex + 1}/${batchQueue.length})`
                      : selectedLanguage}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="w-full px-1">
            <div className="mb-3 flex items-center justify-between text-[13px]">
              <span className="font-medium text-zinc-300">
                {isUploading
                  ? isBatchRender
                    ? `Uploading ${selectedLanguage.toUpperCase()}...`
                    : 'Uploading to cloud...'
                  : isRemuxing
                    ? isBatchRender
                      ? `Converting ${selectedLanguage.toUpperCase()}...`
                      : 'Converting for social media...'
                    : isBatchRender
                      ? `Rendering ${selectedLanguage.toUpperCase()}...`
                      : 'Progress'}
              </span>
              <span className="font-mono text-zinc-400">
                {isUploading ? (
                  `Uploading... ${Math.round(uploadProgress * 100)}%`
                ) : isRemuxing ? (
                  `Converting... ${Math.round(remuxProgress * 100)}%`
                ) : (
                  <>
                    {Math.round(exportProgress * 100)}% •{' '}
                    {exportProgress > 0 && exportStartTime
                      ? (() => {
                          const elapsed = Date.now() - exportStartTime;
                          const remaining =
                            (elapsed / exportProgress - elapsed) / 1000;
                          const mins = Math.floor(remaining / 60);
                          const secs = Math.floor(remaining % 60);
                          return `${mins}min ${secs}s`;
                        })()
                      : 'preparing...'}
                  </>
                )}
              </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`absolute bottom-0 left-0 top-0 transition-all duration-300 ease-out ${
                  isUploading ? 'bg-blue-500' : isRemuxing ? 'bg-amber-500' : 'bg-white'
                }`}
                style={{
                  width: isUploading
                    ? `${Math.round(uploadProgress * 100)}%`
                    : isRemuxing
                      ? `${Math.round(remuxProgress * 100)}%`
                      : `${exportProgress * 100}%`,
                }}
              />
            </div>
          </div>

          <div className="mt-8 flex w-full justify-center">
            <Button
              variant="outline"
              onClick={handleClose}
              className="flex h-11 items-center gap-2.5 rounded-xl border-zinc-800 bg-zinc-900/50 px-8 text-[13px] font-medium text-white transition-all hover:bg-zinc-800 hover:text-white"
            >
              {(isExporting || isRemuxing || isUploading) && (
                <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
              )}
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
