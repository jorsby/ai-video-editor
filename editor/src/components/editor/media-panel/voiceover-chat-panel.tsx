import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { IconLoader2 } from '@tabler/icons-react';
import { toast } from 'sonner';
import { useAssetStore } from '@/stores/asset-store';
import { useProjectId } from '@/contexts/project-context';

export const VoiceoverChatPanel = () => {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const { addAsset } = useAssetStore();
  const projectId = useProjectId();

  const handleGenerate = async () => {
    if (!text.trim()) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const response = await fetch('/api/elevenlabs/voiceover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, project_id: projectId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to generate voiceover');
      }

      const data = await response.json();

      addAsset({
        id: data.id || crypto.randomUUID(),
        url: data.url,
        name: text,
        prompt: text,
        type: 'voiceover',
        createdAt: Date.now(),
      });

      toast.success('Voiceover generated!');
      setText(''); // Clear input on success
    } catch (error) {
      if ((error as DOMException)?.name === 'AbortError') return;
      console.error(error);
      toast.error('Failed to generate voiceover');
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="rounded-xl h-full p-3 flex flex-col gap-2 shadow-sm">
        <div className="flex gap-2 h-full pt-2">
          <Textarea
            placeholder="Enter text for voiceover..."
            className="resize-none text-sm min-h-[24px] h-full !bg-transparent border-0 focus-visible:ring-0 px-1 py-0 shadow-none placeholder:text-muted-foreground"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 pt-2 w-full justify-end">
          {loading && (
            <Button
              variant="ghost"
              className="h-9 w-20 rounded-full text-sm"
              size="sm"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          )}
          <Button
            className="h-9 w-24 rounded-full text-sm relative"
            size="sm"
            onClick={handleGenerate}
            disabled={loading || !text.trim()}
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
