/**
 * Quick concatenate multiple MP4 file streams, requires all MP4s to have consistent properties,
 * properties include (but not limited to): audio/video codec format, resolution, sample rate
 *
 * @param streams An array of readable streams containing Uint8Array.
 * @returns Returns a Promise that resolves to a readable stream containing merged MP4 data.
 * @throws Will throw error if unable to generate file from streams.
 *
 * @example
 * const streams = [stream1, stream2, stream3];
 * const resultStream = await fastConcatMP4(streams);
 */
export declare function fastConcatMP4(streams: ReadableStream<Uint8Array>[]): Promise<ReadableStream<Uint8Array>>;
/**
 * Set correct duration value for fMP4 files generated
 */
export declare function fixFMP4Duration(stream: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>>;
/**
 * Video dubbing; mix MP4 with audio file, only re-encode audio, video track unchanged
 * @param mp4Stream - MP4 stream
 * @param audio - Audio information
 * @param audio.stream - Audio data stream
 * @param audio.volume - Audio volume
 * @param audio.loop - When audio duration is less than video, whether to loop audio stream
 * @returns Output mixed audio stream
 */
export declare function mixinMP4AndAudio(mp4Stream: ReadableStream<Uint8Array>, audio: {
    stream: ReadableStream<Uint8Array>;
    volume: number;
    loop: boolean;
}): ReadableStream<Uint8Array<ArrayBufferLike>>;
