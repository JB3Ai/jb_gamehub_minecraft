import React, { useEffect, useRef, useState } from "react";
import { useSetupWizard } from "../setup/useSetupWizard";
import type { SetupWizardState } from "../setup/types";
import { setupIssueMessage } from "../dashboard/apiClient";
import { canContinueReadiness } from "../setup/hostReadiness";
import { HostReadinessResults } from "./HostReadinessResults";
import { HostConfigurationStep } from "./HostConfigurationStep";

export interface NewServerModalProps {
  isOpen: boolean; onClose: () => void;
  intent?: "create" | "onboarding";
  onProvisioned?: (providerId: string, serverId: string, open: boolean) => Promise<void>;
}
export function SetupReview({ state }: { state: SetupWizardState }) {
  const creation = state.preflight?.creation;
  const provider = state.options?.providers.find(p => p.providerId === state.configuration.providerId);
  return <section aria-label="Setup review">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 break-words">
      <dt>Server type</dt><dd>{provider?.label}</dd>
      <dt>Server</dt><dd>{state.configuration.displayName}</dd>
      <dt>World</dt><dd>{creation?.worldName} <span className="text-slate-400">(created on first start)</span></dd>
      <dt>Setup check</dt><dd>Ready</dd>
      <dt>Ownership</dt><dd>Managed</dd>
      <dt>Startup</dt><dd>{creation?.startup === "remain-stopped" ? "Created stopped" : "Not confirmed"}</dd>
      <dt>Connections</dt><dd>{creation?.endpoints.map(e => e.transport.toUpperCase() + " " + e.port.value).join(", ")}</dd>
    </dl>
    <p id="setup-review-boundary" className="mt-5 text-slate-300">Create this managed server using the checked settings. It will remain stopped. Starting it is a separate action.</p>
  </section>;
}
export function SetupCompletion({ state }: { state: SetupWizardState }) {
  return <section aria-label="Created server summary"><p role="status">Server created</p><dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-3 break-words">
    <dt>Server type</dt><dd>{state.options?.providers.find(p => p.providerId === state.configuration.providerId)?.label}</dd>
    <dt>Server</dt><dd>{state.configuration.displayName}</dd><dt>World</dt><dd>{state.preflight?.creation?.worldName} (created on first start)</dd>
    <dt>Status</dt><dd>Ready to manage</dd><dt>Ownership</dt><dd>Managed</dd><dt>Startup</dt><dd>Created stopped</dd>
  </dl><p className="mt-4 text-slate-300">Your server is ready to manage. It has not been started.</p></section>;
}
export function NewServerModal({ isOpen, onClose, onProvisioned, intent = "create" }: NewServerModalProps) {
  const wizard = useSetupWizard(isOpen, undefined, intent), { state } = wizard;
  const [inventoryMessage, setInventoryMessage] = useState(""), [opening, setOpening] = useState(false);
  const [setupReference, setSetupReference] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement, current = dialog.current;
    current?.showModal();
    return () => { current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [isOpen]);
  useEffect(() => { if (isOpen) heading.current?.focus(); }, [isOpen, state.step]);
  if (!isOpen) return null;
  const close = () => { if (!wizard.canClose() || opening) return; wizard.reset(); setInventoryMessage(""); onClose(); };
  const refreshInventory = async (providerId: string, serverId: string, open: boolean) => {
    setOpening(true); setInventoryMessage("");
    try { if (!onProvisioned) throw new Error("Server summary is unavailable."); await onProvisioned(providerId, serverId, open); if (open) { wizard.reset(); onClose(); } }
    catch { setInventoryMessage("Your server was created, but its summary could not be refreshed. Open Server will check inventory again; it will not create another server."); }
    finally { setOpening(false); }
  };
  const config = state.configuration, provider = state.options?.providers.find(p => p.providerId === config.providerId);
  const titles = { "host-readiness": "Host readiness", "configure-host": "Configure host", "review-host": "Review host configuration", "saving-host": "Saving host configuration", "completing-onboarding": "Completing setup", "setup-complete": "GameHub is ready", "choose-provider": "Choose your server", configure: "Configure essentials", preflight: "Checking setup", review: "Review your setup", provisioning: "Creating server", complete: "Server summary", error: "Setup needs attention" };
  const hostFlow = ["host-readiness", "configure-host", "review-host", "saving-host", "completing-onboarding", "setup-complete"].includes(state.step);
  const steps = hostFlow ? ["host-readiness", "configure-host", "review-host", "saving-host", "completing-onboarding", "setup-complete"] : ["choose-provider", "configure", "preflight", "review", "provisioning", "complete"];
  const step = Math.max(1, steps.indexOf(state.step) + 1);
  const fieldClass = "w-full rounded-lg border border-slate-500 bg-slate-950 p-3 text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400";
  return <dialog ref={dialog} aria-labelledby="setup-title" onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => {
      if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
      const controls = Array.from((event.currentTarget as HTMLDialogElement).querySelectorAll<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex='0']"));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-slate-600 bg-slate-900 p-5 text-slate-100 shadow-xl backdrop:bg-slate-950/80 sm:p-7">
    <div className="mb-5 flex items-start justify-between gap-4">
      <div><p className="text-sm text-slate-400">{hostFlow ? "GameHub setup" : "Server setup"} · Step {step} of 6</p><h2 id="setup-title" ref={heading} tabIndex={-1} className="mt-2 text-2xl font-bold">{titles[state.step]}</h2></div>
      <button type="button" onClick={close} disabled={state.step === "provisioning" || state.step === "saving-host" || state.step === "completing-onboarding" || opening} className="cmd-btn min-h-11" aria-label="Close server setup">Close</button>
    </div>
    <ol aria-label="Setup steps" className="mb-6 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-300">
      {(hostFlow ? ["Host readiness", "Configure host", "Review", "Save settings", "Complete setup", "Done"] : ["Choose server", "Configure server", "Check setup", "Review server", "Create", "Complete"]).map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined}>{index + 1}. {label}</li>)}
    </ol>
    {state.error ? <div role="alert" className="mb-5 rounded-lg border border-red-400 p-3">{state.error.message}</div> : null}
    {state.hostSaved && state.hostView?.warnings?.length ? <ul aria-label="Saved host configuration warnings" className="mb-5 space-y-2 rounded-lg border border-amber-400 p-3" role="status">{state.hostView.warnings.map(code => <li key={code}>{code === "JAVA_PORT_OCCUPIED" ? "The Java default port is in use. Server preflight must select an approved available endpoint." : code === "BEDROCK_PORT_OCCUPIED" ? "The Bedrock default port is in use. Server preflight must select an approved available endpoint." : "Storage write access remains unverified; saving settings did not create a storage probe file."}</li>)}</ul> : null}
    {state.preflight?.issues.length ? <ul className="mb-5 list-inside list-disc text-slate-200">{state.preflight.issues.map((issue, index) => <li key={index}>{setupIssueMessage(issue.code)}</li>)}</ul> : null}
    {["configure-host", "review-host", "saving-host"].includes(state.step) ? <HostConfigurationStep wizard={wizard} /> : null}
    {state.step === "completing-onboarding" ? <section aria-busy="true"><p role="status" aria-live="polite">Checking current host readiness and confirming setup completion. No Minecraft server is being created or started.</p></section> : null}
    {state.step === "setup-complete" ? <section aria-label="GameHub setup complete"><p>Host configuration has been saved.</p><p className="mt-3">No Minecraft server has been created or started.</p>{state.onboarding?.configurationChanged ? <p className="mt-3">Host settings differ from the completed revision. Completion remains recorded; current readiness and provisioning checks still apply.</p> : null}<button type="button" className="cmd-btn mt-5 min-h-11" disabled={state.loading} onClick={close}>Continue to GameHub</button></section> : null}
    {(state.step === "host-readiness" || state.step === "error" && !state.applyFailure) ? <div className="space-y-4">
      <p>No installation, directory creation, database migration, provisioning or server start occurs during this check.</p>
      <form onSubmit={event => { event.preventDefault(); void wizard.connect(); }} className="space-y-3">
        <label htmlFor="setup-access-key" className="block">Administrator access key</label>
        <input id="setup-access-key" type="password" autoComplete="off" value={wizard.accessKey} onChange={event => wizard.setAccessKey(event.target.value)} className={fieldClass} aria-describedby="setup-access-help" required />
        <p id="setup-access-help" className="text-sm text-slate-400">Use your administrator access key. It stays only in this page's memory. Disconnect administrator or close the page to clear it.</p>
        <button type="submit" className="cmd-btn min-h-11" disabled={state.loading || !wizard.accessKey.trim()}>{state.loading ? "Checking…" : state.readiness || state.error ? "Recheck" : "Connect to GameHub"}</button>
      </form>
      <HostReadinessResults report={state.readiness} loading={state.loading} />
      <button type="button" className="cmd-btn min-h-11" disabled={state.loading || !canContinueReadiness(state.readiness)} onClick={() => { void wizard.continueReadiness(); }}>Continue</button>
    </div> : null}
    {state.step === "choose-provider" ? <div className="space-y-4">
      {state.options ? <form className="space-y-3 border-t border-slate-600 pt-4" onSubmit={event => { event.preventDefault(); void wizard.reconcile(setupReference.trim()).then(result => { if (result) return refreshInventory(result.providerId, result.serverId, false); }); }}>
        <label htmlFor="setup-reference" className="block">Existing setup reference</label>
        <input id="setup-reference" value={setupReference} onChange={event => setSetupReference(event.target.value)} className={fieldClass} autoComplete="off" aria-describedby="setup-reference-help" />
        <p id="setup-reference-help" className="text-sm text-slate-400">Lost the result of an earlier setup? Check its plan reference. This only reads the saved result; it does not create or start anything.</p>
        <button type="submit" className="cmd-btn min-h-11" disabled={state.loading || !setupReference.trim()}>{state.loading ? "Checking saved setup…" : "Check existing setup"}</button>
      </form> : null}
      {state.options ? <div className="grid gap-3 sm:grid-cols-2">{state.options.providers.map(option => {
        const available = option.profiles.some(profile => profile.available && profile.requestDefaults);
        return <button key={option.providerId} type="button" disabled={!available || state.loading} onClick={() => wizard.selectProvider(option.providerId)} className="min-h-20 rounded-lg border border-slate-500 p-4 text-left focus-visible:outline-2 focus-visible:outline-cyan-400 disabled:opacity-60">
          <span className="block font-semibold">{option.label}</span><span className="mt-2 block text-sm text-slate-400">{available ? "Create a managed server" : "Approved setup defaults need administrator configuration"}</span>
        </button>;
      })}</div> : null}
      {state.options?.providers.length === 0 ? <p>No approved Java or Bedrock setups are available. Ask your administrator to configure one.</p> : null}
      {state.error && config.providerId ? <button type="button" className="cmd-btn" onClick={wizard.back}>Back to settings</button> : null}
    </div> : null}
    {state.step === "configure" ? <form className="space-y-5" onSubmit={event => { event.preventDefault(); void wizard.checkSetup(); }}>
      <p>{provider?.label}</p>
      {(provider?.profiles.filter(p => p.available).length ?? 0) > 1 ? <div><label htmlFor="setup-profile" className="mb-2 block">Approved setup</label><select id="setup-profile" value={config.profileRef} onChange={event => wizard.updateConfiguration({ profileRef: event.target.value })} className={fieldClass}>{provider?.profiles.filter(p => p.available).map(profile => <option key={profile.profileRef} value={profile.profileRef}>{profile.label}</option>)}</select></div> : null}
      <div><label htmlFor="setup-server-name" className="mb-2 block">Server name</label><input id="setup-server-name" value={config.displayName} onChange={event => wizard.updateConfiguration({ displayName: event.target.value })} className={fieldClass} required maxLength={120} /></div>
      <div><label htmlFor="setup-world-name" className="mb-2 block">World name</label><input id="setup-world-name" value={config.worldName} onChange={event => wizard.updateConfiguration({ worldName: event.target.value })} className={fieldClass} required maxLength={128} /></div>
      <p className="text-sm text-slate-400">Connection settings come from the approved setup. Checking does not create or start a server.</p>
      <div className="flex flex-wrap gap-3"><button type="button" className="cmd-btn min-h-11" onClick={wizard.back}>Back</button><button type="submit" className="cmd-btn min-h-11" disabled={state.loading}>Check setup</button></div>
    </form> : null}
    {state.step === "preflight" ? <div><p role="status" aria-live="polite">Checking your settings with GameHub. No server is being created.</p><button type="button" className="cmd-btn mt-4 min-h-11" onClick={wizard.back}>Back to settings</button></div> : null}
    {state.step === "review" ? <form onSubmit={event => { event.preventDefault(); void wizard.apply().then(result => { if (result) return refreshInventory(result.providerId, result.serverId, false); }); }}>
      <SetupReview state={state} />
      <label className="mt-5 flex items-start gap-3"><input type="checkbox" checked={state.approved} onChange={event => wizard.approve(event.target.checked)} className="mt-1 size-5 shrink-0" />I approve creating this managed server with these checked settings.</label>
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" className="cmd-btn min-h-11" onClick={wizard.back}>Edit settings</button><button type="submit" className="cmd-btn min-h-11" disabled={!state.approved}>Create Server</button></div>
    </form> : null}
    {state.step === "provisioning" ? <section aria-label="Provisioning progress" aria-busy="true"><p role="status" aria-live="polite">Creating your managed server. Waiting for GameHub to confirm the result.</p><p className="mt-4">Keep this window open. Closing is disabled while creation is in progress. The server will remain stopped.</p><p className="mt-4 break-all text-sm text-slate-400">Plan: {state.plan?.plan.planId}</p></section> : null}
    {state.step === "error" && state.applyFailure ? <section aria-label="Provisioning failure"><p className="break-all">{state.apply ? `Operation: ${state.apply.operationId}` : `Plan: ${state.plan?.plan.planId}`}</p>
      <button type="button" className="cmd-btn mt-4 min-h-11" disabled={state.loading || !state.plan} onClick={() => { if (state.plan) void wizard.reconcile(state.plan.plan.planId).then(result => { if (result) return refreshInventory(result.providerId, result.serverId, false); }); }}>Check saved result</button>
      {state.applyFailure === "recheck" || state.applyFailure === "rolled-back" ? <button type="button" className="cmd-btn mt-4 min-h-11" onClick={() => { void wizard.checkSetup(); }}>Recheck setup</button> : <p className="mt-4">Keep this reference for your administrator. Cleanup and another provisioning attempt require operator review.</p>}
    </section> : null}
    {state.step === "complete" ? <div><SetupCompletion state={state} />{inventoryMessage ? <p role="alert" className="mt-4">{inventoryMessage}</p> : null}<div className="mt-5 flex flex-wrap gap-3"><button type="button" className="cmd-btn min-h-11" disabled={opening} onClick={() => { if (state.apply) void refreshInventory(state.apply.providerId, state.apply.serverId, true); }}>{opening ? "Refreshing summary…" : "Open Server"}</button><button type="button" className="cmd-btn min-h-11" onClick={close} disabled={opening}>Done</button></div></div> : null}
  </dialog>;
}
