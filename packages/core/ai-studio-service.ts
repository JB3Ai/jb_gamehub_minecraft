import { AnalyticsService } from "./analytics-service";
import { assembleAiContext, summarizeContextForPrompt, AiContextOptions } from "./ai-context";
import { AiProvider } from "../ai-provider/index";
import { AuditRecord, InMemoryProviderManager } from "../provider-manager/index";

const MAX_QUESTION_LENGTH = 2000;
const MIN_QUESTION_LENGTH = 3;

const SYSTEM_INSTRUCTION = `You are the JB³ GameHub AI Studio assistant.
You can only observe and explain GameHub operational data: providers, servers, operations, events, analytics, and world validation results.
You are strictly read-only. You must never claim to start, stop, restart, delete, install, or modify any server, world, plugin, or configuration.
If the user asks you to perform an action, explain that AI Studio is read-only and that the action must be performed by a human operator through the dashboard.
Answer using only the operational context provided. If the context does not contain the answer, say so plainly instead of guessing.`;

export interface AiAskRequest extends AiContextOptions {
  question: string;
  actor?: string;
}

export interface AiAskResponse {
  requestId: string;
  question: string;
  answer: string;
  providerId: string;
  model: string;
  contextSources: string[];
  contextWindow: { from: string; to: string };
  generatedAt: string;
}

function createRequestId(): string {
  return `aireq_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function validateQuestion(question: unknown): string {
  if (typeof question !== "string") {
    throw new Error("Invalid question: must be a non-empty string");
  }
  const trimmed = question.trim();
  if (trimmed.length < MIN_QUESTION_LENGTH) {
    throw new Error(`Invalid question: must be at least ${MIN_QUESTION_LENGTH} characters`);
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw new Error(`Invalid question: must be at most ${MAX_QUESTION_LENGTH} characters`);
  }
  return trimmed;
}

export class AiStudioService {
  constructor(
    private readonly manager: InMemoryProviderManager,
    private readonly analytics: AnalyticsService,
    private readonly aiProvider: AiProvider,
    private readonly defaultActor: string = "dashboard-user",
  ) {}

  async ask(request: AiAskRequest): Promise<AiAskResponse> {
    const question = validateQuestion(request.question);
    const requestId = createRequestId();
    const actor = request.actor?.trim() || this.defaultActor;

    const context = await assembleAiContext(this.manager, this.analytics, {
      providerId: request.providerId,
      serverId: request.serverId,
      window: request.window,
    });
    const contextSummary = summarizeContextForPrompt(context);

    try {
      const result = await this.aiProvider.generate({
        systemInstruction: SYSTEM_INSTRUCTION,
        question,
        contextSummary,
      });

      await this.writeAudit({
        requestId,
        actor,
        providerId: request.providerId,
        serverId: request.serverId,
        aiProviderId: result.providerId,
        model: result.model,
        contextSources: context.sources,
        questionLength: question.length,
        answerLength: result.text.length,
        result: "completed",
      });

      return {
        requestId,
        question,
        answer: result.text,
        providerId: result.providerId,
        model: result.model,
        contextSources: context.sources,
        contextWindow: context.window,
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      await this.writeAudit({
        requestId,
        actor,
        providerId: request.providerId,
        serverId: request.serverId,
        aiProviderId: this.aiProvider.id,
        model: this.aiProvider.model,
        contextSources: context.sources,
        questionLength: question.length,
        answerLength: 0,
        result: "failed",
        failureReason: err instanceof Error ? err.message : "Unknown AI provider error",
      });
      throw err;
    }
  }

  async listAuditTrail(query: { limit?: number } = {}): Promise<AuditRecord[]> {
    return this.manager.listAudits({
      action: "ai.query.requested",
      limit: query.limit,
    });
  }

  private async writeAudit(input: {
    requestId: string;
    actor: string;
    providerId?: string;
    serverId?: string;
    aiProviderId: string;
    model: string;
    contextSources: string[];
    questionLength: number;
    answerLength: number;
    result: "completed" | "failed";
    failureReason?: string;
  }): Promise<void> {
    // Only lengths and identifiers are persisted; raw prompt/context/answer text is never stored.
    await this.manager.writeAudit({
      actor: input.actor,
      action: "ai.query.requested",
      providerId: input.providerId,
      serverId: input.serverId,
      result: input.result,
      metadata: {
        requestId: input.requestId,
        aiProviderId: input.aiProviderId,
        model: input.model,
        contextSources: input.contextSources,
        questionLength: input.questionLength,
        answerLength: input.answerLength,
        ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      },
    });
  }
}
