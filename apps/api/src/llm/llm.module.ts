import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { AnthropicLlmProvider } from './anthropic.provider';
import { FakeLlmProvider } from './fake-llm.provider';
import { LLM_PROVIDER, type LlmProvider } from './llm-provider';

@Global()
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmProvider => {
        if (config.get('LLM_PROVIDER', { infer: true }) === 'fake') return new FakeLlmProvider();
        return new AnthropicLlmProvider({
          // Presence checked by the env validation when the provider is anthropic.
          apiKey: config.get('ANTHROPIC_API_KEY', { infer: true }) ?? '',
          model: config.get('CLAUDE_MODEL', { infer: true }),
          maxTokens: config.get('CLAUDE_MAX_TOKENS', { infer: true }),
          effort: config.get('CLAUDE_EFFORT', { infer: true }),
        });
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
