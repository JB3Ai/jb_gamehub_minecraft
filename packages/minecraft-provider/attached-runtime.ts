import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { MinecraftProvider } from "./index";
import type { AttachedRuntimeFactory } from "../provider-manager/scoped-runtime-provider";

/** Managed console only for explicitly attached existing runtimes; legacy shell commands are untouched. */
class AttachedJavaProvider extends MinecraftProvider {
  private child?: ChildProcess;
  constructor(private readonly server: string, private readonly root: string, private readonly java: string, private readonly artifact: string, providerId: string, host: string, port: number) {
    super({ serverId: server, providerId, serverDir: root, host: host === "0.0.0.0" ? "127.0.0.1" : host, javaPort: port });
  }
  async startServer(serverId: string) {
    if (serverId !== this.server) throw new Error("Unknown attached server.");
    if (!/^\s*eula\s*=\s*true\s*$/mi.test(await fs.readFile(path.join(this.root, "eula.txt"), "utf8"))) throw new Error("Existing Java runtime EULA acceptance is required.");
    if (this.child || (await super.getServerStatus(serverId)).status === "online") throw new Error("Runtime already running; refusing duplicate launch.");
    const child = spawn(this.java, ["-jar", this.artifact, "--nogui"], { cwd: this.root, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    this.child = child; child.stderr?.resume();
    child.once("exit", () => { if (this.child === child) this.child = undefined; });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", (error) => { this.child = undefined; reject(error); }); });
    return { simulated: false, message: "Attached Java process started." };
  }
  async stopServer(serverId: string) {
    if (serverId !== this.server) throw new Error("Unknown attached server.");
    const child = this.child;
    if (!child?.stdin?.writable) throw new Error("No managed Java console; an externally started runtime cannot be stopped by this attachment.");
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.off("exit", ended); reject(new Error("Java stop timed out; process retained.")); }, 30_000);
      const ended = () => { clearTimeout(timer); resolve(); }; child.once("exit", ended); child.stdin!.write("stop\n");
    });
    return { simulated: false, message: "Attached Java process stopped." };
  }
}
export const createAttachedJavaRuntime: AttachedRuntimeFactory = async (record, policy) => {
  const runtime = record.descriptor.manifest.find((artifact) => artifact.name === "runtime")!;
  const java = record.descriptor.manifest.find((artifact) => artifact.name === "java-runtime")!;
  const endpoint = record.descriptor.endpoints.find((item) => item.transport === "tcp");
  if (!runtime.relativePath || !java.reference || !policy.artifactLocations[java.reference] || !endpoint || endpoint.transport === "virtual" || endpoint.port.mode !== "fixed") throw new Error("Attached Java runtime metadata is incomplete.");
  return new AttachedJavaProvider(record.descriptor.serverId, record.descriptor.runtimeRoot, policy.artifactLocations[java.reference], path.join(record.descriptor.runtimeRoot, runtime.relativePath), record.descriptor.providerId, endpoint.bindAddress, endpoint.port.value);
};
