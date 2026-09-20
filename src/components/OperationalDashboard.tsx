import React from "react";
import {
  askAiStudio,
  evaluateChildAccess,
  getChildEntitlements,
  getAiAuditTrail,
  getAiProvidersInfo,
  getChildIdentities,
  getChildOverrides,
  getChildPlaytime,
  getChildRewards,
  getChildRules,
  getChildSessions,
  getFamilies,
  getFamilyChildren,
  createContentImportPlan,
  executeContentImportPlan,
  getContentHistory,
  getContentInventory,
  getContentItems,
  getContentSources,
  scanContent,
  type ContentImportPlanResponse,
  type ContentLibraryItem,
} from "../dashboard/apiClient";
import {
  AiAskResponse,
  AiAuditEntry,
  AiProvidersInfo,
  ChildProfile,
  DashboardState,
  FamilyOverride,
  FamilyPlaytime,
  FamilyRule,
  FamilySession,
  FamilySummary,
  FamilyEntitlements,
  FamilyReward,
  OperationRecord,
  ServerInventoryItem,
  WorldRuntime,
} from "../dashboard/types";

const PANEL_ORDER = ["servers", "status", "operations", "worlds", "content-library", "events", "analytics", "family", "rewards", "ai-studio"] as const;

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

function formatDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (value < 1000) {
    return `${value} ms`;
  }
  const seconds = value / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = seconds / 60;
  return `${minutes.toFixed(1)} min`;
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

function contentStatusClass(status: string): string {
  if (status === "READY" || status === "completed") return "is-good";
  if (status === "WARNING" || status === "planned") return "is-warn";
  if (status === "BLOCKED" || status === "UNKNOWN" || status === "failed") return "is-bad";
  return "is-neutral";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function ContentLibraryPanel({ selectedServer }: { selectedServer?: ServerInventoryItem }) {
  const [sources, setSources] = React.useState<Array<{ path: string; kind: "file" | "directory" }>>([]);
  const [selectedSource, setSelectedSource] = React.useState("");
  const [items, setItems] = React.useState<ContentLibraryItem[]>([]);
  const [selectedItemId, setSelectedItemId] = React.useState<string>();
  const [plan, setPlan] = React.useState<ContentImportPlanResponse>();
  const [inventory, setInventory] = React.useState<Array<{ contentType: string; path: string; items: Array<{ path: string; kind: string }> }>>([]);
  const [history, setHistory] = React.useState<Array<{ action: string; result: string; timestamp: string; destinationPath?: string }>>([]);
  const [progress, setProgress] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "worlds" | "plugins" | "resource-packs" | "datapacks" | "unsupported" | "blocked">("all");
  const [query, setQuery] = React.useState("");
  const selectedItem = items.find((entry) => entry.contentId === selectedItemId);

  const refresh = React.useCallback(async () => {
    try {
      const [sourceResponse, itemResponse, inventoryResponse, historyResponse] = await Promise.all([
        getContentSources(),
        getContentItems(),
        getContentInventory(),
        getContentHistory(),
      ]);
      setSources(sourceResponse.sources);
      setItems(itemResponse.items);
      setInventory(inventoryResponse.inventory);
      setHistory(historyResponse.audit.slice(-20).reverse());
      setSelectedSource((current) => current || sourceResponse.sources[0]?.path || "");
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Content Library could not load.");
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const scan = async () => {
    if (!selectedSource || !selectedServer) return;
    setBusy(true);
    setPlan(undefined);
    setProgress(["content.scan.started"]);
    try {
      const response = await scanContent(selectedSource, selectedServer.id);
      const nextItem = response.report.items[0];
      if (!nextItem) {
        throw new Error("The scanner returned no content item.");
      }
      setItems((current) => [nextItem, ...current.filter((entry) => entry.sourcePath !== nextItem.sourcePath)]);
      setSelectedItemId(nextItem.contentId);
      setProgress(response.report.events.map((event) => event.type));
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Content scan failed.");
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    if (!selectedItem || !selectedServer) return;
    setBusy(true);
    try {
      const response = await createContentImportPlan(selectedItem.contentId, { serverId: selectedServer.id });
      setPlan(response.plan);
      setProgress((current) => [...current, "content.import.plan.created"]);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import preview failed.");
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!plan) return;
    setBusy(true);
    setProgress((current) => [...current, "content.import.approved", "content.import.running"]);
    try {
      const response = await executeContentImportPlan(plan.operationId);
      setProgress((current) => [...current, ...response.result.audit.map((entry) => entry.action)]);
      if (response.result.status !== "completed") {
        const reason = response.result.error;
        setError(reason ? `${reason.code}: ${reason.message}` : `Import ${response.result.status}.`);
        return;
      }
      await refresh();
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approved import failed.");
    } finally {
      setBusy(false);
    }
  };

  const filteredItems = items.filter((entry) => {
    const haystack = [entry.sourcePath, entry.contentId, entry.contentType, entry.sourceManifestId || ""].join(" ").toLowerCase();
    if (query.trim() && !haystack.includes(query.trim().toLowerCase())) return false;
    if (filter === "all") return true;
    if (filter === "worlds") return entry.contentType === "java-world" || entry.contentType === "bedrock-world";
    if (filter === "plugins") return entry.contentType === "paper-plugin";
    if (filter === "resource-packs") return entry.contentType === "resource-pack";
    if (filter === "datapacks") return entry.contentType === "datapack";
    if (filter === "blocked") return entry.compatibility.status === "BLOCKED";
    return ["unknown", "behavior-pack", "skin", "bedrock-world"].includes(entry.contentType) || entry.compatibility.status === "UNKNOWN";
  });

  return (
    <div className="analytics-grid" aria-label="Content library import controls">
      <article className="world-card">
        <header>
          <h3>Content Browser</h3>
          <button type="button" className="cmd-btn" onClick={() => void refresh()} disabled={busy}>Refresh</button>
        </header>
        <p>Sources are constrained to the configured content root. Destination paths are provider-owned and never editable here.</p>
        <select aria-label="Content source" value={selectedSource} onChange={(event) => setSelectedSource(event.target.value)} disabled={busy}>
          {sources.map((source) => <option key={source.path} value={source.path}>{source.kind === "directory" ? "[dir] " : ""}{source.path}</option>)}
        </select>
        <button type="button" className="cmd-btn" onClick={() => void scan()} disabled={busy || !selectedSource || !selectedServer}>Scan selected source</button>
        <div className="content-library-filters" aria-label="Content library filters">
          {(["all", "worlds", "plugins", "resource-packs", "datapacks", "unsupported", "blocked"] as const).map((entry) => (
            <button key={entry} type="button" className={`cmd-btn ${filter === entry ? "is-selected" : ""}`} onClick={() => setFilter(entry)} disabled={busy}>
              {entry.replace("-", " ").toUpperCase()}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Search scanned content"
          placeholder="Search name, ID, manifest, or type"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={busy}
        />
        {filteredItems.length === 0 ? <p>No scanned content matches this view.</p> : (
          <ul className="content-library-list" aria-label="Scanned content">
            {filteredItems.map((entry) => (
              <li key={entry.contentId}>
                <button type="button" className={`inline-link ${selectedItemId === entry.contentId ? "is-selected" : ""}`} onClick={() => { setSelectedItemId(entry.contentId); setPlan(undefined); }}>
                  {entry.sourcePath} · {entry.contentType.toUpperCase()} · {formatBytes(entry.sizeBytes)}
                </button>
                <span className={`chip ${contentStatusClass(entry.compatibility.status)}`}>{entry.compatibility.status}</span>
              </li>
            ))}
          </ul>
        )}
      </article>

      <article className="world-card">
        <header><h3>Content Details</h3></header>
        {!selectedItem ? <p>Select scanned content to inspect its classification and compatibility.</p> : (
          <div>
            <p><strong>{selectedItem.sourcePath}</strong> · {selectedItem.contentType.toUpperCase()} · {formatBytes(selectedItem.sizeBytes)}</p>
            <p>Content ID: <code>{selectedItem.contentId}</code></p>
            <p>Manifest ID: <code>{selectedItem.sourceManifestId || "not mapped"}</code></p>
            <p>Scanned: {formatTimestamp(selectedItem.scannedAt)}</p>
            <p>Source: {selectedItem.metadata.sourceKind}</p>
            <p>SHA-256: <code>{selectedItem.sha256 || "directory / unavailable"}</code></p>
            <p>Markers: {selectedItem.metadata.markers.join(", ") || "none"}</p>
            <p>Validation: <span className={`chip ${contentStatusClass(selectedItem.validationStatus === "valid" ? "READY" : selectedItem.validationStatus === "invalid" ? "BLOCKED" : "UNKNOWN")}`}>{selectedItem.validationStatus.toUpperCase()}</span></p>
            <p>Compatibility: <span className={`chip ${contentStatusClass(selectedItem.compatibility.status)}`}>{selectedItem.compatibility.status}</span></p>
            {selectedItem.warnings.map((warning) => <p key={warning}>Warning: {warning}</p>)}
            {selectedItem.compatibility.issues.map((entry) => <p key={`${entry.code}-${entry.message}`}>{entry.code}: {entry.message}</p>)}
            <button type="button" className="cmd-btn" onClick={() => void preview()} disabled={busy}>Preview import</button>
          </div>
        )}
      </article>

      <article className="world-card">
        <header><h3>Import Preview & Approval</h3></header>
        {!plan ? <p>Select scanned content, inspect its details, then generate a non-mutating import plan.</p> : (
          <div>
            <p><strong>{plan.status.toUpperCase()}</strong> · approval required: {String(plan.requiresApproval)}</p>
            <p>Operation: <code>{plan.operationId}</code></p>
            <p>Content: <code>{plan.contentId}</code> · {plan.contentType.toUpperCase()}</p>
            <p>Compatibility: {plan.compatibilityStatus}</p>
            <p>Provider destination: <code>{plan.destinationPath}</code></p>
            <p>Staging: <code>{plan.stagingPath}</code></p>
            <p>Actions: {plan.actions.join(" → ")}</p>
            {[...plan.warnings, ...plan.blockingIssues].map((entry, index) => <p key={`${entry.code}-${entry.message}-${index}`}>{entry.code}: {entry.message}</p>)}
            {plan.status === "planned" ? <button type="button" className="cmd-btn" onClick={() => void approve()} disabled={busy}>Approve & install</button> : <p className="error-banner">Blocked: the backend will not stage or install this plan.</p>}
          </div>
        )}
        {progress.length > 0 ? <p>Lifecycle: {progress.join(" → ")}</p> : null}
        {error ? <p className="error-banner">{error}</p> : null}
      </article>

      <article className="world-card">
        <header><h3>Installed Content</h3></header>
        {inventory.map((group) => (
          <div key={`${group.contentType}-${group.path}`}>
            <strong>{group.contentType}</strong>
            <ul>{group.items.slice(0, 12).map((entry) => <li key={entry.path}>{entry.path}</li>)}</ul>
          </div>
        ))}
      </article>

      <article className="world-card">
        <header><h3>Import Audit</h3></header>
        {history.length === 0 ? <p>No import activity recorded.</p> : <ul>{history.map((entry, index) => <li key={`${entry.timestamp}-${index}`}>{formatTimestamp(entry.timestamp)} · {entry.action} · {entry.result}{entry.destinationPath ? ` · ${entry.destinationPath}` : ""}</li>)}</ul>}
      </article>
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

export function AnalyticsPanel({
  state,
  onCleanupHistory,
}: {
  state: DashboardState;
  onCleanupHistory: () => void;
}) {
  const summary = state.analyticsSummary;
  const persistence = state.persistenceOverview;

  return (
    <div className="analytics-grid" aria-label="Analytics and persistence panel">
      <article className="world-card">
        <header>
          <h3>24h Analytics Snapshot</h3>
          <span className={`chip ${summary?.incompleteHistory ? "is-warn" : "is-good"}`}>
            {summary?.incompleteHistory ? "PARTIAL" : "COMPLETE"}
          </span>
        </header>
        {summary ? (
          <ul>
            <li>Providers: {summary.totals.providers}</li>
            <li>Servers: {summary.totals.servers}</li>
            <li>Online: {summary.totals.currentlyOnline}</li>
            <li>Offline: {summary.totals.currentlyOffline}</li>
            <li>Completed Ops: {summary.totals.operationsCompleted}</li>
            <li>Failed Ops: {summary.totals.operationsFailed}</li>
            <li>Avg Operation Duration: {formatDuration(summary.totals.averageOperationDurationMs)}</li>
            <li>Validation Passes: {summary.totals.validationSuccesses}</li>
            <li>Validation Failures: {summary.totals.validationFailures}</li>
          </ul>
        ) : (
          <p>No analytics data loaded yet.</p>
        )}
      </article>

      <article className="world-card">
        <header>
          <h3>History Retention</h3>
          <span className={`chip ${statusClass(state.cleanupState || "neutral")}`}>
            {(state.cleanupState || "idle").toUpperCase()}
          </span>
        </header>
        {persistence ? (
          <ul>
            <li>Database Size: {persistence.databaseSizeBytes ? `${persistence.databaseSizeBytes} bytes` : "Unknown"}</li>
            <li>Operations Retention: {persistence.retention.operationRetentionDays} days</li>
            <li>Events Retention: {persistence.retention.eventRetentionDays} days</li>
            <li>Audit Retention: {persistence.retention.auditRetentionDays} days</li>
            <li>Oldest Record: {formatTimestamp(persistence.oldestRetainedRecordAt)}</li>
          </ul>
        ) : (
          <p>No persistence data loaded yet.</p>
        )}
        <button
          type="button"
          className="cmd-btn"
          disabled={state.cleanupState === "running"}
          onClick={() => {
            if (window.confirm("Delete expired history records now? This action is irreversible.")) {
              onCleanupHistory();
            }
          }}
        >
          Cleanup Expired History
        </button>
        {state.cleanupMessage ? <p>{state.cleanupMessage}</p> : null}
      </article>
    </div>
  );
}

const AI_PRESET_QUESTIONS = [
  "Why did this server go offline?",
  "Show me a summary of the last 24 hours.",
  "Why did world validation fail?",
  "Which provider has the most failures?",
  "Explain the most recent operation failure.",
];

export function AiStudioPanel({ providerId, serverId }: { providerId?: string; serverId?: string }) {
  const [question, setQuestion] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [history, setHistory] = React.useState<AiAskResponse[]>([]);
  const [providersInfo, setProvidersInfo] = React.useState<AiProvidersInfo>();
  const [auditTrail, setAuditTrail] = React.useState<AiAuditEntry[]>([]);

  const loadProvidersInfo = React.useCallback(() => {
    getAiProvidersInfo()
      .then(setProvidersInfo)
      .catch(() => undefined);
  }, []);

  const loadAuditTrail = React.useCallback(() => {
    getAiAuditTrail(20)
      .then((response) => setAuditTrail(response.audits))
      .catch(() => undefined);
  }, []);

  React.useEffect(() => {
    loadProvidersInfo();
    loadAuditTrail();
  }, [loadProvidersInfo, loadAuditTrail]);

  const ask = React.useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || loading) {
        return;
      }
      setLoading(true);
      setError(undefined);
      try {
        const response = await askAiStudio({ question: trimmed, providerId, serverId, window: "24h" });
        setHistory((current) => [response, ...current]);
        setQuestion("");
        loadAuditTrail();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [loading, providerId, serverId, loadAuditTrail],
  );

  return (
    <div className="ai-studio-grid" aria-label="AI Studio read-only intelligence panel">
      <div className="ai-studio-banner">
        <span className="chip is-neutral">READ ONLY</span>
        <p>AI Studio can explain GameHub activity. It cannot start, stop, restart, delete, or modify anything.</p>
      </div>

      <div className="ai-studio-presets">
        {AI_PRESET_QUESTIONS.map((preset) => (
          <button key={preset} type="button" className="cmd-btn" disabled={loading} onClick={() => void ask(preset)}>
            {preset}
          </button>
        ))}
      </div>

      <form
        className="ai-studio-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask AI Studio about GameHub activity..."
          disabled={loading}
          aria-label="Ask AI Studio a question"
        />
        <button type="submit" className="cmd-btn" disabled={loading || question.trim().length === 0}>
          {loading ? "Thinking..." : "Ask"}
        </button>
      </form>

      {error ? <div className="error-banner">AI Studio error: {error}</div> : null}

      <div className="ai-studio-history">
        {history.length === 0 ? (
          <div className="empty-state">Ask a question to see AI Studio's read-only explanation here.</div>
        ) : (
          history.map((entry) => (
            <article key={entry.requestId} className="world-card">
              <header>
                <h3>{entry.question}</h3>
                <span className="chip is-neutral">{entry.providerId.toUpperCase()}</span>
              </header>
              <p>{entry.answer}</p>
              <p className="ai-studio-meta">
                Sources: {entry.contextSources.join(", ")} · Model: {entry.model} · {formatTimestamp(entry.generatedAt)}
              </p>
            </article>
          ))
        )}
      </div>

      <details className="ai-studio-audit">
        <summary>
          AI Query Audit Trail ({providersInfo ? `active provider: ${providersInfo.active}` : "loading provider info"})
        </summary>
        {auditTrail.length === 0 ? (
          <div className="empty-state">No AI Studio queries recorded yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="ops-table" aria-label="AI query audit trail">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Actor</th>
                  <th>Provider/Model</th>
                  <th>Context Sources</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {auditTrail.map((entry) => (
                  <tr key={entry.metadata?.requestId || entry.id}>
                    <td>{formatTimestamp(entry.timestamp)}</td>
                    <td>{entry.actor}</td>
                    <td>
                      {entry.metadata?.aiProviderId || "-"}/{entry.metadata?.model || "-"}
                    </td>
                    <td>{entry.metadata?.contextSources?.join(", ") || "-"}</td>
                    <td>
                      <span className={`chip ${statusClass(entry.result)}`}>{entry.result.toUpperCase()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}

function formatPlaytime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

interface FamilyChildSnapshot {
  child: ChildProfile;
  playtime?: FamilyPlaytime;
  rules: FamilyRule[];
  sessions: FamilySession[];
  overrides: FamilyOverride[];
  access?: { decision: string; reason: string; remainingMinutes?: number };
  error?: string;
}

export function FamilyPanel({ selectedServer }: { selectedServer?: ServerInventoryItem }) {
  const [family, setFamily] = React.useState<FamilySummary>();
  const [children, setChildren] = React.useState<FamilyChildSnapshot[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const familyResponse = await getFamilies();
      const nextFamily = familyResponse.families[0];
      setFamily(nextFamily);
      if (!nextFamily) {
        setChildren([]);
        return;
      }
      const childResponse = await getFamilyChildren(nextFamily.id);
      const snapshots = await Promise.all(
        childResponse.children.map(async (child) => {
          try {
            const [playtime, rules, sessions, overrides, identities] = await Promise.all([
              getChildPlaytime(child.id),
              getChildRules(child.id),
              getChildSessions(child.id),
              getChildOverrides(child.id),
              getChildIdentities(child.id),
            ]);
            const identity = identities.identities[0];
            let access;
            if (identity && selectedServer) {
              access = (await evaluateChildAccess(child.id, {
                providerId: identity.providerId,
                serverId: selectedServer.id,
                externalPlayerId: identity.externalPlayerId,
              })).decision;
            }
            return { child, playtime: playtime.usage, rules: rules.rules, sessions: sessions.sessions, overrides: overrides.overrides, access };
          } catch (childError) {
            return { child, rules: [], sessions: [], overrides: [], error: childError instanceof Error ? childError.message : String(childError) };
          }
        }),
      );
      setChildren(snapshots);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [selectedServer]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <div className="empty-state">Loading family controls...</div>;
  }
  if (error) {
    return <div className="error-banner">Family controls unavailable: {error}</div>;
  }
  if (!family) {
    return <div className="empty-state">No family configured yet.</div>;
  }

  return (
    <div className="analytics-grid" aria-label="Family parental controls panel">
      <div className="status-meta">
        <strong>{family.name}</strong> · timezone {family.timezone} · {children.length} children
      </div>
      {children.length === 0 ? <div className="empty-state">Add a child to begin managing play access.</div> : null}
      {children.map((snapshot) => {
        const activeSession = snapshot.sessions.find((session) => session.status === "active");
        const remaining = snapshot.access?.remainingMinutes ?? snapshot.playtime?.remainingDailyMinutes;
        return (
          <article key={snapshot.child.id} className="world-card">
            <header>
              <h3>{snapshot.child.name}</h3>
              <span className={`chip ${statusClass(snapshot.access?.decision === "DENY" ? "failed" : snapshot.child.active ? "online" : "offline")}`}>
                {snapshot.access?.decision || (snapshot.child.active ? "ACTIVE" : "INACTIVE")}
              </span>
            </header>
            {snapshot.error ? <p className="error-banner">{snapshot.error}</p> : null}
            <ul>
              <li>Play time today: {snapshot.playtime ? formatPlaytime(snapshot.playtime.dailySeconds) : "-"}</li>
              <li>Play time this week: {snapshot.playtime ? formatPlaytime(snapshot.playtime.weeklySeconds) : "-"}</li>
              <li>Remaining today: {remaining === undefined ? "unlimited" : `${remaining} min`}</li>
              <li>Active session: {activeSession ? `${activeSession.providerId}/${activeSession.serverId} since ${formatTimestamp(activeSession.startedAt)}` : "none"}</li>
              <li>Rules: {snapshot.rules.filter((rule) => rule.enabled).map((rule) => rule.type).join(", ") || "none"}</li>
              <li>Overrides: {snapshot.overrides.filter((override) => !override.revokedAt).length}</li>
            </ul>
            <details>
              <summary>Recent activity ({snapshot.sessions.length})</summary>
              <ul>
                {snapshot.sessions.slice(0, 5).map((session) => (
                  <li key={session.id}>{formatTimestamp(session.startedAt)} · {formatPlaytime(session.durationSeconds)} · {session.status}</li>
                ))}
              </ul>
            </details>
          </article>
        );
      })}
    </div>
  );
}

interface RewardSnapshot {
  child: ChildProfile;
  rewards: FamilyReward[];
  entitlements?: FamilyEntitlements;
  error?: string;
}

export function RewardsPanel({ selectedServer }: { selectedServer?: ServerInventoryItem }) {
  const [children, setChildren] = React.useState<RewardSnapshot[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const families = await getFamilies();
        const family = families.families[0];
        if (!family) {
          if (!cancelled) setChildren([]);
          return;
        }
        const childResponse = await getFamilyChildren(family.id);
        const snapshots = await Promise.all(childResponse.children.map(async (child) => {
          try {
            const [rewards, entitlements] = await Promise.all([
              getChildRewards(child.id),
              getChildEntitlements(child.id, { providerId: selectedServer?.providerId, serverId: selectedServer?.id }),
            ]);
            return { child, rewards: rewards.rewards, entitlements: entitlements.entitlements };
          } catch (childError) {
            return { child, rewards: [], error: childError instanceof Error ? childError.message : String(childError) };
          }
        }));
        if (!cancelled) setChildren(snapshots);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedServer?.id, selectedServer?.providerId]);

  if (loading) return <div className="empty-state">Loading rewards and entitlements...</div>;
  if (error) return <div className="error-banner">Rewards unavailable: {error}</div>;
  if (children.length === 0) return <div className="empty-state">No family rewards configured.</div>;

  return (
    <div className="analytics-grid" aria-label="Rewards and entitlements panel">
      {children.map((snapshot) => (
        <article key={snapshot.child.id} className="world-card">
          <header>
            <h3>{snapshot.child.name}</h3>
            <span className="chip is-neutral">{snapshot.rewards.filter((reward) => reward.entryType === "grant").length} grants</span>
          </header>
          {snapshot.error ? <p className="error-banner">{snapshot.error}</p> : null}
          <ul>
            <li>Bonus minutes available: {snapshot.entitlements?.bonusMinutes ?? 0}</li>
            <li>Temporary server access: {snapshot.entitlements?.temporaryServerAccess ? "active" : "none"}</li>
            <li>Active reward IDs: {snapshot.entitlements?.rewardIds.join(", ") || "none"}</li>
          </ul>
          <details>
            <summary>Reward ledger ({snapshot.rewards.length})</summary>
            <ul>
              {snapshot.rewards.slice(0, 10).map((reward) => (
                <li key={reward.id}>
                  {reward.entryType} · {reward.rewardType} · {reward.amountMinutes ?? "-"} min · {reward.reason}
                </li>
              ))}
            </ul>
          </details>
        </article>
      ))}
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
  onCleanupHistory,
}: {
  state: DashboardState;
  selectedServer?: ServerInventoryItem;
  worlds: WorldRuntime[];
  onSelectServer: (serverId: string) => void;
  onCommand: (command: "start" | "stop" | "restart") => void;
  onValidateWorld: (worldId: string) => void;
  onRefresh: () => void;
  onCleanupHistory: () => void;
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

        <SectionCard id="content-library" title="CONTENT LIBRARY" activePanel={activePanel}>
          <ContentLibraryPanel selectedServer={selectedServer} />
        </SectionCard>

        <SectionCard id="events" title="LIVE EVENTS" activePanel={activePanel}>
          <LiveEventsPanel events={state.events} />
        </SectionCard>

        <SectionCard id="analytics" title="ANALYTICS & RETENTION" activePanel={activePanel}>
          <AnalyticsPanel state={state} onCleanupHistory={onCleanupHistory} />
        </SectionCard>

        <SectionCard id="family" title="FAMILY CONTROLS" activePanel={activePanel}>
          <FamilyPanel selectedServer={selectedServer} />
        </SectionCard>

        <SectionCard id="rewards" title="REWARDS" activePanel={activePanel}>
          <RewardsPanel selectedServer={selectedServer} />
        </SectionCard>

        <SectionCard id="ai-studio" title="AI STUDIO" activePanel={activePanel}>
          <AiStudioPanel providerId={selectedServer?.providerId} serverId={selectedServer?.id} />
        </SectionCard>
      </div>
    </main>
  );
}
