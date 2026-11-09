import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { type SearchRequest, searchRequestSchema } from '@knowgate/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentMembership, type OrgMembership } from '../organizations/org-access';
import { RetrievalService } from './retrieval.service';

@Controller('orgs/:orgId/search')
export class RetrievalController {
  constructor(private readonly retrieval: RetrievalService) {}

  /**
   * POST, not GET: the question goes in the body, so it never lands in URLs, proxy logs or
   * browser history (it may contain personal data before masking).
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  async search(
    @CurrentMembership() membership: OrgMembership,
    @Body(new ZodValidationPipe(searchRequestSchema)) body: SearchRequest,
  ) {
    return { results: await this.retrieval.search(membership, body.query, body.limit) };
  }
}
