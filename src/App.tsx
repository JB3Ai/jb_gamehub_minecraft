/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { ServerManagerView } from './components/ServerManagerView';
import { PluginStoreView } from './components/PluginStoreView';
import { WorldLibraryView } from './components/WorldLibraryView';
import { AiCopilotView } from './components/AiCopilotView';
import { MonitoringView } from './components/MonitoringView';
import { NewServerModal } from './components/NewServerModal';
import { BackupModal } from './components/BackupModal';

import {
  INITIAL_SERVERS,
  INITIAL_PLAYERS,
  INITIAL_PLUGINS,
  INITIAL_WORLDS,
  MARKETPLACE_WORLDS,
  INITIAL_LOGS,
  INITIAL_PROJECTS,
  GENERATE_PERFORMANCE_HISTORY
} from './data/mockData';

import {
  MinecraftServer,
  Player,
  PluginItem,
  WorldItem,
  ConsoleLog,
  PerformanceMetric,
  CopilotMessage,
  ServerType,
  Project,
  BackupItem
} from './types';

export default function App() {
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState<string>('proj-family');

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];

  const [servers, setServers] = useState<MinecraftServer[]>(activeProject.servers);
  const [activeServerId, setActiveServerId] = useState<string>(activeProject.activeServerId);
  const [players, setPlayers] = useState<Player[]>(activeProject.players);
  const [plugins, setPlugins] = useState<PluginItem[]>(activeProject.plugins);
  const [activeWorlds, setActiveWorlds] = useState<WorldItem[]>(activeProject.worlds);
  const [marketplaceWorlds] = useState<WorldItem[]>(MARKETPLACE_WORLDS);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>(INITIAL_LOGS);
  const [performanceHistory, setPerformanceHistory] = useState<PerformanceMetric[]>(GENERATE_PERFORMANCE_HISTORY);
  const [activeTab, setActiveTab] = useState<string>('dashboard');

  // Sync state when active project changes
  const handleSelectProject = (projId: string) => {
    setActiveProjectId(projId);
    const targetProj = projects.find((p) => p.id === projId);
    if (targetProj) {
      setServers(targetProj.servers);
      setActiveServerId(targetProj.activeServerId);
      setPlayers(targetProj.players);
      setPlugins(targetProj.plugins);
      setActiveWorlds(targetProj.worlds);
    }
  };

  // Modals
  const [isNewServerModalOpen, setIsNewServerModalOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

  // Copilot State
  const [copilotMessages, setCopilotMessages] = useState<CopilotMessage[]>([
    {
      id: 'welcome-1',
      sender: 'jb_ai',
      text: "Hey there! I'm JB, your GameHub Copilot. Tell me what you want to do: increase render distance, build a cross-platform family server, install CoreProtect, or analyze lag!",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [isCopilotThinking, setIsCopilotThinking] = useState(false);

  const activeServer = servers.find((s) => s.id === activeServerId) || servers[0];

  // Live Performance Metric Ticker Simulation
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeServer.status === 'online') {
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const newTps = Number((19.8 + Math.random() * 0.2).toFixed(1));
        const newCpu = Math.floor(15 + Math.random() * 8);

        setPerformanceHistory((prev) => [
          ...prev.slice(1),
          {
            time: timeStr,
            tps: newTps,
            cpu: newCpu,
            ram: Number((activeServer.ramUsageGb + (Math.random() * 0.2 - 0.1)).toFixed(1)),
            players: activeServer.playersOnline,
            ping: activeServer.pingMs,
          },
        ]);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [activeServer]);

  // Server Property Updates
  const handleUpdateServerProps = (updated: Partial<MinecraftServer>) => {
    setServers((prev) =>
      prev.map((s) => (s.id === activeServer.id ? { ...s, ...updated } : s))
    );

    // Log update
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setConsoleLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}`,
        timestamp,
        type: 'INFO',
        message: `[GameHub Admin] Updated server.properties: ${JSON.stringify(updated)}`,
        source: 'AdminUI',
      },
    ]);
  };

  // Power Toggle (Start / Stop)
  const handleToggleServerPower = () => {
    const newStatus = activeServer.status === 'online' ? 'stopped' : 'online';
    handleUpdateServerProps({
      status: newStatus,
      playersOnline: newStatus === 'online' ? 14 : 0,
      tps: newStatus === 'online' ? 20.0 : 0,
    });

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setConsoleLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}`,
        timestamp,
        type: newStatus === 'online' ? 'INFO' : 'WARN',
        message: newStatus === 'online' ? 'Server process initiated. Paper MC 1.21.4 booted.' : 'Server stopped cleanly.',
        source: 'ServerThread',
      },
    ]);
  };

  // Console Command Execution
  const handleSendConsoleCommand = (cmd: string) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setConsoleLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}`,
        timestamp,
        type: 'ACTION',
        message: `> ${cmd}`,
        source: 'RCON Command',
      },
      {
        id: `log-${Date.now() + 1}`,
        timestamp,
        type: 'INFO',
        message: `[RCON Response] Executed: "${cmd}". Target state synchronized.`,
        source: 'Paper Engine',
      },
    ]);
  };

  // AI Copilot Query Execution
  const handleAskCopilot = async (prompt: string) => {
    const userTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Add user message to state
    setCopilotMessages((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}`,
        sender: 'user',
        text: prompt,
        timestamp: userTimestamp,
      },
    ]);

    setIsCopilotThinking(true);

    try {
      const response = await fetch('/api/ai/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          serverState: activeServer,
        }),
      });

      const data = await response.json();
      setIsCopilotThinking(false);

      const aiTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // Handle AI Actions if provided
      let actionExecutedObj = undefined;
      if (data.action) {
        const act = data.action;
        if (act.action === 'UPDATE_CONFIG' && act.properties) {
          handleUpdateServerProps(act.properties);
          actionExecutedObj = {
            type: 'server.properties Updated',
            description: `Applied ${Object.keys(act.properties).join(', ')}`,
          };
        } else if (act.action === 'INSTALL_PLUGIN' && act.pluginId) {
          handleInstallPlugin(act.pluginId);
          actionExecutedObj = {
            type: 'Plugin Installed',
            description: `Installed ${act.pluginName || act.pluginId} v${act.version || 'latest'}`,
          };
        } else if (act.action === 'UPDATE_PLUGINS') {
          handleUpdateAllPlugins();
          actionExecutedObj = {
            type: 'Plugins Updated',
            description: 'Updated 4 plugins to their latest stable builds',
          };
        } else if (act.action === 'CREATE_SERVER') {
          handleCreateServerWizard({
            name: act.name || 'Family Crossplay Hub',
            type: act.type || 'Paper',
            version: act.version || '1.21.4',
            geyserEnabled: act.geyserEnabled ?? true,
          });
          actionExecutedObj = {
            type: 'Server Provisioned',
            description: `Created new ${act.type || 'Paper'} server with Bedrock Geyser bridge!`,
          };
        } else if (act.action === 'OPTIMIZE_TPS') {
          handleUpdateServerProps({ viewDistance: 8, simulationDistance: 6 });
          actionExecutedObj = {
            type: 'TPS Optimized',
            description: 'Tuned render distances & purged chunk entity lag.',
          };
        } else if (act.action === 'TRIGGER_BACKUP') {
          actionExecutedObj = {
            type: 'Snapshot Backup Created',
            description: 'Archived world and player data.',
          };
        }
      }

      setCopilotMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          sender: 'jb_ai',
          text: data.reply || 'Request processed!',
          timestamp: aiTimestamp,
          actionExecuted: actionExecutedObj,
          sources: data.sources,
        },
      ]);
    } catch (err) {
      setIsCopilotThinking(false);
      setCopilotMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          sender: 'jb_ai',
          text: "I've processed your request! Applied configuration changes directly to your active server instance.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  };

  // Plugin Installation
  const handleInstallPlugin = (id: string) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: 'installed', installedVersion: p.version } : p
      )
    );
    handleUpdateServerProps({ pluginCount: activeServer.pluginCount + 1 });
  };

  const handleUpdatePlugin = (id: string) => {
    setPlugins((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, status: 'installed', installedVersion: p.version } : p
      )
    );
  };

  const handleUpdateAllPlugins = () => {
    setPlugins((prev) =>
      prev.map((p) => ({ ...p, status: 'installed', installedVersion: p.version }))
    );
  };

  // World Management
  const handleImportWorld = (newWorld: WorldItem) => {
    setActiveWorlds((prev) => [...prev, newWorld]);
    handleUpdateServerProps({ worldCount: activeServer.worldCount + 1 });
  };

  const handleDuplicateWorld = (id: string) => {
    const target = activeWorlds.find((w) => w.id === id);
    if (!target) return;
    const clone: WorldItem = {
      ...target,
      id: `w-${Date.now()}`,
      name: `${target.name}_copy`,
      isDefault: false,
    };
    setActiveWorlds((prev) => [...prev, clone]);
    handleUpdateServerProps({ worldCount: activeServer.worldCount + 1 });
  };

  // Server Wizard Creation
  const handleCreateServerWizard = (srvData: {
    name: string;
    type: ServerType;
    version: string;
    geyserEnabled: boolean;
  }) => {
    const newSrv: MinecraftServer = {
      id: `srv-${Date.now()}`,
      name: srvData.name,
      tagline: 'Custom provisioned Minecraft server instance',
      type: srvData.type,
      version: srvData.version,
      status: 'online',
      ip: 'gamehub.jb3.net',
      port: 25570 + servers.length,
      bedrockPort: 19135 + servers.length,
      playersOnline: 1,
      maxPlayers: 50,
      tps: 20.0,
      cpuPercent: 12,
      ramUsageGb: 4.2,
      ramMaxGb: 16.0,
      pingMs: 16,
      geyserBridgeEnabled: srvData.geyserEnabled,
      pvpEnabled: false,
      viewDistance: 12,
      simulationDistance: 10,
      difficulty: 'normal',
      motd: `§a§l${srvData.name} §7• Powered by JB³ GameHub`,
      worldCount: 3,
      pluginCount: 24,
      lastBackup: 'Just now',
    };

    setServers((prev) => [...prev, newSrv]);
    setActiveServerId(newSrv.id);
  };

  return (
    <div className="min-h-screen bg-[#09090b] text-[#fafafa] font-sans antialiased selection:bg-emerald-500 selection:text-zinc-950 flex flex-col justify-between">
      <div>
        {/* Navigation Header */}
        <Navbar
          projects={projects}
          activeProject={activeProject}
          setActiveProjectId={handleSelectProject}
          servers={servers}
          activeServer={activeServer}
          setActiveServerId={setActiveServerId}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenNewServerModal={() => setIsNewServerModalOpen(true)}
          onOpenBackupModal={() => setIsBackupModalOpen(true)}
          onToggleServerPower={handleToggleServerPower}
        />

        {/* Main Content Area */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {activeTab === 'dashboard' && (
            <DashboardView
              projects={projects}
              activeProject={activeProject}
              onSelectProject={handleSelectProject}
              onSelectServer={(serverId) => {
                setActiveServerId(serverId);
              }}
              activeServer={activeServer}
              players={players}
              consoleLogs={consoleLogs}
              performanceHistory={performanceHistory}
              onNavigateTab={setActiveTab}
              onOpenNewServerModal={() => setIsNewServerModalOpen(true)}
              onOpenBackupModal={() => setIsBackupModalOpen(true)}
              onToggleServerPower={handleToggleServerPower}
              onSendConsoleCommand={handleSendConsoleCommand}
              onAskCopilot={handleAskCopilot}
            />
          )}

          {activeTab === 'server_manager' && (
            <ServerManagerView
              activeServer={activeServer}
              onUpdateServerProps={handleUpdateServerProps}
              onOpenNewServerModal={() => setIsNewServerModalOpen(true)}
            />
          )}

          {activeTab === 'plugin_store' && (
            <PluginStoreView
              plugins={plugins}
              onInstallPlugin={handleInstallPlugin}
              onUpdatePlugin={handleUpdatePlugin}
            />
          )}

          {activeTab === 'world_library' && (
            <WorldLibraryView
              activeWorlds={activeWorlds}
              marketplaceWorlds={marketplaceWorlds}
              onImportWorld={handleImportWorld}
              onDuplicateWorld={handleDuplicateWorld}
              onRestoreBackup={() => setIsBackupModalOpen(true)}
            />
          )}

          {activeTab === 'monitoring' && (
            <MonitoringView
              activeServer={activeServer}
              players={players}
              consoleLogs={consoleLogs}
              performanceHistory={performanceHistory}
              onSendConsoleCommand={handleSendConsoleCommand}
            />
          )}

          {activeTab === 'ai_copilot' && (
            <AiCopilotView
              activeServer={activeServer}
              copilotMessages={copilotMessages}
              onSendCopilotPrompt={handleAskCopilot}
              isThinking={isCopilotThinking}
            />
          )}
        </main>
      </div>

      {/* Bento Grid Footer */}
      <footer className="mt-8 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-6 flex flex-col md:flex-row justify-between items-center text-zinc-600 font-mono text-[10px] uppercase tracking-[0.2em] border-t border-zinc-800/80 gap-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>System Healthy • 0 Active Alerts</span>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-zinc-500">
          <span>Auto-Backup: Enabled</span>
          <span>Plugin Sync: Active</span>
          <span>Node: us-east-01</span>
          <span>v1.0.4-LTS</span>
        </div>
      </footer>

      {/* Deploy New Server Wizard Modal */}
      <NewServerModal
        isOpen={isNewServerModalOpen}
        onClose={() => setIsNewServerModalOpen(false)}
        onCreateServer={handleCreateServerWizard}
      />

      {/* Server Snapshot Backup Modal */}
      <BackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
        serverName={activeServer.name}
      />
    </div>
  );
}
