import { MP4File, MP4Info, MP4Sample } from 'wrapbox';
export type TransformChunk = {
    chunkType: 'ready';
    data: {
        info: MP4Info;
        file: MP4File;
    };
} | {
    chunkType: 'samples';
    data: {
        id: number;
        type: 'video' | 'audio';
        samples: MP4Sample[];
    };
};
/**
 * Transforms a raw byte stream into an MP4Sample stream using mp4box.js.
 */
export declare class SampleTransform {
    readonly readable: ReadableStream<TransformChunk>;
    readonly writable: WritableStream<Uint8Array>;
    private inputBufOffset;
    private isStreamCancelled;
    constructor();
    private initMP4Box;
}
