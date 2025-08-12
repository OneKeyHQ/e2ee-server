import { Configuration, IMidwayContainer, App } from '@midwayjs/core';
import { Application } from '@midwayjs/koa';
import * as koa from '@midwayjs/koa';
import * as validate from '@midwayjs/validate';
import * as syncComponent from '@onekeyhq/cloud-sync-server';
import { join } from 'path';
import { MongodbAdapterImpl } from './adapter/mongodb.adapter';
import { KafkaAdapterImpl } from './adapter/kafka.adapter';
import { SyncDependenciesProvider } from './service/dependencies.provider';

@Configuration({
  imports: [
    koa,
    validate,
    syncComponent,
  ],
  importConfigs: [join(__dirname, './config')],
})
export class MainConfiguration {
  @App()
  app!: Application;
  
  async onReady(container: IMidwayContainer) {
    const mongodbAdapter = await container.getAsync(MongodbAdapterImpl);
    const kafkaAdapter = await container.getAsync(KafkaAdapterImpl);
    const dependenciesProvider = await container.getAsync(SyncDependenciesProvider);

    container.registerObject('sync:adapters', {
      mongodbAdapter,
      kafkaAdapter,
    });

    container.registerObject('sync:dependenciesProvider', dependenciesProvider);

    const config = (container as any).getConfiguration?.() || {};
    config.sync = {
      ...config.sync,
      adapters: {
        mongodbAdapter,
        kafkaAdapter,
      },
      dependenciesProvider,
    };

    console.log('✅ Sync component configured successfully');
    console.log('🚀 Mock Sync Application started on http://localhost:7001');
    console.log('📝 Available endpoints:');
    console.log('  POST /sync/download?userId={userId}');
    console.log('  POST /sync/upload?userId={userId}');
    console.log('  POST /sync/check?userId={userId}');
    console.log('  GET  /sync/lock?userId={userId}');
    console.log('  POST /sync/lock?userId={userId}');
    console.log('  POST /sync/flush?userId={userId}');
  }
}