type LogLevel = 'info' | 'success' | 'warn' | 'error';

interface LogContext {
  requestId: string;
  step?: string;
  [key: string]: unknown;
}

const LEVEL_PREFIXES: Record<LogLevel, string> = {
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

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>
  ): void {
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
            // Truncate long values
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
