import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LiveEventsPanel,
  OperationsPanel,
  SectionNavigation,
  ServersPanel,
  StatusPanel,
  WorldsPanel,
} from "../src/components/OperationalDashboard";
import { applyProviderEvent, createInitialDashboardState, reduceConnectionState } from "../src/dashboard/state";
import { DashboardState, OperationRecord, ServerInventoryItem, WorldRuntime } from "../src/dashboard/types";

const sampleServer: ServerInventoryItem = {
  id: "minecraft-main",
  providerId: "minecraft",
  name: "Minecraft Server",
  serverType: "Minecraft",
  status: "online",
  availability: true,
  lastStatusUpdate: "2026-08-08T08:08:12.548Z",
  endpoints: {
    java: "127.0.0.1:25565",
    bedrock: "127.0.0.1:19132",
  },
};

const sampleOperation: OperationRecord = {
  operationId: "op_123",
  type: "server.start",
  providerId: "minecraft",
  serverId: "minecraft-main",
  status: "completed",
  createdAt: "2026-08-08T08:07:56.915Z",
  startedAt: "2026-08-08T08:07:56.916Z",
  completedAt: "2026-08-08T08:07:57.934Z",
};

const sampleWorld: WorldRuntime = {
  id: "jb3-integration-test-world",
  name: "jb3-integration-test-world",
  validationState: "valid",
  validationResult: {
    valid: true,
    missingPacks: [],
    invalidPacks: [],
    errors: [],
  },
};

test("server discovery rendering shows provider and endpoints", () => {
  const html = renderToStaticMarkup(
    <ServersPanel servers={[sampleServer]} selectedServerId={sampleServer.id} onSelectServer={() => undefined} />,
  );

  assert.match(html, /minecraft/);
  assert.match(html, /127.0.0.1:25565/);
  assert.match(html, /127.0.0.1:19132/);
});

test("online and offline status rendering", () => {
  const onlineHtml = renderToStaticMarkup(<StatusPanel server={sampleServer} worldCount={1} wsState="connected" />);
  assert.match(onlineHtml, /ONLINE/);

  const offlineHtml = renderToStaticMarkup(
    <StatusPanel server={{ ...sampleServer, status: "offline", availability: false }} worldCount={1} wsState="connected" />,
  );
  assert.match(offlineHtml, /OFFLINE/);
});

test("operation rendering includes operation fields", () => {
  const html = renderToStaticMarkup(
    <OperationsPanel operations={[sampleOperation]} selectedServerId="minecraft-main" onCommand={() => undefined} />,
  );

  assert.match(html, /op_123/);
  assert.match(html, /server.start/);
  assert.match(html, /COMPLETED/);
});

test("websocket event consumption updates dashboard state", () => {
  const base = createInitialDashboardState();
  const state: DashboardState = {
    ...base,
    loading: false,
    servers: [{ ...sampleServer, status: "offline", availability: false }],
    selectedServerId: sampleServer.id,
  };

  const operationEvent = {
    type: "operation.created",
    timestamp: "2026-08-08T08:07:56.915Z",
    providerId: "minecraft",
    serverId: "minecraft-main",
    operationId: "op_234",
    status: "queued",
    payload: {
      operationId: "op_234",
      type: "server.start",
      providerId: "minecraft",
      serverId: "minecraft-main",
      status: "queued",
      createdAt: "2026-08-08T08:07:56.915Z",
    },
  } as const;

  const withOperation = applyProviderEvent(state, operationEvent);
  assert.equal(withOperation.operations[0]?.operationId, "op_234");

  const withStatus = applyProviderEvent(withOperation, {
    type: "server.status.changed",
    timestamp: "2026-08-08T08:08:12.548Z",
    providerId: "minecraft",
    serverId: "minecraft-main",
    status: "online",
  });

  assert.equal(withStatus.servers[0]?.status, "online");
});

test("websocket reconnect state transitions", () => {
  assert.equal(reduceConnectionState("connecting", "socket_open"), "connected");
  assert.equal(reduceConnectionState("connected", "socket_retry"), "reconnecting");
  assert.equal(reduceConnectionState("reconnecting", "socket_close"), "disconnected");
});

test("world rendering includes validation summary", () => {
  const html = renderToStaticMarkup(<WorldsPanel worlds={[sampleWorld]} onValidate={() => undefined} />);
  assert.match(html, /jb3-integration-test-world/);
  assert.match(html, /Valid: true/);
});

test("failed operation rendering shows failure information", () => {
  const failed: OperationRecord = {
    ...sampleOperation,
    operationId: "op_fail",
    status: "failed",
    error: {
      code: "SERVER_START_FAILED",
      message: "Start command failed",
    },
  };

  const html = renderToStaticMarkup(
    <OperationsPanel operations={[failed]} selectedServerId="minecraft-main" onCommand={() => undefined} />,
  );

  assert.match(html, /FAILED/);
  assert.match(html, /Start command failed/);
});

test("responsive navigation renders section controls", () => {
  const html = renderToStaticMarkup(<SectionNavigation activePanel="servers" onSelect={() => undefined} />);
  assert.match(html, /aria-label="Toggle sections"/);
  assert.match(html, /SERVERS/);
  assert.match(html, /LIVE EVENTS/);
});

test("live events panel renders expected event types", () => {
  const html = renderToStaticMarkup(
    <LiveEventsPanel
      events={[
        {
          type: "operation.created",
          timestamp: "2026-08-08T08:07:56.915Z",
          providerId: "minecraft",
          serverId: "minecraft-main",
          operationId: "op_1",
        },
      ]}
    />,
  );

  assert.match(html, /operation.created/);
});
