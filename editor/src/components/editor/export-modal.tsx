'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Compositor, Log } from 'openvideo';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Cloud, Check, Download, Send, Scissors } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useStudioStore } from '@/stores/studio-store';

import { useProjectId } from '@/contexts/project-context';
import { smartUpload } from '@/lib/upload-utils';
import { remuxToInstagramMp4 } from '@/lib/remux';
import { splitVideoSegment } from '@/lib/split-video';
import type { RenderedVideo } from '@/types/rendered-video';

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
        {render.resolution || 'video'}
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
  const projectId = useProjectId();
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportBlobUrl, setExportBlobUrl] = useState<string | null>(null);
  const [exportStartTime, setExportStartTime] = useState<number | null>(null);
  const [exportCombinator, setExportCombinator] = useState<Compositor | null>(
    null
  );
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isRemuxing, setIsRemuxing] = useState(false);
  const [remuxProgress, setRemuxProgress] = useState(0);
  const [renderStarted, setRenderStarted] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [allRenders, setAllRenders] = useState<RenderedVideo[]>([]);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [generateShorts, setGenerateShorts] = useState(false);
  const [shortsStatus, setShortsStatus] = useState<
    'idle' | 'analyzing' | 'splitting' | 'done' | 'error'
  >('idle');
  const [shortsProgress, setShortsProgress] = useState('');
  const [shortsCreated, setShortsCreated] = useState(0);
  const [shortsTotal, setShortsTotal] = useState(0);

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
    setGenerateShorts(false);
    setShortsStatus('idle');
    setShortsProgress('');
    setShortsCreated(0);
    setShortsTotal(0);
  };

  const handleClose = () => {
    onOpenChange(false);
    resetState();
  };

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

      if (mode === 'download') {
        // Download mode: remux fMP4 → standard faststart MP4 for social media compatibility
        setIsRemuxing(true);
        setRemuxProgress(0);
        const blob = await remuxToInstagramMp4(rawBlob, (p) =>
          setRemuxProgress(p)
        );
        setIsRemuxing(false);

        const blobUrl = URL.createObjectURL(blob);
        setExportBlobUrl(blobUrl);

        setTimeout(() => {
          handleDownload(blobUrl);
          toast.success('Rendering complete! Your download has started.');
          setTimeout(() => {
            handleClose();
          }, 1500);
        }, 500);
      } else {
        // Cloud mode: upload raw MP4 directly (remux skipped for speed)
        const blobUrl = URL.createObjectURL(rawBlob);
        setExportBlobUrl(blobUrl);
        await handleCloudUpload(rawBlob, combinatorOpts);
      }
    } catch (error) {
      Log.error('Export error:', error);
      alert(`Failed to export: ${(error as Error).message}`);
      setIsExporting(false);
      setStoreIsExporting(false);
    }
  };

  const handleCloudUpload = async (blob: Blob, settings: any) => {
    try {
      setIsUploading(true);
      uploadAbortRef.current = new AbortController();

      const file = new File([blob], `render-${Date.now()}.mp4`, {
        type: 'video/mp4',
      });

      const uploadResult = await smartUpload(
        file,
        (progress) => setUploadProgress(progress),
        uploadAbortRef.current.signal
      );

      const saveRes = await fetch('/api/rendered-videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          url: uploadResult.url,
          file_size: file.size,
          duration: maxDuration / 1e6,
          resolution: `${settings.width}x${settings.height}`,
          type: 'video',
        }),
      });

      let parentVideoId: string | null = null;

      if (!saveRes.ok) {
        const errBody = await saveRes.json().catch(() => ({}));
        Log.error('Failed to save rendered video:', errBody);
        toast.error('Upload succeeded but failed to save render record');
      } else {
        const saveData = await saveRes.json();
        parentVideoId = saveData.rendered_video?.id || null;
        toast.success('Uploaded to cloud!');
      }

      setIsUploading(false);

      // Generate shorts if enabled and parent video was saved
      if (generateShorts && parentVideoId) {
        await handleGenerateShorts(blob, parentVideoId, settings);
      }

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
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') {
        Log.info('Cloud upload cancelled by user');
      } else {
        Log.error('Cloud upload error:', error);
        toast.error(`Cloud upload failed: ${(error as Error).message}`);
      }
    } finally {
      uploadAbortRef.current = null;
      setIsUploading(false);
      setStoreIsExporting(false);
    }
  };

  const handleGenerateShorts = async (
    fullVideoBlob: Blob,
    parentVideoId: string,
    settings: any
  ) => {
    try {
      // 1. Analyze transcript
      setShortsStatus('analyzing');
      setShortsProgress('Analyzing transcript for viral moments...');

      console.log('[Shorts] Calling analyze-shorts API for:', parentVideoId);
      const analyzeRes = await fetch(
        `/api/v2/rendered-videos/${parentVideoId}/analyze-shorts`,
        { method: 'POST' }
      );

      console.log('[Shorts] Analyze response status:', analyzeRes.status);

      if (!analyzeRes.ok) {
        const err = await analyzeRes.json().catch(() => ({}));
        console.error('[Shorts] Analysis failed:', err);
        Log.error('Shorts analysis failed:', err);
        toast.error(
          `Shorts analysis failed: ${err.error || analyzeRes.status}`
        );
        setShortsStatus('error');
        return;
      }

      const { segments } = await analyzeRes.json();
      console.log('[Shorts] Segments received:', segments?.length, segments);

      if (!segments || segments.length === 0) {
        toast.info('No suitable segments found for shorts');
        setShortsStatus('done');
        return;
      }

      // 2. Split and upload each segment
      setShortsStatus('splitting');
      setShortsTotal(segments.length);
      let succeeded = 0;
      let failed = 0;

      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        setShortsProgress(
          `Creating short ${i + 1}/${segments.length}: "${segment.title}"`
        );

        try {
          // Split video segment
          const shortBlob = await splitVideoSegment(
            fullVideoBlob,
            segment.start_time,
            segment.end_time,
            i
          );

          // Upload to R2
          const shortFile = new File(
            [shortBlob],
            `short-${Date.now()}-${i}.mp4`,
            { type: 'video/mp4' }
          );
          const uploadResult = await smartUpload(shortFile);

          // Save to DB
          const saveRes = await fetch('/api/rendered-videos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              project_id: projectId,
              url: uploadResult.url,
              file_size: shortFile.size,
              duration: segment.end_time - segment.start_time,
              resolution: `${settings.width}x${settings.height}`,
              type: 'short',
              parent_id: parentVideoId,
              virality_score: segment.virality_score,
              segment_title: segment.title,
            }),
          });

          if (saveRes.ok) {
            succeeded++;
            setShortsCreated(succeeded);
          } else {
            failed++;
            Log.error(`Failed to save short ${i + 1}`);
          }
        } catch (err) {
          failed++;
          Log.error(`Failed to create short ${i + 1}:`, err);
        }
      }

      setShortsStatus('done');
      if (failed === 0) {
        toast.success(`${succeeded} shorts created!`);
      } else {
        toast.warning(`${succeeded}/${segments.length} shorts created`);
      }
    } catch (error) {
      Log.error('Generate shorts error:', error);
      toast.error('Failed to generate shorts');
      setShortsStatus('error');
    }
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
          className="max-w-[520px] max-h-[90svh] overflow-hidden border-zinc-800 bg-[#0c0c0e]/95 p-0 text-white backdrop-blur-xl"
          showCloseButton={false}
        >
          <div className="flex flex-col p-8 pt-10 overflow-y-auto">
            <DialogTitle className="mb-2 text-center text-xl font-medium tracking-tight">
              Render Complete
            </DialogTitle>
            <p className="mb-6 text-center text-sm text-zinc-400">
              Your video has been rendered and uploaded to the cloud.
              {shortsCreated > 0 && (
                <span className="block mt-1 text-purple-400">
                  {shortsCreated} short{shortsCreated !== 1 ? 's' : ''}{' '}
                  generated
                </span>
              )}
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

            {/* All renders */}
            {allRenders.length > 0 && (
              <div className="mb-6">
                <h3 className="mb-3 text-xs font-medium text-zinc-400">
                  Rendered Videos
                </h3>
                <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                  {allRenders.map((rv) => (
                    <RenderVariantRow key={rv.id} render={rv} />
                  ))}
                </div>
              </div>
            )}

            <div className="flex w-full gap-3">
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
              Your video will be rendered and uploaded to the cloud
              automatically.
            </p>

            <div className="mb-6 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Scissors className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-sm font-medium text-white">
                      Generate Shorts
                    </p>
                    <p className="text-xs text-zinc-500">
                      AI finds viral moments and creates short clips
                    </p>
                  </div>
                </div>
                <Switch
                  checked={generateShorts}
                  onCheckedChange={setGenerateShorts}
                />
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
            </div>
          </div>

          <div className="w-full px-1">
            <div className="mb-3 flex items-center justify-between text-[13px]">
              <span className="font-medium text-zinc-300">
                {shortsStatus === 'analyzing' || shortsStatus === 'splitting'
                  ? 'Generating Shorts...'
                  : isUploading
                    ? 'Uploading to cloud...'
                    : isRemuxing
                      ? 'Converting for social media...'
                      : 'Progress'}
              </span>
              <span className="font-mono text-zinc-400">
                {shortsStatus === 'analyzing' ? (
                  'Analyzing transcript...'
                ) : shortsStatus === 'splitting' ? (
                  `Short ${shortsCreated + 1}/${shortsTotal}`
                ) : isUploading ? (
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
                  shortsStatus === 'analyzing' || shortsStatus === 'splitting'
                    ? 'bg-purple-500'
                    : isUploading
                      ? 'bg-blue-500'
                      : isRemuxing
                        ? 'bg-amber-500'
                        : 'bg-white'
                }`}
                style={{
                  width:
                    shortsStatus === 'analyzing'
                      ? '100%'
                      : shortsStatus === 'splitting' && shortsTotal > 0
                        ? `${Math.round((shortsCreated / shortsTotal) * 100)}%`
                        : isUploading
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
              {(isExporting ||
                isRemuxing ||
                isUploading ||
                shortsStatus === 'analyzing' ||
                shortsStatus === 'splitting') && (
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
