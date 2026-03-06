/**
 * Concatenate multiple Float32Arrays, commonly used for merging PCM data
 */
export declare function concatFloat32Array(buffers: Float32Array[]): Float32Array;
/**
 * Merge small PCM fragments into a large fragment
 * @param fragments Small PCM fragments, where each element is raw PCM data from different channels
 */
export declare function concatPCMFragments(fragments: Float32Array[][]): Float32Array[];
/**
 * Utility function to extract PCM data from AudioData
 */
export declare function extractPCM4AudioData(audioData: AudioData): Float32Array[];
/**
 * Extract PCM from AudioBuffer
 */
export declare function extractPCM4AudioBuffer(audioBuffer: AudioBuffer): Float32Array[];
/**
 * Adjust audio data volume
 * @param audioData - Audio object to adjust
 * @param volume - Volume adjustment coefficient (0.0 - 1.0)
 * @returns New audio data with adjusted volume
 */
export declare function adjustAudioDataVolume(audioData: AudioData, volume: number): AudioData;
/**
 * Mix PCM data from dual-channel audio tracks and interleave multiple channels into a single Float32Array output
 * @param audios - A 2D array where each element is a Float32Array array representing PCM data from an audio stream.
 * The first element of each Float32Array array is left channel data, and the second element (if present) is right channel data.
 * If only left channel data exists, the right channel will reuse the left channel data.
 *
 * @returns Returns a Float32Array with left and right channels interleaved.
 *
 * @example
 *
 * const audios = [
 *   [new Float32Array([0.1, 0.2, 0.3]), new Float32Array([0.4, 0.5, 0.6])],
 *   [new Float32Array([0.7, 0.8, 0.9])],
 * ];
 * const mixed = mixinPCM(audios);
 */
export declare function mixinPCM(audios: Float32Array[][]): Float32Array;
/**
 * Resample PCM audio data.
 *
 * @param pcmData - A Float32Array array where each element represents PCM data from one channel.
 * @param curRate - Current sample rate.
 * @param target - Target parameters object.
 * @param target.rate - Target sample rate.
 * @param target.chanCount - Target channel count.
 *
 * @returns Returns a Promise that resolves to a Float32Array array where each element represents PCM data from one channel after resampling.
 *
 * @example
 *
 * const pcmData = [new Float32Array([0.1, 0.2, 0.3]), new Float32Array([0.4, 0.5, 0.6])];
 * const curRate = 44100;
 * const target = { rate: 48000, chanCount: 2 };
 * const resampled = await audioResample(pcmData, curRate, target);
 */
export declare function audioResample(pcmData: Float32Array[], curRate: number, target: {
    rate: number;
    chanCount: number;
}): Promise<Float32Array[]>;
/**
 * Extract a circular slice from the given Float32Array, looping from 0 when exceeding boundaries
 *
 * Mainly used for slicing PCM data to implement looped playback
 *
 * @param data - Input Float32Array.
 * @param start - Start index of the slice.
 * @param end - End index of the slice.
 * @returns Returns a new Float32Array containing data from start to end.
 *
 * @example
 * const data = new Float32Array([0, 1, 2, 3, 4, 5]);
 * ringSliceFloat32Array(data, 4, 6); // => Float32Array [4, 5, 0]
 */
export declare function ringSliceFloat32Array(data: Float32Array, start: number, end: number): Float32Array;
/**
 * Change PCM data playback rate, where 1 means normal playback, 0.5 means half speed, and 2 means double speed
 */
export declare function changePCMPlaybackRate(pcmData: Float32Array, playbackRate: number): Float32Array<ArrayBuffer>;
