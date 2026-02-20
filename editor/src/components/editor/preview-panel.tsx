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
  const { setStudio } = useStudioStore();
  const projectId = useProjectId();
  const isLanguageSwitching = useLanguageStore(
    (s) => s.isLanguageSwitching
  );

  // Initialize Studio
  useEffect(() => {
    if (!previewCanvasRef.current) return;

    // Check support
    (async () => {
      if (!(await Compositor.isSupported())) {
        alert('Your browser does not support WebCodecs');
      }
    })();

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
      await Promise.all([
        fontManager.loadFonts([
          {
            name: editorFont.fontFamily,
            url: editorFont.fontUrl,
          },
        ]),
        previewRef.current?.ready,
      ]);

      // Load from Supabase with active language
      const { activeLanguage } = useLanguageStore.getState();
      const savedData = await loadTimeline(projectId, activeLanguage);
      if (savedData && savedData.length > 0) {
        console.log('Loading from Supabase...');
        const projectJson = reconstructProjectJSON(savedData);
        await previewRef.current?.loadFromJSON(projectJson as any);
      }

      // Fetch available languages and update store
      const langs = await getAvailableLanguages(projectId);
      if (langs.length > 0) {
        useLanguageStore.getState().setAvailableLanguages(langs);
      }

      console.log('Studio ready');
      onReady?.();
    };

    init();

    // Set store
    setStudio(previewRef.current);

    return () => {
      if (previewRef.current) {
        previewRef.current.destroy();
        previewRef.current = null;
        setStudio(null);
      }
    };
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
