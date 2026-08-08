import React from "react";
import { DashboardState, OperationRecord, ServerInventoryItem, WorldRuntime } from "../dashboard/types";

const PANEL_ORDER = ["servers", "status", "operations", "worlds", "events"] as const;

type PanelId = (typeof PANEL_ORDER)[number];

const statusLabelMap: Record<string, string> = {
  online: "ONLINE",
  offline: "OFFLINE",
  starting: "STARTING",
  stopping: "STOPPING",
  unknown: "UNKNOWN",
};

function toStatusLabel(status: string): string {
  return statusLabelMap[status] || "UNKNOWN";
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return "-";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Date(timestamp).toLocaleString();
}

function summarizeEvent(event: DashboardState["events"][number]): string {
  if (event.type === "operation.failed") {
    const payload = event.payload as { error?: { message?: string } } | undefined;
    return payload?.error?.message || "Operation failed";
  }

  if (event.type === "world.validation.completed") {
    const payload = event.payload as { valid?: boolean; missingPacks?: unknown[]; invalidPacks?: unknown[]; errors?: unknown[] } | undefined;
    const valid = payload?.valid === true;
    const issues = (payload?.missingPacks?.length || 0) + (payload?.invalidPacks?.length || 0) + (payload?.errors?.length || 0);
    return valid ? "Validation passed" : `Validation issues: ${issues}`;
  }

  if (event.type === "server.status.changed") {
    const payloadStatus =
      event.payload && typeof event.payload === "object" ? (event.payload as { status?: string }).status : undefined;
    return `Status changed to ${String(event.status || payloadStatus || "unknown").toUpperCase()}`;
  }

  return event.type;
}

function operationStateLabel(status: OperationRecord["status"]): string {
  if (status === "queued") {
    return "QUEUED";
  }
  if (status === "running") {
    return "RUNNING";
  }
  if (status === "completed") {
    return "COMPLETED";
  }
  if (status === "failed") {
    return "FAILED";
  }
  return "CANCELLED";
}

function wsStateLabel(state: DashboardState["wsConnection"]): string {
  if (state === "connected") {
    return "CONNECTED";
  }
  if (state === "reconnecting") {
    return "RECONNECTING";
  }
  return "DISCONNECTED";
}

function statusClass(state: string): string {
  if (state === "online" || state === "connected" || state === "completed") {
    return "is-good";
  }
  if (state === "starting" || state === "stopping" || state === "running" || state === "queued" || state === "reconnecting") {
    return "is-warn";
  }
  if (state === "failed" || state === "error" || state === "disconnected") {
    return "is-bad";
  }
  return "is-neutral";
}

export function SectionNavigation({ activePanel, onSelect }: { activePanel: PanelId; onSelect: (panel: PanelId) => void }) {
  return (
    <nav className="panel-nav" aria-label="Dashboard sections">
      <button className="mobile-nav-toggle" aria-label="Toggle sections" type="button">
        Sections
      </button>
      {PANEL_ORDER.map((panel) => (
        <button
          key={panel}
          type="button"
          className={`nav-pill ${activePanel === panel ? "is-active" : ""}`}
          onClick={() => onSelect(panel)}
        >
          {panel.toUpperCase()}
        </button>
      ))}
    </nav>
  );
}

export function ServersPanel({
  servers,
  selectedServerId,
  onSelectServer,
}: {
  servers: ServerInventoryItem[];
  selectedServerId?: string;
  onSelectServer: (serverId: string) => void;
}) {
  if (servers.length === 0) {
    return <div className="empty-state">No providers or servers discovered.</div>;
  }

  return (
    <div className="table-wrap">
      <table className="ops-table" aria-label="Discovered servers">
        <thead>
          <tr>
            <th>Provider</th>
            <th>Server</th>
            <th>Type</th>
            <th>Java Endpoint</th>
            <th>Bedrock Endpoint</th>
            <th>State</th>
            <th>Availability</th>
            <th>Last Update</th>
          </tr>
        </thead>
        <tbody>
          {servers.map((server) => {
            const selected = server.id === selectedServerId;
            return (
              <tr key={server.id} className={selected ? "is-selected" : ""}>
                <td>{server.providerId}</td>
                <td>
                  <button className="inline-link" type="button" onClick={() => onSelectServer(server.id)}>
                    {server.name}
                  </button>
                </td>
                <td>{server.serverType}</td>
                <td>{server.endpoints.java}</td>
                <td>{server.endpoints.bedrock || "N/A"}</td>
                <td>
                  <span className={`chip ${statusClass(server.status)}`}>{toStatusLabel(server.status)}</span>
                </td>
                <td>{server.availability ? "Available" : "Unavailable"}</td>
                <td>{formatTimestamp(server.lastStatusUpdate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StatusPanel({
  server,
  worldCount,
  wsState,
}: {
  server?: ServerInventoryItem;
  worldCount: number;
  wsState: DashboardState["wsConnection"];
}) {
  if (!server) {
    return <div className="empty-state">Select a server to view status.</div>;
  }

  return (
    <div className="status-grid" aria-label="Server status panel">
      <div className="status-main">
        <div className="status-title">Current Lifecycle State</div>
        <div className={`status-value ${statusClass(server.status)}`}>{toStatusLabel(server.status)}</div>
      </div>
      <div className="status-meta">
        <div>
          <strong>Provider:</strong> {server.providerId}
        </div>
        <div>
          <strong>Server:</strong> {server.name}
        </div>
        <div>
          <strong>World Count:</strong> {worldCount}
        </div>
        <div>
          <strong>Last Update:</strong> {formatTimestamp(server.lastStatusUpdate)}
        </div>
        <div>
          <strong>Java:</strong> {server.endpoints.java}
        </div>
        <div>
          <strong>Bedrock:</strong> {server.endpoints.bedrock || "N/A"}
        </div>
        <div>
          <strong>Event Stream:</strong> <span className={`chip ${statusClass(wsState)}`}>{wsStateLabel(wsState)}</span>
        </div>
      </div>
    </div>
  );
}

export function OperationsPanel({
  operations,
  selectedServerId,
  onCommand,
}: {
  operations: OperationRecord[];
  selectedServerId?: string;
  onCommand: (command: "start" | "stop" | "restart") => void;
}) {
  return (
    <>
      <div className="command-row">
        <button type="button" disabled={!selectedServerId} className="cmd-btn" onClick={() => onCommand("start")}>START</button>
        <button type="button" disabled={!selectedServerId} className="cmd-btn" onClick={() => onCommand("stop")}>STOP</button>
        <button type="button" disabled={!selectedServerId} className="cmd-btn" onClick={() => onCommand("restart")}>RESTART</button>
      </div>
      {operations.length === 0 ? (
        <div className="empty-state">No operations yet. Issue a command to begin.</div>
      ) : (
        <div className="table-wrap">
          <table className="ops-table" aria-label="Recent operations">
            <thead>
              <tr>
                <th>Operation ID</th>
                <th>Type</th>
                <th>Provider</th>
                <th>Server</th>
                <th>State</th>
                <th>Created</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Failure</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((operation) => (
                <tr key={operation.operationId}>
                  <td>{operation.operationId}</td>
                  <td>{operation.type}</td>
                  <td>{operation.providerId}</td>
                  <td>{operation.serverId || "-"}</td>
                  <td>
                    <span className={`chip ${statusClass(operation.status)}`}>{operationStateLabel(operation.status)}</span>
                  </td>
                  <td>{formatTimestamp(operation.createdAt)}</td>
                  <td>{formatTimestamp(operation.startedAt)}</td>
                  <td>{formatTimestamp(operation.completedAt)}</td>
                  <td>{operation.error?.message || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function WorldsPanel({
  worlds,
  onValidate,
}: {
  worlds: WorldRuntime[];
  onValidate: (worldId: string) => void;
}) {
  if (worlds.length === 0) {
    return <div className="empty-state">No worlds returned by provider.</div>;
  }

  return (
    <div className="world-grid" aria-label="World inventory">
      {worlds.map((world) => (
        <article key={world.id} className="world-card">
          <header>
            <h3>{world.name}</h3>
            <span className={`chip ${statusClass(world.validationState === "invalid" ? "failed" : world.validationState)}`}>
              {world.validationState.toUpperCase()}
            </span>
          </header>
          <p>Validation state: {world.validationState}</p>
          {world.validationResult ? (
            <ul>
              <li>Valid: {String(world.validationResult.valid)}</li>
              <li>Missing packs: {world.validationResult.missingPacks.length}</li>
              <li>Invalid packs: {world.validationResult.invalidPacks.length}</li>
              <li>Errors: {world.validationResult.errors.length}</li>
            </ul>
          ) : (
            <p>No validation result yet.</p>
          )}
          <button type="button" className="cmd-btn" onClick={() => onValidate(world.id)}>
            Validate World
          </button>
        </article>
      ))}
    </div>
  );
}

export function LiveEventsPanel({ events }: { events: DashboardState["events"] }) {
  if (events.length === 0) {
    return <div className="empty-state">No live events yet.</div>;
  }

  return (
    <div className="table-wrap">
      <table className="ops-table" aria-label="Live event stream">
        <thead>
          <tr>
            <th>Source</th>
            <th>Event Type</th>
            <th>Timestamp</th>
            <th>Provider</th>
            <th>Server</th>
            <th>Operation</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={`${event.timestamp}-${event.type}-${index}`}>
              <td>{event.source === "persisted" ? "HISTORY" : "LIVE"}</td>
              <td>{event.type}</td>
              <td>{formatTimestamp(event.timestamp)}</td>
              <td>{event.providerId || "-"}</td>
              <td>{event.serverId || "-"}</td>
              <td>{event.operationId || "-"}</td>
              <td>{summarizeEvent(event)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionCard({ id, title, activePanel, children }: { id: PanelId; title: string; activePanel: PanelId; children: React.ReactNode }) {
  return (
    <section className={`dash-card ${activePanel === id ? "is-active" : ""}`} id={`panel-${id}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function OperationalDashboard({
  state,
  selectedServer,
  worlds,
  onSelectServer,
  onCommand,
  onValidateWorld,
  onRefresh,
}: {
  state: DashboardState;
  selectedServer?: ServerInventoryItem;
  worlds: WorldRuntime[];
  onSelectServer: (serverId: string) => void;
  onCommand: (command: "start" | "stop" | "restart") => void;
  onValidateWorld: (worldId: string) => void;
  onRefresh: () => void;
}) {
  const [activePanel, setActivePanel] = React.useState<PanelId>("servers");

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">JB3 GAMEHUB OPERATOR SURFACE</p>
          <h1>JBGH-013 Operational Dashboard</h1>
          <p className="subtitle">REST for commands. WebSocket for live state and event visibility.</p>
        </div>
        <div className="header-actions">
          <span className={`chip ${statusClass(state.wsConnection)}`}>{wsStateLabel(state.wsConnection)}</span>
          <button type="button" className="cmd-btn" onClick={onRefresh}>Refresh</button>
        </div>
      </header>

      {state.error ? <div className="error-banner">Backend unavailable: {state.error}</div> : null}

      <SectionNavigation activePanel={activePanel} onSelect={setActivePanel} />

      <div className="dash-grid">
        <SectionCard id="servers" title="SERVERS" activePanel={activePanel}>
          <ServersPanel servers={state.servers} selectedServerId={state.selectedServerId} onSelectServer={onSelectServer} />
        </SectionCard>

        <SectionCard id="status" title="STATUS" activePanel={activePanel}>
          <StatusPanel server={selectedServer} worldCount={worlds.length} wsState={state.wsConnection} />
        </SectionCard>

        <SectionCard id="operations" title="OPERATIONS" activePanel={activePanel}>
          <OperationsPanel operations={state.operations} selectedServerId={state.selectedServerId} onCommand={onCommand} />
        </SectionCard>

        <SectionCard id="worlds" title="WORLDS" activePanel={activePanel}>
          <WorldsPanel worlds={worlds} onValidate={onValidateWorld} />
        </SectionCard>

        <SectionCard id="events" title="LIVE EVENTS" activePanel={activePanel}>
          <LiveEventsPanel events={state.events} />
        </SectionCard>
      </div>
    </main>
  );
}
