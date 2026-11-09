import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import type { Env } from '../config/env';
import { ChunkRepository } from './chunk.repository';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { EmbeddingWorker } from './embedding.worker';

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        // Memory storage (no `dest`): the file is parsed in memory and never written to disk.
        limits: {
          fileSize: config.get('UPLOAD_MAX_BYTES', { infer: true }), // larger -> 413
          files: 1,
          fields: 60,
        },
        // Without it, UTF-8 file names ("Política.pdf") arrive decoded as latin1.
        defParamCharset: 'utf8',
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, ChunkRepository, EmbeddingWorker],
})
export class DocumentsModule {}
