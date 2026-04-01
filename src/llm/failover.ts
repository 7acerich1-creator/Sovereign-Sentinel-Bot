// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Model Failover
// Auto-retry with next provider on failure/timeout/rate-limit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from "../types";

const DEFAULT_TIMEOUT_MS = 60_000;

export class FailoverLLM implements LLMProvider {
  name = "failover";
  model = "failover";
  private providers: LLMProvider[];
  private timeoutMs: number;
  private lastUsedProvider: string = "";

  constructor(providers: LLMProvider[], timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.providers = providers;
    this.timeoutMs = timeoutMs;
    if (providers.length > 0) {
      this.model = providers[0].model;
    }
  }

  get activeProvider(): string {
    return this.lastUsedProvider;
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const errors: string[] = [];

    for (const provider of this.providers) {
      try {
        console.log(`🔄 Trying LLM provider: ${provider.name} (${provider.model})`);
        const response = await this.withTimeout(
          provider.generate(messages, options),
          this.timeoutMs,
          `${provider.name} timed out after ${this.timeoutMs}ms`
        );

        if (response.finishReason === "error") {
          errors.push(`${provider.name}: ${response.content}`);
          console.warn(`⚠️ ${provider.name} returned error, trying next...`);
          continue;
        }

        this.lastUsedProvider = provider.name;
        this.model = provider.model;
        console.log(`✅ Response from ${provider.name} (${provider.model})`);
        return response;
      } catch (err: any) {
        errors.push(`${provider.name}: ${err.message}`);
        console.warn(`⚠️ ${provider.name} failed: ${err.message}`);
        continue;
      }
    }

    // All providers failed
    return {
      content: `All LLM providers failed:\n${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}`,
      model: "none",
      finishReason: "error",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  switchPrimary(providerName: string): boolean {
    const idx = this.providers.findIndex((p) => p.name === providerName);
    if (idx < 0) return false;
    const [provider] = this.providers.splice(idx, 1);
    this.providers.unshift(provider);
    console.log(`🔀 Primary LLM switched to: ${providerName}`);
    return true;
  }

  listProviders(): string[] {
    return this.providers.map((p) => `${p.name} (${p.model})`);
  }
}
