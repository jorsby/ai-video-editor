/**
 * Global logging utility.
 */
export declare const Log: {
    debug: (...args: any[]) => void;
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    /**
     * Sets the logging threshold. Only logs at this level or higher will be recorded.
     * @example Log.setLogLevel(Log.warn) // Only warn and error will be logged
     */
    setLogLevel: <T extends Function>(logfn: T) => void;
    /**
     * Creates a logger instance that prefixes all messages with a tag.
     */
    create: (tag: string) => {
        debug: (...args: any[]) => void;
        info: (...args: any[]) => void;
        warn: (...args: any[]) => void;
        error: (...args: any[]) => void;
    };
    /**
     * Dumps the log history as a string.
     */
    dump: () => Promise<string>;
};
