import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from './embedding-provider';
import { FakeEmbeddingProvider } from './fake.provider';
import { VoyageEmbeddingProvider } from './voyage.provider';

@Global()
@Module({
  providers: [
    {
      provide: EMBEDDING_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): EmbeddingProvider => {
        const dimension = config.get('EMBEDDING_DIMENSION', { infer: true });
        if (config.get('EMBEDDING_PROVIDER', { infer: true }) === 'fake') {
          return new FakeEmbeddingProvider(dimension);
        }
        return new VoyageEmbeddingProvider({
          // Presence checked by the env validation when the provider is voyage.
          apiKey: config.get('VOYAGE_API_KEY', { infer: true }) ?? '',
          model: config.get('VOYAGE_MODEL', { infer: true }),
          dimension,
        });
      },
    },
  ],
  exports: [EMBEDDING_PROVIDER],
})
export class EmbeddingsModule {}
