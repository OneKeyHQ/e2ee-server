import { Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { ISyncDependenciesProvider, ISyncErrors, ITraceHeaders } from '@onekeyhq/sync';

@Provide()
@Scope(ScopeEnum.Singleton)
export class SyncDependenciesProvider implements ISyncDependenciesProvider {
  async updateUser(userId: string, data: any): Promise<void> {
    console.log(`[Mock] Updating user ${userId} with data:`, data);
  }

  getTraceHeaders(): ITraceHeaders {
    return {
      'x-trace-id': `mock-trace-${Date.now()}`,
      'x-onekey-instance-id': 'mock-instance',
    };
  }

  getErrors(): ISyncErrors {
    return {
      PrimeUserNonceInvalidError: class extends Error {
        constructor(message?: string) {
          super(message || 'Nonce invalid');
          this.name = 'PrimeUserNonceInvalidError';
        }
      },
      PrimeUserPwdHashInvalidError: class extends Error {
        constructor(message?: string) {
          super(message || 'Password hash invalid');
          this.name = 'PrimeUserPwdHashInvalidError';
        }
      },
    };
  }
}
