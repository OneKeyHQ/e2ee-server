import { Inject, Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { ISyncDependenciesProvider, ISyncErrors, ITraceHeaders } from '@onekeyhq/cloud-sync-server';
import { MongodbAdapterImpl } from '../adapter/mongodb.adapter';

@Provide()
@Scope(ScopeEnum.Singleton)
export class SyncDependenciesProvider implements ISyncDependenciesProvider {
  @Inject()
  mongodbAdapter!: MongodbAdapterImpl;

  async updateUser(userId: string, data: any): Promise<void> {
    await this.mongodbAdapter.updateUserFields(userId, data);
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
