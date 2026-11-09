import { Body, Controller, Get, Logger, Param, Post, Res } from '@nestjs/common';
import { type ChatRequest, chatRequestSchema, type ChatStreamEvent } from '@knowgate/shared';
import type { Response } from 'express';
import { uuidParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentMembership, type OrgMembership } from '../organizations/org-access';
import { ChatService } from './chat.service';

@Controller('orgs/:orgId')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly chat: ChatService) {}

  /**
   * Answers with Server-Sent Events over a POST (the question stays out of URLs and logs; the
   * browser reads the stream with fetch). Validation, the conversation lookup and retrieval
   * happen first, so those errors are ordinary HTTP responses; once streaming starts, a
   * failure becomes an `error` event.
   */
  @Post('chat')
  async ask(
    @CurrentMembership() membership: OrgMembership,
    @Body(new ZodValidationPipe(chatRequestSchema)) body: ChatRequest,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.chat.prepare(membership, body.question, body.conversationId);

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disables response buffering in nginx-style proxies, so tokens arrive as generated.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const send = ({ event, data }: ChatStreamEvent) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // The user closed the tab: stop generating (and paying for) tokens nobody will read.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });

    send({
      event: 'meta',
      data: { conversationId: prepared.conversationId, sources: prepared.sources },
    });
    try {
      const summary = await this.chat.answer(
        prepared,
        (event) =>
          send(
            event.type === 'text'
              ? { event: 'text', data: { text: event.text } }
              : {
                  event: 'citation',
                  data: { sourceIndex: event.sourceIndex, citedText: event.citedText },
                },
          ),
        abort.signal,
      );
      send({ event: 'done', data: summary });
    } catch (error) {
      if (!abort.signal.aborted) {
        // Error type/message only: never the question or the documents.
        this.logger.error(`Chat answer failed: ${(error as Error).message}`);
        send({
          event: 'error',
          data: { message: 'Não foi possível gerar a resposta. Tente novamente.' },
        });
      }
    } finally {
      res.end();
    }
  }

  @Get('conversations')
  list(@CurrentMembership() membership: OrgMembership) {
    return this.chat.listConversations(membership);
  }

  @Get('conversations/:conversationId')
  get(
    @CurrentMembership() membership: OrgMembership,
    @Param('conversationId', uuidParam()) conversationId: string,
  ) {
    return this.chat.getConversation(membership, conversationId);
  }
}
