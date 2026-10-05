import type { GameProvider, ProviderPlayerLifecycleEvent, ServerSummary } from "./index";
import type { RuntimeAttachmentRecord, RuntimeAttachmentPolicy } from "../core/runtime-attachment";

export type AttachedRuntimeFactory = (record: RuntimeAttachmentRecord, policy: RuntimeAttachmentPolicy) => Promise<GameProvider>;
/** One provider registry identity, independently configured runtime instances. */
export function scopeRuntimeProvider(base: GameProvider, factory: AttachedRuntimeFactory): GameProvider {
  const children = new Map<string, { runtime: GameProvider; record: RuntimeAttachmentRecord; verify: () => Promise<void> }>();
  const listeners = new Set<(event: ProviderPlayerLifecycleEvent) => void>();
  const subscriptions = new Map<string, () => void>();
  const forward = (event: ProviderPlayerLifecycleEvent) => { for (const listener of listeners) listener(event); };
  const subscribe = () => {
    if (!subscriptions.has("base") && base.subscribePlayerEvents) subscriptions.set("base", base.subscribePlayerEvents(forward));
    for (const [id, child] of children) if (!subscriptions.has(id) && child.runtime.subscribePlayerEvents) subscriptions.set(id, child.runtime.subscribePlayerEvents(forward));
  };
  const scoped = new Set(["getServerConnectionEndpoints", "getServerStatus", "startServer", "stopServer", "restartServer", "getWorlds", "validateWorld", "resolvePlayerIdentity", "getOnlinePlayers", "disconnectPlayer", "enforcePlayerAccess"]);
  const queues = new Map<string, Promise<unknown>>();
  const activations = new Map<string, Promise<void>>();
  return new Proxy(base, {
    get(target, property) {
      if (property === "activateAttachment") return async (record: RuntimeAttachmentRecord, policy: RuntimeAttachmentPolicy, verify: () => Promise<void>) => {
        const id = record.descriptor.serverId;
        if ((await base.getServers()).some((server) => server.id === id)) throw new Error("Attachment identity conflicts with configured server.");
        const pending = activations.get(id); if (pending) await pending;
        const current = children.get(id);
        if (current) { if (current.record.digest !== record.digest) throw new Error("Incompatible active runtime attachment."); return; }
        const activation = (async () => {
          const runtime = await factory(record, policy); await runtime.register();
          children.set(id, { runtime, record, verify }); if (listeners.size) subscribe();
        })();
        activations.set(id, activation);
        try { await activation; } finally { activations.delete(id); }
      };
      if (property === "getServers") return async (): Promise<ServerSummary[]> => [
        ...await base.getServers(), ...[...children.values()].map(({ record }) => ({ id: record.descriptor.serverId, providerId: record.descriptor.providerId, name: record.descriptor.serverId, ownership: "ADOPTED" as const, attachmentId: record.effectId })),
      ];
      if (property === "getCapabilities") return () => {
        const capabilities = { ...base.getCapabilities() };
        for (const { runtime } of children.values()) for (const [key, value] of Object.entries(runtime.getCapabilities())) if (value && !key.startsWith("server.provision")) capabilities[key] = true;
        return capabilities;
      };
      if (property === "subscribePlayerEvents") return (listener: (event: ProviderPlayerLifecycleEvent) => void) => {
        listeners.add(listener); subscribe();
        return () => { listeners.delete(listener); if (!listeners.size) { for (const unsubscribe of subscriptions.values()) unsubscribe(); subscriptions.clear(); } };
      };
      if (typeof property === "string" && scoped.has(property)) return async (...args: unknown[]) => {
        const id = property === "enforcePlayerAccess" ? (args[0] as { serverId: string }).serverId : String(args[0]);
        const child = children.get(id); const runtime = child?.runtime ?? target;
        const invoke = async () => {
          if (child && ["startServer", "restartServer"].includes(property)) await child.verify();
          if (property === "validateWorld" && (typeof args[1] !== "string" || args[1].includes("..") || /[\\/]/.test(args[1]))) throw new Error("Invalid world identity.");
          if (child && property === "getServerConnectionEndpoints") return child.record.descriptor.endpoints.map((endpoint) => endpoint.transport === "virtual" ? { ...endpoint, display: endpoint.id } : { id: endpoint.id, protocol: endpoint.protocol, transport: endpoint.transport, host: endpoint.bindAddress, port: endpoint.port.mode === "fixed" ? endpoint.port.value : undefined, display: `${endpoint.bindAddress}:${endpoint.port.mode === "fixed" ? endpoint.port.value : "unknown"}` });
          const method = Reflect.get(runtime, property);
          if (typeof method !== "function") throw new Error("Runtime capability unavailable.");
          if (child && property === "restartServer") { await runtime.stopServer(id); await waitForRuntimeStopped(runtime, id); return runtime.startServer(id); }
          return method.apply(runtime, args);
        };
        if (!["startServer", "stopServer", "restartServer"].includes(property)) return invoke();
        const pending = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(invoke); queues.set(id, pending);
        try { return await pending; } finally { if (queues.get(id) === pending) queues.delete(id); }
      };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
export async function waitForRuntimeStopped(runtime: GameProvider, serverId: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((await runtime.getServerStatus(serverId)).status !== "offline") {
    if (Date.now() >= deadline) throw new Error("Runtime did not stop before deadline.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
