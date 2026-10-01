const readline = require("node:readline");

/** @param {{ input?: import('node:stream').Readable, output?: import('node:stream').Writable, phase?: string }} options */
function runHumanClient({ input = process.stdin, output = process.stdout, phase = process.env.JBGH_BDS_ACCEPTANCE_PHASE || "initial" } = {}) {
  const rl = readline.createInterface({ input, terminal: false });
  const say = (message) => output.write(`${message}\n`);
  let state = "join";
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      state = "done";
      rl.close();
      input.removeListener("error", fail);
      if (error) reject(error); else resolve();
    };
    const fail = (error) => finish(error);
    input.on("error", fail);
    rl.on("close", () => {
      if (state !== "done") finish(new Error("Input closed before human acceptance completed."));
    });
    rl.on("line", (line) => {
      if (state === "session") {
        if (line !== "JBGH_SESSION_CONFIRMED") return;
        state = "disconnect";
        say("Now disconnect/leave the server from Minecraft.");
        say("Press ENTER once the player has disconnected...");
      } else if (line === "" && state === "join") {
        // Arm the gate before publishing READY, including synchronous test streams.
        state = phase === "initial" ? "session" : "kick";
        say(phase === "initial" ? "JBGH_CLIENT_READY" : "JBGH_CLIENT_RECONNECTED");
        if (phase === "initial") {
          say("Stay connected while GameHub confirms the active family session.");
        } else {
          say("Wait for GameHub to apply the DENY rule and BDS to kick the player.");
          say("Press ENTER only AFTER Minecraft shows that you were kicked/disconnected...");
        }
      } else if (line === "" && (state === "disconnect" || state === "kick")) {
        say(`[JBGH-021A CLIENT] ${state === "kick" ? "Enforcement" : "Initial"} phase complete.`);
        finish();
      }
    });
    if (phase !== "initial" && phase !== "reconnect") {
      finish(new Error(`Unknown phase: ${phase}`));
      return;
    }
    say("JB3 GameHub - Native Bedrock Live Acceptance");
    say(`Connect to ${process.env.JBGH_BDS_HOST || "127.0.0.1"}:${process.env.JBGH_BDS_PORT || "19132"}`);
    if (phase === "reconnect") say("Reconnect with the SAME Minecraft/Xbox account. Stay connected.");
    say("Wait until Minecraft has fully joined/spawned.");
    say(phase === "initial" ? "Press ENTER once the player is fully connected..." : "Press ENTER once the player is fully connected again...");
  });
}

module.exports = { runHumanClient };

if (require.main === module) {
  runHumanClient().then(() => process.exit(0)).catch((error) => {
    console.error("[JBGH-021A CLIENT] Failed:", error);
    process.exit(1);
  });
}
