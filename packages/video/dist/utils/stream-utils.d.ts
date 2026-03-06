import { MP4File } from 'wrapbox';
export declare function autoReadStream<ST extends ReadableStream>(stream: ST, cbs: {
    onChunk: ST extends ReadableStream<infer DT> ? (chunk: DT) => Promise<void> : never;
    onDone: () => void;
}): () => void;
export declare function file2stream(file: MP4File, timeSlice: number, onCancel?: () => void): {
    stream: ReadableStream<Uint8Array>;
    stop: (err?: Error) => void;
};
