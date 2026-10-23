import React, { useEffect, useRef, useState } from "react";
import { safeOperationReference, type CommandRecovery as RecoveryRecord } from "../dashboard/commandJournal";
import type { ServerKey } from "../dashboard/homeModel";

export function CommandRecovery({ record, message, authorized, onRecheck, onAssociate, onActivity }: {
  record: RecoveryRecord; message?: string; authorized: boolean;
  onRecheck: (key: ServerKey) => Promise<void> | undefined;
  onAssociate: (key: ServerKey, operationId: string, reviewed: boolean) => Promise<void> | undefined;
  onActivity: () => void;
}) {
  const [reference, setReference] = useState(""), [reviewed, setReviewed] = useState(false), [checking, setChecking] = useState(false);
  const busy = useRef(false);
  useEffect(() => { setReference(""); setReviewed(false); }, [record.attemptId]);
  const check = async (associate = false) => {
    if (busy.current || !authorized) return;
    busy.current = true; setChecking(true);
    try { if (associate) await onAssociate(record.key, reference.trim(), reviewed); else await onRecheck(record.key); }
    finally { busy.current = false; setChecking(false); }
  };
  return <section className="command-recovery" aria-label="Command recovery" aria-busy={checking}>
    <p role="status">{record.locked ? record.phase === "unknown" ? "Command outcome unknown" : "Command still in progress" : "Command did not complete as requested"}</p>
    {message ? <p>{message}</p> : null}
    {record.locked ? <p>Actions stay locked until the outcome and server state are checked. Reconnecting never sends this command again.</p> : <p>Server status has been checked. Any new action requires your approval.</p>}
    <details open={record.phase === "unknown"}><summary>Saved command details</summary>
      <p>Saved command reference: <code>{record.attemptId}</code></p>
      {record.operationId ? <p>Operation reference: <code>{record.operationId}</code></p> : <p>No operation reference was returned. Server status alone cannot establish this command's outcome.</p>}
      <p>Requested {record.command} at <time dateTime={record.submittedAt}>{new Date(record.submittedAt).toLocaleString()}</time></p>
      {record.locked && !record.operationId && !record.rejected ? <form onSubmit={event => { event.preventDefault(); void check(true); }}>
        <p>An administrator must review Activity and identify the operation belonging to this request. Unrelated or unverifiable references leave actions locked.</p>
        <label>Reviewed operation reference<input value={reference} maxLength={200} onChange={event => { setReference(event.target.value); setReviewed(false); }} autoComplete="off" spellCheck={false} /></label>
        <label className="reviewed-command"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I reviewed this operation in Activity and confirmed it belongs to this command.</label>
        <button type="submit" className="cmd-btn" disabled={!authorized || checking || !reviewed || !safeOperationReference(reference.trim())}>Check reviewed operation</button>
      </form> : null}
    </details>
    <div className="home-actions">{record.locked && (record.operationId || record.rejected) ? <button type="button" className="cmd-btn" disabled={!authorized || checking} onClick={() => { void check(); }}>Check outcome</button> : null}
      <button type="button" className="inline-link" onClick={onActivity}>Review activity</button>
    </div>
  </section>;
}
