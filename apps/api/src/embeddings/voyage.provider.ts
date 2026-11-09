import { z } from 'zod';
import { estimateTokens } from '../documents/ingestion/chunker';
import type { EmbeddingInputType, EmbeddingProvider, EmbeddingResult } from './embedding-provider';

/**
 * List prices in USD per million tokens (https://docs.voyageai.com/docs/pricing, checked
 * 2026-11-09). Accounts get free tokens first; the recorded cost is the list price.
 */
const PRICES: Record<string, number> = {
  'voyage-4-large': 0.12,
};

// Request limits for voyage-4-large (https://docs.voyageai.com/reference/embeddings-api):
// at most 1,000 texts and 120K tokens per request. Tokens are estimated, so with a margin.
const MAX_TEXTS_PER_REQUEST = 128;
const MAX_ESTIMATED_TOKENS_PER_REQUEST = 80_000;

// 429 = rate limit; 5xx = transient server errors (https://docs.voyageai.com/docs/error-codes).
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

const responseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().int() })),
  usage: z.object({ total_tokens: z.number().int() }),
});

export interface VoyageOptions {
  apiKey: string;
  model: string;
  dimension: number;
  baseUrl?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  /** Injected in unit tests to simulate the API and skip real waiting. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class VoyageApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'VoyageApiError';
  }
}

/** Voyage REST API through fetch: one endpoint, so no SDK dependency is needed. */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimension: number;
  readonly pricePerMillionTokens: number;
  private readonly options: Required<Omit<VoyageOptions, 'fetch' | 'sleep'>>;
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: VoyageOptions) {
    const price = PRICES[options.model];
    if (price === undefined) {
      throw new Error(`No price configured for Voyage model "${options.model}"`);
    }
    this.model = options.model;
    this.dimension = options.dimension;
    this.pricePerMillionTokens = price;
    this.options = {
      baseUrl: 'https://api.voyageai.com/v1',
      maxAttempts: 5,
      baseDelayMs: 500,
      timeoutMs: 30_000,
      ...options,
    };
    this.fetch = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<EmbeddingResult> {
    const vectors: number[][] = [];
    let totalTokens = 0;
    for (const batch of batches(texts)) {
      const result = await this.request(batch, inputType);
      vectors.push(...result.vectors);
      totalTokens += result.totalTokens;
    }
    return { vectors, totalTokens };
  }

  private async request(input: string[], inputType: EmbeddingInputType): Promise<EmbeddingResult> {
    const body = JSON.stringify({
      input,
      model: this.model,
      input_type: inputType,
      output_dimension: this.dimension,
      // Fail instead of silently embedding a cut text (chunks are far below the limit).
      truncation: false,
    });

    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetch(`${this.options.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
      } catch (error) {
        // Network error or timeout: transient.
        if (attempt >= this.options.maxAttempts) {
          throw new VoyageApiError(`Voyage request failed: ${(error as Error).name}`);
        }
        await this.sleep(this.backoff(attempt));
        continue;
      }

      if (response.ok) return this.parse(await response.json(), input.length);

      if (!RETRYABLE_STATUS.has(response.status) || attempt >= this.options.maxAttempts) {
        // The response body may echo the input; only the status is reported.
        throw new VoyageApiError(`Voyage API responded ${response.status}`, response.status);
      }
      await this.sleep(retryAfterMs(response) ?? this.backoff(attempt));
    }
  }

  /** Exponential backoff with full jitter: spreads retries of concurrent clients. */
  private backoff(attempt: number): number {
    return Math.random() * this.options.baseDelayMs * 2 ** (attempt - 1);
  }

  private parse(json: unknown, expected: number): EmbeddingResult {
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw new VoyageApiError('Unexpected Voyage response shape');
    const { data, usage } = parsed.data;
    const vectors = [...data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    if (vectors.length !== expected || vectors.some((v) => v.length !== this.dimension)) {
      throw new VoyageApiError('Voyage returned an unexpected number or size of vectors');
    }
    return { vectors, totalTokens: usage.total_tokens };
  }
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) * 1000 : undefined;
}

/** Splits texts so each request stays under the API limits. */
function* batches(texts: string[]): Generator<string[]> {
  let batch: string[] = [];
  let tokens = 0;
  for (const text of texts) {
    const textTokens = estimateTokens(text);
    if (
      batch.length > 0 &&
      (batch.length >= MAX_TEXTS_PER_REQUEST ||
        tokens + textTokens > MAX_ESTIMATED_TOKENS_PER_REQUEST)
    ) {
      yield batch;
      batch = [];
      tokens = 0;
    }
    batch.push(text);
    tokens += textTokens;
  }
  if (batch.length > 0) yield batch;
}
