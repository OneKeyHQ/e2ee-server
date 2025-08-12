import { Provide, Scope, ScopeEnum } from '@midwayjs/core';
import { IKafkaAdapter, ISyncNotificationData } from '@onekeyhq/cloud-sync-server';

@Provide()
@Scope(ScopeEnum.Singleton)
export class KafkaAdapterImpl implements IKafkaAdapter {
  async sendPrimeNotification(data: ISyncNotificationData): Promise<void> {
    console.log('[Mock Kafka] Sending notification:', {
      devices: data.devices,
      type: data.type,
      data: data.data,
      timestamp: new Date().toISOString(),
    });
  }
}