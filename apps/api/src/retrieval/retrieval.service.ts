import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@knowgate/db';
import type { SearchResult } from '@knowgate/shared';
import { PRISMA } from '../database/database.module';
import { ChunkRepository } from '../documents/chunk.repository';
import {
  costUsd,
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from '../embeddings/embedding-provider';
import type { OrgMembership } from '../organizations/org-access';
import { maskPii } from '../privacy/pii-masker';

@Injectable()
export class RetrievalService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly chunks: ChunkRepository,
  ) {}

  async search(membership: OrgMembership, query: string, limit: number): Promise<SearchResult[]> {
    const scope = {
      organizationId: membership.organizationId,
      userId: membership.userId,
      isAdmin: membership.role === 'ADMIN',
    };
    // Nothing the user can read: answer without paying for a query embedding.
    if (!(await this.chunks.hasSearchableChunks(scope))) return [];

    // The question is masked like the documents: the provider never sees personal data, and a
    // masked value in the question still matches the same placeholder in the chunks.
    const queryText = maskPii(query).text;
    const { vectors, totalTokens } = await this.embeddings.embed([queryText], 'query');
    await this.prisma.usageEvent.create({
      data: {
        organizationId: membership.organizationId,
        userId: membership.userId,
        kind: 'EMBEDDING',
        model: this.embeddings.model,
        inputTokens: totalTokens,
        costUsd: costUsd(this.embeddings, totalTokens),
      },
    });

    return this.chunks.hybridSearch({ ...scope, queryVector: vectors[0] ?? [], queryText, limit });
  }
}
