// Provider-neutral AI abstraction for JBGH-017.
// AI providers only ever produce text from a bounded, read-only context. They
// never receive credentials or handles capable of mutating GameHub state.

export type AiProviderId = "gemini" | "openai" | "fallback";

export interface AiGenerationRequest {
  systemInstruction: string;
  question: string;
  contextSummary: string;
}

export interface AiGenerationResult {
  text: string;
  providerId: AiProviderId;
  model: string;
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly model: string;
  generate(request: AiGenerationRequest): Promise<AiGenerationResult>;
}

export interface AiProviderConfig {
  provider: AiProviderId;
  model?: string;
  apiKey?: string;
}

const DEFAULT_MODELS: Record<AiProviderId, string> = {
  gemini: "gemini-3.6-flash",
  openai: "gpt-4o-mini",
  fallback: "gamehub-fallback-summarizer-v1",
};

/**
 * Deterministic, offline-safe provider. Used when no AI provider is
 * configured, and as a stable target for automated tests that must not
 * depend on network access or vendor SDKs.
 */
export class FallbackAiProvider implements AiProvider {
  readonly id: AiProviderId = "fallback";
  readonly model: string;

  constructor(model: string = DEFAULT_MODELS.fallback) {
    this.model = model;
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    const text =
      `I can only summarize what GameHub has recorded, I can't take any action.\n\n` +
      `Question: ${request.question}\n\n` +
      `Based on the current operational context:\n${request.contextSummary}`;

    return {
      text,
      providerId: this.id,
      model: this.model,
    };
  }
}

export class GeminiAiProvider implements AiProvider {
  readonly id: AiProviderId = "gemini";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model: string = DEFAULT_MODELS.gemini,
  ) {
    this.model = model;
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    const { GoogleGenAI } = await import("@google/genai");
    const client = new GoogleGenAI({ apiKey: this.apiKey });

    const response = await client.models.generateContent({
      model: this.model,
      contents: request.question,
      config: {
        systemInstruction: `${request.systemInstruction}\n\nOperational context:\n${request.contextSummary}`,
        temperature: 0.2,
      },
    });

    return {
      text: response.text || "No response generated.",
      providerId: this.id,
      model: this.model,
    };
  }
}

export class OpenAiAiProvider implements AiProvider {
  readonly id: AiProviderId = "openai";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model: string = DEFAULT_MODELS.openai,
  ) {
    this.model = model;
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResult> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `${request.systemInstruction}\n\nOperational context:\n${request.contextSummary}`,
          },
          { role: "user", content: request.question },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI request failed with status ${response.status}: ${body}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content;

    return {
      text: text || "No response generated.",
      providerId: this.id,
      model: this.model,
    };
  }
}

export function createAiProvider(config: AiProviderConfig): AiProvider {
  if (config.provider === "gemini") {
    if (!config.apiKey) {
      return new FallbackAiProvider(config.model);
    }
    return new GeminiAiProvider(config.apiKey, config.model || DEFAULT_MODELS.gemini);
  }

  if (config.provider === "openai") {
    if (!config.apiKey) {
      return new FallbackAiProvider(config.model);
    }
    return new OpenAiAiProvider(config.apiKey, config.model || DEFAULT_MODELS.openai);
  }

  return new FallbackAiProvider(config.model);
}
