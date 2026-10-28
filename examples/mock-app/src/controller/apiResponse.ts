import { Context } from '@midwayjs/koa';

import { HardwareAuthError } from '../hardwareAuth/hardwareAuthCore';

// Prime responses use { code, message, data }; code 0 means success.
export type IApiResponse<T> = { code: number; message: string; data: T | null };

// Integer codes, as the app requires. Placeholders until aligned with Prime.
export const SYNC_ERROR_CODES: Record<string, number> = {
  PrimeUserPwdHashInvalidError: 90010,
  PrimeUserNonceInvalidError: 90011,
};
export const BAD_REQUEST_CODE = 90400;
export const INJECTED_FAULT_CODE = 90503;

export async function respond<T>(
  ctx: Context,
  run: () => Promise<T>
): Promise<IApiResponse<T>> {
  try {
    return { code: 0, message: 'ok', data: await run() };
  } catch (error) {
    if (error instanceof HardwareAuthError) {
      ctx.status = error.status;
      return { code: error.code, message: error.message, data: null };
    }
    const name = error instanceof Error ? error.name : '';
    if (SYNC_ERROR_CODES[name]) {
      return { code: SYNC_ERROR_CODES[name], message: name, data: null };
    }
    ctx.status = 400;
    return {
      code: BAD_REQUEST_CODE,
      message: error instanceof Error ? error.message : 'Bad request',
      data: null,
    };
  }
}

export function injectedFailure(ctx: Context): IApiResponse<null> {
  ctx.status = 503;
  return { code: INJECTED_FAULT_CODE, message: 'Injected fault', data: null };
}
