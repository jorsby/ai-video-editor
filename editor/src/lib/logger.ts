type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  success: 1,
  warn: 2,
  error: 3,
};

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const CONFIGURED_LEVEL: LogLevel = (() => {
  const env = process.env.NEXT_PUBLIC_LOG_LEVEL;
  if (env && env in LOG_LEVEL_PRIORITY) return env as LogLevel;
  return IS_PRODUCTION ? 'info' : 'debug';
})();

interface LogContext {
  requestId: string;
  step?: string;
  [key: string]: unknown;
}

const LEVEL_PREFIXES: Record<LogLevel, string> = {
  debug: '🔍 DEBUG',
  info: 'ℹ️  INFO ',
  success: '✅ OK   ',
  warn: '⚠️  WARN ',
  error: '❌ ERROR',
};

const STEP_EMOJIS: Record<string, string> = {
  GenGridImage: '🖼️',
  SplitGridImage: '✂️',
  StartWorkflow: '🚀',
  GenerateTTS: '🎙️',
  OutpaintImage: '✨',
  GenerateVideo: '🎬',
};

export class Logger {
  private context: LogContext;
  private timings: Map<string, number> = new Map();
  private startTime: number;

  constructor(requestId?: string) {
    this.startTime = performance.now();
    this.context = {
      requestId: requestId || crypto.randomUUID().slice(0, 8),
    };
  }

  setContext(ctx: Partial<LogContext>): this {
    this.context = { ...this.context, ...ctx };
    return this;
  }

  startTiming(operation: string): void {
    this.timings.set(operation, performance.now());
  }

  endTiming(operation: string): number {
    const start = this.timings.get(operation);
    if (!start) return 0;
    const elapsed = Math.round(performance.now() - start);
    this.timings.delete(operation);
    return elapsed;
  }

  elapsed(): number {
    return Math.round(performance.now() - this.startTime);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[CONFIGURED_LEVEL];
  }

  private toJSON(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): string {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      requestId: this.context.requestId,
      step: this.context.step ?? null,
      message,
      data: data ?? null,
      elapsed_ms: this.elapsed(),
    });
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
    if (!this.shouldLog(level)) return;

    if (IS_PRODUCTION) {
      const json = this.toJSON(level, message, data);
      switch (level) {
        case 'error':
          console.error(json);
          break;
        case 'warn':
          console.warn(json);
          break;
        default:
          console.log(json);
      }
      return;
    }

    // Dev: pretty format with emojis
    const prefix = LEVEL_PREFIXES[level];
    const stepEmoji = this.context.step
      ? STEP_EMOJIS[this.context.step] || '📌'
      : '';
    const elapsed = `[${this.elapsed()}ms]`;
    const reqId = `[${this.context.requestId}]`;

    const parts = [prefix, reqId, elapsed];
    if (stepEmoji) parts.push(stepEmoji);
    parts.push(message);

    const logLine = parts.join(' ');

    const dataStr = data
      ? Object.entries(data)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => {
            const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
            const truncated =
              val.length > 100 ? `${val.substring(0, 100)}...` : val;
            return `  ${k}=${truncated}`;
          })
          .join('\n')
      : '';

    const fullMessage = dataStr ? `${logLine}\n${dataStr}` : logLine;

    switch (level) {
      case 'error':
        console.error(fullMessage);
        break;
      case 'warn':
        console.warn(fullMessage);
        break;
      default:
        console.log(fullMessage);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  success(message: string, data?: Record<string, unknown>): void {
    this.log('success', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  db(operation: string, table: string, data?: Record<string, unknown>): void {
    this.info(`🗄️ DB ${operation} on ${table}`, data);
  }

  api(service: string, endpoint: string, data?: Record<string, unknown>): void {
    this.info(`🤖 API ${service} -> ${endpoint}`, data);
  }

  summary(status: 'success' | 'error', data?: Record<string, unknown>): void {
    const totalTime = this.elapsed();
    if (status === 'success') {
      this.success(`Completed in ${totalTime}ms`, data);
    } else {
      this.error(`Failed after ${totalTime}ms`, data);
    }
  }
}

export function createLogger(requestId?: string): Logger {
  return new Logger(requestId);
}

/**
 * Log a workflow event to the debug_logs table.
 * Use this from API routes to track workflow step progress.
 */
export async function logWorkflowEvent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  event: {
    storyboardId: string;
    step: string;
    status: 'start' | 'success' | 'error';
    data?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabase.from('debug_logs').insert({
      step: event.step,
      payload: {
        storyboard_id: event.storyboardId,
        status: event.status,
        ...event.data,
        logged_at: new Date().toISOString(),
      },
    });
  } catch {
    // Logging should never break the main flow
  }
}
