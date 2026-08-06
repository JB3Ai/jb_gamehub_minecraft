import React, { useState } from 'react';
import {
  Server,
  Layers,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  Smartphone,
  Shield,
  X
} from 'lucide-react';
import { ServerType } from '../types';

interface NewServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateServer: (serverData: { name: string; type: ServerType; version: string; geyserEnabled: boolean }) => void;
}

export const NewServerModal: React.FC<NewServerModalProps> = ({
  isOpen,
  onClose,
  onCreateServer,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [serverName, setServerName] = useState('Family Crossplay Hub');
  const [selectedType, setSelectedType] = useState<ServerType>('Paper');
  const [selectedVersion, setSelectedVersion] = useState('1.21.4');
  const [geyserEnabled, setGeyserEnabled] = useState(true);

  if (!isOpen) return null;

  const handleFinish = () => {
    onCreateServer({
      name: serverName,
      type: selectedType,
      version: selectedVersion,
      geyserEnabled,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#09090b]/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-[#18181b] border border-zinc-800 rounded-3xl max-w-xl w-full p-6 sm:p-8 space-y-6 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-200 p-1 font-bold"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Wizard Progress Steps */}
        <div>
          <div className="flex items-center justify-between text-xs font-bold text-zinc-400 mb-2">
            <span className={step >= 1 ? 'text-emerald-400' : ''}>1. Choose Type</span>
            <span className={step >= 2 ? 'text-emerald-400' : ''}>2. Choose Version & Name</span>
            <span className={step >= 3 ? 'text-emerald-400' : ''}>3. Crossplay & Done</span>
          </div>

          <div className="w-full bg-zinc-950 h-2 rounded-full overflow-hidden border border-zinc-800">
            <div
              className="bg-emerald-500 h-full transition-all duration-300"
              style={{ width: `${(step / 3) * 100}%` }}
            ></div>
          </div>
        </div>

        {/* Step 1: Choose Type */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-extrabold text-zinc-100 flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-400" /> Choose Minecraft Server Platform
            </h2>

            <div className="grid grid-cols-2 gap-3">
              {[
                { type: 'Paper', desc: 'Ultra high performance with plugins (Recommended)' },
                { type: 'Purpur', desc: 'Fork of Paper with custom gameplay tweaks' },
                { type: 'Fabric', desc: 'Modern lightweight modding framework' },
                { type: 'Vanilla', desc: 'Pure un-modded Mojang server' },
                { type: 'Bedrock', desc: 'Official Minecraft Bedrock server' },
                { type: 'Geyser Bridge', desc: 'Cross-play Java & Bedrock bridge' },
              ].map((item) => (
                <button
                  key={item.type}
                  onClick={() => setSelectedType(item.type as ServerType)}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    selectedType === item.type
                      ? 'bg-emerald-950 border-emerald-500 text-emerald-300 shadow-md'
                      : 'bg-zinc-950 border-zinc-800 hover:border-zinc-700 text-zinc-300'
                  }`}
                >
                  <div className="font-bold text-xs">{item.type}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{item.desc}</div>
                </button>
              ))}
            </div>

            <div className="pt-4 flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors"
              >
                Next: Choose Version <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Choose Version & Name */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-extrabold text-zinc-100">Name & Select Version</h2>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-300">Server Display Name</label>
              <input
                type="text"
                value={serverName}
                onChange={(e) => setServerName(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 focus:border-emerald-500 rounded-xl px-3.5 py-2.5 text-xs text-zinc-100 outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-300">Minecraft Version</label>
              <select
                value={selectedVersion}
                onChange={(e) => setSelectedVersion(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-xs text-zinc-100 outline-none"
              >
                <option value="1.21.4">1.21.4 (Latest Stable)</option>
                <option value="1.21.3">1.21.3</option>
                <option value="1.20.6">1.20.6</option>
                <option value="1.19.4">1.19.4</option>
                <option value="1.16.5">1.16.5 (Classic SMP)</option>
              </select>
            </div>

            <div className="pt-4 flex justify-between">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs rounded-xl"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors"
              >
                Next: Crossplay Settings <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-extrabold text-zinc-100 flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-blue-400" /> Bedrock Crossplay Bridge
            </h2>

            <div className="bg-zinc-950 p-4 border border-zinc-800 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-zinc-200">Enable Geyser Bridge</div>
                  <div className="text-[11px] text-zinc-400">Allow iOS, Android, Xbox, Switch players to join</div>
                </div>
                <button
                  type="button"
                  onClick={() => setGeyserEnabled(!geyserEnabled)}
                  className={`w-12 h-6 rounded-full p-1 transition-colors ${geyserEnabled ? 'bg-blue-600' : 'bg-zinc-800'}`}
                >
                  <div className={`w-4 h-4 bg-zinc-100 rounded-full transition-transform ${geyserEnabled ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </button>
              </div>
            </div>

            <div className="pt-4 flex justify-between">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs rounded-xl"
              >
                Back
              </button>
              <button
                onClick={handleFinish}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-black text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-lg shadow-emerald-600/30"
              >
                <CheckCircle2 className="w-4 h-4" /> Deploy Server Now
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
