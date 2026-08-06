import React, { useState, useRef, useEffect } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  Zap,
  CheckCircle2,
  Sliders,
  Puzzle,
  Server,
  RefreshCw,
  Terminal,
  ShieldAlert,
  ArrowRight
} from 'lucide-react';
import { CopilotMessage, MinecraftServer } from '../types';

interface AiCopilotViewProps {
  activeServer: MinecraftServer;
  copilotMessages: CopilotMessage[];
  onSendCopilotPrompt: (prompt: string) => Promise<void>;
  isThinking: boolean;
}

export const AiCopilotView: React.FC<AiCopilotViewProps> = ({
  activeServer,
  copilotMessages,
  onSendCopilotPrompt,
  isThinking,
}) => {
  const [inputText, setInputText] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [copilotMessages, isThinking]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isThinking) return;
    const prompt = inputText.trim();
    setInputText('');
    await onSendCopilotPrompt(prompt);
  };

  const handlePresetClick = async (prompt: string) => {
    if (isThinking) return;
    await onSendCopilotPrompt(prompt);
  };

  const presetPrompts = [
    { label: "Increase render distance to 12", desc: "Modify server.properties view-distance" },
    { label: "Build me a cross-platform family server", desc: "Provision Paper 1.21.4 + Geyser Bedrock bridge" },
    { label: "Install CoreProtect and configure permissions", desc: "App store install & rollback logging" },
    { label: "Why is TPS dropping? Analyze logs", desc: "Live telemetry diagnosis & entity culling" },
    { label: "Backup server every night at 3 AM", desc: "Configure scheduled cloud snapshots" },
    { label: "Update all plugins to latest builds", desc: "Hot-reload EssentialsX, LuckPerms, WorldEdit" },
  ];

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="bg-[#18181b] border border-zinc-800 p-6 md:p-8 rounded-3xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-[#09090b] font-black text-2xl flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            <Bot className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-zinc-100 tracking-tight">JB AI Copilot Engine</h1>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-emerald-400 bg-emerald-950/80 border border-emerald-800 rounded-md">
                Gemini 3.6 Flash
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 font-mono">
              "Hey JB... Increase render distance, install CoreProtect, optimize lag, or build a cross-play server."
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-emerald-950/80 border border-emerald-800/80 px-4 py-2 rounded-xl text-xs text-emerald-300 font-mono font-bold shadow-inner">
          <Sparkles className="w-4 h-4 text-emerald-400 animate-spin-slow" />
          <span>Server RCON Synced</span>
        </div>
      </div>

      {/* Preset Command Prompt Chips */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
          Suggested AI Admin Commands
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {presetPrompts.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => handlePresetClick(preset.label)}
              disabled={isThinking}
              className="p-3 bg-zinc-900/90 hover:bg-emerald-950/40 border border-zinc-800 hover:border-emerald-700/60 rounded-xl text-left transition-all group cursor-pointer disabled:opacity-50"
            >
              <div className="text-xs font-bold text-zinc-200 group-hover:text-emerald-300 flex items-center justify-between">
                <span>"{preset.label}"</span>
                <ArrowRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-emerald-400 transition-colors shrink-0" />
              </div>
              <div className="text-[11px] text-zinc-500 mt-1">{preset.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Conversation History Box */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col h-[520px] overflow-hidden">
        {/* Messages Scroll Area */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          {copilotMessages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.sender === 'jb_ai' && (
                <div className="w-8 h-8 rounded-xl bg-emerald-950 border border-emerald-700 flex items-center justify-center shrink-0 shadow-md">
                  <Bot className="w-4 h-4 text-emerald-400" />
                </div>
              )}

              <div
                className={`max-w-2xl rounded-2xl p-4 text-xs leading-relaxed space-y-2 ${
                  msg.sender === 'user'
                    ? 'bg-emerald-600 text-zinc-950 font-medium rounded-tr-none shadow-lg shadow-emerald-600/20'
                    : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-none shadow-xl'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.text}</div>

                {/* Render Action Executed Badge if JB modified server properties */}
                {msg.actionExecuted && (
                  <div className="mt-3 p-3 bg-zinc-950/90 border border-emerald-700/80 rounded-xl text-emerald-300 space-y-1 font-mono">
                    <div className="flex items-center gap-1.5 font-bold font-sans text-xs text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>[ACTION EXECUTED] {msg.actionExecuted.type}</span>
                    </div>
                    <div className="text-[11px] text-zinc-400">{msg.actionExecuted.description}</div>
                  </div>
                )}

                <div className="text-[10px] opacity-60 text-right">{msg.timestamp}</div>
              </div>

              {msg.sender === 'user' && (
                <div className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 text-zinc-300 font-bold text-xs">
                  YOU
                </div>
              )}
            </div>
          ))}

          {isThinking && (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-950 border border-emerald-700 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-emerald-400 animate-spin" />
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl rounded-tl-none p-3.5 text-xs text-zinc-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400 animate-spin-slow" />
                <span>JB is analyzing server properties and executing commands...</span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 bg-zinc-900 border-t border-zinc-800">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder='Ask JB... "Increase render distance", "Install CoreProtect", "Why is TPS dropping?"'
              className="flex-1 bg-zinc-950 border border-zinc-700 focus:border-emerald-500 rounded-xl px-4 py-3 text-xs text-zinc-100 placeholder-zinc-500 outline-none shadow-inner"
            />
            <button
              type="submit"
              disabled={isThinking || !inputText.trim()}
              className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-bold rounded-xl text-xs flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/30 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send Prompt</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
