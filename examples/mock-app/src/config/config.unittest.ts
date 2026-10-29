import { MidwayConfig } from '@midwayjs/core';

// Port 0 picks a free port, so tests never clash with a running dev server or
// another test worker on 7001.
export default {
  koa: {
    port: 0,
  },
} as MidwayConfig;
