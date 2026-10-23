import express from "express";
import type { InMemoryProviderManager } from "../provider-manager";
import type { ProvisioningApiOptions } from "./provisioning-api";

/** A read-only host-administrator view, without account IDs or Family identity links. */
export function playerPresenceRouter(manager: () => Pick<InMemoryProviderManager, "getServer" | "getProvider">, options: () => Pick<ProvisioningApiOptions, "authorize">): express.Router {
  const router = express.Router();
  router.get("/providers/:providerId/servers/:serverId/players", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const principal = await options().authorize(req);
      if (!principal?.admin) { res.status(principal ? 403 : 401).json({ error: { code: principal ? "FORBIDDEN" : "UNAUTHENTICATED" } }); return; }
    } catch { res.status(503).json({ error: { code: "AUTHORIZATION_UNAVAILABLE" } }); return; }
    const { providerId, serverId } = req.params;
    const result = (state: string, players: Array<{ displayName: string }> = [], namesComplete = false) => ({ providerId, serverId, state, observedAt: new Date().toISOString(), players, namesComplete });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const observe = async () => {
        if (!await manager().getServer(serverId, providerId)) return undefined;
        const provider = manager().getProvider(providerId);
        // Call the provider directly: manager status observation persists events/snapshots.
        if ((await provider.getServerStatus(serverId)).status !== "online") return result("not-running");
        if (!provider.getCapabilities()["player.list"] || !provider.getOnlinePlayers) return result("unsupported");
        const online = await provider.getOnlinePlayers(serverId);
        if (!Array.isArray(online)) throw new Error("Invalid player data");
        const names = online.slice(0, 256).flatMap(player => {
          if (player.providerId !== providerId || player.serverId !== serverId || typeof player.displayName !== "string") return [];
          const displayName = player.displayName.trim();
          if (!displayName || displayName.length > 64 || /[\p{C}<>\\/:=@]/u.test(displayName)) return [];
          // Providers can fall back to raw XUID/UUID as their display name; never project that.
          if (/^\d{10,}$/.test(displayName) || /^[a-f\d]{8}-?[a-f\d]{4}-?[a-f\d]{4}-?[a-f\d]{4}-?[a-f\d]{12}$/i.test(displayName)) return [];
          return [{ displayName }];
        });
        // Do not return an old roster if the server stopped while the provider query ran.
        if ((await provider.getServerStatus(serverId)).status !== "online") return result("not-running");
        return result("available", names, names.length === online.length);
      };
      const value = await Promise.race([observe(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Presence timeout")), 2500); })]);
      if (!value) { res.status(404).json({ error: { code: "NOT_FOUND" } }); return; }
      res.json(value);
    } catch { res.status(503).json({ error: { code: "PLAYER_PRESENCE_UNAVAILABLE" } }); }
    finally { clearTimeout(timer); }
  });
  return router;
}
