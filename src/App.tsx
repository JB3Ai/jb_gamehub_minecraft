import React from "react";
import { OperationalDashboard } from "./components/OperationalDashboard";
import { useOperationalDashboard } from "./dashboard/useOperationalDashboard";

export default function App() {
  const { state, selectedServer, selectServer, showProvisionedServer, refreshData, runCommand, runWorldValidation, cleanupHistory, recheckCommand, associateCommand } = useOperationalDashboard();
  const worlds = selectedServer ? state.worldsByServer[selectedServer.id] || [] : [];

  return (
    <OperationalDashboard
      state={state}
      selectedServer={selectedServer}
      worlds={worlds}
      onSelectServer={selectServer}
      onProvisioned={showProvisionedServer}
      onRefresh={() => {
        void refreshData();
      }}
      onCommand={(command) => {
        void runCommand(command);
      }}
      onServerCommand={(key, command) => { void runCommand(command, key); }}
      onRecheckCommand={recheckCommand}
      onAssociateCommand={associateCommand}
      onValidateWorld={(worldId) => {
        void runWorldValidation(worldId);
      }}
      onCleanupHistory={() => {
        void cleanupHistory();
      }}
    />
  );
}
