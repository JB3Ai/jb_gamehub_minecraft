import React from "react";
import type { HostReadinessReport } from "../setup/hostReadiness";

export function HostReadinessResults({ report, loading }: { report?: HostReadinessReport; loading: boolean }) {
  return <section aria-label="Host readiness results" aria-busy={loading} className="mt-5">
    <p role="status" aria-live="polite" className="font-semibold">{loading ? "Checking host readiness…" : report ? `Overall: ${report.status === "PASS" ? "READY" : report.status === "WARNING" ? "READY WITH WARNINGS" : "BLOCKED"}` : "Connect to check the host before continuing."}</p>
    {report ? <ul className="mt-4 space-y-3">{report.checks.map(item => <li key={item.id} className="rounded-lg border border-slate-600 p-3 break-words">
      <p className="font-semibold"><span aria-hidden="true">{item.status === "PASS" ? "✓" : item.status === "WARNING" ? "!" : "×"} </span>{item.title} <span className="text-sm text-slate-400">— {item.status}</span></p>
      <p className="mt-1 text-slate-200">{item.message}</p>{item.remediation ? <p className="mt-2 text-sm text-slate-300">{item.remediation}</p> : null}
      {typeof item.details?.availableBytes === "string" && /^[0-9]+$/.test(item.details.availableBytes) ? <p className="mt-1 text-sm text-slate-300">{(Number(item.details.availableBytes) / 1024 ** 3).toFixed(1)} GiB available</p> : null}
      {typeof item.details?.version === "string" ? <p className="mt-1 text-sm text-slate-300">Version: {item.details.version}</p> : null}
    </li>)}</ul> : null}
    {report?.status === "WARNING" ? <p className="mt-4 text-sm text-slate-300">Review the warnings before continuing. They do not grant provisioning approval. Runtime setup and preflight still validate their own requirements.</p> : null}
  </section>;
}
