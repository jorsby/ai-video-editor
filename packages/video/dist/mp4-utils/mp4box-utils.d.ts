import { AudioTrackOpts, MP4File, MP4Info, MP4Sample, VideoTrackOpts } from 'wrapbox';
import { file } from 'opfs-tools';
interface ExtractedConfig {
    videoTrackConf?: VideoTrackOpts;
    videoDecoderConf?: VideoDecoderConfig;
    audioTrackConf?: AudioTrackOpts;
    audioDecoderConf?: AudioDecoderConfig;
}
/**
 * Extracts video and audio configurations from an MP4 file.
 */
export declare function extractFileConfig(file: MP4File, info: MP4Info): ExtractedConfig;
/**
 * Quick parse mp4 file, prioritizing header parsing to save memory.
 */
export declare function quickParseMP4File(reader: Awaited<ReturnType<ReturnType<typeof file>['createReader']>>, onReady: (data: {
    mp4boxFile: MP4File;
    info: MP4Info;
}) => void, onSamples: (id: number, sampleType: 'video' | 'audio', samples: MP4Sample[]) => void): Promise<void>;
/**
 * Parses transformation matrix to extract scale, rotation, and translation.
 */
export declare function parseMatrix(matrix?: Int32Array): {
    scaleX?: undefined;
    scaleY?: undefined;
    rotationRad?: undefined;
    rotationDeg?: undefined;
    translateX?: undefined;
    translateY?: undefined;
    perspective?: undefined;
} | {
    scaleX: number;
    scaleY: number;
    rotationRad: number;
    rotationDeg: number;
    translateX: number;
    translateY: number;
    perspective: number;
};
/**
 * Creates a function to rotate VideoFrames using Canvas.
 */
export declare function createVFRotater(width: number, height: number, rotationDeg: number): (vf: VideoFrame | null) => VideoFrame | null;
export {};
