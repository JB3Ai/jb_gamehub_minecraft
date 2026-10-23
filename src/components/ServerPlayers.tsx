import React, { useEffect, useState, useSyncExternalStore } from "react";
import { getDashboardAccessKey, subscribeAdminConnection } from "../dashboard/adminConnection";
import { getPlayerPresence, PlayerPresenceError } from "../dashboard/apiClient";
import { playerCountText } from "../dashboard/connectionExperience";
import { relativeTime } from "../dashboard/homeModel";
import type { PlayerPresence, ServerInventoryItem, WebSocketConnectionState } from "../dashboard/types";

export function ServerPlayers({ server, connection }: { server: ServerInventoryItem; connection: WebSocketConnectionState }) {
  const accessKey = useSyncExternalStore(subscribeAdminConnection, getDashboardAccessKey, getDashboardAccessKey);
  const [open, setOpen] = useState(false), [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; accessKey: string; value?: PlayerPresence; error?: string; loading?: boolean }>();
  const identity = JSON.stringify([server.providerId, server.id]);
  const permitted = Boolean(accessKey) && server.status === "online" && !server.statusUnconfirmed;
  useEffect(() => {
    if (!open || !permitted) return;
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    let activeRequest: AbortController | undefined;
    const read = async () => {
      setSnapshot({ key: identity, accessKey, loading: true });
      const abort = new AbortController(); activeRequest = abort;
      const timeout = setTimeout(() => abort.abort(), 5000);
      let retry = true;
      try {
        const value = await getPlayerPresence(server.providerId, server.id, abort.signal);
        if (!disposed) setSnapshot({ key: identity, accessKey, value });
      } catch (error) {
        if (error instanceof PlayerPresenceError && [401, 403].includes(error.status)) retry = false;
        if (!disposed) setSnapshot({ key: identity, accessKey, error: error instanceof PlayerPresenceError ? error.message : "Player names are unavailable. Refresh to check again." });
      } finally { clearTimeout(timeout); }
      if (!disposed && retry) timer = setTimeout(read, 5000);
    };
    void read();
    return () => { disposed = true; activeRequest?.abort(); clearTimeout(timer); };
  }, [open, permitted, identity, accessKey, refresh, connection, server.providerId, server.id]);
  const current = snapshot?.key === identity && snapshot.accessKey === accessKey && permitted ? snapshot : undefined;
  const countAvailable = server.status === "online" && Number.isInteger(server.players) && server.players! >= 0;
  return <section className="server-players" aria-label={`Players on ${server.name}`}>
    <p className="home-players">{playerCountText(server, connection === "connected")}</p>
    <small>{server.status === "offline" ? "Server stopped — players cannot connect." : server.status !== "online" ? "Player status unavailable until the server is running." : !countAvailable ? "Player count unavailable. Refresh to check again." : server.players === 0 ? "No players reported by the server." : "Count reported by the server."}</small>
    {server.playersObservedAt && countAvailable ? <small className="player-checked">Last checked <time dateTime={server.playersObservedAt} title={new Date(server.playersObservedAt).toLocaleString()}>{relativeTime(server.playersObservedAt)}</time></small> : null}
    <details className="player-presence" onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>Who is playing</summary>
      {!accessKey ? <p>Player names are visible only to a connected administrator.</p> : server.statusUnconfirmed ? <p>Server status could not be checked. Refresh before checking players.</p> : server.status !== "online" ? <p>Player names are available only while the server is running.</p> : <>
        {connection !== "connected" ? <p>Live updates are interrupted. Player names are checked periodically and may have changed.</p> : null}
        {current?.error ? <p role="status">{current.error}</p> : !current?.value ? <p role="status">Checking player names…</p> : current.value.state === "unsupported" ? <p>This server does not provide player names.</p> : current.value.state === "not-running" ? <p>The server is no longer reporting a running state. Refresh status.</p> : <>
          {current.value.players.length ? <ul aria-label="Reported player names">{current.value.players.map((player, index) => <li key={`${index}:${player.displayName}`}>{player.displayName}</li>)}</ul> : <p>{current.value.namesComplete && (!countAvailable || server.players === 0) ? "No players reported by the server." : "Player names unavailable."}</p>}
          {current.value.namesComplete && countAvailable && current.value.players.length !== server.players ? <p>Player names and count were checked separately. They may differ briefly; refresh to check again.</p> : null}
          {!current.value.namesComplete ? <p>Some player names are unavailable. This list may be incomplete.</p> : null}
          <small>Player list checked <time dateTime={current.value.observedAt} title={new Date(current.value.observedAt).toLocaleString()}>{relativeTime(current.value.observedAt)}</time></small>
        </>}
        <button type="button" className="inline-link" disabled={current?.loading} onClick={() => setRefresh(value => value + 1)}>Refresh players</button>
        <small className="player-policy-note">Presence does not grant access. Family access rules and server allowlists remain in effect.</small>
      </>}
    </details>
  </section>;
}
