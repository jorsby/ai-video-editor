'use client';

import { Sparkles, Loader2 } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { CaptionStyleOptions } from './caption-style-options';
import type { SocialAccount } from '@/types/social';
import type { CaptionStyleOptions as CaptionStyleOptionsType } from '@/types/caption-style';
import type { LanguageCode } from '@/lib/constants/languages';

interface CaptionEditorProps {
  value: string;
  onChange: (value: string) => void;
  selectedAccounts: SocialAccount[];
  onGenerateCaption?: () => void;
  isGenerating?: boolean;
  captionStyle?: CaptionStyleOptionsType;
  onCaptionStyleChange?: (style: CaptionStyleOptionsType) => void;
  language?: LanguageCode;
  onLanguageChange?: (lang: LanguageCode) => void;
}

export function CaptionEditor({
  value,
  onChange,
  selectedAccounts,
  onGenerateCaption,
  isGenerating,
  captionStyle,
  onCaptionStyleChange,
  language,
  onLanguageChange,
}: CaptionEditorProps) {
  const providers = Array.from(
    new Set(selectedAccounts.map((a) => a.platform))
  );

  // TikTok has the strictest limit at 2200 chars
  const hasTikTok = providers.includes('tiktok');
  const maxChars = hasTikTok ? 2200 : 5000;
  const isOverLimit = value.length > maxChars;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-zinc-400">Caption</label>
          {onGenerateCaption && (
            <button
              type="button"
              onClick={onGenerateCaption}
              disabled={isGenerating}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/10 hover:text-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Generate caption with AI"
            >
              {isGenerating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
        <span
          className={`text-xs ${
            isOverLimit ? 'text-red-400 font-medium' : 'text-muted-foreground'
          }`}
        >
          {value.length} / {maxChars}
        </span>
      </div>
      {captionStyle && onCaptionStyleChange && (
        <CaptionStyleOptions
          value={captionStyle}
          onChange={onCaptionStyleChange}
          language={language}
          onLanguageChange={onLanguageChange}
        />
      )}
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Write your caption..."
        className="min-h-[120px] resize-y bg-zinc-900/40 border-white/[0.08] text-sm"
      />
      {providers.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          This caption will be posted to:{' '}
          {providers.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}
        </p>
      )}
      {isOverLimit && (
        <p className="text-xs text-red-400">
          Caption exceeds the {maxChars} character limit
          {hasTikTok ? ' (TikTok)' : ''}.
        </p>
      )}
    </div>
  );
}
