import test from "node:test";
import assert from "node:assert/strict";
import { bootstrapCore } from "../packages/core/index";
import { AnalyticsService } from "../packages/core/analytics-service";
import { AiStudioService } from "../packages/core/ai-studio-service";
import { FallbackAiProvider } from "../packages/ai-provider/index";
import path from "node:path";

function testDbPath(name: string): string {
  return path.resolve(process.cwd(), "tests", "tmp", `${name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sqlite`);
}

test("AI Studio answers read-only questions and records a privacy-safe audit entry", async () => {
  const manager = await bootstrapCore({
    minecraftServerDir: path.resolve(process.cwd(), "tests/fixtures/minecraft-server"),
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: testDbPath("ai-studio"),
  });

  try {
    await manager.startServer("minecraft-main");

    const analytics = new AnalyticsService(manager);
    const aiProvider = new FallbackAiProvider();
    const aiStudio = new AiStudioService(manager, analytics, aiProvider, "test-actor");

    const response = await aiStudio.ask({
      question: "Why did Minecraft go offline?",
      providerId: "minecraft",
      window: "24h",
    });

    assert.equal(typeof response.requestId, "string");
    assert.equal(response.providerId, "fallback");
    assert.ok(response.answer.includes("Why did Minecraft go offline?"));
    assert.ok(response.contextSources.includes("operations"));
    assert.ok(response.contextSources.includes("analytics"));

    const audits = await aiStudio.listAuditTrail({ limit: 10 });
    const match = audits.find((entry) => entry.metadata?.requestId === response.requestId);
    assert.ok(match);
    assert.equal(match?.action, "ai.query.requested");
    assert.equal(match?.result, "completed");
    assert.equal(match?.actor, "test-actor");
    assert.equal(typeof match?.metadata?.questionLength, "number");
    assert.equal(typeof match?.metadata?.answerLength, "number");
    assert.ok(match?.metadata && !("question" in match.metadata));
    assert.ok(match?.metadata && !("answer" in match.metadata));
    assert.ok(match?.metadata && !("contextSummary" in match.metadata));
  } finally {
    await manager.shutdown();
  }
});

test("AI Studio rejects invalid questions before touching the AI provider", async () => {
  const manager = await bootstrapCore({
    minecraftServerDir: path.resolve(process.cwd(), "tests/fixtures/minecraft-server"),
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: testDbPath("ai-studio-invalid"),
  });

  try {
    const analytics = new AnalyticsService(manager);
    const aiStudio = new AiStudioService(manager, analytics, new FallbackAiProvider());

    await assert.rejects(async () => aiStudio.ask({ question: "" }), /Invalid question/);
    await assert.rejects(async () => aiStudio.ask({ question: "a".repeat(3000) }), /Invalid question/);

    const audits = await aiStudio.listAuditTrail({ limit: 10 });
    assert.equal(audits.length, 0);
  } finally {
    await manager.shutdown();
  }
});

test("AI Studio never exposes mutation-capable methods on the provider manager it holds", async () => {
  const manager = await bootstrapCore({
    minecraftServerDir: path.resolve(process.cwd(), "tests/fixtures/minecraft-server"),
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
    persistenceDbPath: testDbPath("ai-studio-boundary"),
  });

  try {
    const analytics = new AnalyticsService(manager);
    const aiStudio = new AiStudioService(manager, analytics, new FallbackAiProvider());

    // AiStudioService's public surface must remain read-only: no start/stop/restart/delete/cleanup verbs.
    const publicMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(aiStudio)).filter((name) => name !== "constructor");
    assert.ok(publicMethods.includes("ask"));
    assert.ok(publicMethods.includes("listAuditTrail"));
    assert.ok(!publicMethods.some((name) => /start|stop|restart|delete|cleanup/i.test(name)));
  } finally {
    await manager.shutdown();
  }
});
