import { IMidwayContainer, createConfiguration } from '@midwayjs/core';

import { ISyncComponentConfig } from './interface';

export default createConfiguration({
  namespace: 'sync',
  importConfigs: [
    {
      default: {
        sync: {
          enableCache: false,
          cachePrefix: 'sync:',
          cacheTTL: 300,
        },
      },
    },
  ],
}).onReady(async (container: IMidwayContainer) => {
  const config = (container as any).getConfiguration?.(
    'sync'
  ) as ISyncComponentConfig;

  // Register adapters if provided
  if (config?.adapters) {
    container.registerObject('sync:adapters', config.adapters);
  }

  // Register dependencies provider if provided
  if (config?.dependenciesProvider) {
    container.registerObject(
      'sync:dependenciesProvider',
      config.dependenciesProvider
    );
  }
});
