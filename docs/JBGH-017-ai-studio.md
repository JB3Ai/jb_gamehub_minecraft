# JBGH-017 - AI Studio Read-Only Intelligence Layer

## Critical Boundary

> AI can observe and explain GameHub. It cannot change GameHub.

AI Studio never calls `startServer`, `stopServer`, `restartServer`, `validateWorld`, or `cleanupHistory`.
It only reads through `InMemoryProviderManager` list/query methods and `AnalyticsService`. There are no
AI-triggered mutation endpoints in this milestone. An AI Action + Approval Layer, with authentication,
permissions, audit, and admin controls, is explicitly future scope.

```
                    ┌─────────────────────┐
                    │      AI STUDIO      │
                    │                     │
                    │ Context Assembly    │
                    │ AI Provider         │
                    │ Structured Response │
                    └──────────┬──────────┘
                               │ READ ONLY
                               ▼
┌────────────────────────────────────────────────────┐
│                  GAMEHUB CORE                       │
│                                                      │
│ Providers │ Servers │ Operations │ Events │ Stats   │
└────────────────────────────────────────────────────┘
                               ▲
                               │
                         Persistence
```

## 1. AI Provider Abstraction

`packages/ai-provider/index.ts` defines a provider-neutral interface:

- `AiProvider { id, model, generate(request) }`
- `GeminiAiProvider` (uses `@google/genai`, lazy-imported)
- `OpenAiAiProvider` (uses `fetch` against the OpenAI chat completions API, no new dependency)
- `FallbackAiProvider` (fully deterministic, offline, used when no provider/key is configured and in tests)
- `createAiProvider(config)` factory selects the implementation from runtime config

Model and provider selection lives entirely outside core business logic (`RuntimeConfig` + `server.ts`
wiring), so adding another provider means adding one class and one factory branch.

## 2. Context Assembly

`packages/core/ai-context.ts` builds a bounded `AiContextPackage` from existing read-only services only:

- registered providers and their status
- servers in scope, with live status
- recent operations (bounded to 15) and events (bounded to 15) within the requested window
- the JBGH-016 analytics summary and world-validation analytics for the same window
- static notes reiterating the read-only boundary

`summarizeContextForPrompt()` renders this into a compact text block capped at 6000 characters before it
is ever sent to an AI provider.

## 3. AI Studio API

All AI Studio endpoints are read-only with respect to GameHub state:

- `GET /api/ai/providers` - active provider/model, which keys are configured (never the keys themselves)
- `POST /api/ai/ask` - `{ question, providerId?, serverId?, window? }` -> structured answer
- `GET /api/ai/audit` - bounded AI query audit trail

`packages/core/ai-studio-service.ts` validates the question (3-2000 chars), assembles context, calls the
configured `AiProvider`, and returns:

- `requestId`
- `question`
- `answer`
- `providerId` / `model`
- `contextSources[]`
- `contextWindow`
- `generatedAt`

The system instruction explicitly tells the model it is read-only and must refuse to claim it performed
any action, directing the user back to the dashboard for anything mutating.

## 4. AI Audit Trail

Every `ask()` call writes one `ai.query.requested` audit record (reusing the existing audit log/table from
JBGH-015) with:

- `requestId`
- `actor`
- `aiProviderId` / `model`
- `contextSources[]`
- `questionLength` / `answerLength` (or `failureReason` on error)
- `timestamp` (audit record timestamp)
- `result` (`completed` | `failed`)

Raw question text, raw context payloads, and raw AI responses are never persisted. Retention follows the
existing audit retention policy (`AUDIT_RETENTION_DAYS`) and is included in history cleanup like any other
audit record.

## 5. Dashboard AI Studio

`AiStudioPanel` in `src/components/OperationalDashboard.tsx` adds a new "AI STUDIO" tab with:

- a persistent read-only banner
- preset natural-language questions (why did a server go offline, last 24h summary, why did validation
  fail, which provider has the most failures, explain this operation failure)
- a free-form question box
- per-answer source/model/timestamp metadata
- a collapsible audit trail view of past AI Studio queries

No dashboard control in this panel can start, stop, restart, or modify anything; it only calls the
read-only `/api/ai/*` endpoints.

## Configuration

- `AI_PROVIDER` = `gemini` | `openai` | `fallback` (default `fallback`, fully offline)
- `AI_MODEL` = optional override; otherwise provider-specific default
- `GEMINI_API_KEY` = reused from the existing Gemini configuration
- `OPENAI_API_KEY` = required only when `AI_PROVIDER=openai`

## Verification

- TypeScript/lint passes
- `tests/ai-studio.test.ts` verifies: valid questions produce bounded, sourced answers; invalid questions
  are rejected before any AI provider call; audit records never contain raw question/answer/context text;
  the service's public surface exposes no start/stop/restart/delete/cleanup methods
- `tests/api-contract.test.ts` extended to cover `/api/ai/providers`, `/api/ai/ask` (including the 400 for
  an invalid question), and `/api/ai/audit`
- existing lifecycle, persistence, analytics, and websocket tests remain green
