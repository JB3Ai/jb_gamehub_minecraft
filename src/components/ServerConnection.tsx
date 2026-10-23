import React, { useEffect, useRef, useState } from "react";
import type { ServerInventoryItem } from "../dashboard/types";
import { connectionAddresses, writeConnectionClipboard } from "../dashboard/connectionExperience";

function CopyConnection({ value, label }: { value: string; label: "address" | "port" }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "manual">("idle");
  const input = useRef<HTMLInputElement>(null), busy = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (status === "manual") { input.current?.focus(); input.current?.select(); } }, [status]);
  const copy = async () => {
    if (busy.current) return;
    busy.current = true; setStatus("copying");
    const copied = await writeConnectionClipboard(value, navigator.clipboard, window.isSecureContext);
    if (mounted.current) setStatus(copied ? "copied" : "manual");
    busy.current = false;
  };
  return <div className="connection-copy"><button type="button" className="cmd-btn" disabled={status === "copying"} onClick={() => { void copy(); }}>Copy {label}</button>
    <span role="status" aria-live="polite">{status === "copied" ? `${label === "address" ? "Address" : "Port"} copied.` : status === "manual" ? "Copy unavailable. Select the value below and copy it manually." : ""}</span>
    {status === "manual" ? <label className="manual-copy">{label === "address" ? "Address" : "Port"} to copy manually<input ref={input} readOnly value={value} onFocus={event => event.currentTarget.select()} /></label> : null}
  </div>;
}

export function ServerConnection({ server, onRefresh }: { server: ServerInventoryItem; onRefresh: () => void }) {
  const endpoints = connectionAddresses(server);
  return <section className="home-connect" aria-label={`Connection instructions for ${server.name}`}>
    <h4>Connect</h4>
    {server.statusUnconfirmed ? <p className="connection-availability">These are saved connection details. Current server availability could not be confirmed.</p> : null}
    {!endpoints.length ? <><p>Connection information unavailable</p><small>A usable player address has not been supplied. Ask your administrator to check the approved endpoint.</small><button type="button" className="inline-link" onClick={onRefresh}>Refresh connection details</button></> : <>
      {server.status !== "online" ? <p className="connection-availability">{server.status === "offline" ? "Server is stopped. Use these saved details once it is running." : server.status === "starting" ? "Wait for Running before connecting." : server.status === "stopping" ? "Server is stopping. Players may be disconnected." : "Connection availability could not be confirmed. Refresh status before connecting."}</p> : null}
      {endpoints.map(endpoint => <div className="connection-option" key={`${endpoint.edition}:${endpoint.address}:${endpoint.port}`}>
        <p className="connection-edition">{endpoint.edition === "java" ? "Java Edition" : "Bedrock Edition"} · {endpoint.scope === "local" ? "This computer only" : endpoint.scope === "lan" ? "Local network" : "External address — reachability unverified"}</p>
        <p className="connection-address">{endpoint.address}</p>
        {endpoint.edition === "bedrock" ? <p>Port {endpoint.port}</p> : null}
        <small>{endpoint.scope === "local" ? "Only on the GameHub computer. A network address is not available." : endpoint.scope === "lan" ? "Connect from a device on the same local network. This is not a public internet address." : "This supplied address may require network configuration. GameHub has not verified public access."}</small>
        <div className="connection-copy-actions"><CopyConnection value={endpoint.address} label="address" />{endpoint.edition === "bedrock" ? <CopyConnection value={String(endpoint.port)} label="port" /> : null}</div>
        <details className="connection-help"><summary>How to connect with {endpoint.edition === "java" ? "Java" : "Bedrock"}</summary>
          {endpoint.edition === "java" ? <p>In Minecraft Java Edition, add a multiplayer server and enter the full server address shown above, including the port.</p> : <p>On a Bedrock device that supports adding servers, enter the address and port in their separate fields. Server entry options vary by device.</p>}
          <p>Share connection details only with people you trust. Server allowlists and family access rules still apply.</p>
        </details>
      </div>)}
    </>}
  </section>;
}
