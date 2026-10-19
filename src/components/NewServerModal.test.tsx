import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewServerModal, SetupReview, SetupCompletion } from "./NewServerModal";
import { initialSetupState } from "../setup/useSetupWizard";

test("setup shell exposes labelled dialog/connection and never renders old engine/version choices", () => {
  const html = renderToStaticMarkup(<NewServerModal isOpen onClose={() => {}} />);
  assert.match(html, /<dialog/); assert.match(html, /aria-labelledby="setup-title"/); assert.match(html, /aria-label="Setup steps"/);
  assert.match(html, /type="password"/); assert.match(html, /for="setup-access-key"/); assert.match(html, /Connect to GameHub/);
  for (const unsupported of ["Purpur", "Fabric", "Vanilla", "Geyser", "Latest Stable", "Deploy Server Now"]) assert.ok(!html.includes(unsupported));
  assert.equal(renderToStaticMarkup(<NewServerModal isOpen={false} onClose={() => {}} />), "");
});
test("review and completion present user-safe stopped result and escaped values", () => {
  const state = initialSetupState(); state.step = "review"; state.configuration = { providerId: "minecraft-bedrock", profileRef: "private-profile-reference", serverId: "internal-id", displayName: "Family <Server>", worldName: "Family World" };
  state.options = { providers: [{ providerId: "minecraft-bedrock", label: "Minecraft Bedrock", profiles: [] }] };
  state.preflight = { status: "PASS", issues: [], creation: { digest: "a".repeat(64), ownership: "MANAGED", profileId: "private-profile-reference", serverId: "internal-id", directoryName: "not-for-display", files: [], endpoints: [{ id: "game", protocol: "native-bds", transport: "udp", bindAddress: "0.0.0.0", port: { mode: "fixed", value: 29232 } }], worldName: "Family World", startup: "remain-stopped", deferredValidations: [] } };
  const html = renderToStaticMarkup(<SetupReview state={state} />);
  for (const expected of ["Minecraft Bedrock", "Family &lt;Server&gt;", "Family World", "Managed", "Created stopped", "UDP 29232", "It will remain stopped."]) assert.ok(html.includes(expected), expected);
  const complete = renderToStaticMarkup(<SetupCompletion state={state} />);
  for (const expected of ["Server created", "Ready to manage", "It has not been started.", "Managed"]) assert.ok(complete.includes(expected));
  for (const privateValue of ["private-profile-reference", "internal-id", "not-for-display", "a".repeat(64)]) assert.ok(!html.includes(privateValue));
});
