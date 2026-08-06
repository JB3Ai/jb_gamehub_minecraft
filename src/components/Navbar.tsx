import React from 'react';
import {
  Server,
  Terminal,
  Puzzle,
  Globe,
  Activity,
  Bot,
  Plus,
  Save,
  Power,
  ChevronDown,
  Sparkles,
  Wifi,
  ShieldCheck
} from 'lucide-react';
import { MinecraftServer, ServerStatus } from '../types';

interface NavbarProps {
  servers: MinecraftServer[];
  activeServer: MinecraftServer;
  setActiveServerId: (id: string) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenNewServerModal: () => void;
  onOpenBackupModal: () => void;
  onToggleServerPower: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  servers,
  activeServer,
  setActiveServerId,
  activeTab,
  setActiveTab,
  onOpenNewServerModal,
  onOpenBackupModal,
  onToggleServerPower,
}) => {
  const [isServerDropdownOpen, setIsServerDropdownOpen] = React.useState(false);

  const getStatusBadge = (status: ServerStatus) => {
    switch (status) {
      case 'online':
        return <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400"><span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> ONLINE</span>;
      case 'updating':
        return <span className="flex items-center gap-1 text-xs font-semibold text-amber-400"><span className="w-2 h-2 rounded-full bg-amber-500 animate-spin"></span> UPDATING</span>;
      case 'starting':
        return <span className="flex items-center gap-1 text-xs font-semibold text-blue-400"><span className="w-2 h-2 rounded-full bg-blue-500 animate-ping"></span> STARTING</span>;
      case 'stopped':
      case 'offline':
        return <span className="flex items-center gap-1 text-xs font-semibold text-rose-400"><span className="w-2 h-2 rounded-full bg-rose-500"></span> OFF</span>;
    }
  };

  const navTabs = [
    { id: 'dashboard', label: 'Dashboard', icon: Activity },
    { id: 'server_manager', label: 'Server Manager', icon: Server },
    { id: 'plugin_store', label: 'Plugin Store', icon: Puzzle, badge: '42' },
    { id: 'world_library', label: 'World Library', icon: Globe, badge: 'Market' },
    { id: 'monitoring', label: 'Monitoring', icon: Terminal },
    { id: 'ai_copilot', label: 'AI Copilot', icon: Bot, isHighlight: true },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#09090b]/90 backdrop-blur-md border-b border-zinc-800/80 shadow-2xl">
      {/* Top Main Navigation Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20 gap-4">
          {/* Logo & Tagline */}
          <div className="flex items-center gap-3.5">
            <div className="relative group cursor-pointer" onClick={() => setActiveTab('dashboard')}>
              <div className="bg-emerald-500 text-[#09090b] font-black text-2xl w-12 h-12 flex items-center justify-center rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.3)] group-hover:scale-105 transition-transform duration-200">
                JB³
              </div>
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-[#09090b] animate-pulse"></span>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xl text-zinc-100 tracking-tight">GameHub</span>
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 rounded-md">
                  v1.0.4-LTS
                </span>
              </div>
              <p className="text-xs text-zinc-500 hidden sm:block font-mono uppercase tracking-widest text-[10px] mt-0.5">
                One Platform. Every World.
              </p>
            </div>
          </div>

          {/* Active Server Switcher Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsServerDropdownOpen(!isServerDropdownOpen)}
              className="flex items-center gap-3 px-4 py-2 bg-[#18181b] hover:bg-zinc-800 border border-zinc-800 rounded-full text-left transition-all duration-150 shadow-inner group"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse"></span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-100 group-hover:text-emerald-400 transition-colors uppercase tracking-wider">
                    {activeServer.name}
                  </span>
                  <span className="text-[10px] text-zinc-400 bg-zinc-900 border border-zinc-700/80 px-1.5 py-0.5 rounded font-mono">
                    {activeServer.type} {activeServer.version}
                  </span>
                </div>
              </div>
              <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${isServerDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown Menu */}
            {isServerDropdownOpen && (
              <div className="absolute left-0 mt-2 w-80 bg-[#18181b] border border-zinc-700 rounded-2xl shadow-2xl z-50 overflow-hidden py-2 divide-y divide-zinc-800 animate-in fade-in slide-in-from-top-2 duration-150">
                <div className="px-3.5 py-2 text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest">
                  Select Active Minecraft Server
                </div>
                <div className="py-1">
                  {servers.map((srv) => (
                    <button
                      key={srv.id}
                      onClick={() => {
                        setActiveServerId(srv.id);
                        setIsServerDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between hover:bg-zinc-800/80 transition-colors ${
                        srv.id === activeServer.id ? 'bg-emerald-950/40 border-l-2 border-emerald-500' : ''
                      }`}
                    >
                      <div>
                        <div className="text-sm font-bold text-zinc-200">{srv.name}</div>
                        <div className="text-xs text-zinc-400 font-mono">
                          {srv.ip}:{srv.port} ({srv.type})
                        </div>
                      </div>
                      {getStatusBadge(srv.status)}
                    </button>
                  ))}
                </div>
                <div className="p-2 bg-[#09090b]/80">
                  <button
                    onClick={() => {
                      setIsServerDropdownOpen(false);
                      onOpenNewServerModal();
                    }}
                    className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-[#09090b] font-black rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors shadow-md shadow-emerald-500/20"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Deploy New Server Wizard
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Action Header Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenBackupModal}
              title="Create Instant Server Snapshot Backup"
              className="px-3.5 py-2 bg-[#18181b] hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 rounded-xl text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-sm"
            >
              <Save className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden md:inline">Backup</span>
            </button>

            <button
              onClick={onToggleServerPower}
              title={activeServer.status === 'online' ? 'Stop Server' : 'Start Server'}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-md ${
                activeServer.status === 'online'
                  ? 'bg-rose-950/90 hover:bg-rose-900 border border-rose-800/80 text-rose-200'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-[#09090b] shadow-[0_0_20px_rgba(16,185,129,0.3)]'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{activeServer.status === 'online' ? 'Restart / Stop' : 'Start Server'}</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-2.5 no-scrollbar border-t border-zinc-800/80">
          {navTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-150 relative ${
                  isActive
                    ? tab.isHighlight
                      ? 'bg-emerald-500 text-[#09090b] shadow-[0_0_20px_rgba(16,185,129,0.3)] font-black'
                      : 'bg-[#18181b] text-emerald-400 border border-zinc-700 shadow-sm'
                    : tab.isHighlight
                    ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/50 hover:bg-emerald-900/40'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-[#18181b]'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive && !tab.isHighlight ? 'text-emerald-400' : ''}`} />
                <span>{tab.label}</span>

                {tab.badge && (
                  <span
                    className={`px-1.5 py-0.2 text-[10px] rounded-full font-mono font-bold ${
                      isActive
                        ? 'bg-[#09090b]/40 text-emerald-300'
                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}

                {tab.isHighlight && !isActive && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
