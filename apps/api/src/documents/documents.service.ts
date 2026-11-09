import {
  BadRequestException,
  Logger,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@knowgate/db';
import type { UploadDocumentFields } from '@knowgate/shared';
import type { Env } from '../config/env';
import { PRISMA } from '../database/database.module';
import type { OrgMembership } from '../organizations/org-access';
import { documentAccessWhere } from './document-access';
import { chunkSections, type ChunkOptions } from './ingestion/chunker';
import { detectSourceType } from './ingestion/file-type';
import { parseDocument, type Section } from './ingestion/parsers';
import { maskPii, totalMasked } from '../privacy/pii-masker';

/** The parts of the multer file the service uses (memory storage). */
export interface UploadedDocumentFile {
  originalname: string;
  buffer: Buffer;
}

const documentSelect = {
  id: true,
  title: true,
  sourceType: true,
  visibility: true,
  status: true,
  createdById: true,
  createdAt: true,
  documentTeams: { select: { teamId: true } },
  _count: { select: { chunks: true } },
} as const;

type DocumentRow = {
  documentTeams: { teamId: string }[];
  _count: { chunks: number };
} & Record<string, unknown>;

function toView({ documentTeams, _count, ...document }: DocumentRow) {
  return { ...document, teamIds: documentTeams.map((t) => t.teamId), chunkCount: _count.chunks };
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly chunkOptions: ChunkOptions;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    config: ConfigService<Env, true>,
  ) {
    this.chunkOptions = {
      targetTokens: config.get('CHUNK_TARGET_TOKENS', { infer: true }),
      overlapTokens: config.get('CHUNK_OVERLAP_TOKENS', { infer: true }),
    };
  }

  /**
   * Parses and chunks the file inside the request, so an unreadable file is rejected right
   * away (415/422), then stores the document and its chunks in one transaction. The document
   * stays PENDING until its chunks get embeddings.
   */
  async upload(
    membership: OrgMembership,
    file: UploadedDocumentFile,
    fields: UploadDocumentFields,
  ) {
    const { organizationId } = membership;
    const sourceType = detectSourceType(file.originalname, file.buffer);
    // Personal data is masked before anything is stored or sent to the embeddings API, so the
    // database, Voyage and Claude only ever see placeholders such as [CPF].
    const sections = maskSections(await parseDocument(sourceType, file.buffer));
    const chunks = chunkSections(sections.sections, this.chunkOptions);
    if (chunks.length === 0) {
      throw new UnprocessableEntityException(
        'The file has no extractable text (scanned PDFs are not supported)',
      );
    }

    if (fields.teamIds.length > 0) {
      // Only teams of this organization (the composite FK would also reject others, with a 500).
      const found = await this.prisma.team.count({
        where: { organizationId, id: { in: fields.teamIds } },
      });
      if (found !== fields.teamIds.length) throw new BadRequestException('Unknown team');
    }

    const document = await this.prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          organizationId,
          title: maskPii(fields.title ?? stripExtension(file.originalname)).text,
          sourceType,
          visibility: fields.visibility,
          createdById: membership.userId,
          documentTeams: { create: fields.teamIds.map((teamId) => ({ teamId })) },
        },
        select: { id: true },
      });
      await tx.chunk.createMany({
        data: chunks.map((chunk) => ({ ...chunk, organizationId, documentId: created.id })),
      });
      return tx.document.findUniqueOrThrow({ where: { id: created.id }, select: documentSelect });
    });
    // Counts only: the masked values themselves are never logged.
    if (sections.masked > 0) {
      this.logger.log(`Document ${document.id}: ${sections.masked} personal data items masked`);
    }
    return toView(document);
  }

  async list(membership: OrgMembership) {
    const documents = await this.prisma.document.findMany({
      where: documentAccessWhere(membership),
      select: documentSelect,
      orderBy: { createdAt: 'desc' },
    });
    return documents.map(toView);
  }

  /** 404 both when the document does not exist and when the user cannot see it. */
  async get(membership: OrgMembership, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { ...documentAccessWhere(membership), id: documentId },
      select: documentSelect,
    });
    if (!document) throw new NotFoundException('Document not found');
    return toView(document);
  }

  /** Chunks and team shares go with the document (ON DELETE CASCADE). */
  async remove(organizationId: string, documentId: string): Promise<void> {
    const { count } = await this.prisma.document.deleteMany({
      where: { organizationId, id: documentId },
    });
    if (count === 0) throw new NotFoundException('Document not found');
  }
}

function maskSections(sections: Section[]): { sections: Section[]; masked: number } {
  let masked = 0;
  const result = sections.map((section) => ({
    reference: section.reference === null ? null : maskPii(section.reference).text,
    paragraphs: section.paragraphs.map((paragraph) => {
      const { text, counts } = maskPii(paragraph);
      masked += totalMasked(counts);
      return text;
    }),
  }));
  return { sections: result, masked };
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return (dot > 0 ? fileName.slice(0, dot) : fileName).slice(0, 200);
}
