/**
 * Audio codec detection utility
 * Detects the best supported audio codec based on browser capabilities
 */
export interface AudioCodecConfig {
    codec: string;
    codecType: 'aac' | 'opus';
    sampleRate: number;
    channelCount: number;
}
/**
 * Get the default audio codec configuration based on browser support
 * Prefers AAC (mp4a.40.2) but falls back to Opus if not supported
 *
 * @returns Promise resolving to the best supported audio codec configuration
 */
export declare function getDefaultAudioCodec(): Promise<AudioCodecConfig>;
/**
 * Synchronously get the cached codec configuration
 * Returns null if detection hasn't been performed yet
 *
 * @returns The cached audio codec configuration or null
 */
export declare function getCachedAudioCodec(): AudioCodecConfig | null;
/**
 * Reset the cached codec (useful for testing)
 */
export declare function resetCodecCache(): void;
