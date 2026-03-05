import { useEffect, useRef } from 'react';
import { Player } from '../player';
import { Studio, Compositor, fontManager } from 'openvideo';
import { useStudioStore } from '@/stores/studio-store';
import { useLanguageStore } from '@/stores/language-store';
import { editorFont } from './constants';
import {
  loadTimeline,
  reconstructProjectJSON,
  getAvailableLanguages,
} from '@/lib/supabase/timeline-service';
import { useProjectId } from '@/contexts/project-context';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const defaultSize = {
  width: 1080,
  height: 1920,
};
interface PreviewPanelProps {
  onReady?: () => void;
}

export function PreviewPanel({ onReady }: PreviewPanelProps) {
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<Studio | null>(null);
  const onReadyRef = useRef(onReady);
  const { setStudio } = useStudioStore();
  const projectId = useProjectId();
  const isLanguageSwitching = useLanguageStore(
    (s) => s.isLanguageSwitching
  );

  // Keep onReady ref up to date
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // Initialize Studio
  useEffect(() => {
    if (!previewCanvasRef.current) return;

    const abortController = new AbortController();

    // Check support (non-blocking)
    Compositor.isSupported().then((supported) => {
      if (!supported && !abortController.signal.aborted) {
        alert('Your browser does not support WebCodecs');
      }
    });

    // Create studio instance with initial dimensions
    previewRef.current = new Studio({
      width: defaultSize.width,
      height: defaultSize.height,
      fps: 30,
      bgColor: '#1B1917',
      canvas: previewCanvasRef.current,
      interactivity: true,
      spacing: 20,
    });

    const init = async () => {
      try {
        await Promise.all([
          fontManager.loadFonts([
            {
              name: editorFont.fontFamily,
              url: editorFont.fontUrl,
            },
          ]),
          previewRef.current?.ready,
        ]);

        if (abortController.signal.aborted) return;

        // Fetch available languages (queries tracks + voiceovers + storyboard plan)
        const langs = await getAvailableLanguages(projectId);
        if (abortController.signal.aborted) return;

        let { activeLanguage } = useLanguageStore.getState();

        if (langs.length > 0 && !langs.includes(activeLanguage)) {
          activeLanguage = langs[0];
          useLanguageStore.getState().setActiveLanguage(activeLanguage);
        }

        // Always ensure activeLanguage is in the list
        if (!langs.includes(activeLanguage)) {
          langs.push(activeLanguage);
        }
        useLanguageStore.getState().setAvailableLanguages(langs);

        // Load timeline for the correct language
        const savedData = await loadTimeline(projectId, activeLanguage);
        if (abortController.signal.aborted) return;

        if (savedData && savedData.length > 0) {
          console.log('Loading from Supabase...');
          const projectJson = reconstructProjectJSON(savedData);
          await previewRef.current?.loadFromJSON(projectJson as any);
        }

        if (abortController.signal.aborted) return;

        console.log('Studio ready');
        onReadyRef.current?.();
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error('Failed to initialize studio:', error);
          toast.error('Failed to load project. Please refresh the page.');
          // Still dismiss loading overlay so the user can see the error
          onReadyRef.current?.();
        }
      }
    };

    init();

    // Set store
    setStudio(previewRef.current);

    return () => {
      abortController.abort();
      if (previewRef.current) {
        previewRef.current.destroy();
        previewRef.current = null;
        setStudio(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-full w-full flex flex-col min-h-0 min-w-0 bg-panel rounded-sm relative">
      <Player canvasRef={previewCanvasRef} />
      {isLanguageSwitching && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] z-10 rounded-sm">
          <div className="flex items-center gap-2 text-sm text-white">
            <Loader2 className="h-4 w-4 animate-spin" />
            Switching language...
          </div>
        </div>
      )}
    </div>
  );
}
