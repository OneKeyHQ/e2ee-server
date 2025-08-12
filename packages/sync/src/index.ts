// Export configuration for Midway.js component loading
export { default as Configuration } from './configuration';
export * from './interface';
export * from './dto/sync.dto';
export {
  PrimeSyncService,
  ISyncServiceDependencies,
  EPrimeNotificationEvent,
} from './service/sync.service';
