export type CaptionLength = 'short' | 'medium' | 'long';
export type CaptionTone = 'professional' | 'casual' | 'witty' | 'inspirational';

export interface CaptionStyleOptions {
  length: CaptionLength;
  tone: CaptionTone;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyleOptions = {
  length: 'short',
  tone: 'casual',
};
