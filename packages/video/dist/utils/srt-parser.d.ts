/**
 * Parse SRT subtitle format
 * Returns array of subtitle segments with start, end, and text
 */
export interface SubtitleSegment {
    start: number;
    end: number;
    text: string;
}
/**
 * Parse SRT subtitle content into segments
 * @param srt SRT file content as string
 * @returns Array of subtitle segments
 */
export declare function parseSrt(srt: string): SubtitleSegment[];
