import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { PrismaClient } from '@knowgate/db';
import { PRISMA } from '../database/database.module';
import {
  costUsd,
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from '../embeddings/embedding-provider';
import { ChunkRepository } from './chunk.repository';

const BATCH_SIZE = 128;

/**
 * Embeds the chunks of uploaded documents in the background: PENDING -> PROCESSING -> READY,
 * or FAILED after the provider's retries are exhausted.
 *
 * In-process queue on purpose (phase 6 replaces it with SQS + Lambda): documents are processed
 * one at a time, so a large upload cannot exhaust the embeddings rate limit. Work is resumable:
 * the chunks are already in the database and only those without an embedding are sent, so a
 * restart re-enqueues unfinished documents without paying twice for finished chunks.
 */
@Injectable()
export class EmbeddingWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(EmbeddingWorker.name);
  private readonly queued = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private stopping = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
    private readonly chunks: ChunkRepository,
  ) {}

  /** Crash recovery: documents left unfinished by a previous process. */
  async onApplicationBootstrap(): Promise<void> {
    const unfinished = await this.prisma.document.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    for (const { id } of unfinished) this.enqueue(id);
  }

  /** Finishes the document in progress; the rest stays PENDING for the next start. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopping = true;
    await this.tail;
  }

  enqueue(documentId: string): void {
    if (this.stopping || this.queued.has(documentId)) return;
    this.queued.add(documentId);
    this.tail = this.tail.then(async () => {
      this.queued.delete(documentId);
      if (this.stopping) return;
      // A failure outside process()'s own handling (e.g. the database is down) must not
      // break the chain, or every later document would stay queued forever.
      await this.process(documentId).catch((error: unknown) => {
        this.logger.error(`Could not process document ${documentId}: ${(error as Error).message}`);
      });
    });
  }

  private async process(documentId: string): Promise<void> {
    // Claim: only a PENDING/PROCESSING document is processed (deleted or READY ones are skipped).
    const claimed = await this.prisma.document.updateMany({
      where: { id: documentId, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count === 0) return;
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { organizationId: true, createdById: true },
    });
    if (!document) return;

    try {
      for (;;) {
        const batch = await this.chunks.findWithoutEmbedding(
          document.organizationId,
          documentId,
          BATCH_SIZE,
        );
        if (batch.length === 0) break;

        // Contextual Retrieval (phase 5) fills `context`; it is embedded together with the chunk.
        const texts = batch.map((c) => (c.context ? `${c.context}\n\n${c.content}` : c.content));
        const { vectors, totalTokens } = await this.provider.embed(texts, 'document');
        await this.chunks.setEmbeddings(
          document.organizationId,
          batch.map((chunk, i) => ({ id: chunk.id, vector: vectors[i] ?? [] })),
        );
        // Cost is recorded per batch: PostgreSQL is the source of truth for usage.
        await this.prisma.usageEvent.create({
          data: {
            organizationId: document.organizationId,
            userId: document.createdById,
            kind: 'EMBEDDING',
            model: this.provider.model,
            inputTokens: totalTokens,
            costUsd: costUsd(this.provider, totalTokens),
          },
        });
      }
      await this.setStatus(documentId, 'READY');
    } catch (error) {
      // Only the error type/message: never chunk content (it could contain personal data).
      this.logger.error(`Embedding failed for document ${documentId}: ${(error as Error).message}`);
      await this.setStatus(documentId, 'FAILED');
    }
  }

  private async setStatus(documentId: string, status: 'READY' | 'FAILED'): Promise<void> {
    // updateMany: the document may have been deleted meanwhile (no error, nothing to update).
    await this.prisma.document.updateMany({
      where: { id: documentId, status: 'PROCESSING' },
      data: { status },
    });
  }
}
