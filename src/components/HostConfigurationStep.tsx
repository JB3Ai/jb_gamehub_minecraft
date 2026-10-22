import React from "react";
import type { useSetupWizard } from "../setup/useSetupWizard";
import { validHostSettings } from "../setup/hostConfiguration";

export function HostConfigurationStep({ wizard }: { wizard: ReturnType<typeof useSetupWizard> }) {
  const { state } = wizard, view = state.hostView, draft = state.hostDraft;
  const field = "w-full rounded-lg border border-slate-500 bg-slate-950 p-3 text-slate-100 focus-visible:outline-2 focus-visible:outline-cyan-400";
  if (state.step === "saving-host") return <section aria-busy="true"><p role="status" aria-live="polite">Saving host configuration. Keep this window open while GameHub confirms the revision.</p><p className="mt-4">No Minecraft server is being created or started.</p></section>;
  if (!view || !draft) return <section><p>Load the operator-approved host choices to continue.</p><button type="button" disabled={state.loading} className="cmd-btn mt-4 min-h-11" onClick={() => { void wizard.continueReadiness(); }}>{state.loading ? "Loading…" : "Reload configuration"}</button></section>;
  const label = (kind: keyof typeof view.choices, selected?: string) => !selected ? "Not selected" : view.choices[kind].find(choice => choice.id === selected)?.label ?? "Selection needs review";
  if (state.step === "review-host") return <section aria-label="Host configuration review">
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 break-words">
      <dt>Storage</dt><dd>{label("storage", draft.storageRootId)}</dd><dt>Database</dt><dd>{label("databases", draft.databaseLocationId)}</dd>
      <dt>Java</dt><dd>{label("java", draft.javaRuntimeId)}</dd><dt>Bedrock</dt><dd>{label("bedrock", draft.bedrockRuntimeId)}</dd>
      <dt>Java port</dt><dd>{draft.javaPort}</dd><dt>Bedrock port</dt><dd>{draft.bedrockPort}</dd><dt>Current revision</dt><dd>{view.revision}</dd>
    </dl>
    <p className="mt-5">This saves GameHub host settings only. No Minecraft server will be created or started.</p>
    <p className="mt-3 text-slate-300">Existing servers, ownership, approved provisioning profiles and license records stay unchanged. This step does not migrate the running database or verify storage writes.</p>
    <div className="mt-5 flex flex-wrap gap-3"><button type="button" className="cmd-btn min-h-11" onClick={wizard.backHost}>Back</button><button type="button" className="cmd-btn min-h-11" onClick={() => { void wizard.saveHost(); }}>Save configuration</button></div>
  </section>;
  return <form aria-label="Configure host" className="space-y-4" onSubmit={event => { event.preventDefault(); wizard.reviewHost(); }}>
    {state.hostSaved ? <p role="status">Host configuration saved at revision {view.revision}. No server was created or started.</p> : null}
    <p>Choose approved references. At least one runtime is required. Existing server configuration is preserved.</p>
    {([ ["storage", "storageRootId", "Managed storage"], ["databases", "databaseLocationId", "Database location"], ["java", "javaRuntimeId", "Java runtime"], ["bedrock", "bedrockRuntimeId", "Bedrock source (optional)"] ] as const).map(([kind, key, title]) => <div key={key}><label className="mb-2 block" htmlFor={"host-" + key}>{title}</label><select id={"host-" + key} className={field} disabled={state.loading} value={draft[key] ?? ""} onChange={event => wizard.editHost({ [key]: event.target.value || undefined })}>
      <option value="">{kind === "storage" || kind === "databases" ? "Choose a location" : "Not selected"}</option>{view.choices[kind].map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
    </select></div>)}
    {([ ["javaPort", "Default Java port"], ["bedrockPort", "Default Bedrock port"] ] as const).map(([key, title]) => <div key={key}><label className="mb-2 block" htmlFor={"host-" + key}>{title}</label><input id={"host-" + key} className={field} type="number" min={1} max={65535} required disabled={state.loading} value={Number.isNaN(draft[key]) ? "" : draft[key]} onChange={event => wizard.editHost({ [key]: event.target.valueAsNumber })} /></div>)}
    <p className="text-sm text-slate-300">Port availability is checked when saving. Conflicts warn and reserve no port; server preflight still enforces its approved endpoints. These defaults do not alter existing profiles.</p>
    {state.hostReloadRequired ? <p role="status">Reload the latest configuration before reviewing and saving again. Your entered choices will be kept for comparison.</p> : null}
    <div className="flex flex-wrap gap-3"><button type="button" className="cmd-btn min-h-11" disabled={state.loading} onClick={() => { void wizard.continueReadiness(); }}>Reload configuration</button><button type="submit" className="cmd-btn min-h-11" disabled={state.loading || state.hostReloadRequired || !validHostSettings(draft, view)}>Review configuration</button>{state.hostReloadRequired ? <button type="button" className="cmd-btn min-h-11" disabled={state.loading} onClick={wizard.checkOnboarding}>Check completion</button> : null}</div>
  </form>;
}
