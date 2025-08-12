import { IKafkaAdapter, IMongodbAdapter } from './adapter.interface';
import { ISyncErrors, ITraceHeaders } from './sync.interface';

export interface ISyncComponentConfig {
  enableCache?: boolean;
  cachePrefix?: string;
  cacheTTL?: number;
  adapters?: {
    mongodbAdapter: IMongodbAdapter;
    kafkaAdapter?: IKafkaAdapter;
  };
  dependenciesProvider?: ISyncDependenciesProvider;
}

export interface ISyncDependenciesProvider {
  updateUser(userId: string, data: any): Promise<void>;
  getTraceHeaders(): ITraceHeaders;
  getErrors(): ISyncErrors;
}
