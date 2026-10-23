# JBGH-025 — Daily Operations

Status: **CLOSED / PASS** (2026-10-23)

025A, 025B, 025C and 025D are **CLOSED / PASS**. The milestone closes daily
operations UX using synthetic/disposable lifecycle acceptance and read-only
preservation of the existing 023C runtimes. Real first boot and player join remain
outside this acceptance boundary.

## 025A — Daily Operations Home

Status: **CLOSED / PASS** (2026-10-23)

The default dashboard Home answers which servers exist, whether they are running,
how to connect, what needs attention, and what recently happened. The existing
Servers, Status, Operations, Worlds, Content Library, Events, Analytics, Family,
Rewards and AI Studio panels remain available under **Advanced**.

### Presentation and actions

- One card per provider/server identity, with friendly server name and Java or
  Bedrock label. Home does not display ownership, policy, plan, profile or operation
  identifiers, trusted paths, hashes, or raw provider diagnostics in ordinary
  summaries. The 025C recovery disclosure deliberately retains command references.
- Online → Running / Stop Server; offline → Stopped / Start Server. Starting and
  stopping show progress with disabled controls. Unknown/error states offer status
  refresh, with lifecycle actions disabled. Stopped is healthy.
- Start has no confirmation. Stop and secondary Restart require confirmation with
  Cancel focused first, Escape cancellation, native modal focus containment, and
  focus return. Confirmation states that players may disconnect and a normal
  shutdown will be requested; it does not promise backups or saves.
- A confirmation rechecks current server state before dispatch. If the original
  button becomes disabled after confirmation, focus returns to Server details.
- Administrator connection is required where the existing server contract requires
  it. The existing in-memory administrator connection and REST/WebSocket mechanisms
  are reused; credentials are never put in Home diagnostics.

### Lifecycle orchestration

Home and advanced controls share `runCommand` / `runServerCommand`. Existing
provider-scoped lifecycle and status routes are used; there is no new backend API.
New actions, locks, observations, and selection use the pair `providerId/serverId`.
Legacy callers of the API client retain their existing URLs when no provider is
specified. A status event without provider identity cannot update ambiguous IDs.

Before POST, a synchronous per-server lock prevents duplicate activation even before
React rerenders. Queued/running lifecycle operations also disable matching cards.
The lock clears only after a terminal operation and a stable online/offline status
are observed. Actual observed lifecycle state remains visible while the operation
settles. A network error or mismatched observation cannot unlock an unconfirmed
operation. A rejected request shows a sanitized failure; a lost POST response keeps
the card locked and directs the operator to Operations. No automatic command replay
or force-cleanup action is offered. The completed 025C contract below adds session
recovery and explicit reviewed association for a missing operation reference.

WebSocket events update the same dashboard state. Five-second read-only polling
refreshes provider-scoped status and unresolved operation records, including commands
issued elsewhere. The next poll is scheduled after reads finish, avoiding overlapping
background polls. Disconnect/reconnect changes connection messaging, not server
lifecycle state. As hardened in 025C, failed reads preserve the last confirmed state,
mark its freshness unconfirmed, and disable lifecycle actions until refreshed.
GET polling never issues a lifecycle or provisioning command.

### Connection information, attention, and activity

Prefer structured provider connection endpoints, with a conservative legacy endpoint
fallback. Java shows host and port; Bedrock shows host and a separate port. Wildcard
bind addresses are not player destinations and show **Connection information
unavailable**. Loopback addresses are labeled **Only on the GameHub computer**.
No LAN address is inferred, substituted, or promised reachable.

Attention comes from failed commands, unknown status, dashboard retrieval failure,
or an unconnected administrator. Transient stream loss uses a small reconnect note.
Empty inventory offers Create Server; retrieval failure does not pretend inventory
is empty. Recent activity shows the latest five completed/failed lifecycle actions
or successful stopped CREATE results, with human-readable messages and relative
times plus exact accessible timestamps. Validation and internal events are omitted.

Create Server opens the existing 023/024 wizard. Durable onboarding READY skips host
configuration. Successful inventory refresh/Open Server returns to Home and selects
the created provider/server; CREATE remains stopped. Advanced panels are mounted
when opened, avoiding their optional data requests on the everyday Home surface.

### Acceptance boundary

Lifecycle interaction acceptance uses synthetic API/WebSocket responses and existing
fixture integration tests. No first boot is authorized for `java-023c-live` or
`bedrock-023c-live`. Real-host acceptance reads their persisted inventory/endpoint
definitions and observes process/port absence, renders that read-only projection,
navigates to details and the existing wizard, and compares before/after hashes.
It does not POST to either real server or run the real provisioning flow.

Preserve the real 023C runtime trees, ownership, managed definitions, claims,
acceptance databases, operator policy, and protected BDS source. No provisioning
core, lifecycle adapter, Family Service, licensing, or ownership contract changes.

### Regression and validation record

Slice validation across 2026-10-22–23; final milestone validation is recorded below.

| Gate | Result |
| --- | --- |
| Focused dashboard/lifecycle, wizard, onboarding and setup regressions | 145/145 PASS |
| Provider/API contracts | 5/5 PASS |
| TypeScript lint, production build, whitespace | PASS |
| Full suite | 620/621; sole failure is the known unrelated Content Library 422 |
| Chromium desktop 1280px, 390px and 320px | PASS |
| Keyboard, cancellation, confirmation, focus return and modal handling | PASS |
| WebSocket lifecycle/reconnect and read-only polling fallback | PASS |
| Empty Home → synthetic wizard CREATE → stopped card on Home | PASS |
| Durable READY skips repeat host onboarding | PASS |
| Read-only real 023C inventory/endpoint projection and advanced navigation | PASS |
| Real runtime trees, DB tables, ownership, claims and operator policy preserved | PASS |
| All 3,038 protected BDS source files unchanged | PASS |
| Real Java/BDS absent; 27061 TCP and 29242/29243 UDP free; no first boot | PASS |

Browser verification used the production Vite preview with regular Playwright
because the Browser plugin was unavailable. All normal paths had meaningful page
content, no framework overlay, no console/runtime errors, and no page overflow.
An intentionally aborted status read produced the expected network errors, disabled
unsafe actions, and recovered through Refresh. Lifecycle and CREATE responses were
synthetic: no production lifecycle/provisioning endpoint was contacted. Protected
host evidence used read-only SQLite access and content hashes before/after testing.
Private screenshots/logs are retained outside Git; no disposable evidence links are
embedded in this document.

Regression coverage includes:

- Default Home/empty state; all lifecycle states; unresolved operation locks;
  double activation; confirmation cancellation/approval; secondary Restart.
- Provider identity, WebSocket status updates/reconnect and polling fallback;
  failed/unknown state recovery; offline is healthy; filtered activity.
- Safe Java/Bedrock connection information, loopback/wildcards, no private diagnostics.
- Existing wizard handoff, READY skips host setup, advanced views preserved.
- Desktop, 390px and 320px; keyboard, Escape, modal containment and focus return.
- A terminal operation event missed by WebSocket is recovered through GET polling,
  including a command issued outside this page.
- An empty inventory refresh during administrator connection keeps the dashboard
  and its setup modal mounted, allowing first-server creation to complete.
- Contracts, focused regressions, lint/build/whitespace and full suite. The known
  unrelated Content Library native Bedrock plan failure (201 expected, 422 received)
  remains outside this slice and must be reported explicitly.

## 025B — Connection and Player Experience

Status: **CLOSED / PASS** (2026-10-23)

### Connection contract

`ServerConnection` uses provider-supplied structured play endpoints, with a
conservative legacy fallback only when structured endpoints are absent. An empty
structured list, an unavailable capability, unknown protocol, invalid port, or
unsafe/unusable host does not fall back to a guessed address. Java/Geyser servers
can show separate Java and Bedrock connections when the provider supplies both.

- Java shows the complete multiplayer address, including port and IPv6 brackets.
- Bedrock shows address and port separately, with separate Copy actions. Guidance
  acknowledges that adding servers depends on the Bedrock device.
- Loopback, including alternate IPv4 and IPv4-mapped IPv6 spellings, is labeled
  **This computer only**. It is never substituted with the browser hostname or a
  guessed LAN interface.
- Private/local addresses are labeled **Local network**. Other supplied IPs/DNS
  names are **External address — reachability unverified**. No NAT, public IP,
  forwarding, firewall change, or public reachability is discovered or promised.
- Wildcard/unspecified, multicast, broadcast, invalid, and unscoped link-local IPv6
  endpoints show **Connection information unavailable**, with a refresh path.
- Stopped servers retain saved connection instructions, explicitly gated on the
  server running. Starting/stopping/unknown states explain current availability.

Clipboard writes occur only on explicit user activation and copy only the selected
validated address or port. No clipboard reads occur in the app. Missing Clipboard
API, insecure context, and browser rejection produce a selected read-only manual
copy field. Success is announced only after `writeText` resolves; raw browser errors
are never shown. A changed endpoint/unmounted control ignores a late copy result.

### Player data and visibility

Counts remain provider-reported status observations. Missing, negative, fractional,
offline, and transitional counts show **Players: —**, not a fabricated zero. A
confirmed zero is **No players reported by the server**. Counts have observation
timestamps; reconnect labels the last reported count. Lifecycle changes clear old
counts so a restart cannot revive a prior player count.

**Who is playing** is opt-in and visible only to a connected host administrator.
It uses a new narrow, provider-neutral, read-only route:

```text
GET /api/providers/:providerId/servers/:serverId/players
```

This is the one audited HTTP gap: providers already implemented `getOnlinePlayers`,
but no safe player projection existed for the dashboard. The route:

- Reuses the existing administrator authorizer directly, with 401/403 rejection
  and `Cache-Control: no-store`; GET does not write authorization audit rows.
- Resolves the full provider/server pair, calls provider status directly, and
  never calls manager status persistence, provisioning, lifecycle or Family APIs.
- Returns only provider/server identity, `available | not-running | unsupported`,
  observation time, display names, and whether all names were available.
- Omits UUIDs/XUIDs, external account IDs, identity types, child/profile links,
  sessions, schedules, policy decisions, host paths, and raw diagnostics. Invalid,
  cross-server, raw numeric/UUID or unsafe names are hidden; partial lists are explicit.
- Bounds the response at 256 display names, times out at 2.5 seconds, and checks
  running state again after querying so a stop during the read discards the roster.

The UI fetches names only while that disclosure is open, the server is online,
and an administrator is connected. Five-second GET polling and explicit Refresh
players recover missed updates; a five-second client deadline handles transport
stalls. Closing, logout, identity changes, stop, or unmount abort pending work and
ignore late replies. Authentication failures stop automatic roster polling until
explicit refresh or reconnection. A list/count mismatch is explained as separate
observations; an unsupported, failed, incomplete or empty list is not conflated
with a confirmed zero count. Stream reconnection refreshes inventory/endpoints and
status as well as the open player view.

Host-administrator authorization is the existing visibility boundary. No new child
viewer or household-role policy is invented. Player presence never grants access,
implies policy permission, bypasses an allowlist, or exposes child mappings; the UI
states that Family rules still apply. Family Service and enforcement are unchanged.

### Acceptance boundary and validation

No real first boot or player join is authorized. API regression tests use isolated
providers/databases; the mounted endpoint is checked against unchanged SQLite
tables. Browser clipboard, player names, joins/leaves and reconnect cases use
synthetic data. Real 023C inventory is a read-only projection; both runtimes remain
stopped and receive no player-query, lifecycle, or provisioning request.

| Gate | Result |
| --- | --- |
| Combined connection/player, Home/lifecycle, wizard and onboarding regressions | 199/199 PASS |
| Provider/API contracts | 5/5 PASS |
| TypeScript lint, production build, whitespace | PASS |
| Full suite | 674/675; sole failure is the known unrelated Content Library 422 |
| Desktop 1280px, 390px, 320px, keyboard and clipboard feedback | PASS |
| Administrator-only roster, provider scope, timeout and late-reply/logout handling | PASS |
| Unsupported, unavailable, partial and empty list/count distinctions | PASS |
| Existing 025A lifecycle/confirmation/focus and stopped CREATE handoff browser regression | PASS |
| Real 023C stopped inventory, databases, ownership, claims, policy and trees preserved | PASS |
| All 3,038 protected BDS source files unchanged; no real first boot/player join | PASS |

Chromium used the production Vite preview through regular Playwright because the
Browser plugin was unavailable. Normal desktop/mobile paths had no console errors,
framework overlay or page overflow. Intentional provider/transport failures showed
only the expected network failure; UI errors never reflected raw diagnostics.
Clipboard success was checked against exact values, and denial/API absence exposed
selected manual-copy controls. No real backend lifecycle/provisioning call or game
server launch occurred; browser player data was synthetic. All evidence remains
outside Git, with no disposable local-evidence links in this document.

The added player refresh controls exposed a confirmation focus-return regression:
the prior generic inline-link selector could select a hidden link. Focus return now
targets the visible Server details action; the full 025A browser loop passed again
at all three viewports after that correction.

## 025C — Recovery, Failure & Confirmation UX

Status: **CLOSED / PASS** (2026-10-23)

### Command outcomes and recovery

The browser writes a per-provider/server intent before sending a lifecycle POST.
One explicit activation sends at most one POST. The POST deadline is ten seconds;
operation and status GET deadlines are five seconds. A transport error, timeout,
malformed response or server failure means **unknown outcome**, never success.
Aborting the browser request does not imply that the backend cancelled it.

An uncertain command disables duplicate Home and Advanced lifecycle actions. Its
attempt reference, request time, command and any returned operation reference stay
available in **Saved command details**. Only a matching terminal operation plus a
fresh stable server status releases the lock. Completed Start/Restart must observe
online; completed Stop must observe offline. A different stable result is a failure,
not success. A terminal operation with transitional/unavailable state stays locked.
An explicit HTTP rejection also needs fresh stable status before another action.
Retryable failures offer a new explicit action only after that check; no command is
ever replayed by polling, reconnect, refresh or reload.

Known operation references are reconciled using GET only, either through periodic
refresh or **Check outcome**. If the POST response was lost before a reference was
returned, status alone cannot identify that request's outcome. An administrator
must review Activity, enter its operation reference and explicitly confirm that it
belongs to this command. The client verifies provider, server, command, reference,
known operation state and a bounded request-time window (five seconds before through
two minutes after the saved request), rejecting unrelated/old references. Time is
an additional check, not automatic proof of association. Unverifiable references
leave actions locked. There is no force-clear, automatic association or cleanup UI.

The browser-session journal survives reload in the same tab/origin. It stores only
whitelisted identifiers and recovery metadata, never access keys, player names,
backend errors, paths or credentials. Invalid, unreadable or unwritable recovery
storage fails closed; the unreadable material is retained. A failed initial intent
write prevents POST entirely. Late responses after disposal cannot overwrite the
journal. This is tab-session recovery, not a durable host journal, cross-tab lock or
backend idempotency mechanism. Backend ownership/fencing contracts are unchanged.

### Observations and confirmation

No optimistic lifecycle state is assigned when a command is submitted. Home keeps
the backend-observed state and displays command progress separately. A failed status
read keeps the last confirmed state, flags it as unconfirmed, hides stale player
data and disables actions until rechecked. Older status reads, live events and
inventory responses cannot overwrite a newer observation. A connection interruption
changes connection messaging rather than inventing a lifecycle transition.

Home and Advanced Stop/Restart share the accessible confirmation dialog and state
guard. Cancel receives initial focus; Escape cancels without POST. Confirmation
rechecks the original provider/server and current state. Start remains an explicit
single activation. Error messages are fixed, user-safe text; Home, Operations and
operation-failure events never render raw backend diagnostics or credentials.

### Regression coverage

`tests/lifecycle-recovery.test.tsx` covers pre-POST intent persistence, session
restoration, lost replies, real client timeout classification, terminal operation
plus failed/wrong/transitional status, explicit rejection, reviewed reference
association, corrupt/inaccessible/quota-limited storage, late unmounted replies,
metadata projection, duplicate identities, stale reads/events/inventory and safe
rendering. Existing command, Home, player, connection, wizard and onboarding tests
remain part of milestone validation.

Browser acceptance at desktop/390px/320px exercises timeout/lost replies, known and
missing references across reload, reconnect without replay, unrelated reference
rejection, keyboard-reviewed recovery, failed status recheck, explicit new actions
after confirmed failure, rejection recovery and corrupt-session blocking. All
lifecycle responses and player data are synthetic; no real game server is started.

## 025D — Acceptance and parent closure review

Status: **CLOSED / PASS** (2026-10-23)

Acceptance only. No additional provisioning, onboarding, Smart Worlds, first-boot
or player-join capability is included. Real 023C runtimes are read-only inventory
projections and preservation subjects; lifecycle failure/recovery uses synthetic
providers and disposable fixture data. Final closure requires all milestone gates,
including real-host preservation. The sole known unrelated Content Library 422 is
the only full-suite failure and is explicitly outside JBGH-025.

### Final milestone validation

| Gate | Result |
| --- | --- |
| Focused Home, recovery, connection/player, dashboard/auth, wizard and host/onboarding regressions | 238/238 PASS |
| Provider/API contracts | 5/5 PASS |
| TypeScript lint, production build, whitespace | PASS |
| Full suite | 688/689; only the known unrelated Content Library 422 versus expected 201 |
| Home/connection/player UX at desktop 1280px, 390px and 320px | PASS |
| Keyboard, cancel/confirm, focus return, stale confirmation and duplicate prevention | PASS |
| Timeout/lost replies, GET-only reconciliation, reconnect and tab-session reload recovery | PASS |
| Safe failure versus unknown outcome, explicit retry after recheck, corrupt storage blocked | PASS |
| Synthetic empty-inventory wizard CREATE → completion → selected stopped server | PASS |
| Browser page identity, nonblank rendering, no framework overlay and normal-path console health | PASS |
| Real 023C stopped inventory/details rendering with zero lifecycle/provisioning requests | PASS |
| Real runtime trees, complete database tables, managed definitions, ownership, claims and policy unchanged | PASS |
| All 3,038 protected BDS source files unchanged | PASS |
| No Java/BDS launch or player join; TCP 27061 and UDP 29242/29243 free | PASS |

Final browser QA reran the Home, connection/player and recovery flows against the
production build. The Browser plugin was unavailable, so regular Playwright with
Chromium provided DOM, keyboard, screenshot, console and overflow evidence. Expected
synthetic network/503 failures were exercised deliberately; they produced sanitized
recovery UI rather than raw diagnostics. Other browsers and real player connections
are not claimed by this acceptance.

The closure review also found Advanced populated-table overflow at small widths.
Grid cards now shrink correctly, tables scroll inside their cards, and all Advanced
cards occupy the mobile width. Advanced Stop/Restart use the same confirmation and
locks as Home; focus falls back to Refresh if a disabled Advanced command cannot
receive it. Desktop/390px/320px checks passed after these corrections.

The final full-suite failure remains:
**Content Library API maps Bedrock plans to the configured native provider root**
(`tests/content-library-api.test.ts`, expected 201, received 422). It was not changed
or counted as green. The pre-existing CJS `import.meta` build warning also remains.

Preservation compares read-only inventories of the two real 023C runtime trees,
their complete database tables, operator policy and the protected source tree
before and after validation. All comparisons passed. Both real runtimes remained
stopped/MANAGED; no real configuration promotion, provisioning, boot or player join
occurred. Temporary browser helpers, screenshots and evidence remain outside Git;
the preview process was stopped after QA.

Provisioning core, provider lifecycle implementations, Family Service, licensing,
ownership and real-runtime approval boundaries remain unchanged. JBGH-025 closes
with A+B+C+D together; subsequent real first boot/player acceptance still requires
its own explicit authorization.
