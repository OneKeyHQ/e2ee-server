export interface IPrimeUser {
  userId: string;
  nonce: number;
  pwdHash?: string;
  isPrime?: boolean;
  deleted?: boolean;
}

export interface IDevice {
  userId: string;
  instanceId: string;
}

export interface ITraceHeaders {
  'x-onekey-instance-id'?: string;
  'x-trace-id'?: string;
  [key: string]: any;
}

export interface ISyncErrors {
  PrimeUserNonceInvalidError: new (message?: string, options?: any) => Error;
  PrimeUserPwdHashInvalidError: new (message?: string, options?: any) => Error;
}
