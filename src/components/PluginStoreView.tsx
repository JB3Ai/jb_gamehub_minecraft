import React, { useState } from 'react';
import {
  Puzzle,
  Search,
  Star,
  Download,
  Check,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  Shield,
  Zap,
  Filter,
  Sparkles
} from 'lucide-react';
import { PluginItem } from '../types';

interface PluginStoreViewProps {
  plugins: PluginItem[];
  onInstallPlugin: (id: string) => void;
  onUpdatePlugin: (id: string) => void;
}

export const PluginStoreView: React.FC<PluginStoreViewProps> = ({
  plugins,
  onInstallPlugin,
  onUpdatePlugin,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedPluginDetail, setSelectedPluginDetail] = useState<PluginItem | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);

  const categories = ['All', 'Permissions', 'Security', 'WorldEdit', 'Economy', 'Crossplay', 'Optimization'];

  const filteredPlugins = plugins.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleInstallClick = (p: PluginItem) => {
    setInstallingId(p.id);
    setTimeout(() => {
      onInstallPlugin(p.id);
      setInstallingId(null);
    }, 1200);
  };

  const handleUpdateClick = (p: PluginItem) => {
    setInstallingId(p.id);
    setTimeout(() => {
      onUpdatePlugin(p.id);
      setInstallingId(null);
    }, 1200);
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="bg-[#18181b] border border-zinc-800 p-6 md:p-8 rounded-3xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Puzzle className="w-6 h-6 text-purple-400" />
            <h1 className="text-2xl font-black text-zinc-100 tracking-tight">Plugin Store & App Hub</h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1 font-mono">
            One-click installation for EssentialsX, LuckPerms, WorldEdit, CoreProtect, Geyser, and 10,000+ Spigot/Paper plugins.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-purple-950/60 border border-purple-800/60 px-3.5 py-2 rounded-xl text-xs text-purple-300 font-mono font-semibold">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <span>Auto-Dependency Resolver Active</span>
        </div>
      </div>

      {/* Search & Category Filter Controls */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#18181b] p-4 border border-zinc-800 rounded-2xl shadow-xl">
        {/* Search Bar */}
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search plugins (Essentials, WorldEdit, LuckPerms)..."
            className="w-full bg-[#09090b] border border-zinc-800 focus:border-purple-500 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none"
          />
        </div>

        {/* Category Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto no-scrollbar">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold whitespace-nowrap transition-all ${
                selectedCategory === cat
                  ? 'bg-purple-600 text-zinc-100 shadow-md shadow-purple-600/30 font-bold'
                  : 'bg-[#09090b] text-zinc-400 border border-zinc-800 hover:text-zinc-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Plugin Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredPlugins.map((p) => {
          const isInstalling = installingId === p.id;
          return (
            <div
              key={p.id}
              className="bg-[#18181b] border border-zinc-800 hover:border-purple-900/60 p-6 rounded-3xl shadow-xl space-y-4 flex flex-col justify-between transition-all group"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-950/80 border border-purple-800/80 flex items-center justify-center shrink-0 shadow-inner">
                      <Puzzle className="w-5 h-5 text-purple-400 group-hover:scale-110 transition-transform" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-1.5">
                        {p.name}
                        {p.status === 'update_available' && (
                          <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                        )}
                      </h3>
                      <p className="text-[11px] text-zinc-500 font-medium">By {p.author}</p>
                    </div>
                  </div>

                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase text-purple-300 bg-purple-950/80 border border-purple-800/80 rounded-md">
                    {p.category}
                  </span>
                </div>

                <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">
                  {p.description}
                </p>

                {/* Rating & Stats */}
                <div className="flex items-center gap-4 text-xs font-mono text-zinc-400">
                  <div className="flex items-center gap-1 text-amber-400 font-bold">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    <span>{p.rating.toFixed(1)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Download className="w-3.5 h-3.5 text-zinc-500" />
                    <span>{p.downloads}</span>
                  </div>
                  <div className="text-[10px] text-zinc-500">v{p.version}</div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between">
                <button
                  onClick={() => setSelectedPluginDetail(p)}
                  className="text-xs text-zinc-400 hover:text-purple-400 font-semibold transition-colors flex items-center gap-1"
                >
                  Inspect Config
                </button>

                {p.status === 'installed' ? (
                  <span className="px-3 py-1.5 bg-emerald-950/80 border border-emerald-800/80 text-emerald-400 rounded-xl text-xs font-bold flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" /> Installed (v{p.installedVersion})
                  </span>
                ) : p.status === 'update_available' ? (
                  <button
                    onClick={() => handleUpdateClick(p)}
                    disabled={isInstalling}
                    className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-zinc-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-md shadow-amber-600/20 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isInstalling ? 'animate-spin' : ''}`} />
                    <span>{isInstalling ? 'Updating...' : `Update (v${p.version})`}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleInstallClick(p)}
                    disabled={isInstalling}
                    className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-zinc-100 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-md shadow-purple-600/20 disabled:opacity-50"
                  >
                    <Download className={`w-3.5 h-3.5 ${isInstalling ? 'animate-spin' : ''}`} />
                    <span>{isInstalling ? 'Installing...' : '1-Click Install'}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Plugin Details Modal */}
      {selectedPluginDetail && (
        <div className="fixed inset-0 z-50 bg-zinc-950/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl relative">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-purple-950 border border-purple-700 flex items-center justify-center">
                  <Puzzle className="w-6 h-6 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-extrabold text-zinc-100">{selectedPluginDetail.name}</h3>
                  <p className="text-xs text-zinc-400">By {selectedPluginDetail.author} • v{selectedPluginDetail.version}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPluginDetail(null)}
                className="text-zinc-500 hover:text-zinc-200 text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              {selectedPluginDetail.description}
            </p>

            <div className="space-y-2 text-xs text-zinc-400 font-mono">
              <div className="flex justify-between">
                <span>Compatibility:</span>
                <span className="text-emerald-400 font-bold">Paper / Purpur / Spigot 1.21.4</span>
              </div>
              <div className="flex justify-between">
                <span>Total Downloads:</span>
                <span className="text-zinc-200">{selectedPluginDetail.downloads}</span>
              </div>
              <div className="flex justify-between">
                <span>Hot Reload Support:</span>
                <span className="text-purple-400 font-bold">Yes (No Server Restart Needed)</span>
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
              <button
                onClick={() => setSelectedPluginDetail(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs rounded-xl"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
