const readline = require("node:readline");

const phase = process.env.JBGH_BDS_ACCEPTANCE_PHASE || "initial";
const host = process.env.JBGH_BDS_HOST || "127.0.0.1";
const port = process.env.JBGH_BDS_PORT || "19132";
const xuid = process.env.JBGH_BDS_XUID || "not-set";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(message) {
  return new Promise((resolve) => {
    rl.question(message, () => resolve());
  });
}

async function main() {
  console.log("");
  console.log("===============================================");
  console.log(" JB3 GameHub � Native Bedrock Live Acceptance");
  console.log("===============================================");
  console.log(`Phase: ${phase}`);
  console.log(`Server: ${host}:${port}`);
  console.log(`XUID configured: ${xuid !== "not-set" ? "yes" : "no"}`);
  console.log("");

  if (phase === "initial") {
    console.log("STEP 1 � INITIAL JOIN");
    console.log("");
    console.log("On the real Minecraft Bedrock client:");
    console.log(`  Connect to ${host}:${port}`);
    console.log("");
    console.log("Wait until Minecraft has fully joined/spawned.");
    console.log("");

    await ask("Press ENTER once the player is fully connected...");

    console.log("JBGH_CLIENT_READY");
    console.log("Operator confirmed client connected.");
    console.log("");
    console.log("Now disconnect/leave the server from Minecraft.");
    console.log("");

    await ask("Press ENTER once the player has disconnected...");

    console.log("[JBGH-021A CLIENT] Initial phase complete.");
    rl.close();
    process.exit(0);
  }

  if (phase === "reconnect") {
    console.log("STEP 2 � RECONNECT + ENFORCEMENT");
    console.log("");
    console.log("Reconnect with the SAME Minecraft/Xbox account.");
    console.log(`  Connect to ${host}:${port}`);
    console.log("");
    console.log("Stay connected.");
    console.log("GameHub will apply the DENY rule and BDS should kick the player.");
    console.log("");

    await ask("Press ENTER once the player is fully connected again...");

    console.log("JBGH_CLIENT_RECONNECTED");
    console.log("Operator confirmed client reconnected.");
    console.log("");
    console.log("Wait for GameHub to apply the DENY rule and BDS to kick the player.");

    await ask("Press ENTER only AFTER Minecraft shows that you were kicked/disconnected...");

    console.log("[JBGH-021A CLIENT] Enforcement phase complete.");
    rl.close();
    process.exit(0);
  }

  console.error(`[JBGH-021A CLIENT] Unknown phase: ${phase}`);
  rl.close();
  process.exit(1);
}

main().catch((error) => {
  console.error("[JBGH-021A CLIENT] Failed:", error);
  rl.close();
  process.exit(1);
});
