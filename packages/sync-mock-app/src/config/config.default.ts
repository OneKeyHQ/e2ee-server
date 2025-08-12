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