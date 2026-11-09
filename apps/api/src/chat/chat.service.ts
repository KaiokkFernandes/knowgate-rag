import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@knowgate/db';
import type { ChatCitation, ChatSource } from '@knowgate/shared';
import type { Env } from '../config/env';
import { PRISMA } from '../database/database.module';
import { type AnswerEvent, LLM_PROVIDER, type LlmProvider } from '../llm/llm-provider';
import type { OrgMembership } from '../organizations/org-access';
import { maskPii } from '../privacy/pii-masker';
import { RetrievalService } from '../retrieval/retrieval.service';

export const NOT_FOUND_ANSWER = 'Não encontrei essa informação nos documentos disponíveis.';
/** Earlier messages sent back as context for follow-up questions (3 question/answer turns). */
const HISTORY_MESSAGES = 6;
/** Candidates retrieved before the relevance threshold is applied. */
const RETRIEVAL_LIMIT = 10;

export interface PreparedQuestion {
  organizationId: string;
  userId: string;
  conversationId: string;
  question: string;
  sources: ChatSource[];
  history: { role: 'user' | 'assistant'; content: string }[];
}

export interface AnswerSummary {
  messageId: string;
  answer: string;
  citations: ChatCitation[];
  notFound: boolean;
  stopReason: string | null;
}

@Injectable()
export class ChatService {
  private readonly minSimilarity: number;
  private readonly maxSources: number;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly retrieval: RetrievalService,
    config: ConfigService<Env, true>,
  ) {
    this.minSimilarity = config.get('CHAT_MIN_SIMILARITY', { infer: true });
    this.maxSources = config.get('CHAT_MAX_SOURCES', { infer: true });
  }

  /**
   * Everything that can fail with a plain HTTP error (unknown conversation, retrieval) runs
   * here, before the response switches to an event stream.
   */
  async prepare(
    membership: OrgMembership,
    rawQuestion: string,
    conversationId?: string,
  ): Promise<PreparedQuestion> {
    const { organizationId, userId } = membership;
    // Masked once, before it is stored, embedded, sent to Claude or logged.
    const question = maskPii(rawQuestion).text;

    let history: PreparedQuestion['history'] = [];
    if (conversationId) {
      // Only the user's own conversations, in this organization (404 otherwise).
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: conversationId, organizationId, userId },
        select: {
          messages: {
            select: { role: true, content: true },
            orderBy: { createdAt: 'desc' },
            take: HISTORY_MESSAGES,
          },
        },
      });
      if (!conversation) throw new NotFoundException('Conversation not found');
      history = conversation.messages.reverse().map((message) => ({
        role: message.role === 'USER' ? 'user' : 'assistant',
        content: message.content,
      }));
    }

    // "No basis, no answer": only chunks similar enough to the question reach the model.
    const results = await this.retrieval.search(membership, question, RETRIEVAL_LIMIT);
    const sources = results
      .filter((result) => result.similarity !== null && result.similarity >= this.minSimilarity)
      .slice(0, this.maxSources)
      .map((result, index) => ({
        index,
        chunkId: result.chunkId,
        documentId: result.documentId,
        documentTitle: result.documentTitle,
        reference: result.reference,
        content: result.content,
      }));

    // Created only after retrieval succeeded, so a failed request leaves no empty conversation.
    conversationId ??= (
      await this.prisma.conversation.create({
        data: { organizationId, userId },
        select: { id: true },
      })
    ).id;

    return { organizationId, userId, conversationId, question, sources, history };
  }

  /** Streams the answer through `onEvent`, then stores both messages and the usage. */
  async answer(
    prepared: PreparedQuestion,
    onEvent: (event: AnswerEvent) => void,
    signal?: AbortSignal,
  ): Promise<AnswerSummary> {
    const { organizationId, userId, conversationId, question, sources } = prepared;
    await this.prisma.message.create({
      data: { conversationId, role: 'USER', content: question },
    });

    if (sources.length === 0) {
      // Nothing relevant: answer without calling (and paying for) the model.
      onEvent({ type: 'text', text: NOT_FOUND_ANSWER });
      const message = await this.saveAssistant(conversationId, NOT_FOUND_ANSWER, []);
      return {
        messageId: message.id,
        answer: NOT_FOUND_ANSWER,
        citations: [],
        notFound: true,
        stopReason: null,
      };
    }

    const result = await this.llm.answer(
      {
        question,
        history: prepared.history,
        sources: sources.map((source) => ({
          id: source.chunkId,
          title: source.reference
            ? `${source.documentTitle} — ${source.reference}`
            : source.documentTitle,
          text: source.content,
        })),
        signal,
      },
      onEvent,
    );

    // Citation offsets in the final answer text, mapped back to chunks and documents.
    let answer = '';
    const citations: ChatCitation[] = [];
    for (const segment of result.segments) {
      const start = answer.length;
      answer += segment.text;
      for (const sourceIndex of segment.sourceIndexes) {
        const source = sources[sourceIndex];
        if (!source) continue;
        citations.push({
          sourceIndex,
          chunkId: source.chunkId,
          documentId: source.documentId,
          documentTitle: source.documentTitle,
          reference: source.reference,
          start,
          end: answer.length,
        });
      }
    }

    // Input tokens include cached ones: they still count against the daily token limit.
    const { usage } = result;
    const tokens = {
      inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      outputTokens: usage.outputTokens,
      costUsd: this.llm.costUsd(usage),
    };
    const message = await this.saveAssistant(conversationId, answer, citations, tokens);
    await this.prisma.usageEvent.create({
      data: { organizationId, userId, kind: 'CHAT', model: this.llm.model, ...tokens },
    });

    return {
      messageId: message.id,
      answer,
      citations,
      notFound: false,
      stopReason: result.stopReason,
    };
  }

  private async saveAssistant(
    conversationId: string,
    content: string,
    citations: ChatCitation[],
    usage?: { inputTokens: number; outputTokens: number; costUsd: number },
  ) {
    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId, role: 'ASSISTANT', content, citations, ...usage },
        select: { id: true },
      }),
      // Bumps updatedAt so the conversation list is ordered by last activity.
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return message;
  }

  /** The user's own conversations in the organization, most recent first. */
  async listConversations(membership: OrgMembership) {
    const conversations = await this.prisma.conversation.findMany({
      where: { organizationId: membership.organizationId, userId: membership.userId },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          where: { role: 'USER' },
          select: { content: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
    return conversations.map(({ messages, ...conversation }) => ({
      ...conversation,
      title: (messages[0]?.content ?? '').slice(0, 80),
    }));
  }

  async getConversation(membership: OrgMembership, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId: membership.organizationId,
        userId: membership.userId,
      },
      select: {
        id: true,
        createdAt: true,
        messages: {
          select: { id: true, role: true, content: true, citations: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}
