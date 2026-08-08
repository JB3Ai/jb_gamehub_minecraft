import React from "react";
import { OperationalDashboard } from "./components/OperationalDashboard";
import { useOperationalDashboard } from "./dashboard/useOperationalDashboard";

export default function App() {
  const { state, selectedServer, selectServer, refreshData, runCommand, runWorldValidation } = useOperationalDashboard();
  const worlds = selectedServer ? state.worldsByServer[selectedServer.id] || [] : [];

  if (state.loading && state.servers.length === 0) {
    return (
      <main className="dashboard-shell">
        <header className="dashboard-header">
          <div>
            <p className="eyebrow">JB3 GAMEHUB OPERATOR SURFACE</p>
            <h1>JBGH-013 Operational Dashboard</h1>
            <p className="subtitle">Loading providers, servers, worlds, and event stream.</p>
          </div>
        </header>
      </main>
    );
  }

  return (
    <OperationalDashboard
      state={state}
      selectedServer={selectedServer}
      worlds={worlds}
      onSelectServer={selectServer}
      onRefresh={() => {
        void refreshData();
      }}
      onCommand={(command) => {
        void runCommand(command);
      }}
      onValidateWorld={(worldId) => {
        void runWorldValidation(worldId);
      }}
    />
  );
}
