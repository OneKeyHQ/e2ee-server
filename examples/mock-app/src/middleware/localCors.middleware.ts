import { IMiddleware, Middleware } from '@midwayjs/core';
import { Context, NextFunction } from '@midwayjs/koa';

// Local mock only: the desktop/web dev app calls this server from another
// origin (e.g. http://localhost:3001).
@Middleware()
export class LocalCorsMiddleware implements IMiddleware<Context, NextFunction> {
  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const origin = ctx.get('origin');
      if (origin) {
        ctx.set('Access-Control-Allow-Origin', origin);
        ctx.set('Vary', 'Origin');
        ctx.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
        ctx.set(
          'Access-Control-Allow-Headers',
          ctx.get('access-control-request-headers') ||
            'Content-Type,Authorization,DPoP'
        );
        ctx.set('Access-Control-Max-Age', '600');
      }
      if (ctx.method === 'OPTIONS') {
        ctx.status = 204;
        return;
      }
      await next();
    };
  }

  static getName() {
    return 'localCors';
  }
}
