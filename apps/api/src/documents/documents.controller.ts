import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type UploadDocumentFields, uploadDocumentFieldsSchema } from '@knowgate/shared';
import { uuidParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentMembership, type OrgMembership, Roles } from '../organizations/org-access';
import { DocumentsService, type UploadedDocumentFile } from './documents.service';

/** Members read the documents they can see; only admins upload and delete (CLAUDE.md §7). */
@Controller('orgs/:orgId/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * multipart/form-data: `file` plus optional `title`, `visibility` and repeated `teamIds`.
   * Guards run before interceptors, so non-admins are rejected before the file is read.
   */
  @Post()
  @Roles('ADMIN')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentMembership() membership: OrgMembership,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @Body(new ZodValidationPipe(uploadDocumentFieldsSchema)) fields: UploadDocumentFields,
  ) {
    if (!file) throw new BadRequestException('Missing file field "file"');
    return this.documents.upload(membership, file, fields);
  }

  @Get()
  list(@CurrentMembership() membership: OrgMembership) {
    return this.documents.list(membership);
  }

  @Get(':documentId')
  get(
    @CurrentMembership() membership: OrgMembership,
    @Param('documentId', uuidParam()) documentId: string,
  ) {
    return this.documents.get(membership, documentId);
  }

  /** 202: accepted, the embeddings are computed in the background. */
  @Post(':documentId/reprocess')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.ACCEPTED)
  reprocess(
    @CurrentMembership() membership: OrgMembership,
    @Param('documentId', uuidParam()) documentId: string,
  ): Promise<void> {
    return this.documents.reprocess(membership.organizationId, documentId);
  }

  @Delete(':documentId')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentMembership() membership: OrgMembership,
    @Param('documentId', uuidParam()) documentId: string,
  ): Promise<void> {
    return this.documents.remove(membership.organizationId, documentId);
  }
}
