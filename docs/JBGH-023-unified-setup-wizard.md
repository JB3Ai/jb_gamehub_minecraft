# JBGH-023 — Unified Setup Wizard

Status: **JBGH-023 OPEN. 023A discovery/preflight and 023B apply/completion implemented; local fixture/browser acceptance PASS. 023C household/live hardening remains pending.**

Read-only UI/API audit completed 2026-10-19 against `c0d6d4d`; the 023A
implementation record below extends that checkpoint.
[JBGH-022](./JBGH-022-unified-server-provisioning.md) remains CLOSED / PASS.

## Goal

Provide one guided setup flow for creating a managed Java or Bedrock server
without requiring the user to understand provider internals, provisioning
manifests, filesystem ownership, or runtime implementation details.

## User flow

023A supplies discovery through Review. 023B adds explicit approval, managed
CREATE progress and completion using that same plan/preflight state machine.

1. Choose server type
2. Configure essentials
3. Validate setup
4. Review
5. Approve provisioning
6. Provision
7. Complete

## Wizard states

- choose-provider
- configure
- preflight
- review
- provisioning
- complete
- error

## Supported providers

### Java

- providerId: `minecraft`
- managed CREATE only
- approved managed-create profile
- server name
- world name
- endpoint defaults

### Bedrock

- providerId: `minecraft-bedrock`
- managed CREATE only
- approved RakNet profile
- server name
- world name
- endpoint defaults

## Architectural boundary

The wizard is a client of the existing provisioning API in the root React/Vite
application. It MUST NOT:

- create provider-specific filesystem logic
- reproduce provisioning validation in React
- construct trusted manifests
- mutate provisioning policy
- bypass authenticated provisioning routes
- add ADOPT flows
- add player acceptance
- add first-run host onboarding
- add content import
- add rewards/education flows

Provider-specific knowledge remains in providers/profiles. Existing registered
server selection remains dashboard behavior; completion hands off the created
provider/server identity to that existing inventory.

## Required behavior

The wizard:

- builds a provisioning request from user-safe inputs
- requests a plan
- executes preflight
- presents blocking issues before approval
- requires explicit approval before apply
- displays provisioning progress/result
- handles recoverable errors without losing entered configuration
- lands on the created server after success

## Acceptance

A non-technical user can create one managed Java server and one managed Bedrock
server using the same wizard flow, with provider-specific choices limited to the
minimum necessary configuration. 023A+B prove this locally with non-executable
approved fixture bundles. Household/live deployment acceptance remains for 023C.

## Stopped completion boundary

Creation finishes at the existing **PROVISIONED / MANAGED / stopped** boundary.
The summary is usable for viewing status, connection information and next actions;
it does not promise that the server is running or joinable. World name is an intent
until a separate authorized first boot creates/loads it. CREATE approval does not
authorize start, Bedrock boot policy or world writes through lifecycle operations.

## Non-goals

- Player acceptance, Family/rewards/education, advanced moderation and content import.
- First-run host onboarding, filesystem selection, licensing acquisition or consent
  collection, runtime downloads, new engines/transports and new provisioning powers.
- New ownership, claims, filesystem, rollback, runtime parsing or readiness logic.
- Automatic first boot, destructive recovery, delete/recreate, orphan adoption,
  firewall/NAT setup, remote hosts, or a new account/identity platform.
- A dashboard redesign or exposure of raw manifests, commands, paths, hashes and
  acceptance tokens as ordinary household decisions.

The known Content Library HTTP 422 remains outside this milestone. Any genuine API
gap discovered by the flow must be scoped as a small API projection/integration
change; it does not reopen JBGH-022 implementation or acceptance.

## Read-only frontend audit

| Inspected source | Current behavior | Wizard consequence |
|---|---|---|
| [App](../src/App.tsx), [main](../src/main.tsx) | The mounted application uses `useOperationalDashboard` and renders `OperationalDashboard`; development uses StrictMode. | Integrate through this active tree. Mutating requests must never run merely because a component mounts/renders. |
| [OperationalDashboard](../src/components/OperationalDashboard.tsx) | Header actions, server selection and operational panels; no mounted create-server flow. | Add a clear Create server entry in the header and server-empty state. Keep it available when optional dashboard panels fail. |
| [NewServerModal](../src/components/NewServerModal.tsx) | Unmounted three-step prototype with callback-only completion, fixed version choices and extra engines/Geyser toggles. | Do not treat it as an API-backed flow or reuse its choices/defaults. A new focused wizard replaces its product role. |
| [ServerManagerView](../src/components/ServerManagerView.tsx) | Unmounted broader configuration prototype, including raw properties and unsupported engine choices. | Keep advanced configuration outside setup. Do not generate server.properties in the browser. |
| [Dashboard client](../src/dashboard/apiClient.ts) | Existing fetch wrappers cover discovery/lifecycle/history but not provisioning; errors lose structured codes/status; no Authorization header is supplied. | Add a typed setup client and explicit credential adapter, preserving HTTP status, safe issue codes and abort semantics. |
| [Dashboard hook](../src/dashboard/useOperationalDashboard.ts) | One refresh sequence includes protected operations/events/history and optional panels; a rejection interrupts the sequence. | Wizard access and summary refresh must not depend on successful analytics/history/AI/Family requests. Refresh/select by provider and server identity. |
| [Event stream](../src/dashboard/eventStream.ts) | Opens `/ws` with no credential integration. | Do not rely on this stream for wizard progress. Authenticated HTTP polling can use the existing API without changing WebSocket authorization. |
| [Frontend types](../src/dashboard/types.ts) | Inventory/status types lack managed ownership/readiness; operation union contains only lifecycle/world operations. | Add accurate projections for setup; do not infer MANAGED, READY or provider endpoints from old Java-shaped fields. |
| [UI tests](../tests/dashboard-ui.test.tsx), [integration tests](../tests/dashboard-integration.test.ts) | Static React markup and fixture-backed API/state tests exist. | Reuse these patterns for contracts; add real keyboard/focus/browser checks for the implemented interactive wizard. No runtime launch in ordinary UI tests. |

023A placement: a dedicated native dialog opened from the active operational
dashboard header. It has an explicit keyboard focus loop and restores focus to
the entry button on close. The entry is available with an empty inventory or
unavailable optional dashboard data. No router migration or design system is added.

The inspected file plan is implemented in `src/components/NewServerModal.tsx`,
`src/setup/{types,useSetupWizard}.ts`, `src/dashboard/provisioningTypes.ts` and
the existing dashboard API client, with one dashboard-header integration.
023B adds the completion callback through `App.tsx` and a focused dashboard
inventory refresh. The old callback-only engine/version/Geyser flow is
replaced; no mock profile IDs or version lists are embedded in the component.

## User inputs and trusted defaults

| Shared | Java | Bedrock |
|---|---|---|
| Display name; world name; managed CREATE | Approved Java profile when more than one is available; game port only if operator policy allows choice | Approved RakNet BDS profile; approved IPv4/IPv6 endpoint defaults; port changes only when allowed |

Show Java and Bedrock as household choices, mapped to `minecraft` and
`minecraft-bedrock`. Do not offer Geyser as native Bedrock, or infer support from
the old prototype's engine list. A single approved profile can be selected by
default; unavailable providers/profiles explain what the operator must configure.

Display name maps to `displayName`; it is not a path or server ID. The trusted setup
choice supplies host/root/profile references, endpoint roles/protocols/binds and
the allowed identity/default rules. Keep an automatically allocated draft identity
stable while the user edits; do not generate a new target on retry. A server-scoped
license record may restrict the permissible server ID. Do not claim that approval
of one profile licenses every new server or copy an acceptance-test identity.

Server/world names get immediate form feedback consistent with advertised backend
constraints. Backend validation remains authoritative. World naming safety, hashes,
license scope, protected roots, compatible builds and collision checks remain in
providers/core. The UI neither parses runtime configuration nor probes ports.

Do not hard-code `local`, `root`, `approved`, an acceptance installation path,
19132/19133, the C1 disposable ports, a BDS version or bundle digest as deployable
choices. Generic provider endpoint hints are not necessarily managed-profile defaults.
The pinned Bedrock managed profile requires two specifically identified UDP endpoints;
its generic planner hint currently describes only one.

## State machine

The only top-level states are:

`choose-provider`, `configure`, `preflight`, `review`, `provisioning`, `complete`, `error`.

| State | Meaning and allowed transitions |
|---|---|
| choose-provider | Load approved choices and choose Java/Bedrock. Next -> configure when a usable provider choice exists. Discovery/auth failure -> error with a return target. |
| configure | Enter essential CREATE fields. Back -> choose-provider, invalidating dependent review data. Check setup -> preflight. No ADOPT or existing-server branch. |
| preflight | Create/store a plan, then check that plan. A valid current PASS with a creation preview -> review. Blocking issues -> configure with preserved inputs/field feedback. Unexpected transport/auth/protocol failure -> error. Back/edit abandons the local request generation and invalidates approval. |
| review | Show the actual returned plan/creation preview. Edit/back -> configure and invalidate the preview. Explicit Create server -> provisioning using the exact current creation digest. No implicit approval. |
| provisioning | Track the submitted request and its durable operation. Verified applied success -> complete. Verified failure/rollback or unknown/disconnected outcome -> error with its actual recovery classification. No edit/back/reset that could create a second operation. |
| complete | Show verified created provider/server identity, MANAGED ownership, stopped/current runtime status, endpoints and configured world intent. Open server refreshes inventory and selects that exact server. |
| error | Preserve the draft, safe message, originating state and known plan/operation references. Offer only recovery actions justified by the recorded outcome. Authentication reconnect/status reconciliation returns to the appropriate state; it never auto-approves. |

Context holds draft revision, provider, approved choice reference,
essential fields, current plan/preview, pending request generation, submitted
approval tuple, operation reference, outcome certainty and safe error/field details.
Authentication availability is a separate dependency, not another wizard step.

Required invariants:

- Any provider/profile/identity/name/world/endpoint change invalidates prior plan,
  preflight result, digest and approval. Editing an approved request is forbidden
  while its outcome is unresolved.
- Ignore stale async results by generation/draft revision, including responses
  arriving after close, provider switch or a newer preflight. Abort abandoned reads
  where supported; aborting a browser request does not cancel a server operation.
- Only current `status=PASS` plus a valid `creation` preview enables approval.
  WARN, FAIL, missing fields, unknown state and schema mismatch cannot enable it.
- Store the reviewed `{planId, creation.digest, providerId, serverId}` together.
  Submit `approved:true` only from the explicit approval action. The outer plan
  digest is not the creation approval digest.
- Disable duplicate submit and allow one in-flight apply per approved tuple.
  StrictMode, refresh, timers and remounts must not trigger POST applies.
- Never infer completion from HTTP 200, a finished spinner or an online/offline
  server with a matching name. Inspect state, outcome, error and identity.
- Mocks are injected test adapters. A failed real request never falls back to
  simulated success or a synthetic server in the household flow.

## Existing API sequence

All provisioning calls and protected status/operation reads need authorized admin
access. These are the current routes; the setup-options projection is added by 023A.

| Purpose | Existing API and contract |
|---|---|
| Approved setup choices | GET `/api/provisioning/setup-options`, authenticated by the existing provisioning middleware; returns only the safe metadata described below. |
| Provider/inventory discovery | GET `/api/providers`, `/api/providers/:id`, `/api/servers`. Provider metadata/capabilities do not enumerate approved managed setups. |
| Plan | POST `/api/provisioning/plans` with schemaVersion 1, providerId, stable serverId when applicable, displayName, hostId, create storage reference, approved endpoints and providerOptions `{profileRef,worldName}`. Returns `{plan,digest,profile}`. |
| Preflight | POST `/api/provisioning/preflight` with `{planId}`. Managed CREATE success returns `{status:"PASS",issues:[],creation}`. `creation` includes the approval digest, profile/target identity, endpoints, world intent, file summary, optional bundle summary and `startup:"remain-stopped"`. |
| Review/resume plan | GET `/api/provisioning/plans/:id` returns the stored plan and available creation preview. Reading it does not prove an apply succeeded. |
| Approve creation | POST `/api/provisioning/applies` with `{planId,digest:creation.digest,approved:true}`. Current handler waits for a result and responds with operationId/providerId/serverId/state/outcome/ownership plus optional error and residuals. It is not a 202 job-creation contract. |
| Progress/reconciliation | GET `/api/operations/:id`; GET `/api/operations` with the supported provider/server filters; GET `/api/events` where useful. CREATE records are mirrored into the existing operation/history repository. |
| Summary | Refresh GET `/api/servers`; GET `/api/providers/:providerId/servers/:serverId/status` and `/endpoints`. GET `/worlds` describes actual worlds when present; an empty list before first boot is expected. |

Review copy presents edition, display/world name, approved profile, intended
connection ports and the fact that creation leaves the server stopped. Advanced
details may reveal safe relative file/version summaries; never require a parent to
interpret a checksum or filesystem path to approve an ordinary setup.

Create success requires the correlated operation/apply result to report
`state=PROVISIONED`, `outcome=applied`, `ownership=MANAGED`, no reported error or
residuals, followed by matching registered server discovery. A server refresh failure
after verified creation shows **Created — summary unavailable**, with refresh/Open
server actions. It must not re-enable creation or report provisioning failed.

### Progress and unknown outcomes

Show real phases such as Checking, Creating, Registering and Created only when the
API provides that evidence. Use indeterminate progress otherwise; no invented
percentage or estimated READY. 023B shows Creating while the synchronous apply
request is pending; the response supplies its terminal state and operation ID.
It does not invent intermediate phases or rely on the dashboard WebSocket.

In 023B a lost/invalid apply response produces an unconfirmed outcome with its
plan reference and administrator instructions. It never restores the old Create
action. Partial rollback similarly exposes its operation reference without cleanup
or retry controls. Future in-wizard status reconciliation belongs to 023C; it must
match providerId, serverId, provisioning operation type and exact `result.planId`,
never the latest display name or an assumed operation-ID prefix. No match in a
limited history is not proof that nothing happened.

An unresolved submission stays unknown and requires operator review. 023B has no
apply retry action. Verified clean rollback and rejected/stale approval offer
Recheck setup: plan and preflight run again, followed by a fresh unchecked approval
checkbox. No error silently resubmits the previous digest.

## Error, retry and navigation policy

| Condition | Household behavior |
|---|---|
| Invalid input or preflight blocker | Explain the relevant field/action, preserve draft, return to configure; no side effects claimed. |
| 401 / lost credential | Ask for authorized reconnection through the selected session mechanism. Preserve context and reconcile any submitted apply before allowing another. |
| 403 | Explain that an authorized household administrator must continue. No Family role inference or weaker alternate endpoint. |
| Profile/license unavailable or source drift | Explain that the approved setup needs operator attention. Do not expose source paths, change policy, fabricate acceptance or offer a licensing checkbox. |
| Endpoint/target conflict or changed digest | Return to configuration/recheck only if no apply is unresolved. Require a new review and explicit approval for changed inputs. |
| HTTP 200 with FAILED/ROLLED_BACK/PARTIALLY_ROLLED_BACK | Treat the actual result as failure. Distinguish clean rollback from retained/ambiguous resources; preserve operation references. |
| Partial rollback or ownership uncertainty | Show Needs attention. Do not expose an automatic cleanup/recreate button. Existing explicit admin recovery remains a separate deliberate operator action. |
| Network timeout, abort or refresh during apply | Report Connection interrupted / checking result, not failed or successful. Resume via correlation; do not automatically resubmit. |
| Unknown payload/state or unsafe raw error | Fail closed with a safe message and support reference; no approve action. Preserve typed code/status privately without rendering raw server diagnostics. |

Closing an unsubmitted draft resets local work. While apply is pending, Close and
Escape are blocked and browser unload requests confirmation; no cancellation
endpoint is implied. Errors retain the draft, plan, preflight and available
operation reference while the dialog remains open. Unknown/partial outcomes tell
the user to retain that reference for the administrator. Browser reload/session
resume is not implemented in 023B; no credentials or runtime policy are persisted.

## Integration gaps resolved by 023A

### 1. Approved setup discovery — real API gap

At the audit checkpoint there was no read-only route for managed profile choices, approved host/root
references, managed endpoint defaults or permitted identity constraints. The generic
profile is returned only after POST plan, which already requires those choices.
GET provider metadata exposes capabilities, not the private managed policy. Reading
the policy file in a browser, embedding its contents or hard-coding acceptance
values would defeat the objective and established trust boundary.

023A adds one authenticated **safe setup-options projection**:
GET `/api/provisioning/setup-options`. It advertises only operator-configured
choices: opaque profile/host/root
references, household labels, editable essentials and validation hints, approved
endpoint roles/defaults, world default and relevant identity/license-scope
availability. No source paths, launch commands, executable locations, full manifests,
acceptance records, secrets or browser-supplied policy. Mark unsupported/unavailable
choices honestly. Its output is descriptive; preflight/apply still perform every
existing verification and may reject changed facts.

The public response is `{providers:[{providerId,label,profiles:[{profileRef,
revision,label,defaults:{worldName?},available,requestDefaults?}]}]}`.
`requestDefaults`, when available, contains only `hostId`, `rootId`, approved fixed
`endpoints`, and an optional `serverId` constraint. The latter preserves existing
server-scoped license policy without returning any acceptance record.

Existing policy does not specify every setup endpoint/root default. Optional
operator-owned `policy.setup.profiles[profileRef]` supplies `{rootId,endpoints,label?}`;
the endpoint projects these references instead of guessing ports, selecting an
arbitrary managed root or adding provider-specific endpoint rules. Generic provider
hints are insufficient for the managed Bedrock dual-endpoint contract. A missing
or malformed setup entry yields `available:false`, with no request defaults.
This metadata authorizes no execution: the existing preflight remains authoritative
for compatibility, path, source, license and collision checks.

Discovery performs no filesystem inspection, socket probing, plan/preflight or apply.
The existing authorization audit remains in effect. No real operator policy files
are modified by this slice. An existing deployment must provide complete trusted
setup metadata before its real wizard check can be used; the UI does not invent it.

### 2. Browser authorization — client integration gap

The old dashboard client supplied no admin credential. Provisioning requires the
configured/injected admin authorizer; the default uses a server-side Bearer token.
023A provides an explicit administrator access-key connection for setup requests,
kept only in hook memory and cleared on close/reset/unmount. Never ship GAMEHUB_ADMIN_TOKEN in a Vite bundle,
configuration response, URL, localStorage, sessionStorage, logs or evidence.

The operator supplies that access key through their existing trusted channel;
no token-discovery route or new identity subsystem is added. Do not add account/host
onboarding, equate Family membership with admin permission, expose the server's
token, or weaken API/WebSocket guards to make the dashboard work. A mock credential
adapter can exercise shell transitions without pretending authentication exists.
The old dashboard's unrelated protected reads/WebSocket still have no credential
integration; their authorization failures must not prevent opening setup.

### 3. Progress, errors and summary — frontend work, not new provisioning powers

Existing operation mirroring and HTTP reads support progress/reconciliation; no
parallel provisioning worker/job API is justified by this audit. Add typed
provisioning results, structured errors, ownership and provider-neutral endpoints
to the setup client. Do not reuse Java-only legacy endpoint assumptions. Separate
optional dashboard refresh failures from setup success and identity selection.

## Accessibility requirements

- Use a real form with explicit labels, descriptions and field errors; Java/Bedrock
  selection is keyboard-operable and not communicated by color alone.
- Provide a textual step indicator and current-step state. Every view has a unique
  heading; focus moves to it on user-driven step changes. On invalid submit, focus
  the error summary/first invalid field and associate each message with its input.
- Announce meaningful checking/provisioning/completion changes politely. Avoid
  announcing every polling tick or repeatedly stealing focus.
- Provide visible focus, logical tab order, usable Back/Close controls, adequate
  touch targets and a single-column layout without horizontal scrolling at 320px.
- Support reduced motion and zoom; essential information and controls must not
  depend on animation, hover, icons or progress-bar color.
- If a dialog is chosen later, require accessible naming, focus containment and
  restoration; Escape must not pretend to cancel a submitted operation.

## Implementation sequence and acceptance

1. **023A implemented:** authenticated setup discovery, typed public client,
   deterministic reducer/hook, active dashboard entry and accessible modal shell.
2. **023A complete:** real plan -> preflight -> review, with no creation effects.
3. Prove Java/Bedrock PASS through the real HTTP/provider preflight with
   non-executable fixtures, plus error/back/reset/stale-response and browser checks.
4. **023B implemented:** explicit approval -> apply -> indeterminate progress ->
   completion or classified failure, followed by inventory refresh/selection.
5. **023C pending:** UX hardening/live household flow, including deployment policy
   prerequisites and any approved session/status-resume improvements. No onboarding.

Required tests before calling the implemented flow accepted:

- Both providers complete the exact state sequence using current API payloads;
  defaults are taken from approved choices, with unavailable profiles blocked.
- Requests use managed CREATE only and never call attachment/ADOPT routes. CREATE
  remains stopped and an uncreated world is labelled as configured intent.
- Field/provider/profile edits invalidate review; stale responses, repeated clicks,
  StrictMode/remount and abandoned requests cannot apply stale or duplicate work.
- The creation digest is used; plan digest substitution, failed/warned preflight,
  HTTP 200 failure results and mismatched server/provider identity cannot complete.
- 401/403, source/license/endpoint blockers, clean rollback, partial rollback,
  unknown outcomes and post-success summary failure offer only valid retry actions.
- Unknown/partial outcomes require operator review; no missing history or absent
  auth triggers a new CREATE. Session reconciliation is a 023C boundary. Secrets
  never persist or enter URLs.
- Ownership/status/endpoints are accurate for Java and Bedrock; completion refreshes
  and selects the correct server without breaking existing operational panels.
- Keyboard navigation, focus/errors/live announcements, narrow screens, zoom and
  reduced motion are checked in the rendered implementation.

Ordinary tests use fake adapters or existing non-executable fixtures, never the
protected BDS source or managed acceptance runtime. Actual CREATE/start acceptance
requires separate explicit disposable-environment authorization. Keep JBGH-022's
known unrelated Content Library failure visible when reporting any later full run.

023A validation is recorded separately below. No household CREATE, boot or player
acceptance is claimed by preflight/review. JBGH-023 remains OPEN until the full
product flow is accepted for both editions.

## JBGH-023A — Setup discovery + real preflight

Implemented and locally validated on 2026-10-19. The root React/Vite application
now opens the replacement `NewServerModal` from `OperationalDashboard`; no second
frontend or `App.tsx` change is introduced. The seven-state contract remains,
but only choose-provider/configure/preflight/review/error are reachable in 023A.
Creation is visibly disabled and the reserved `onProvisioned` callback is unused.

Validation uses trusted Java and Bedrock fixture profiles with arbitrary discovered
references. Both perform actual authenticated HTTP POST plans and POST preflight
against the existing provider implementations and reach PASS/review. These are
non-executable fixtures, not live Paper/BDS acceptance. Target directories remain
empty, source inventories and fixture policies remain unchanged, and no claims,
managed definitions, lifecycle operations or apply requests are produced.

The setup-options route requires the existing admin authorization, sends no-store
responses and returns no absolute paths, hashes, acceptance records, actors/terms,
protected roots or manifests. It performs no runtime inspection. Tests cover
missing/invalid credentials, non-admin denial, read-only discovery, malformed
options, absent/invalid setup defaults and safe error handling. Typed client
responses and correlation checks prevent mismatched preflight results from review.

The browser run exercised the real Java and Bedrock preflight flows plus duplicate
clicks, blocked plans, FAIL and HTTP 422 results, input preservation, stale results
after edit, stable generated identity, 401/reconnection, close/reset, disabled
creation, Escape/focus restoration, keyboard focus containment and reduced motion.
Chromium was launched from the existing cache through Playwright because the
Browser plugin was unavailable; no dependencies were installed. Viewports were
1280x900, 390x844 and 320x740. An observed Tab escape was fixed and the interaction
run passed afterward. Screenshots and request evidence remain outside the repo.

The browser recorded no uncaught page errors. Expected authorization errors from
the legacy dashboard's protected reads/WebSocket and deliberately injected
401/422 checks remain distinguishable from wizard failures. The wizard's access
key is supplied explicitly, used only in request headers, never persisted and
cleared on close; broader dashboard session integration is not claimed.

Local validation: lint PASS; **33/33** focused setup/API/dashboard regressions,
including **16 new tests**, PASS; contracts **5/5** PASS; build PASS with the
existing CJS `import.meta` warning; whitespace checks PASS. Full suite **479/480**:
only the known unrelated Content Library native Bedrock root-mapping test fails
(expected HTTP 201, received 422). The full suite is not green. An initial parallel
contract run encountered a shared test-port collision; the isolated rerun passed.

No real runtime or operator policy file was modified and no server was created or
started. The current real operator policy has no setup presentation defaults;
profiles correctly remain unavailable for checking until an operator supplies
those approved references/endpoints. This slice does not silently update that
policy or claim deployment acceptance. Apply, provisioning and completion are
implemented by 023B below; first boot and player acceptance remain outside setup.

## JBGH-023B — Apply, progress and completion

Implemented on 2026-10-19 on top of the unchanged 023A setup discovery and real
preflight contract. Review now requires an explicit approval checkbox. Its sole
apply handler posts `{planId,digest:preflight.creation.digest,approved:true}` to
the existing authenticated `/api/provisioning/applies` endpoint. Event-handler
submission, a synchronous busy guard and a submitted-approval guard prevent
duplicate POSTs, including the interval before React renders a response.

Only review can enter provisioning. Close, Escape, edit and reset cannot abandon
an active submission. Progress is indeterminate while the existing synchronous
API runs; the UI does not fabricate percentages, READY, or intermediate phases.
Completion requires the matching provider/server, PROVISIONED/applied/MANAGED,
no error and no residuals. All other results are classified as clean rollback,
partial rollback, rejected approval or unconfirmed outcome. Form, plan and
preflight evidence survive failure. Unknown/partial outcomes offer no retry or
force cleanup; rejected approval/clean rollback require a new check and approval.

Completion shows the entered server name, edition, world intent, Managed and Ready
to manage, explicitly Created stopped. It refreshes inventory independently of
optional protected dashboard panels. Open Server refreshes again and selects the
exact provider/server pair; failure to refresh remains a created-summary error,
with inventory-only retry. Done/Open clear the draft and in-memory access key.
No lifecycle/start/boot-authorization/recovery endpoint is called.

The existing inventory currently names managed servers by their server ID, not
their plan displayName. Selection therefore correlates identities; completion
retains the entered display name. This slice does not redesign that projection.

Local browser acceptance uses actual HTTP/provider plan, preflight and apply with
small non-executable Java/Bedrock fixture bundles. Both reached offline/MANAGED;
created file hashes, sources and fixture policies remained intact. Keyboard
approval, duplicate activation, blocked Close/Escape, stale approval, clean and
partial rollback, network/HTTP uncertainty, inventory-refresh failure, exact
selection, reset and 320px/390px progress/completion layouts passed. The existing
DISABLE_HMR option isolates this test from Vite reloads caused by bundled fixture
HTML. Fixture server shutdown and cleanup are verified; no real runtime was used.

Deployment prerequisite remains explicit: the operator must configure
`setup.profiles` with approved root references and endpoint defaults, in addition
to existing bundle/runtime/license authorization. The current real policy lacks
these defaults. It is unchanged; live 023B acceptance is not claimed. The browser
receives no absolute trusted paths or internal acceptance records. JBGH-023 remains
OPEN, with 023C and household/live validation pending.

Combined 023A+B validation: lint PASS; focused setup/API/dashboard tests **43/43
PASS**; contracts **5/5 PASS**; build PASS with the existing CJS `import.meta`
warning; browser checks PASS; `git diff --check` PASS. Full suite **493/494**:
only the known unrelated "Content Library API maps Bedrock plans to the configured
native provider root" fails (expected HTTP 201, received 422). The full suite is
not green. This checkpoint leaves runtime/provider validation, Family Service and
JBGH-022 provisioning semantics unchanged.
