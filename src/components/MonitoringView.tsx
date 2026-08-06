import React, { useState } from 'react';
import {
  Activity,
  Terminal,
  Cpu,
  HardDrive,
  Users,
  Shield,
  Search,
  Filter,
  Zap,
  TrendingUp,
  AlertTriangle,
  Layers,
  Globe
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts';
import { MinecraftServer, Player, ConsoleLog, PerformanceMetric } from '../types';

interface MonitoringViewProps {
  activeServer: MinecraftServer;
  players: Player[];
  consoleLogs: ConsoleLog[];
  performanceHistory: PerformanceMetric[];
  onSendConsoleCommand: (cmd: string) => void;
}

export const MonitoringView: React.FC<MonitoringViewProps> = ({
  activeServer,
  players,
  consoleLogs,
  performanceHistory,
  onSendConsoleCommand,
}) => {
  const [logFilter, setLogFilter] = useState<'ALL' | 'INFO' | 'WARN' | 'ERROR' | 'CHAT'>('ALL');
  const [logSearch, setLogSearch] = useState('');
  const [commandInput, setCommandInput] = useState('');

  const filteredLogs = consoleLogs.filter((l) => {
    const matchesType = logFilter === 'ALL' || l.type === logFilter;
    const matchesSearch = l.message.toLowerCase().includes(logSearch.toLowerCase());
    return matchesType && matchesSearch;
  });

  const handleCommandSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;
    onSendConsoleCommand(commandInput.trim());
    setCommandInput('');
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="bg-[#18181b] border border-zinc-800 p-6 md:p-8 rounded-3xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-6 h-6 text-emerald-400" />
            <h1 className="text-2xl font-black text-zinc-100 tracking-tight">Real-Time Telemetry & Console Monitor</h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1 font-mono">
            Live TPS graphs, CPU & RAM breakdown, chunk/entity counters, player ping distribution, and color-coded RCON console.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-[#09090b] border border-zinc-800 px-4 py-2 rounded-xl text-xs font-mono text-emerald-400">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>RCON Port 25575 Online</span>
        </div>
      </div>

      {/* Analytics Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* TPS & CPU Graph */}
        <div className="bg-zinc-900/90 border border-zinc-800 p-5 rounded-2xl shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" /> TPS & CPU Stability (20.0 Benchmark)
            </h2>
            <span className="text-xs font-mono text-emerald-400">20.0 TPS</span>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={performanceHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="tpsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="time" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} domain={[16, 20.5]} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '12px' }} />
                <Area type="monotone" dataKey="tps" stroke="#10b981" strokeWidth={2.5} fill="url(#tpsGrad)" name="TPS" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Player Latencies Bar Chart */}
        <div className="bg-zinc-900/90 border border-zinc-800 p-5 rounded-2xl shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-400" /> Active Player Ping Latencies (ms)
            </h2>
            <span className="text-xs font-mono text-blue-400">Avg 22ms</span>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={players} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="username" stroke="#71717a" fontSize={11} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#18181b', borderColor: '#3f3f46', borderRadius: '12px' }} />
                <Bar dataKey="pingMs" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Ping (ms)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Full-Page RCON Live Console Streamer */}
      <div className="bg-zinc-950 border border-zinc-800 p-6 rounded-2xl shadow-2xl space-y-4 font-mono">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 font-sans">
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-bold text-zinc-200">
              Interactive RCON Console Terminal
            </h2>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-48">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={logSearch}
                onChange={(e) => setLogSearch(e.target.value)}
                placeholder="Search logs..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-8 pr-2 py-1.5 text-xs text-zinc-200 outline-none"
              />
            </div>

            <div className="flex items-center bg-zinc-900 p-1 border border-zinc-800 rounded-lg text-xs font-semibold text-zinc-400">
              {(['ALL', 'INFO', 'WARN', 'ERROR', 'CHAT'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setLogFilter(type)}
                  className={`px-2 py-1 rounded transition-colors ${
                    logFilter === type ? 'bg-zinc-800 text-emerald-400 font-bold' : 'hover:text-zinc-200'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Console Box */}
        <div className="bg-zinc-900/90 border border-zinc-800/80 p-4 rounded-xl h-80 overflow-y-auto space-y-2 text-xs text-zinc-300 shadow-inner font-mono">
          {filteredLogs.map((log) => (
            <div key={log.id} className="leading-relaxed flex items-start gap-2">
              <span className="text-zinc-600 shrink-0 font-sans text-[10px]">{log.timestamp}</span>
              {log.type === 'INFO' && <span className="text-emerald-400 font-bold shrink-0">[INFO]</span>}
              {log.type === 'WARN' && <span className="text-amber-400 font-bold shrink-0">[WARN]</span>}
              {log.type === 'ERROR' && <span className="text-rose-400 font-bold shrink-0">[ERROR]</span>}
              {log.type === 'CHAT' && <span className="text-blue-400 font-bold shrink-0">[CHAT]</span>}
              {log.type === 'ACTION' && <span className="text-purple-400 font-bold shrink-0">[AI ACTION]</span>}
              <span className={log.type === 'CHAT' ? 'text-blue-200' : log.type === 'ACTION' ? 'text-purple-200 font-semibold' : ''}>
                {log.message}
              </span>
            </div>
          ))}
        </div>

        {/* Command Line Input */}
        <form onSubmit={handleCommandSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-2.5 text-zinc-500 font-bold">$</span>
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="Send server command (e.g. op Alex, time set day, weather clear, kick player)..."
              className="w-full bg-zinc-900 border border-zinc-800 focus:border-emerald-500 rounded-xl pl-7 pr-3 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold rounded-xl text-xs font-sans transition-colors shadow-md shadow-emerald-600/20"
          >
            Execute RCON
          </button>
        </form>
      </div>
    </div>
  );
};
