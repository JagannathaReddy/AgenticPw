import pino from 'pino';

/**
 * Structured logger for the worker.
 *
 * JSON mode (production, CI, redirected stdio): default.
 * Pretty mode (interactive dev): set LOG_PRETTY=true. Requires pino-pretty
 * (installed as an optional dep so CI doesn't blow up if it's missing).
 */
export const logger = pino(
  process.env.LOG_PRETTY === 'true'
    ? {
        level: process.env.LOG_LEVEL ?? 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        level: process.env.LOG_LEVEL ?? 'info',
        base: { service: 'worker', pid: process.pid },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
);

/** Bind a manifestId + correlationId to every log line for a given flow. */
export function manifestLogger(manifestId: string, correlationId: string) {
  return logger.child({
    manifestId,
    correlationId,
    manifestShortId: manifestId.slice(0, 8),
  });
}

export type Logger = typeof logger;
