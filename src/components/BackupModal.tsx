import React, { useState } from 'react';
import { Save, CheckCircle2, RotateCcw, X, Download, ShieldCheck } from 'lucide-react';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverName: string;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  serverName,
}) => {
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [completedBackup, setCompletedBackup] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStartBackup = () => {
    setIsBackingUp(true);
    setTimeout(() => {
      setIsBackingUp(false);
      const filename = `backup-${serverName.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString().slice(-4)}.tar.gz`;
      setCompletedBackup(filename);
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#09090b]/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-[#18181b] border border-zinc-800 rounded-3xl max-w-md w-full p-6 sm:p-8 space-y-4 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-200 p-1 font-bold"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-950 border border-blue-700 flex items-center justify-center text-blue-400">
            <Save className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-zinc-100">Server Backup & Snapshot</h2>
            <p className="text-xs text-zinc-400">{serverName}</p>
          </div>
        </div>

        {completedBackup ? (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-950/80 border border-emerald-700/80 rounded-xl text-xs text-emerald-300 font-semibold space-y-1">
              <div className="flex items-center gap-2 text-emerald-400 font-bold">
                <CheckCircle2 className="w-4 h-4" /> Snapshot Created!
              </div>
              <p className="font-mono text-[11px] text-zinc-300">{completedBackup}</p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold rounded-xl"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              Creates an asynchronous, zero-downtime archive of all loaded worlds, plugin data, player profiles, and <code className="text-emerald-400">server.properties</code>.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleStartBackup}
                disabled={isBackingUp}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-zinc-100 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-md shadow-blue-600/30 disabled:opacity-50"
              >
                <Save className={`w-3.5 h-3.5 ${isBackingUp ? 'animate-spin' : ''}`} />
                <span>{isBackingUp ? 'Archiving World Data...' : 'Start Backup Now'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
