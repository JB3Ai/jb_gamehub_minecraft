import React, { useState } from 'react';
import {
  Globe,
  Download,
  Copy,
  Save,
  RotateCcw,
  Plus,
  Compass,
  Star,
  Upload,
  Layers,
  Sparkles,
  Check,
  Share2
} from 'lucide-react';
import { WorldItem } from '../types';

interface WorldLibraryViewProps {
  activeWorlds: WorldItem[];
  marketplaceWorlds: WorldItem[];
  onImportWorld: (world: WorldItem) => void;
  onDuplicateWorld: (id: string) => void;
  onRestoreBackup: (id: string) => void;
}

export const WorldLibraryView: React.FC<WorldLibraryViewProps> = ({
  activeWorlds,
  marketplaceWorlds,
  onImportWorld,
  onDuplicateWorld,
  onRestoreBackup,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'manager' | 'marketplace'>('manager');
  const [installingMarketplaceId, setInstallingMarketplaceId] = useState<string | null>(null);
  const [copiedSeed, setCopiedSeed] = useState<string | null>(null);

  const handleInstallMarketplaceWorld = (w: WorldItem) => {
    setInstallingMarketplaceId(w.id);
    setTimeout(() => {
      onImportWorld(w);
      setInstallingMarketplaceId(null);
      setActiveSubTab('manager');
    }, 1500);
  };

  const handleCopySeed = (seed: string) => {
    navigator.clipboard.writeText(seed);
    setCopiedSeed(seed);
    setTimeout(() => setCopiedSeed(null), 2000);
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="bg-[#18181b] border border-zinc-800 p-6 md:p-8 rounded-3xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="w-6 h-6 text-amber-400" />
            <h1 className="text-2xl font-black text-zinc-100 tracking-tight">World Manager & Community Marketplace</h1>
          </div>
          <p className="text-xs text-zinc-400 mt-1 font-mono">
            Import, backup, clone, duplicate, or deploy Adventure maps, Skyblock, Parkour, Cities, and Jurassic Worlds in 1 click.
          </p>
        </div>

        {/* Subtab Toggle */}
        <div className="bg-[#09090b] p-1 border border-zinc-800 rounded-2xl flex items-center text-xs font-mono font-semibold text-zinc-400">
          <button
            onClick={() => setActiveSubTab('manager')}
            className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all ${
              activeSubTab === 'manager'
                ? 'bg-amber-500 text-[#09090b] font-black shadow-md shadow-amber-500/20'
                : 'hover:text-zinc-200'
            }`}
          >
            <Globe className="w-4 h-4" /> Active Worlds ({activeWorlds.length})
          </button>
          <button
            onClick={() => setActiveSubTab('marketplace')}
            className={`px-4 py-2 rounded-xl flex items-center gap-2 transition-all ${
              activeSubTab === 'marketplace'
                ? 'bg-amber-500 text-[#09090b] font-black shadow-md shadow-amber-500/20'
                : 'hover:text-zinc-200'
            }`}
          >
            <Compass className="w-4 h-4" /> World Marketplace
          </button>
        </div>
      </div>

      {activeSubTab === 'manager' ? (
        /* Active Worlds View */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider">
              Loaded Server Dimensions & Worlds
            </h2>

            <button
              onClick={() => setActiveSubTab('marketplace')}
              className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-zinc-950 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-md shadow-amber-600/20"
            >
              <Plus className="w-4 h-4" /> Import from Marketplace
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {activeWorlds.map((w) => (
              <div
                key={w.id}
                className="bg-zinc-900 border border-zinc-800 hover:border-amber-900/60 rounded-2xl overflow-hidden shadow-xl flex flex-col justify-between transition-all group"
              >
                {/* World Banner Thumbnail */}
                <div className="h-32 relative overflow-hidden bg-zinc-950">
                  <img
                    src={w.thumbnail}
                    alt={w.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent"></div>

                  <div className="absolute top-3 right-3">
                    <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-zinc-950/80 border border-amber-800/80 rounded-md backdrop-blur-md">
                      {w.type}
                    </span>
                  </div>

                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                    <span className="text-sm font-extrabold text-zinc-100 font-mono tracking-tight drop-shadow">
                      {w.name}
                    </span>
                    {w.isDefault && (
                      <span className="px-2 py-0.5 text-[9px] font-black uppercase text-emerald-400 bg-emerald-950/90 border border-emerald-700/80 rounded">
                        Main Spawn
                      </span>
                    )}
                  </div>
                </div>

                {/* World Stats */}
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono text-zinc-400 bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80">
                    <div>
                      <span className="text-[10px] uppercase text-zinc-500 font-sans block">Size</span>
                      <span className="text-zinc-200 font-bold">{w.sizeMb} MB</span>
                    </div>
                    <div>
                      <span className="text-[10px] uppercase text-zinc-500 font-sans block">Loaded Chunks</span>
                      <span className="text-zinc-200 font-bold">{w.chunksLoaded}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
                    <span>Seed: {w.seed}</span>
                    <button
                      onClick={() => handleCopySeed(w.seed)}
                      className="text-amber-400 hover:underline flex items-center gap-1 font-sans text-[11px]"
                    >
                      {copiedSeed === w.seed ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedSeed === w.seed ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {/* Actions */}
                <div className="p-3 bg-zinc-950/80 border-t border-zinc-800/80 grid grid-cols-3 gap-2">
                  <button
                    onClick={() => onDuplicateWorld(w.id)}
                    className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-[11px] rounded-lg flex items-center justify-center gap-1 transition-colors"
                    title="Duplicate / Clone World"
                  >
                    <Copy className="w-3 h-3 text-amber-400" /> Duplicate
                  </button>
                  <button
                    onClick={() => onRestoreBackup(w.id)}
                    className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-[11px] rounded-lg flex items-center justify-center gap-1 transition-colors"
                    title="Create World Snapshot Backup"
                  >
                    <Save className="w-3 h-3 text-blue-400" /> Backup
                  </button>
                  <button
                    className="py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-[11px] rounded-lg flex items-center justify-center gap-1 transition-colors"
                    title="Export World Download"
                  >
                    <Download className="w-3 h-3 text-emerald-400" /> Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* World Marketplace View */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
              <Compass className="w-4 h-4 text-amber-400" /> Community Presets & Maps
            </h2>
            <span className="text-xs text-zinc-400">1-Click Deploy to Server</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {marketplaceWorlds.map((w) => {
              const isInstalling = installingMarketplaceId === w.id;
              return (
                <div
                  key={w.id}
                  className="bg-zinc-900 border border-zinc-800 hover:border-amber-900/60 rounded-2xl overflow-hidden shadow-xl flex flex-col justify-between transition-all group"
                >
                  <div className="h-36 relative overflow-hidden bg-zinc-950">
                    <img
                      src={w.thumbnail}
                      alt={w.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 opacity-80"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-transparent to-transparent"></div>

                    <div className="absolute top-3 right-3">
                      <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-300 bg-zinc-950/80 border border-amber-800/80 rounded-md backdrop-blur-md">
                        {w.type}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-bold text-zinc-100">{w.name}</h3>
                      <p className="text-[11px] text-zinc-500">By {w.author || 'Community Builder'}</p>
                    </div>

                    <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                      <div className="flex items-center gap-1 text-amber-400 font-bold">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        <span>{w.rating?.toFixed(1) || '4.9'}</span>
                      </div>
                      <span>{w.sizeMb} MB</span>
                    </div>
                  </div>

                  <div className="p-3 bg-zinc-950/80 border-t border-zinc-800/80">
                    <button
                      onClick={() => handleInstallMarketplaceWorld(w)}
                      disabled={isInstalling}
                      className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-zinc-950 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md shadow-amber-600/20 disabled:opacity-50"
                    >
                      <Download className={`w-3.5 h-3.5 ${isInstalling ? 'animate-spin' : ''}`} />
                      <span>{isInstalling ? 'Downloading & Deploying...' : 'Deploy to Server'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
