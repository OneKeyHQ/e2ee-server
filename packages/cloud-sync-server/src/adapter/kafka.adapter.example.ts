import { IKafkaAdapter, ISyncNotificationData } from '../interface';

/**
 * Example implementation of IKafkaAdapter for the main application.
 * This should be implemented in the main application, not in the sync-component package.
 */
export class KafkaAdapterImpl implements IKafkaAdapter {
  constructor(private kafkaService: any) {}

  async sendPrimeNotification(data: ISyncNotificationData): Promise<void> {
    // Example implementation
    // This would typically send a message to a Kafka topic
    return this.kafkaService.sendPrimeNotification(data);
  }
}
