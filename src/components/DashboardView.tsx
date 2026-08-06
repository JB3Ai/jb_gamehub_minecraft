import React, { useState } from 'react';
import {
  Activity,
  Users,
  Globe,
  Puzzle,
  Cpu,
  HardDrive,
  Copy,
  Check,
  Play,
  RotateCw,
  Square,
  Save,
  PlusCircle,
  Bot,
  Terminal,
  Shield,
  Smartphone,
  Monitor,
  Gamepad2,
  Sparkles,
  ArrowRight,
  Zap,
  TrendingUp,
  AlertCircle,
  FolderKanban,
  LayoutGrid,
  CheckCircle2,
  ExternalLink,
  Plus,
  Layers,
  ChevronRight,
  Database,
  Radio,
  Server
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { MinecraftServer, Player, ConsoleLog, PerformanceMetric, Project } from '../types';

interface DashboardViewProps {
  projects?: Project[];
  activeProject?: Project;
  onSelectProject?: (projectId: string) => void;
  onSelectServer?: (serverId: string) => void;
  activeServer: MinecraftServer;
  players: Player[];
  consoleLogs: ConsoleLog[];
  performanceHistory: PerformanceMetric[];
  onNavigateTab: (tab: string) => void;
  onOpenNewServerModal: () => void;
  onOpenBackupModal: () => void;
  onToggleServerPower: () => void;
  onSendConsoleCommand: (cmd: string) => void;
  onAskCopilot: (prompt: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  projects = [],
  activeProject,
  onSelectProject,
  onSelectServer,
  activeServer,
  players,
  consoleLogs,
  performanceHistory,
  onNavigateTab,
  onOpenNewServerModal,
  onOpenBackupModal,
  onToggleServerPower,
  onSendConsoleCommand,
  onAskCopilot,
}) => {
  const [viewMode, setViewMode] = useState<'projects' | 'active_server'>('projects');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [commandInput, setCommandInput] = useState('');
  const [copilotQuickPrompt, setCopilotQuickPrompt] = useState('');
  const [chartMetric, setChartMetric] = useState<'tps' | 'cpu' | 'ram'>('tps');

  const handleCopyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIp(label);
    setTimeout(() => setCopiedIp(null), 2000);
  };

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;
    onSendConsoleCommand(commandInput.trim());
    setCommandInput('');
  };

  const handleQuickAiSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!copilotQuickPrompt.trim()) return;
    onAskCopilot(copilotQuickPrompt.trim());
    onNavigateTab('ai_copilot');
  };

  const filteredProjects = projects.filter((p) => {
    if (categoryFilter === 'all') return true;
    return p.category.toLowerCase() === categoryFilter.toLowerCase();
  });

  const totalServersCount = projects.reduce((acc, p) => acc + p.servers.length, 0);

  const javaAddress = `${activeServer.ip}:${activeServer.port}`;
  const bedrockAddress = `${activeServer.ip}:${activeServer.bedrockPort || 19132}`;

  return (
    <div className="space-y-8 pb-12 animate-in fade-in duration-200">
      {/* Top Operations Header Bar & View Switcher */}
      <div className="bg-[#18181b] border border-zinc-800 rounded-3xl p-5 md:p-6 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950 border border-emerald-800/80 rounded uppercase tracking-wider">
              Cluster Dashboard
            </span>
            <span className="text-xs text-zinc-500 font-mono">
              {projects.length} Workspaces • {totalServersCount} Managed Servers
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-zinc-100 tracking-tight flex items-center gap-2.5">
            <FolderKanban className="w-7 h-7 text-emerald-400" /> Operational Control Center
          </h1>
        </div>

        {/* View Mode Toggle Controls */}
        <div className="flex items-center gap-2 bg-[#09090b] border border-zinc-800 p-1.5 rounded-2xl">
          <button
            onClick={() => setViewMode('projects')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold transition-all ${
              viewMode === 'projects'
                ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FolderKanban className="w-4 h-4" />
            <span>Project View ({projects.length})</span>
          </button>
          <button
            onClick={() => setViewMode('active_server')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-extrabold transition-all ${
              viewMode === 'active_server'
                ? 'bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Zap className="w-4 h-4" />
            <span>Active Server Focus</span>
          </button>
        </div>
      </div>

      {/* PROJECT VIEW MODE: Bento Grid Categorized by Project Environment */}
      {viewMode === 'projects' && (
        <div className="space-y-6">
          {/* Category Filter Pills & Deploy Button Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#18181b]/60 border border-zinc-800/80 rounded-2xl p-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
              <span className="text-xs font-mono font-bold text-zinc-500 uppercase tracking-wider px-2">
                Filter Category:
              </span>
              {['all', 'Family', 'Education', 'Creator'].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    categoryFilter === cat
                      ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                      : 'bg-[#09090b] text-zinc-400 border border-zinc-800 hover:text-zinc-200 hover:border-zinc-700'
                  }`}
                >
                  {cat === 'all' ? 'All Environments' : cat}
                </button>
              ))}
            </div>

            <button
              onClick={onOpenNewServerModal}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-extrabold rounded-xl transition-all shadow-lg shadow-emerald-500/10 shrink-0"
            >
              <Plus className="w-4 h-4" /> Deploy Server
            </button>
          </div>

          {/* Bento Grid of Project Environments */}
          <div className="grid grid-cols-1 gap-8">
            {filteredProjects.map((project) => {
              const isActiveWorkspace = activeProject?.id === project.id;
              return (
                <div
                  key={project.id}
                  className={`bg-[#18181b] border rounded-3xl p-6 md:p-8 space-y-6 relative overflow-hidden transition-all shadow-xl ${
                    isActiveWorkspace
                      ? 'border-emerald-500/80 shadow-[0_0_30px_rgba(16,185,129,0.08)]'
                      : 'border-zinc-800/90 hover:border-zinc-700'
                  }`}
                >
                  {/* Subtle Background Glow */}
                  {isActiveWorkspace && (
                    <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none"></div>
                  )}

                  {/* Project Header Row */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
                    <div className="flex items-start gap-3.5">
                      <div className="text-3xl md:text-4xl p-2.5 bg-[#09090b] border border-zinc-800 rounded-2xl shadow-inner shrink-0">
                        {project.icon}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-xl md:text-2xl font-black text-zinc-100 tracking-tight">
                            {project.name}
                          </h2>
                          <span className="px-2.5 py-0.5 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800/80 rounded-md">
                            {project.category}
                          </span>
                          {isActiveWorkspace && (
                            <span className="px-2.5 py-0.5 text-[10px] font-mono font-black text-emerald-950 bg-emerald-400 rounded-md shadow-sm">
                              ACTIVE WORKSPACE
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400 mt-1 font-medium">{project.tagline}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {onSelectProject && !isActiveWorkspace && (
                        <button
                          onClick={() => onSelectProject(project.id)}
                          className="px-4 py-2 bg-[#09090b] hover:bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs font-extrabold rounded-xl transition-all"
                        >
                          Switch to Workspace
                        </button>
                      )}
                      <button
                        onClick={onOpenBackupModal}
                        className="px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-semibold rounded-xl transition-all flex items-center gap-1.5"
                      >
                        <Database className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Snapshots ({project.backups.length})</span>
                      </button>
                    </div>
                  </div>

                  {/* Project Summary Metrics Bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-[#09090b]/80 border border-zinc-800/80 rounded-2xl p-3.5">
                    <div className="flex items-center gap-2.5 px-2">
                      <Server className="w-4 h-4 text-emerald-400" />
                      <div>
                        <div className="text-xs font-bold text-zinc-200">{project.servers.length} Instances</div>
                        <div className="text-[10px] text-zinc-500 font-mono">Server Engines</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 px-2 border-l border-zinc-800/80">
                      <Users className="w-4 h-4 text-blue-400" />
                      <div>
                        <div className="text-xs font-bold text-zinc-200">{project.players.length} Active</div>
                        <div className="text-[10px] text-zinc-500 font-mono">Players Roster</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 px-2 border-l border-zinc-800/80">
                      <Globe className="w-4 h-4 text-amber-400" />
                      <div>
                        <div className="text-xs font-bold text-zinc-200">{project.worlds.length} Worlds</div>
                        <div className="text-[10px] text-zinc-500 font-mono">Overworld & Nether</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 px-2 border-l border-zinc-800/80">
                      <Puzzle className="w-4 h-4 text-purple-400" />
                      <div>
                        <div className="text-xs font-bold text-zinc-200">{project.plugins.length} Loaded</div>
                        <div className="text-[10px] text-zinc-500 font-mono">Plugins & Geyser</div>
                      </div>
                    </div>
                  </div>

                  {/* Server Cards Sub-Grid for this Project */}
                  <div className="space-y-3">
                    <div className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-500 flex items-center justify-between">
                      <span>Server Environments ({project.servers.length})</span>
                      <span>Click card to inspect or toggle state</span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {project.servers.map((srv) => {
                        const isThisActiveServer = srv.id === activeServer.id;
                        return (
                          <div
                            key={srv.id}
                            className={`bg-[#09090b] border rounded-2xl p-5 space-y-4 relative group transition-all ${
                              isThisActiveServer
                                ? 'border-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.12)] bg-[#09090b]'
                                : 'border-zinc-800 hover:border-zinc-700'
                            }`}
                          >
                            {/* Server Title & Status */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-base font-extrabold text-zinc-100 tracking-tight">
                                    {srv.name}
                                  </h3>
                                  {isThisActiveServer && (
                                    <span className="px-1.5 py-0.2 text-[9px] font-mono font-black text-emerald-400 bg-emerald-950 border border-emerald-800 rounded">
                                      ACTIVE FOCUS
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-zinc-400">
                                  <span className="px-2 py-0.5 bg-zinc-900 border border-zinc-700/80 rounded-md font-semibold text-zinc-300">
                                    {srv.type} {srv.version}
                                  </span>
                                  {srv.geyserBridgeEnabled && (
                                    <span className="px-2 py-0.5 bg-blue-950/80 text-blue-300 border border-blue-800/80 rounded-md font-semibold">
                                      Geyser Crossplay
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5">
                                {srv.status === 'online' ? (
                                  <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/80 border border-emerald-800/80 text-emerald-400 text-xs font-mono font-bold rounded-xl">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                    ONLINE
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-950/80 border border-rose-800/80 text-rose-400 text-xs font-mono font-bold rounded-xl">
                                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                                    STOPPED
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Addresses & Metrics */}
                            <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-1">
                              <div className="bg-zinc-900/80 border border-zinc-800 p-2 rounded-xl flex items-center justify-between">
                                <span className="text-zinc-500">Java Port:</span>
                                <span className="text-emerald-400 font-bold">{srv.port}</span>
                              </div>
                              <div className="bg-zinc-900/80 border border-zinc-800 p-2 rounded-xl flex items-center justify-between">
                                <span className="text-zinc-500">Bedrock:</span>
                                <span className="text-blue-400 font-bold">{srv.bedrockPort || 19132}</span>
                              </div>
                            </div>

                            {/* Live Stats Bar */}
                            <div className="flex items-center justify-between text-xs font-mono text-zinc-400 pt-2 border-t border-zinc-800/80">
                              <div>
                                Players: <span className="text-zinc-100 font-bold">{srv.playersOnline} / {srv.maxPlayers}</span>
                              </div>
                              <div>
                                TPS: <span className="text-emerald-400 font-bold">{srv.tps.toFixed(1)}</span>
                              </div>
                              <div>
                                RAM: <span className="text-purple-400 font-bold">{srv.ramUsageGb.toFixed(1)} GB</span>
                              </div>
                            </div>

                            {/* Server Card Footer Actions */}
                            <div className="flex items-center gap-2 pt-1">
                              {onSelectServer && !isThisActiveServer && (
                                <button
                                  onClick={() => onSelectServer(srv.id)}
                                  className="flex-1 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-extrabold rounded-xl transition-all text-center"
                                >
                                  Make Active Focus
                                </button>
                              )}
                              <button
                                onClick={onToggleServerPower}
                                className={`px-3 py-2 text-xs font-mono font-bold rounded-xl border transition-all ${
                                  srv.status === 'online'
                                    ? 'bg-rose-950/60 text-rose-300 border-rose-800 hover:bg-rose-900'
                                    : 'bg-emerald-500 text-zinc-950 border-emerald-400 hover:bg-emerald-400'
                                }`}
                              >
                                {srv.status === 'online' ? 'Restart' : 'Start'}
                              </button>
                              <button
                                onClick={() => onNavigateTab('monitoring')}
                                className="px-3 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs font-semibold rounded-xl transition-all"
                              >
                                RCON Console
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Project Footer Bar */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400 border-t border-zinc-800/80">
                    <div className="flex items-center gap-3">
                      <span>Created: {project.createdAt}</span>
                      <span>•</span>
                      <span>Last Updated: {project.lastUpdated}</span>
                    </div>

                    <button
                      onClick={() => {
                        onAskCopilot(`Check health and optimize performance for project ${project.name}`);
                        onNavigateTab('ai_copilot');
                      }}
                      className="text-emerald-400 hover:text-emerald-300 font-mono font-bold flex items-center gap-1.5 transition-colors"
                    >
                      <Bot className="w-4 h-4" /> Run AI Copilot Health Check
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ACTIVE SERVER FOCUS VIEW OR ALWAYS-ACCESSIBLE TELEMETRY & CONSOLE */}
      {(viewMode === 'active_server' || viewMode === 'projects') && (
        <div className="space-y-6 pt-4 border-t border-zinc-800/80">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-extrabold text-zinc-100 tracking-tight flex items-center gap-2">
              <Zap className="w-5 h-5 text-emerald-400" /> Active Instance Telemetry & Console ({activeServer.name})
            </h2>
            <span className="text-xs text-zinc-500 font-mono">
              Port: {activeServer.port} • Engine: {activeServer.type} {activeServer.version}
            </span>
          </div>

          {/* Top Bento Grid Row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Active Server Hero Bento Card (8 Cols) */}
            <div className="lg:col-span-8 bg-[#18181b] border border-zinc-800 rounded-3xl p-6 md:p-8 relative overflow-hidden flex flex-col justify-between group shadow-xl min-h-[300px]">
              <div className="z-10 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-zinc-500 text-xs font-mono font-bold uppercase tracking-widest">
                    Active Focus Engine
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_#10b981]"></span>
                    <span className="text-xs font-mono text-emerald-500 uppercase tracking-wider font-bold">Online</span>
                  </div>
                </div>

                <h2 className="text-3xl md:text-5xl font-black text-zinc-100 tracking-tight">
                  {activeServer.name}
                </h2>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="px-3 py-1 bg-zinc-900 rounded-xl text-xs font-mono text-zinc-300 border border-zinc-700/80">
                    {activeServer.type} {activeServer.version}
                  </span>
                  <span className="px-3 py-1 bg-emerald-950/40 text-emerald-400 rounded-xl text-xs font-mono border border-emerald-900/60 font-semibold">
                    Uptime: 4d 12h
                  </span>
                </div>

                {/* Connection Addresses */}
                <div className="pt-2 flex flex-wrap gap-2 text-xs font-mono">
                  <div className="bg-[#09090b] border border-zinc-800 px-3 py-1.5 rounded-xl flex items-center gap-2 text-zinc-300">
                    <span className="text-emerald-400 font-bold">Java:</span> {javaAddress}
                    <button
                      onClick={() => handleCopyText(javaAddress, 'java')}
                      className="hover:text-emerald-400 p-0.5 ml-1"
                    >
                      {copiedIp === 'java' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  {activeServer.geyserBridgeEnabled && (
                    <div className="bg-[#09090b] border border-zinc-800 px-3 py-1.5 rounded-xl flex items-center gap-2 text-zinc-300">
                      <span className="text-blue-400 font-bold">Bedrock:</span> {bedrockAddress}
                      <button
                        onClick={() => handleCopyText(bedrockAddress, 'bedrock')}
                        className="hover:text-blue-400 p-0.5 ml-1"
                      >
                        {copiedIp === 'bedrock' ? <Check className="w-3.5 h-3.5 text-blue-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-4 md:gap-8 z-10 pt-6 mt-4 border-t border-zinc-800/60">
                <div className="border-l-2 border-emerald-500 pl-4">
                  <div className="text-2xl md:text-3xl font-black font-mono text-zinc-100">
                    {activeServer.playersOnline} / {activeServer.maxPlayers}
                  </div>
                  <div className="text-[10px] md:text-xs text-zinc-500 uppercase font-mono font-bold tracking-widest mt-1">
                    Players Online
                  </div>
                </div>

                <div
                  onClick={() => onNavigateTab('world_library')}
                  className="border-l-2 border-zinc-700 pl-4 cursor-pointer hover:border-amber-400 transition-colors group"
                >
                  <div className="text-2xl md:text-3xl font-black font-mono text-zinc-100 group-hover:text-amber-400 transition-colors">
                    {activeServer.worldCount}
                  </div>
                  <div className="text-[10px] md:text-xs text-zinc-500 uppercase font-mono font-bold tracking-widest mt-1">
                    Active Worlds
                  </div>
                </div>

                <div
                  onClick={() => onNavigateTab('plugin_store')}
                  className="border-l-2 border-zinc-700 pl-4 cursor-pointer hover:border-purple-400 transition-colors group"
                >
                  <div className="text-2xl md:text-3xl font-black font-mono text-zinc-100 group-hover:text-purple-400 transition-colors">
                    {activeServer.pluginCount}
                  </div>
                  <div className="text-[10px] md:text-xs text-zinc-500 uppercase font-mono font-bold tracking-widest mt-1">
                    Plugins Loaded
                  </div>
                </div>
              </div>
            </div>

            {/* AI Copilot Quick Prompt Bento Card (4 Cols) */}
            <div className="lg:col-span-4 bg-[#18181b] border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between shadow-xl space-y-4">
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                    <Bot className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-zinc-100 tracking-tight">AI Copilot</h3>
                    <p className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Natural Admin Command</p>
                  </div>
                </div>

                <div className="bg-[#09090b]/80 border border-zinc-800 rounded-2xl p-4 font-mono text-xs text-zinc-300 space-y-3 relative overflow-hidden">
                  <div className="text-emerald-400 font-semibold">
                    "Hey JB, install CoreProtect and increase view distance to 12"
                  </div>
                  <div className="flex gap-1.5">
                    <div className="w-2 h-2 bg-emerald-500/60 rounded-full animate-ping"></div>
                    <div className="w-2 h-2 bg-emerald-500/40 rounded-full"></div>
                    <div className="w-2 h-2 bg-emerald-500/20 rounded-full"></div>
                  </div>
                  <div className="text-zinc-500 text-[11px] italic border-t border-zinc-800/80 pt-2">
                    "Updated server.properties view-distance=12. CoreProtect installed!"
                  </div>
                </div>
              </div>

              <form onSubmit={handleQuickAiSubmit} className="relative mt-2">
                <input
                  type="text"
                  value={copilotQuickPrompt}
                  onChange={(e) => setCopilotQuickPrompt(e.target.value)}
                  placeholder="Ask JB a command..."
                  className="w-full bg-[#09090b] border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 pr-10 shadow-inner"
                />
                <button
                  type="submit"
                  className="absolute right-2 top-2.5 p-1 bg-emerald-500 text-[#09090b] rounded-lg font-bold hover:bg-emerald-400 transition-colors"
                >
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>

          {/* System Metrics Telemetry & Power Toggle Row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 bg-[#18181b] border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between shadow-xl space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h3 className="font-extrabold text-base text-zinc-100 tracking-tight flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-emerald-400" /> System Metrics Telemetry
                  </h3>
                  <p className="text-xs text-zinc-500 font-mono">Real-time resource allocation and frame pacing</p>
                </div>

                <div className="flex items-center bg-[#09090b] border border-zinc-800 p-1 rounded-xl text-xs font-semibold text-zinc-400">
                  <button
                    onClick={() => setChartMetric('tps')}
                    className={`px-3 py-1 rounded-lg transition-colors font-mono ${
                      chartMetric === 'tps' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'hover:text-zinc-200'
                    }`}
                  >
                    TPS (20.0)
                  </button>
                  <button
                    onClick={() => setChartMetric('cpu')}
                    className={`px-3 py-1 rounded-lg transition-colors font-mono ${
                      chartMetric === 'cpu' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'hover:text-zinc-200'
                    }`}
                  >
                    CPU Usage
                  </button>
                  <button
                    onClick={() => setChartMetric('ram')}
                    className={`px-3 py-1 rounded-lg transition-colors font-mono ${
                      chartMetric === 'ram' ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'hover:text-zinc-200'
                    }`}
                  >
                    RAM Alloc
                  </button>
                </div>
              </div>

              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={performanceHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTps" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                      </linearGradient>
                      <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="time" stroke="#71717a" fontSize={11} tickLine={false} />
                    <YAxis stroke="#71717a" fontSize={11} domain={chartMetric === 'tps' ? [15, 20.5] : [0, 'dataMax + 5']} tickLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '12px', fontSize: '12px' }} />
                    {chartMetric === 'tps' && (
                      <Area type="monotone" dataKey="tps" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorTps)" name="TPS" />
                    )}
                    {chartMetric === 'cpu' && (
                      <Area type="monotone" dataKey="cpu" stroke="#06b6d4" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCpu)" name="CPU %" />
                    )}
                    {chartMetric === 'ram' && (
                      <Area type="monotone" dataKey="ram" stroke="#a855f7" strokeWidth={2.5} fillOpacity={1} fill="url(#colorRam)" name="RAM (GB)" />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Power Toggle Button Card */}
            <div
              onClick={onToggleServerPower}
              className={`lg:col-span-4 rounded-3xl p-8 flex flex-col justify-center items-center gap-4 cursor-pointer transition-all shadow-xl group ${
                activeServer.status === 'online'
                  ? 'bg-[#18181b] border border-rose-800/80 text-rose-300 hover:bg-rose-950/40'
                  : 'bg-emerald-500 text-[#09090b] hover:bg-emerald-400'
              }`}
            >
              <div className="bg-[#09090b] p-4 rounded-2xl group-hover:scale-110 transition-transform shadow-lg">
                {activeServer.status === 'online' ? (
                  <RotateCw className="w-8 h-8 text-rose-400" />
                ) : (
                  <Play className="w-8 h-8 text-emerald-400 fill-current ml-1" />
                )}
              </div>
              <div className="text-center">
                <span className="text-xl font-black uppercase tracking-widest block">
                  {activeServer.status === 'online' ? 'Restart / Stop' : 'Start Server'}
                </span>
                <span className="text-xs font-mono opacity-80 mt-1 block">
                  {activeServer.status === 'online' ? `${activeServer.type} • Port ${activeServer.port}` : 'Click to launch process'}
                </span>
              </div>
            </div>
          </div>

          {/* Active Players Bento Card */}
          <div className="bg-[#18181b] border border-zinc-800 rounded-3xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-400" />
                <h2 className="text-base font-extrabold text-zinc-100 tracking-tight">
                  Active Players Online ({players.length})
                </h2>
              </div>
              <span className="text-xs text-zinc-500 font-mono uppercase tracking-widest">
                Capacity: {activeServer.maxPlayers}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {players.map((p) => (
                <div
                  key={p.id}
                  className="bg-[#09090b] border border-zinc-800 hover:border-zinc-700 p-3.5 rounded-2xl space-y-2 relative group transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-zinc-900 border border-zinc-700 flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
                      <img
                        src={`https://mc-heads.net/avatar/${p.username}/36`}
                        alt={p.username}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <Gamepad2 className="w-5 h-5 text-zinc-500 hidden" />
                    </div>

                    <div className="overflow-hidden">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-zinc-100 truncate">{p.username}</span>
                        {p.isOp && (
                          <span className="px-1 text-[9px] font-mono font-bold uppercase text-amber-400 bg-amber-950/80 border border-amber-800/80 rounded">
                            OP
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-mono">
                        <span>{p.device}</span>
                        <span>•</span>
                        <span className="text-emerald-400">{p.pingMs}ms</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-zinc-400 font-medium truncate pt-1 border-t border-zinc-800/80 flex justify-between font-mono">
                    <span>{p.world}</span>
                    <span className="capitalize text-zinc-500">{p.gamemode}</span>
                  </div>

                  <div className="absolute inset-0 bg-[#09090b]/95 rounded-2xl p-2 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                    <button
                      onClick={() => onSendConsoleCommand(`tp ${p.username} 0 100 0`)}
                      className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-mono font-bold rounded-lg"
                    >
                      TP
                    </button>
                    <button
                      onClick={() => onSendConsoleCommand(`op ${p.username}`)}
                      className="px-2 py-1 bg-amber-950 hover:bg-amber-900 text-amber-300 border border-amber-800 text-[10px] font-mono font-bold rounded-lg"
                    >
                      OP
                    </button>
                    <button
                      onClick={() => onSendConsoleCommand(`kick ${p.username} Admin Action`)}
                      className="px-2 py-1 bg-rose-950 hover:bg-rose-900 text-rose-300 border border-rose-800 text-[10px] font-mono font-bold rounded-lg"
                    >
                      Kick
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live RCON Console Streamer Bento Card */}
          <div className="bg-[#18181b] border border-zinc-800 p-6 rounded-3xl shadow-2xl space-y-4 font-mono">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-sans">
                <Terminal className="w-5 h-5 text-emerald-400" />
                <h2 className="text-base font-extrabold text-zinc-100 tracking-tight">
                  Live Console Output
                </h2>
                <span className="px-2 py-0.5 text-[10px] bg-[#09090b] text-emerald-400 border border-zinc-800 rounded font-mono">
                  RCON ONLINE
                </span>
              </div>

              <button
                onClick={() => onNavigateTab('monitoring')}
                className="text-xs text-zinc-400 hover:text-emerald-400 font-sans font-semibold flex items-center gap-1 transition-colors"
              >
                Full Console <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="bg-[#09090b] border border-zinc-800 p-4 rounded-2xl h-44 overflow-y-auto space-y-1.5 text-xs text-zinc-300 shadow-inner font-mono">
              {consoleLogs.slice(-10).map((log) => (
                <div key={log.id} className="leading-relaxed flex items-start gap-2">
                  <span className="text-zinc-600 shrink-0 font-sans text-[10px]">{log.timestamp}</span>
                  {log.type === 'INFO' && <span className="text-emerald-400 font-bold shrink-0">[INFO]</span>}
                  {log.type === 'WARN' && <span className="text-amber-400 font-bold shrink-0">[WARN]</span>}
                  {log.type === 'ERROR' && <span className="text-rose-400 font-bold shrink-0">[ERROR]</span>}
                  {log.type === 'CHAT' && <span className="text-blue-400 font-bold shrink-0">[CHAT]</span>}
                  {log.type === 'ACTION' && <span className="text-purple-400 font-bold shrink-0">[AI ACTION]</span>}
                  <span className={log.type === 'CHAT' ? 'text-blue-200 font-medium' : log.type === 'ACTION' ? 'text-purple-200 font-semibold' : ''}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>

            <form onSubmit={handleCommandSubmit} className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-2.5 text-zinc-500 font-bold">$</span>
                <input
                  type="text"
                  value={commandInput}
                  onChange={(e) => setCommandInput(e.target.value)}
                  placeholder="Send server command (e.g. op JonoB, time set day)..."
                  className="w-full bg-[#09090b] border border-zinc-800 focus:border-emerald-500 rounded-xl pl-7 pr-3 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none"
                />
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-[#09090b] font-black rounded-xl text-xs font-sans transition-colors"
              >
                Execute
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
