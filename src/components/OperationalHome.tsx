import React, { useEffect, useRef, useState } from "react";
import type { DashboardState, ServerInventoryItem } from "../dashboard/types";
import { inventoryKey, lifecycleLabels, recentActivity, relativeTime, serverIdentity, unresolvedOperation, type ServerCommand, type ServerKey } from "../dashboard/homeModel";
import { ServerConnection } from "./ServerConnection";
import { ServerPlayers } from "./ServerPlayers";
import { CommandRecovery } from "./CommandRecovery";

export function CommandConfirmation({ server, command, onCancel, onConfirm }: {
  server: ServerInventoryItem; command: "stop" | "restart"; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    const current = dialog.current;
    return () => {
      current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) {
        if (previous instanceof HTMLButtonElement && previous.disabled) {
          const fallback = previous.closest("article")?.querySelector<HTMLButtonElement>(".home-actions > .inline-link")
            || document.querySelector<HTMLButtonElement>(".dashboard-header .cmd-btn");
          fallback?.focus();
        }
        else previous.focus();
      }
    };
  }, []);
  const label = command === "stop" ? "Stop" : "Restart";
  return <dialog ref={dialog} className="home-confirmation" aria-labelledby="home-confirm-title" aria-describedby="home-confirm-message"
    onCancel={e => { e.preventDefault(); onCancel(); }}>
    <h2 id="home-confirm-title">{label} {server.name}?</h2>
    <p id="home-confirm-message">Players may be disconnected. GameHub will request a normal server shutdown.{command === "restart" ? " The server will then start again." : ""}</p>
    <div className="home-actions"><button autoFocus type="button" className="cmd-btn" onClick={onCancel}>Cancel</button>
      <button type="button" className="cmd-btn home-danger" onClick={() => { if (submitted.current) return; submitted.current = true; onConfirm(); }}>{label} Server</button></div>
  </dialog>;
}

export interface OperationalHomeProps {
  state: DashboardState;
  onCommand: (key: ServerKey, command: ServerCommand) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onDetails: (key: ServerKey) => void;
  onActivity: () => void;
  onConnect: () => void;
  onRecheckCommand?: (key: ServerKey) => Promise<void> | undefined;
  onAssociateCommand?: (key: ServerKey, operationId: string, reviewed: boolean) => Promise<void> | undefined;
}

export function OperationalHome({ state, onCommand, onRefresh, onCreate, onDetails, onActivity, onConnect, onRecheckCommand, onAssociateCommand }: OperationalHomeProps) {
  const [confirmation, setConfirmation] = useState<{ key: ServerKey; command: "stop" | "restart" }>();
  const activity = recentActivity(state);
  const confirmServer = confirmation && state.servers.find(s => serverIdentity(inventoryKey(s)) === serverIdentity(confirmation.key));
  const failed = activity.filter(item => item.failed);
  const unknown = state.servers.filter(s => s.statusUnconfirmed || !["online", "offline", "starting", "stopping"].includes(s.status));
  const connectionLabel = state.wsConnection === "connected" ? "GameHub connected" : state.wsConnection === "disconnected" ? "Connection interrupted" : "Reconnecting…";
  const busy = (server: ServerInventoryItem) => Boolean(state.pendingCommands?.[serverIdentity(inventoryKey(server))]) || unresolvedOperation(state.operations, inventoryKey(server));
  return <section className="operational-home" aria-label="Daily operations home">
    <div className="home-heading"><div><p className="eyebrow">YOUR GAME SERVERS</p><h2>{state.servers.length} {state.servers.length === 1 ? "Server" : "Servers"}</h2></div>
      <span role="status" className={`home-connection ${state.wsConnection === "connected" ? "is-good" : ""}`}>{connectionLabel}</span></div>
    {state.wsConnection !== "connected" ? <p className="home-note">Live updates are interrupted. GameHub checks server status periodically; the last known state stays visible.</p> : null}
    {state.commandsAuthorized === false ? <div className="home-attention"><p>Connect as an administrator to manage your servers.</p><button type="button" className="cmd-btn" onClick={onConnect}>Connect administrator</button></div> : null}
    {state.error ? <div className="home-attention" role="alert"><p>GameHub could not refresh all dashboard information. The last known server states are shown.</p><button type="button" className="cmd-btn" onClick={onRefresh}>Retry</button></div> : null}
    {unknown.length ? <div className="home-attention" role="status"><p>{unknown.map(s => s.name).join(", ")} status could not be confirmed.</p><button type="button" className="cmd-btn" onClick={onRefresh}>Check status</button></div> : null}
    {failed.length || Object.keys(state.commandErrors || {}).length ? <div className="home-attention" role="alert"><p>A server command needs attention. Check activity before trying again.</p>
      {Object.entries(state.commandErrors || {}).map(([key, message]) => <p key={key}>{message}</p>)}<button type="button" className="cmd-btn" onClick={onActivity}>View activity</button></div> : null}
    {state.loading && !state.servers.length ? <p role="status">Finding your servers…</p> : !state.servers.length && state.error ? <p>Server inventory is unavailable. Refresh to check again.</p> : !state.servers.length ? <div className="home-empty"><h3>Make room for your next adventure</h3><p>GameHub has no servers yet. Create your first server to get started.</p><button type="button" className="cmd-btn home-primary" onClick={onCreate}>Create Server</button></div> :
      <div className="home-server-grid">{state.servers.map(server => {
        const key = inventoryKey(server), identity = serverIdentity(key), pending = state.pendingCommands?.[identity];
        const waiting = busy(server), bedrock = server.providerId === "minecraft-bedrock";
        const status = lifecycleLabels[server.status] || "Status unavailable";
        const actionable = !waiting && !state.loading && !server.statusUnconfirmed && !state.commandRecoveryBlocked && state.commandsAuthorized !== false;
        return <article className="home-server-card" key={identity} aria-label={server.name} aria-busy={waiting}>
          <header><div><h3>{server.name}</h3><p>{bedrock ? "Bedrock Server" : server.providerId === "minecraft" ? "Java Server" : "Game Server"}</p></div><span className={`home-state ${server.status === "online" ? "is-good" : ""}`} role="status">{status}</span></header>
          {server.statusUnconfirmed ? <p className="home-note">Status check failed. Showing the last confirmed state; refresh before another action.</p> : null}
          <ServerPlayers server={server} connection={state.wsConnection} />
          <ServerConnection server={server} onRefresh={onRefresh} />
          <div className="home-actions">
            <button type="button" className={`cmd-btn ${server.status === "offline" ? "home-primary" : ""}`} disabled={!actionable || !["offline", "online"].includes(server.status)} onClick={() => {
              if (!actionable) return;
              if (server.status === "offline") onCommand(key, "start");
              else if (server.status === "online") setConfirmation({ key, command: "stop" });
            }}>{waiting || ["starting", "stopping"].includes(server.status) ? waiting && ["online", "offline"].includes(server.status) ? "Working…" : status : server.status === "offline" ? "Start Server" : server.status === "online" ? "Stop Server" : "Check status"}</button>
            <button type="button" className="inline-link" onClick={() => onDetails(key)}>Server details</button>
          </div>
          {server.status === "online" ? <details className="home-more"><summary>More actions</summary><button type="button" className="cmd-btn" disabled={!actionable} onClick={() => setConfirmation({ key, command: "restart" })}>Restart Server</button></details> : null}
          {state.commandRecoveries?.[identity] && (state.commandRecoveries[identity].locked || state.commandErrors?.[identity]) ? <CommandRecovery record={state.commandRecoveries[identity]} message={state.commandErrors?.[identity]} authorized={state.commandsAuthorized === true} onRecheck={key => onRecheckCommand?.(key)} onAssociate={(key, reference, reviewed) => onAssociateCommand?.(key, reference, reviewed)} onActivity={onActivity} /> : null}
        </article>;
      })}</div>}
    <section className="home-activity" aria-labelledby="home-activity-title"><div className="home-heading"><h3 id="home-activity-title">Recent activity</h3><button type="button" className="inline-link" onClick={onActivity}>View activity →</button></div>
      {activity.length ? <ul>{activity.map(item => <li key={item.id}><span>{item.message}</span><time dateTime={item.timestamp} title={new Date(item.timestamp).toLocaleString()}>{relativeTime(item.timestamp)}</time></li>)}</ul> : <p>No recent server activity.</p>}</section>
    {state.servers.length ? <button type="button" className="cmd-btn home-primary" onClick={onCreate}>+ Create Server</button> : null}
    {confirmation && confirmServer ? <CommandConfirmation server={confirmServer} command={confirmation.command} onCancel={() => setConfirmation(undefined)} onConfirm={() => {
      // Recheck the live state: it may have changed while the confirmation was open.
      if (confirmServer.status === "online" && !confirmServer.statusUnconfirmed && !state.commandRecoveryBlocked && !busy(confirmServer) && state.commandsAuthorized !== false) onCommand(confirmation.key, confirmation.command);
      setConfirmation(undefined);
    }} /> : null}
  </section>;
}
