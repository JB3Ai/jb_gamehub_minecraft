import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

/** Operator input is filtered: only ENTER is forwarded; control lines originate here. */
export function startAcceptanceClient(executable: string, args: string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: Readable;
  output?: Writable;
  timeoutMs?: number;
} = {}) {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  const input = options.input ?? process.stdin;
  const operator = createInterface({ input, terminal: false });
  const lines = createInterface({ input: child.stdout, terminal: false });
  const markers = new Set<string>();
  const listeners = new Set<() => void>();
  let failure: Error | undefined;
  let closed = false;
  let code: number | null = null;
  const notify = () => { for (const listener of listeners) listener(); };
  const fail = (error: Error) => { failure = error; notify(); };
  child.on("error", fail);
  child.stdin.on("error", fail);
  const completion = new Promise<void>((resolve) => child.once("close", (exitCode) => {
    closed = true;
    code = exitCode;
    notify();
    resolve();
  }));
  lines.on("line", (line) => {
    if (line === "JBGH_CLIENT_READY" || line === "JBGH_CLIENT_RECONNECTED") markers.add(line);
    notify();
  });
  child.stdout.on("data", (chunk) => (options.output ?? process.stdout).write(chunk));
  operator.on("line", (line) => {
    if (line === "" && !closed && child.stdin.writable) child.stdin.write("\n");
  });

  async function wait(description: string, ready: () => boolean): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        listeners.delete(check);
        if (error) reject(error); else resolve();
      };
      const check = () => {
        if (failure) finish(failure);
        else if (ready()) finish();
        else if (closed) finish(new Error(`Client helper exited with code ${code} before ${description}.`));
      };
      const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${description}.`)), options.timeoutMs ?? 120_000);
      listeners.add(check);
      check();
    });
  }

  return {
    child,
    waitForMarker: (marker: string) => wait(marker, () => markers.has(marker)),
    async confirmSession() {
      if (closed || failure || !child.stdin.writable) throw failure ?? new Error("Client helper is not writable.");
      await new Promise<void>((resolve, reject) => child.stdin.write("JBGH_SESSION_CONFIRMED\n", (error) => error ? reject(error) : resolve()));
    },
    async waitForExit() {
      await wait("client helper completion", () => closed);
      if (code !== 0) throw new Error(`Client helper exited with code ${code}.`);
    },
    async dispose() {
      operator.close();
      input.pause();
      if (!closed) child.kill("SIGKILL");
      await completion;
      lines.close();
      child.stdin.destroy();
    },
  };
}

/** The initial disconnect gate opens only after the real session assertion succeeds. */
export async function runAcceptanceClientPhase(
  client: ReturnType<typeof startAcceptanceClient>,
  phase: "initial" | "reconnect",
  assertActive: () => Promise<void>,
  afterActive: () => Promise<void> = async () => {},
): Promise<void> {
  try {
    await client.waitForMarker(phase === "initial" ? "JBGH_CLIENT_READY" : "JBGH_CLIENT_RECONNECTED");
    await assertActive();
    if (phase === "initial") await client.confirmSession();
    await afterActive();
    await client.waitForExit();
  } finally {
    await client.dispose();
  }
}
