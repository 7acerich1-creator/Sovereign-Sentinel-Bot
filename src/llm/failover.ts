// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// GRAVITY CLAW v3.0 — Model Failover
// Auto-retry with next provider on failure/timeout/rate-limit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { LLMProvider, LLMMessage, LLMOptions, LLMResponse } from "../types";

const DEFAULT_TIMEOUT_MS = 60_000;
const PRIMARY_RETRY_DELAY_MS = 3000;

export class FailoverLLM implements LLMProvider {
  name = "failover";
  model = "failover";
  private providers: LLMProvider[];
  private timeoutMs: number;
  private primaryRetries: number;
  private lastUsedProvider: string = "";
  private _primaryOnly: boolean = false;

  /**
   * @param providers - Ordered list of LLM providers (first = primary)
   * @param timeoutMs - Per-call timeout
   * @param primaryRetries - How many times to retry the PRIMARY provider before failing over.
   *   Default 0 = original behavior (try once, then move to next).
   *   Set to 3 for pipeline LLM to lock onto Groq before Gemini can sneak in.
   */
  constructor(providers: LLMProvider[], timeoutMs = DEFAULT_TIMEOUT_MS, primaryRetries = 0) {
    this.providers = providers;
    this.timeoutMs = timeoutMs;
    this.primaryRetries = primaryRetries;
    if (providers.length > 0) {
      this.model = providers[0].model;
    }
  }

  /**
   * SESSION 33: Primary-only mode for dispatch tasks.
   * When enabled, the failover chain ONLY tries the primary provider (Groq).
   * If Groq is down, it fails fast instead of cascading to Anthropic and burning credits.
   * Call setPrimaryOnly(true) before dispatch processing, setPrimaryOnly(false) after.
   */
  setPrimaryOnly(enabled: boolean): void {
    this._primaryOnly = enabled;
  }

  get activeProvider(): string {
    return this.lastUsedProvider;
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const errors: string[] = [];

    // SESSION 33: If primary-only mode is active, only try the first provider.
    // This prevents dispatch tasks from cascading to paid providers (Anthropic)
    // when the free primary (Groq) is rate-limited.
    const providerLimit = this._primaryOnly ? 1 : this.providers.length;

    for (let providerIdx = 0; providerIdx < providerLimit; providerIdx++) {
      const provider = this.providers[providerIdx];
      const isPrimary = providerIdx === 0;
      // Primary gets extra retries with backoff. Secondaries get 1 shot each (original behavior).
      const maxAttempts = isPrimary ? 1 + this.primaryRetries : 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const attemptLabel = maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "";
          console.log(`🔄 Trying LLM provider: ${provider.name} (${provider.model})${attemptLabel}`);
          const response = await this.withTimeout(
            provider.generate(messages, options),
            this.timeoutMs,
            `${provider.name} timed out after ${this.timeoutMs}ms`
          );

          if (response.finishReason === "error") {
            errors.push(`${provider.name}[${attempt}]: ${response.content}`);
            if (attempt < maxAttempts) {
              const delay = PRIMARY_RETRY_DELAY_MS * attempt;
              console.warn(`⚠️ ${provider.name} returned error, retrying in ${delay / 1000}s (${attempt}/${maxAttempts})...`);
              await new Promise(r => setTimeout(r, delay));
              continue; // Retry same provider
            }
            console.warn(`⚠️ ${provider.name} exhausted ${maxAttempts} attempts, trying next provider...`);
            break; // Move to next provider
          }

          this.lastUsedProvider = provider.name;
          this.model = provider.model;
          console.log(`✅ Response from ${provider.name} (${provider.model})`);
          return response;
        } catch (err: any) {
          errors.push(`${provider.name}[${attempt}]: ${err.message}`);
          if (attempt < maxAttempts) {
            const delay = PRIMARY_RETRY_DELAY_MS * attempt;
            console.warn(`⚠️ ${provider.name} failed: ${err.message} — retrying in ${delay / 1000}s (${attempt}/${maxAttempts})...`);
            await new Promise(r => setTimeout(r, delay));
            continue; // Retry same provider
          }
          console.warn(`⚠️ ${provider.name} failed after ${maxAttempts} attempts: ${err.message}`);
          break; // Move to next provider
        }
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
