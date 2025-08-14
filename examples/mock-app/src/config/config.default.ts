import { MidwayConfig } from '@midwayjs/core';

export default {
  keys: 'sync-mock-app',
  koa: {
    port: 7001,
  },
  sync: {
    maxDataSize: 1024 * 1024 * 10, // 10MB
    maxHistorySize: 100,
    maxNonceGap: 10,
    pageSize: 100,
    deviceLimit: 10,
    // Rate limiting configuration
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: 'Too many requests from this IP, please try again later.',
    },
  },
  midwayLogger: {
    default: {
      maxSize: '100m',
      maxFiles: '7d',
      level: 'info',
      consoleLevel: 'info',
    },
  },
} as MidwayConfig;