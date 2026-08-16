import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { estimateDeepSeekCostUsd } from './deepseek';

describe('DeepSeek cost estimator', () => {
  const oldHit = process.env.DEEPSEEK_INPUT_CACHE_HIT_PRICE_PER_MILLION;
  const oldMiss = process.env.DEEPSEEK_INPUT_PRICE_PER_MILLION;
  const oldOut = process.env.DEEPSEEK_OUTPUT_PRICE_PER_MILLION;

  beforeEach(() => {
    delete process.env.DEEPSEEK_INPUT_CACHE_HIT_PRICE_PER_MILLION;
    delete process.env.DEEPSEEK_INPUT_PRICE_PER_MILLION;
    delete process.env.DEEPSEEK_OUTPUT_PRICE_PER_MILLION;
  });
  afterEach(() => {
    if (oldHit === undefined) delete process.env.DEEPSEEK_INPUT_CACHE_HIT_PRICE_PER_MILLION; else process.env.DEEPSEEK_INPUT_CACHE_HIT_PRICE_PER_MILLION = oldHit;
    if (oldMiss === undefined) delete process.env.DEEPSEEK_INPUT_PRICE_PER_MILLION; else process.env.DEEPSEEK_INPUT_PRICE_PER_MILLION = oldMiss;
    if (oldOut === undefined) delete process.env.DEEPSEEK_OUTPUT_PRICE_PER_MILLION; else process.env.DEEPSEEK_OUTPUT_PRICE_PER_MILLION = oldOut;
  });

  it('calcula aproximadamente US$ 0,000812 para 1845 tokens de entrada e 1985 de saída', () => {
    const cost = estimateDeepSeekCostUsd({ prompt_tokens: 1845, completion_tokens: 1985 });
    expect(cost).toBeCloseTo(0.0008126, 7);
  });

  it('divide corretamente por 1 milhão de tokens', () => {
    const cost = estimateDeepSeekCostUsd({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.42, 8);
  });

  it('respeita preços explícitos configurados por ambiente', () => {
    process.env.DEEPSEEK_INPUT_PRICE_PER_MILLION = '1';
    process.env.DEEPSEEK_OUTPUT_PRICE_PER_MILLION = '2';
    const cost = estimateDeepSeekCostUsd({ prompt_tokens: 1000, completion_tokens: 2000 });
    expect(cost).toBeCloseTo(0.005, 10);
  });
});
