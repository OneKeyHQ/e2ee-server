import { Inject, Provide, Scope, ScopeEnum } from '@midwayjs/core';

import {
  ISyncDependenciesProvider,
  ISyncErrors,
  ITraceHeaders,
} from '../interface';

/**
 * Example implementation of ISyncDependenciesProvider for the main application.
 * This should be implemented in the main application, not in the sync-component package.
 *
 * This provider is responsible for providing external dependencies required by the sync component.
 */
@Provide()
@Scope(ScopeEnum.Singleton)
export class SyncDependenciesProvider implements ISyncDependenciesProvider {
  @Inject()
  userService: any; // Your user service

  @Inject()
  traceService: any; // Your trace service

  async updateUser(userId: string, data: any): Promise<void> {
    // Example: Update user in your database
    await this.userService.updateUser(userId, data);
  }

  getTraceHeaders(): ITraceHeaders {
    // Example: Return trace headers from your trace service
    return this.traceService.getTraceHeaders() || {};
  }

  getErrors(): ISyncErrors {
    // Example: Return your custom error classes
    return {
      PrimeUserNonceInvalidError: Error, // Replace with your custom error class
      PrimeUserPwdHashInvalidError: Error, // Replace with your custom error class
    };
  }
}
