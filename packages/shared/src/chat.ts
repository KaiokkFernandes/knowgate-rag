import { z } from 'zod';

export const chatRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  /** Continue an existing conversation of the same user; omitted to start a new one. */
  conversationId: z.uuid().optional(),
});

/** A chunk sent to the model, shown to the user so a citation opens the original passage. */
export const chatSourceSchema = z.object({
  index: z.number().int(),
  chunkId: z.uuid(),
  documentId: z.uuid(),
  documentTitle: z.string(),
  reference: z.string().nullable(),
  content: z.string(),
});

/** Where a source is cited in the answer: characters [start, end) of the answer text. */
export const chatCitationSchema = z.object({
  sourceIndex: z.number().int(),
  chunkId: z.uuid(),
  documentId: z.uuid(),
  documentTitle: z.string(),
  reference: z.string().nullable(),
  start: z.number().int(),
  end: z.number().int(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatSource = z.infer<typeof chatSourceSchema>;
export type ChatCitation = z.infer<typeof chatCitationSchema>;

/**
 * Server-Sent Events of POST /orgs/:orgId/chat, in order:
 * `meta` once, then `text` / `citation` while the answer streams, then `done` (or `error`).
 */
export type ChatStreamEvent =
  | { event: 'meta'; data: { conversationId: string; sources: ChatSource[] } }
  | { event: 'text'; data: { text: string } }
  | { event: 'citation'; data: { sourceIndex: number; citedText: string } }
  | {
      event: 'done';
      data: {
        messageId: string;
        answer: string;
        citations: ChatCitation[];
        notFound: boolean;
        stopReason: string | null;
      };
    }
  | { event: 'error'; data: { message: string } };
