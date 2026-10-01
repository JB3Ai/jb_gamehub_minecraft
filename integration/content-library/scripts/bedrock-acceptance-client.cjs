const bedrock = require("bedrock-protocol");

const host = process.env.JBGH_BDS_HOST || "127.0.0.1";
const port = Number(process.env.JBGH_BDS_PORT || "19132");
const phase = process.env.JBGH_BDS_ACCEPTANCE_PHASE || "initial";

console.log(`[BDS CLIENT] starting phase=${phase} host=${host} port=${port}`);

const client = bedrock.createClient({
  host,
  port,
  offline: false,
  raknetBackend: "jsp-raknet",
  profilesFolder: "./integration/minecraft-bedrock/auth",
});

let finished = false;

function finish(code = 0) {
  if (finished) return;
  finished = true;

  setTimeout(() => {
    process.exit(code);
  }, 250);
}

client.on("join", () => {
  console.log("[BDS CLIENT] joined server");
});

client.on("spawn", () => {
  console.log(`[BDS CLIENT] spawned phase=${phase}`);

  if (phase === "initial") {
    setTimeout(() => {
      console.log("[BDS CLIENT] initial phase complete; disconnecting");

      try {
        client.close();
      } catch {}

      finish(0);
    }, 8000);
  }
});

client.on("kick", (reason) => {
  console.log("[BDS CLIENT] kicked:", reason);
  finish(0);
});

client.on("close", () => {
  console.log("[BDS CLIENT] connection closed");

  if (phase === "reconnect") {
    finish(0);
  }
});

client.on("error", (error) => {
  console.error("[BDS CLIENT] error:", error);
  finish(1);
});

setTimeout(() => {
  console.error("[BDS CLIENT] timed out");

  try {
    client.close();
  } catch {}

  finish(1);
}, 120000);