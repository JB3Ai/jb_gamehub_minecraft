import { useEffect, useReducer, useRef, useState } from "react";
import { applyProvisioning, createProvisioningPlan, getProvisioningSetupOptions, preflightProvisioning, ProvisioningClientError } from "../dashboard/apiClient";
import type { CreateProvisioningRequest, SetupConfiguration, SetupProviderId } from "../dashboard/provisioningTypes";
import type { SetupWizardAction, SetupWizardState } from "./types";

export const initialSetupState = (generation = 0): SetupWizardState => ({ step: "choose-provider", configuration: { serverId: "", displayName: "", worldName: "" }, loading: false, approved: false, generation });
const sameJson = (a: unknown, b: unknown): boolean => {
  const ordered = (v: any): any => Array.isArray(v) ? v.map(ordered) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(key => [key, ordered(v[key])])) : v;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
};
export function setupWizardReducer(state: SetupWizardState, action: SetupWizardAction): SetupWizardState {
  if (action.generation < state.generation) return state;
  if (state.step === "provisioning" && !["APPLY_SUCCEEDED", "APPLY_FAILED"].includes(action.type)) return state;
  if ((state.applyFailure === "partial" || state.applyFailure === "unknown") && action.type !== "RESET" && action.type !== "OPEN") return state;
  if (state.step === "complete" && !["RESET", "OPEN", "COMPLETE"].includes(action.type)) return state;
  if (action.type === "RESET" || action.type === "OPEN") return initialSetupState(action.generation);
  const next = { ...state, generation: action.generation, ...(["SELECT_PROVIDER", "UPDATE_CONFIGURATION", "PLAN_STARTED", "CREDENTIAL_CHANGED"].includes(action.type) ? { approved: false, apply: undefined, applyFailure: undefined } : {}) };
  if (action.type === "APPROVAL_CHANGED") return state.step === "review" ? { ...next, approved: action.approved } : state;
  if (action.type === "APPLY_STARTED") return state.step === "review" && state.approved && state.plan && state.preflight?.status === "PASS" && state.preflight.creation ? { ...next, step: "provisioning", loading: true, approved: false, error: undefined } : state;
  if (action.type === "APPLY_SUCCEEDED" || action.type === "APPLY_FAILED") {
    if (state.step !== "provisioning") return state;
    const result = action.result, matches = result && result.providerId === state.configuration.providerId && result.serverId === state.configuration.serverId;
    if (action.type === "APPLY_SUCCEEDED" && matches && result.ownership === "MANAGED" && result.state === "PROVISIONED" && result.outcome === "applied" && !result.error && result.residuals.length === 0) return { ...next, step: "complete", loading: false, apply: result };
    const code = action.type === "APPLY_FAILED" ? action.code : undefined;
    const failure = matches && result.state === "PARTIALLY_ROLLED_BACK" ? "partial" : matches && result.state === "ROLLED_BACK" && result.residuals.length === 0 ? "rolled-back" : !result && action.type === "APPLY_FAILED" && (["PLAN_STALE", "APPROVAL_MISMATCH", "APPROVAL_REQUIRED", "POLICY_UNAVAILABLE"].includes(code ?? "") || action.status === 401 || action.status === 403) ? "recheck" : "unknown";
    const message = failure === "partial" ? "Setup stopped safely but cleanup is incomplete. An administrator must review the retained operation before retrying." : failure === "rolled-back" ? "Setup could not complete. No managed server was left behind." : failure === "recheck" ? "Approval is no longer valid or permitted. Recheck setup before approving again." : "GameHub could not confirm the provisioning outcome. An administrator must check this plan before another attempt. Do not submit it again.";
    return { ...next, step: "error", loading: false, apply: matches ? result : undefined, applyFailure: failure, error: { code, message } };
  }
  if (action.type === "COMPLETE") return state.step === "complete" ? initialSetupState(action.generation) : state;
  if (action.type === "OPTIONS_STARTED") return { ...next, loading: true, error: undefined };
  if (action.type === "CREDENTIAL_CHANGED") return { ...next, step: "choose-provider", options: undefined, plan: undefined, preflight: undefined, loading: false, error: undefined };
  if (action.type === "OPTIONS_LOADED") return { ...next, options: action.options, loading: false, error: undefined, step: "choose-provider" };
  if (action.type === "SELECT_PROVIDER") {
    const provider = state.options?.providers.find(p => p.providerId === action.providerId), profile = provider?.profiles.find(p => p.available);
    if (!profile?.requestDefaults) return state;
    return { ...next, step: "configure", loading: false, error: undefined, plan: undefined, preflight: undefined,
      configuration: { ...state.configuration, providerId: action.providerId, profileRef: profile.profileRef, serverId: profile.requestDefaults.serverId ?? action.serverId, worldName: state.configuration.providerId === action.providerId && state.configuration.profileRef === profile.profileRef ? state.configuration.worldName : profile.defaults.worldName ?? "" } };
  }
  if (action.type === "UPDATE_CONFIGURATION") {
    const profile = state.options?.providers.find(p => p.providerId === state.configuration.providerId)?.profiles.find(p => p.profileRef === action.patch.profileRef && p.available);
    if (action.patch.profileRef && !profile) return state;
    return { ...next, step: "configure", loading: false, error: undefined, plan: undefined, preflight: undefined, configuration: {
      ...state.configuration, ...action.patch, ...(profile ? { serverId: profile.requestDefaults?.serverId ?? action.serverId ?? state.configuration.serverId, worldName: profile.defaults.worldName ?? "" } : {}) } };
  }
  if (action.type === "BACK") return { ...next, step: state.step === "configure" || !state.options || !state.configuration.providerId ? "choose-provider" : "configure", loading: false, approved: false, apply: undefined, applyFailure: undefined, error: undefined, plan: undefined, preflight: undefined };
  if (action.type === "PLAN_STARTED") return { ...next, step: "preflight", loading: true, error: undefined, plan: undefined, preflight: undefined };
  if (action.type === "PLAN_CREATED") return state.step === "preflight" ? { ...next, plan: action.plan } : state;
  if (action.type === "PREFLIGHT_PASSED" && state.step === "preflight" && state.plan) {
    const creation = action.preflight.creation, config = state.configuration;
    if (action.preflight.status !== "PASS" || action.preflight.issues.some(i => i.severity === "blocking") || !creation || !/^[a-f0-9]{64}$/.test(creation.digest) || creation.ownership !== "MANAGED" || creation.serverId !== config.serverId || creation.profileId !== config.profileRef || creation.worldName !== config.worldName || creation.startup !== "remain-stopped" || !sameJson(creation.endpoints, state.plan.plan.request.endpoints)) return { ...next, step: "error", loading: false, preflight: undefined, error: { code: "INVALID_RESPONSE", message: "The setup check did not match your settings. Check setup again." } };
    return { ...next, step: "review", loading: false, preflight: action.preflight };
  }
  if (action.type === "PREFLIGHT_FAILED") return { ...next, step: "configure", loading: false, preflight: action.preflight, error: { code: "PREFLIGHT_FAILED", message: "Setup needs attention. Your settings have been kept; check them or ask your administrator." } };
  if (action.type === "ERROR") return { ...next, step: "error", loading: false, approved: false, error: action.error };
  return state;
}
export function setupRequestFromState(state: SetupWizardState): CreateProvisioningRequest {
  const c = state.configuration, profile = state.options?.providers.find(p => p.providerId === c.providerId)?.profiles.find(p => p.profileRef === c.profileRef && p.available), defaults = profile?.requestDefaults;
  if (!c.providerId || !c.profileRef || !defaults || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(c.serverId) || !c.displayName.trim() || c.displayName.length > 120 || !c.worldName.trim()) throw new Error("Enter a server name and world name using an available setup.");
  return { schemaVersion: 1, providerId: c.providerId, serverId: c.serverId, displayName: c.displayName, hostId: defaults.hostId,
    storage: { mode: "create", rootId: defaults.rootId }, endpoints: defaults.endpoints.map(e => ({ ...e, port: { ...e.port } })), providerOptions: { profileRef: c.profileRef, worldName: c.worldName } };
}
export interface SetupWizardApi {
  options: typeof getProvisioningSetupOptions; plan: typeof createProvisioningPlan; preflight: typeof preflightProvisioning;
  apply: typeof applyProvisioning;
}
const realApi: SetupWizardApi = { options: getProvisioningSetupOptions, plan: createProvisioningPlan, preflight: preflightProvisioning, apply: applyProvisioning };
export function useSetupWizard(isOpen: boolean, api: SetupWizardApi = realApi) {
  const [state, dispatch] = useReducer(setupWizardReducer, undefined, () => initialSetupState());
  const [accessKey, setAccessKey] = useState("");
  const request = useRef<{ generation: number; abort?: AbortController; busy: boolean }>({ generation: 0, busy: false });
  const draftId = useRef("");
  const applying = useRef(false);
  const submitted = useRef(false);
  const invalidate = () => { request.current.abort?.abort(); request.current.busy = false; return ++request.current.generation; };
  useEffect(() => {
    request.current.abort?.abort(); request.current.busy = false; const generation = ++request.current.generation;
    dispatch({ type: isOpen ? "OPEN" : "RESET", generation }); setAccessKey(""); draftId.current = ""; submitted.current = false;
    return () => { request.current.abort?.abort(); request.current.generation++; request.current.busy = false; };
  }, [isOpen]);
  useEffect(() => {
    if (state.step !== "provisioning") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.step]);
  const reportError = (generation: number, error: unknown) => {
    if (request.current.generation !== generation) return;
    dispatch({ type: "ERROR", generation, error: error instanceof ProvisioningClientError ? { code: error.code, message: error.message } : { message: "Setup could not be checked. Your settings have been kept; please try again." } });
  };
  const connect = async () => {
    if (!isOpen || request.current.busy) return;
    const generation = invalidate(), abort = new AbortController(); request.current.abort = abort; request.current.busy = true;
    dispatch({ type: "OPTIONS_STARTED", generation });
    try { const options = await api.options({ token: accessKey, signal: abort.signal }); if (generation === request.current.generation) dispatch({ type: "OPTIONS_LOADED", generation, options }); }
    catch (error) { reportError(generation, error); }
    finally { if (generation === request.current.generation) request.current.busy = false; }
  };
  const checkSetup = async () => {
    if (!isOpen || request.current.busy || !(state.step === "configure" || state.step === "error" && ["recheck", "rolled-back"].includes(state.applyFailure ?? ""))) return;
    submitted.current = false;
    const generation = invalidate(), abort = new AbortController(); request.current.abort = abort; request.current.busy = true;
    dispatch({ type: "PLAN_STARTED", generation });
    try {
      const input = setupRequestFromState(state), connection = { token: accessKey, signal: abort.signal }, planned = await api.plan(input, connection);
      if (generation !== request.current.generation) return;
      if (planned.plan.providerId !== input.providerId || planned.plan.serverId !== input.serverId || planned.plan.mode !== "create" || planned.plan.displayName !== input.displayName || planned.plan.request.providerOptions.profileRef !== input.providerOptions.profileRef || planned.plan.request.providerOptions.worldName !== input.providerOptions.worldName || planned.plan.request.hostId !== input.hostId || planned.plan.request.storage.rootId !== input.storage.rootId || !sameJson(planned.plan.request.endpoints, input.endpoints) || planned.plan.status === "expired") throw new ProvisioningClientError("INVALID_RESPONSE");
      if (!planned.plan.validation.valid || planned.plan.status === "blocked") {
        dispatch({ type: "PREFLIGHT_FAILED", generation, preflight: { status: "FAIL", issues: planned.plan.validation.errors } }); return;
      }
      dispatch({ type: "PLAN_CREATED", generation, plan: planned });
      const result = await api.preflight(planned.plan.planId, connection);
      if (generation === request.current.generation) dispatch({ type: result.status === "PASS" ? "PREFLIGHT_PASSED" : "PREFLIGHT_FAILED", generation, preflight: result });
    } catch (error) { reportError(generation, error); }
    finally { if (generation === request.current.generation) request.current.busy = false; }
  };
  const id = () => draftId.current ||= `family-${Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  const apply = async () => {
    if (!isOpen || request.current.busy || applying.current || submitted.current || state.step !== "review" || !state.approved || !state.plan || !state.preflight?.creation) return;
    const generation = invalidate(); submitted.current = true; applying.current = true; request.current.busy = true;
    dispatch({ type: "APPLY_STARTED", generation });
    try {
      const result = await api.apply({ planId: state.plan.plan.planId, digest: state.preflight.creation.digest, approved: true }, { token: accessKey });
      if (generation !== request.current.generation) return;
      const next = setupWizardReducer({ ...state, step: "provisioning", generation }, { type: "APPLY_SUCCEEDED", result, generation });
      dispatch({ type: "APPLY_SUCCEEDED", result, generation });
      return next.step === "complete" ? result : undefined;
    } catch (error) {
      if (generation === request.current.generation) dispatch({ type: "APPLY_FAILED", generation, ...(error instanceof ProvisioningClientError ? { code: error.code, status: error.status } : {}) });
    } finally { applying.current = false; if (generation === request.current.generation) request.current.busy = false; }
  };
  return { state, accessKey, apply, canClose: () => !applying.current,
    approve: (approved: boolean) => dispatch({ type: "APPROVAL_CHANGED", approved, generation: request.current.generation }),
    setAccessKey: (value: string) => { if (applying.current) return; invalidate(); setAccessKey(value); dispatch({ type: "CREDENTIAL_CHANGED", generation: request.current.generation }); }, connect, checkSetup,
    selectProvider: (providerId: SetupProviderId) => dispatch({ type: "SELECT_PROVIDER", providerId, serverId: id(), generation: invalidate() }),
    updateConfiguration: (patch: Partial<Pick<SetupConfiguration, "displayName" | "worldName" | "profileRef">>) => dispatch({ type: "UPDATE_CONFIGURATION", patch, serverId: id(), generation: invalidate() }),
    back: () => { if (!applying.current) dispatch({ type: "BACK", generation: invalidate() }); }, reset: () => { if (applying.current) return; setAccessKey(""); draftId.current = ""; dispatch({ type: state.step === "complete" ? "COMPLETE" : "RESET", generation: invalidate() }); } };
}
