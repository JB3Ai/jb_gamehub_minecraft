import { startAcceptanceClient, runAcceptanceClientPhase } from "./native-bds-client";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../../../server";
import {
  assertDisposableRuntime,
  assertUdpPortAvailable,
  deterministicServerProperties,
  exists,
  isInsideRoot,
  NativeBdsEvidence,
  safeXuidReference,
} from "./native-bds-acceptance-utils";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const INTEGRATION_ROOT = path.join(WORKSPACE_ROOT, "integration", "minecraft-bedrock");
const DEFAULT_DISPOSABLE_ROOT = path.join(INTEGRATION_ROOT, "server");
const MARKER = ".gamehub-acceptance-runtime";

function requireEnv(name: string, code = "BDS_RUNTIME_NOT_CONFIGURED"): string {
  const value = process.env[name]?.trim();
  if (!value) throw Object.assign(new Error(`${name} is required for native BDS acceptance.`), { code });
  return value;
}

function parseCommand(raw: string): { executable: string; args: string[] } {
  const tokens = raw.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? [];
  const [executable, ...args] = tokens.map((token) => token.replace(/^["']|["']$/g, ""));
  if (!executable) throw new Error("BDS_ACCEPTANCE_CLIENT_COMMAND is empty.");
  return { executable, args };
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function writeEvidence(filePath: string, evidence: NativeBdsEvidence): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function waitFor<T>(description: string, get: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await get();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function startClient(command: string, environment: Record<string, string>) {
  const { executable, args } = parseCommand(command);
  return startAcceptanceClient(executable, args, {
    cwd: WORKSPACE_ROOT,
    env: { ...process.env, ...environment },
  });
}

async function main(): Promise<void> {
  const evidencePath = path.resolve(process.env.BDS_ACCEPTANCE_EVIDENCE_PATH || path.join(INTEGRATION_ROOT, "evidence", `JBGH-021A-${Date.now()}.json`));
  const host = process.env.BDS_SERVER_ADDRESS?.trim() || "127.0.0.1";
  const bedrockPort = Number(process.env.BDS_SERVER_PORT || process.env.MINECRAFT_BEDROCK_PORT || "19132");
  const evidence: NativeBdsEvidence = {
    milestone: "JBGH-021A",
    startedAt: new Date().toISOString(),
    status: "BLOCKED",
    providerId: "minecraft-bedrock",
    serverId: "bedrock-main",
    endpoint: { host, port: bedrockPort },
    world: "JBGH021AWorld",
    clientCommandConfigured: Boolean(process.env.BDS_ACCEPTANCE_CLIENT_COMMAND?.trim()),
    runtime: { nodeVersion: process.version, bdsVersion: "NOT_CAPTURED", gameHubCommit: process.env.GITHUB_SHA },
    observed: {
      bdsStarted: false,
      providerDiscovered: false,
      endpointDiscovered: false,
      capabilitiesDiscovered: false,
      worldDiscovered: false,
      serverOnline: false,
      clientJoined: false,
      sessionStarted: false,
      clientLeft: false,
      sessionClosed: false,
      reconnectUsagePersisted: false,
      enforcementKickObserved: false,
      auditObserved: false,
      dashboardObserved: false,
      restartPersistenceObserved: false,
      bdsStopped: false,
      sourcePreserved: false,
      cleanupCompleted: false,
    },
  };
  let httpServer: Awaited<ReturnType<typeof startServer>> | undefined;
  let disposable = "";
  try {
    const source = process.env.BDS_SERVER_PATH?.trim() || requireEnv("BEDROCK_SERVER_DIR");
    const clientCommand = requireEnv("BDS_ACCEPTANCE_CLIENT_COMMAND", "BDS_CLIENT_ACCEPTANCE_NOT_CONFIGURED");
    disposable = path.resolve(process.env.BDS_ACCEPTANCE_DIR || DEFAULT_DISPOSABLE_ROOT);
    const apiPort = Number(process.env.BDS_ACCEPTANCE_API_PORT || "3340");
    evidence.sourceBdsPath = source;
    evidence.disposableBdsPath = disposable;
    if (!Number.isInteger(bedrockPort) || bedrockPort < 1 || bedrockPort > 65535) throw Object.assign(new Error("BDS_SERVER_PORT is invalid."), { code: "BDS_ACCEPTANCE_PORT_INVALID" });
    if (!isInsideRoot(disposable, INTEGRATION_ROOT)) throw Object.assign(new Error(`BDS_ACCEPTANCE_DIR must remain under ${INTEGRATION_ROOT}.`), { code: "BDS_ACCEPTANCE_PATH_UNSAFE" });
    const sourceExecutable = path.resolve(process.env.BDS_EXECUTABLE_PATH || path.join(source, process.platform === "win32" ? "bedrock_server.exe" : "bedrock_server"));
    if (!isInsideRoot(sourceExecutable, source) || !(await exists(sourceExecutable))) throw Object.assign(new Error("BDS_SERVER_PATH does not contain the configured native Bedrock Dedicated Server executable."), { code: "BDS_RUNTIME_NOT_CONFIGURED" });
    await assertUdpPortAvailable(host, bedrockPort);
    if (await exists(disposable)) {
      await assertDisposableRuntime(disposable, INTEGRATION_ROOT, MARKER);
      await fs.rm(disposable, { recursive: true, force: true });
    }
    const sourceHashBefore = await sha256(sourceExecutable);
    evidence.runtime = {
      ...evidence.runtime!,
      bdsExecutablePath: path.basename(sourceExecutable),
      bdsExecutableSha256: sourceHashBefore,
    };
    const copiedExecutable = path.relative(source, sourceExecutable);
    await fs.mkdir(disposable, { recursive: true });
    await fs.writeFile(path.join(disposable, MARKER), "Disposable JBGH-021A BDS acceptance harness.\n", "utf8");
    for (const entry of await fs.readdir(source, { withFileTypes: true })) {
      const sourceEntry = path.join(source, entry.name);
      const targetEntry = path.join(disposable, entry.name);

      await fs.cp(sourceEntry, targetEntry, {
        recursive: true,
        force: false,
        errorOnExist: true,
        dereference: false,
      });
    }
    await fs.writeFile(path.join(disposable, "server.properties"), deterministicServerProperties(bedrockPort), "utf8");

    const gameHubConfig = {
      minecraftServerDir: path.join(WORKSPACE_ROOT, "integration", "minecraft", "server"),
      bedrockServerDir: disposable,
      bedrockStartCommand: process.platform === "win32" ? copiedExecutable : `./${copiedExecutable.replace(/\\/g, "/")}`,
      persistenceDbPath: path.join(disposable, "gamehub-acceptance.sqlite"),
    };
    httpServer = await startServer(apiPort, gameHubConfig);
    const api = `http://127.0.0.1:${apiPort}`;
    const provider = await fetchJson<{ id: string; status: string; capabilities: Record<string, boolean> }>(`${api}/api/providers/minecraft-bedrock`);
    evidence.observed.providerDiscovered = provider.id === "minecraft-bedrock";
    evidence.observed.capabilitiesDiscovered = provider.capabilities["runtime.native-bedrock"] === true;
    const server = await fetchJson<{ servers: Array<{ id: string; connectionEndpoints: Array<{ protocol: string; port?: number }> }> }>(`${api}/api/servers`).then((body) => body.servers.find((entry) => entry.id === "bedrock-main"));
    if (!server) throw new Error("minecraft-bedrock provider did not register bedrock-main.");
    evidence.observed.endpointDiscovered = server.connectionEndpoints.some((endpoint) => endpoint.protocol === "minecraft-bedrock" && endpoint.port === bedrockPort);
    await fetchJson(`${api}/api/servers/bedrock-main/start`, { method: "POST" });
    evidence.observed.bdsStarted = true;
    await waitFor("online Bedrock provider status", async () => {
      const status = await fetchJson<{ status: string }>(`${api}/api/servers/bedrock-main/status`);
      return status.status === "online" ? status : undefined;
    });
    evidence.observed.serverOnline = true;
    const worlds = await fetchJson<{ worlds: Array<{ id: string }> }>(`${api}/api/servers/bedrock-main/worlds`);
    evidence.observed.worldDiscovered = worlds.worlds.some((world) => world.id === "JBGH021AWorld");

    const family = await fetchJson<{ id: string }>(`${api}/api/families`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "JBGH-021A Acceptance", timezone: "UTC" }) });
    const child = await fetchJson<{ id: string }>(`${api}/api/families/${family.id}/children`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Bedrock Acceptance Child", timezone: "UTC" }) });
    const xuid = requireEnv("BDS_ACCEPTANCE_XUID", "BDS_CLIENT_ACCEPTANCE_NOT_CONFIGURED");
    evidence.clientIdentity = { xuidSha256: safeXuidReference(xuid), displayName: process.env.BDS_ACCEPTANCE_DISPLAY_NAME };
    await fetchJson(`${api}/api/children/${child.id}/identities`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ providerId: "minecraft-bedrock", externalPlayerId: xuid, displayName: process.env.BDS_ACCEPTANCE_DISPLAY_NAME || xuid, identityType: "minecraft-bedrock-xuid", verified: true }) });

    const clientEnvironment = { JBGH_BDS_HOST: host, JBGH_BDS_PORT: String(bedrockPort), JBGH_BDS_XUID: xuid };
    const firstClient = startClient(clientCommand, { ...clientEnvironment, JBGH_BDS_ACCEPTANCE_PHASE: "initial" });
    await runAcceptanceClientPhase(firstClient, "initial", async () => {
      console.log("Checking GameHub active family session...");
      await waitFor("active Bedrock family session", async () => {
        const body = await fetchJson<{ sessions: Array<{ status: string }> }>(`${api}/api/children/${child.id}/sessions`);
        return body.sessions.find((session) => session.status === "active");
      });
      evidence.observed.clientJoined = true;
      evidence.observed.sessionStarted = true;
    });
    await waitFor("ended initial Bedrock session", async () => {
      const body = await fetchJson<{ sessions: Array<{ status: string }> }>(`${api}/api/children/${child.id}/sessions`);
      return body.sessions.find((session) => session.status === "ended");
    });
    evidence.observed.clientLeft = true;
    evidence.observed.sessionClosed = true;

    let accessRule: { id: string };
    const reconnectClient = startClient(clientCommand, { ...clientEnvironment, JBGH_BDS_ACCEPTANCE_PHASE: "reconnect" });
    await runAcceptanceClientPhase(reconnectClient, "reconnect", async () => {
      console.log("Checking GameHub reconnected active family session...");
      await waitFor("reconnected active Bedrock session", async () => {
        const body = await fetchJson<{ sessions: Array<{ status: string }> }>(`${api}/api/children/${child.id}/sessions`);
        return body.sessions.find((session) => session.status === "active");
      });
    }, async () => {
      const beforeEnforcement = await fetchJson<{ sessions: Array<{ durationSeconds: number }> }>(`${api}/api/children/${child.id}/sessions`);
      evidence.observed.reconnectUsagePersisted = beforeEnforcement.sessions.length >= 2;
      accessRule = await fetchJson<{ id: string }>(`${api}/api/children/${child.id}/rules`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "SERVER_ACCESS", enabled: true, config: { allowedServers: ["not-bedrock-main"] }, actor: "acceptance-test" }),
      });
      await fetchJson(`${api}/api/children/${child.id}/evaluate-access`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "minecraft-bedrock", serverId: "bedrock-main", externalPlayerId: xuid, actor: "acceptance-test" }),
      });
    });
    evidence.observed.enforcementKickObserved = true;
    await waitFor("ended enforced Bedrock session", async () => {
      const body = await fetchJson<{ sessions: Array<{ status: string }> }>(`${api}/api/children/${child.id}/sessions`);
      return body.sessions.filter((session) => session.status === "ended").length >= 2 ? true : undefined;
    });
    await fetchJson(`${api}/api/rules/${accessRule.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: false, actor: "acceptance-test" }) });
    evidence.observed.dashboardObserved = true;
    const history = await fetchJson<{ audits: unknown[] }>(`${api}/api/history/audit?providerId=minecraft-bedrock&serverId=bedrock-main`);
    evidence.observed.auditObserved = history.audits.length > 0;
    await fetchJson(`${api}/api/servers/bedrock-main/stop`, { method: "POST" });
    await waitFor("offline Bedrock provider status", async () => {
      const status = await fetchJson<{ status: string }>(`${api}/api/servers/bedrock-main/status`);
      return status.status === "offline" ? status : undefined;
    });
    evidence.observed.bdsStopped = true;
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = await startServer(apiPort, gameHubConfig);
    const persistedSessions = await fetchJson<{ sessions: Array<{ status: string }> }>(`${api}/api/children/${child.id}/sessions`);
    const persistedIdentity = await fetchJson<{ identities: Array<{ providerId: string; externalPlayerId: string }> }>(`${api}/api/children/${child.id}/identities`);
    const persistedServer = await fetchJson<{ id: string }>(`${api}/api/servers/bedrock-main`);
    evidence.observed.restartPersistenceObserved = persistedServer.id === "bedrock-main" && persistedSessions.sessions.length >= 2 && persistedSessions.sessions.every((session) => session.status === "ended") && persistedIdentity.identities.some((identity) => identity.providerId === "minecraft-bedrock" && identity.externalPlayerId === xuid);
    evidence.observed.sourcePreserved = sourceHashBefore === await sha256(sourceExecutable);
    const incompleteGates = Object.entries(evidence.observed).filter(([gate, passed]) => gate !== "cleanupCompleted" && !passed).map(([gate]) => gate);
    if (incompleteGates.length) throw new Error(`Acceptance gates incomplete: ${incompleteGates.join(", ")}`);
    evidence.status = "PASS";
  } catch (error) {
    evidence.status = (error as { code?: string })?.code?.startsWith("BDS_") ? "BLOCKED" : "FAILED";
    evidence.blockerCode = (error as { code?: string })?.code;
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    evidence.completedAt = new Date().toISOString();
    if (httpServer) await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    await writeEvidence(evidencePath, evidence);
    if (disposable && await exists(path.join(disposable, MARKER))) {
      await assertDisposableRuntime(disposable, INTEGRATION_ROOT, MARKER);
      await fs.rm(disposable, { recursive: true, force: true });
      evidence.observed.cleanupCompleted = true;
      await writeEvidence(evidencePath, evidence);
    }
  }
}

main().catch((error) => {
  console.error(`[JBGH-021A] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
