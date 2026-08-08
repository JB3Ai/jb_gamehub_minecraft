import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type http from "http";
import { startServer } from "../server";
import { DashboardEventStream } from "../src/dashboard/eventStream";
import { applyProviderEvent, createInitialDashboardState } from "../src/dashboard/state";
import { DashboardState, ProviderEvent } from "../src/dashboard/types";
import { StatusPanel, LiveEventsPanel } from "../src/components/OperationalDashboard";

process.env.NODE_ENV = "production";

const fixtureDir = path.resolve(process.cwd(), "tests/fixtures/minecraft-server");

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for condition"));
      }
    }, 25);
  });
}

test("backend websocket events drive dashboard state and UI", async () => {
  const apiPort = 3344;
  const javaPort = 45693;

  const heartbeatServer = net.createServer();
  const appServer = await startServer(apiPort, {
    minecraftServerDir: fixtureDir,
    minecraftHost: "127.0.0.1",
    minecraftJavaPort: javaPort,
    minecraftBedrockPort: 19132,
    minecraftStartCommand: "node -e \"process.exit(0)\"",
    minecraftStopCommand: "node -e \"process.exit(0)\"",
  });

  let state: DashboardState = createInitialDashboardState();

  const stream = new DashboardEventStream(
    `ws://127.0.0.1:${apiPort}/ws`,
    (event: ProviderEvent) => {
      state = applyProviderEvent(state, event);
    },
    (connection) => {
      state = { ...state, wsConnection: connection };
    },
  );

  try {
    const serversRes = await fetch(`http://127.0.0.1:${apiPort}/api/servers`);
    const serversBody = (await serversRes.json()) as { servers: DashboardState["servers"] };
    const selected = serversBody.servers[0];

    state = {
      ...state,
      loading: false,
      servers: serversBody.servers,
      selectedServerId: selected?.id,
    };

    stream.connect();
    await waitFor(() => state.wsConnection === "connected");

    const startRes = await fetch(`http://127.0.0.1:${apiPort}/api/servers/${selected.id}/start`, { method: "POST" });
    assert.equal(startRes.status, 202);

    await new Promise<void>((resolve, reject) => {
      heartbeatServer.listen(javaPort, "127.0.0.1", (err?: Error) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    const onlineStatusRes = await fetch(`http://127.0.0.1:${apiPort}/api/servers/${selected.id}/status`);
    assert.equal(onlineStatusRes.status, 200);

    await new Promise<void>((resolve, reject) => {
      heartbeatServer.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });

    const offlineStatusRes = await fetch(`http://127.0.0.1:${apiPort}/api/servers/${selected.id}/status`);
    assert.equal(offlineStatusRes.status, 200);

    await waitFor(
      () =>
        state.events.some((event) => event.type === "operation.created") &&
        state.events.some((event) => event.type === "server.status.changed" && event.status === "online") &&
        state.events.some((event) => event.type === "server.status.changed" && event.status === "offline"),
      7000,
    );

    const selectedServer = state.servers.find((server) => server.id === selected.id);
    const statusHtml = renderToStaticMarkup(
      React.createElement(StatusPanel, { server: selectedServer, worldCount: 0, wsState: state.wsConnection }),
    );
    const eventsHtml = renderToStaticMarkup(React.createElement(LiveEventsPanel, { events: state.events }));

    assert.match(statusHtml, /CONNECTED/);
    assert.match(statusHtml, /OFFLINE|ONLINE/);
    assert.match(eventsHtml, /operation.created/);
    assert.match(eventsHtml, /server.status.changed/);
  } finally {
    stream.disconnect();
    await closeServer(appServer);
  }
});
