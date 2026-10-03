import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'migration-workbench' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: ['*.apiKey', '*.GEMINI_API_KEY', 'req.headers.authorization'], remove: true },
});
