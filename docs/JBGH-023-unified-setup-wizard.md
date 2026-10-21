# JBGH-023 — Unified Setup Wizard

Status: **JBGH-023 CLOSED / PASS. JBGH-023C CLOSED / PASS — live stopped Java and Bedrock CREATE, completion/selection, restart persistence and authenticated dashboard WebSocket acceptance completed on 2026-10-21.**

The dated preparation records below preserve their original findings. The final
023C closure record supersedes their OPEN/PENDING status; first boot and player
acceptance remain outside this wizard milestone.

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
approved fixture bundles. The 023C closure record documents the real approved
Java/Bedrock stopped CREATE and browser acceptance.

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
or retry controls. 023C adds explicit read-only status reconciliation; it must
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
resume was not implemented in 023B. In 023C the operator can reconnect and enter
the retained plan reference to check the existing result; no credentials or runtime
policy are persisted, and reconciliation never resubmits an apply.

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
kept only in hook memory and cleared on close/reset/unmount in that slice. 023C
shares a successfully verified key with a page-memory dashboard connection;
Disconnect administrator or closing the page clears that connection. Never ship GAMEHUB_ADMIN_TOKEN in a Vite bundle,
configuration response, URL, localStorage, sessionStorage, logs or evidence.

The operator supplies that access key through their existing trusted channel;
no token-discovery route or new identity subsystem is added. Do not add account/host
onboarding, equate Family membership with admin permission, expose the server's
token, or weaken API/WebSocket guards to make the dashboard work. A mock credential
adapter can exercise shell transitions without pretending authentication exists.
The old dashboard's protected reads/WebSocket lacked credential integration at the
audit checkpoint. The narrow 023C integration and its rejection/reconnect coverage
are recorded in the final closure section; authorization was not weakened.

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

## JBGH-023C — Live acceptance, UX hardening and closure review

Status: **OPEN / fresh operator authorization and dashboard console-health gap
unresolved**.
The 023A+B checkpoint is `c40c352`, local and not pushed. No live 023C CREATE or
milestone closure is claimed by the checks below.

### Preparation findings (2026-10-19)

Read-only inspection found that the real policy has no `setup.profiles` entries.
Its existing Java acceptance is bound to `java-022g-live`; its Bedrock acceptance
is bound to `bedrock-022g-live`. Both identities already have completed MANAGED
definitions, preserved directories and active resource claims in their original
acceptance databases. Their stopped processes do not release those claims.

Adding setup presentation defaults cannot widen those license scopes, authorize
new identities, or turn an existing target into a fresh CREATE target. Do not
recreate either runtime, replace their database, clear their claims, copy an old
operator acceptance into a broader scope, or use an empty database to bypass an
existing reservation. Fresh 023C profile/identity authorization must be supplied
by the operator before the live flow proceeds. Existing trusted profiles,
artifacts, bundle digest and acceptance records remain unchanged.

Candidate disposable endpoints are TCP 27061 (Java) and UDP 29242/29243 (Bedrock);
they were unbound during preparation and are distinct from the reserved 022
ports. These are proposed operator defaults, not approved policy or a live port
reservation. Recheck OS bindings and retained claims immediately before preflight.
The D: volume had approximately 163 GB available during preparation.

### Policy preparation boundary

After the operator supplies fresh authorized profile/identity records:

1. Preserve a private before-copy and SHA-256 of the policy. Keep it outside Git
   and outside all managed/protected source roots.
2. Add only `setup.profiles[approvedProfileRef]` presentation entries containing
   the approved opaque `rootId`, exact fixed endpoints and a household label.
   World defaults remain in the existing approved profile configuration; the
   browser must not choose trusted directories or manufacture acceptance data.
3. Write UTF-8 without BOM. Compare the entire parsed policy with each provider's
   `setup` member removed: it must equal the baseline. Changes to profiles,
   sources, bundles, hashes, license records or endpoint inventory are separate
   operator-authorized prerequisites and must not be hidden in this comparison.
4. Validate authenticated setup discovery: both intended choices available,
   matching profile/root/endpoint references and no absolute paths, source hashes,
   acceptance records, actors, terms, launch commands or admin credential in the
   response. Log request shapes/outcomes, never the Authorization header.
5. Verify target absence and sufficient capacity; preserve the full protected BDS
   source inventory and existing 022 runtime/database evidence. The API must use
   the authoritative managed-state database for that host's active claims.

### Live sequence and evidence

Use the real root React/Vite wizard against the approved disposable targets.
Capture one correlated evidence set per provider, including planId, reviewed
creation digest, operationId, providerId/serverId and final inventory selection.

`choose-provider -> configure -> preflight PASS -> review -> explicit approval
-> apply -> complete -> Open Server`

Require PROVISIONED/applied/MANAGED, no residuals and registered offline status.
Verify the actual generated files/receipts against the reviewed manifest. World
names are configured intent: this slice does not boot, create a world, accept a
player or authorize first boot. There must be no lifecycle POST, Java/BDS launch,
or listener on the disposable endpoints. Refresh/select must use the returned
provider/server identity. Preserve the original sources and existing 022 targets.

Exercise a stale approval against a real preflight without causing filesystem
effects. Use non-executable fixture/browser tests for rollback and partial cleanup
presentation; do not induce disk exhaustion or ambiguous ownership in a live
runtime. Separate intentionally injected negative-test HTTP errors from errors in
the successful path. Record uncaught exceptions, framework overlays, console and
request failures. Legacy dashboard/WebSocket authorization failures, if present,
are an explicit unresolved console-health finding rather than a silently passed
"no browser errors" gate.

### Gates and closure

| Gate | Required evidence | Current state |
|---|---|---|
| Java setup discovery | Approved public choice/defaults, no private policy | NOT RUN live |
| Java preflight | Correlated real PASS and creation digest | NOT RUN live |
| Java apply | PROVISIONED/applied/MANAGED, no residuals | NOT RUN live |
| Java completion selection | Exact created provider/server selected after inventory refresh | NOT RUN live |
| Java stopped boundary | Offline, no process launch or disposable listener | NOT RUN live |
| Bedrock setup discovery | Approved public RakNet choice/defaults, no private policy | NOT RUN live |
| Bedrock preflight | Correlated real PASS and creation digest | NOT RUN live |
| Bedrock apply | PROVISIONED/applied/MANAGED, no residuals | NOT RUN live |
| Bedrock completion selection | Exact created provider/server selected after inventory refresh | NOT RUN live |
| Bedrock stopped boundary | Offline, no process launch or disposable listeners | NOT RUN live |
| One apply per approval | Request count/body evidence for keyboard and repeated activation | Fixture coverage exists; live pending |
| No trusted paths exposed | Public HTTP response and rendered UI checks | Fixture coverage exists; live pending |
| No automatic start | No lifecycle request/process/listener | Fixture coverage exists; live pending |
| Browser health | No uncaught/framework/unexpected console errors on successful flow | Live pending |
| Responsive layout | Desktop, 390px and 320px progress/completion usable | Fixture coverage exists; live pending |
| Keyboard flow | Complete guided flow without a pointer; focus containment/restoration | Fixture coverage exists; live pending |
| Reset/close/recheck | Correct pending guard, cleared credentials and safe failure navigation | Fixture coverage exists; live pending |
| Policy integrity | Only approved setup metadata changed; original trusted material preserved | Policy not changed |

Close JBGH-023 only after the real Java and Bedrock gates pass and the closure
review resolves every 023-scoped blocker. Keep the unrelated Content Library 422
explicit. Push `c40c352` plus the 023C/closure commit only after that acceptance;
do not start JBGH-024 implementation as part of this slice.

### Preparation QA results (2026-10-19)

The browser tab title was corrected from the template's "My Google AI Studio
App" to "JB³ GameHub". The existing non-executable fixture environment exercised
both provider flows at desktop (1280px), 390px and 320px, including progress and
completion. The complete happy paths used Tab/Enter/Space and typed input without
a pointer. Exact approval tuples, one apply per approval, stopped/MANAGED results,
inventory selection, reset, pending close protection, stale approval, rollback,
partial rollback and unknown outcomes passed. No lifecycle request, native
process, world output, uncaught JavaScript exception or framework overlay was
observed. Fixture sources/policies remained intact and cleanup completed.

The stricter console-health check did **not** pass: the dashboard's unauthenticated
`GET /api/operations` and `/ws` connections are rejected when provisioning policy
is configured. The wizard's in-memory credential is deliberately separate from
those legacy requests. Intentionally injected 409/503/network failures were also
recorded separately. The authorization errors are a confirmed existing dashboard
integration gap; hiding them, weakening server authorization or counting the
browser-health gate as passed would be incorrect. Resolve that narrow auth/session
integration before closure, or explicitly revise the acceptance boundary with the
operator. No auth or provisioning backend semantics were changed during this QA.

A private before-policy copy, byte hash and explicitly disabled proposal were
prepared outside Git. Proposed acceptance fields remain empty, execution disabled
and authorization false; they are not new operator acceptance records. A complete
read-only inventory captured **3,038 protected BDS files / 290,152,023 bytes**.
The real policy remains byte-exact unchanged, and the 022 targets/claims remain
preserved. Live gates remain NOT RUN; these fixture results do not close 023C.

Preparation validation: lint PASS; focused setup/API/dashboard regressions
**43/43 PASS**; contracts **5/5 PASS**; build PASS with the existing CJS
`import.meta` warning; whitespace checks PASS. These are documentation/title
changes, so the full suite was not repeated: the `c40c352` checkpoint baseline
remains **493/494**, with the known unrelated Content Library 201/422 failure.
The functional fixture flow passed; the stricter console-health gate remains
failed for the authorization finding above. No commit or push was performed.

### Disabled review package (2026-10-20)

The operator requested fresh, reviewable drafts without any implied acceptance.
`integration/provisioning/scripts/setup-wizard-drafts.ts` now builds that package
as pure data from the pinned source policy. It does not write policy files,
register runtimes or authorize execution. Generated private policy/review files
remain outside Git and must not be returned to the browser.

| Provider | New profile / revision | New server / explicit review directory | Proposed endpoints | World default | Missing acceptanceRef |
|---|---|---|---|---|---|
| minecraft | java-023c-approved / 1 | java-023c-live | TCP 127.0.0.1:27061 | managed-world | java-023c-license |
| minecraft-bedrock | bedrock-023c-raknet-approved / 1 | bedrock-023c-live | UDP 0.0.0.0:29242 and [::]:29243 | managed-bedrock-world | bedrock-023c-license |

The existing managed root references are preserved. Both fresh target directories
were absent during preparation; the old 022G targets are protected. New profiles
retain the exact source configuration/artifact/runtime lineage, changing only
their profile key and acceptanceRef. Bedrock retains the approved BDS 1.26.51.1
RakNet bundle digest
`557fe940e01a0ca2de8df3fb7d14783b2a59f6e669d1fbfd6b2249176570647f`.
The manifest's canonical digest is checked before it can enter the draft.

The loadable draft contains **empty acceptance maps**, no copied records, and
`managedCreate.endpointInventory = {complete:false,bindings:[]}`. Its
`setup.profiles` maps are also empty. Proposed presentation defaults are included
in a separate review-only file, so loading the policy leaves wizard choices
unavailable. Execution is blocked by existing authorization/preflight guards;
there is no invented `enabled:false` switch whose meaning the backend ignores.

The package includes the loadable policy, proposed setup mappings, explicit
review requests, scope/digest requirements, validation and operator instructions.
Scope requirements identify providerId, new serverId, new profileId/revision and
hostId; Bedrock additionally requires the exact bundleDigest. Actor, actual
acceptance time, reviewed terms, revision and generated-acceptance authorization
remain for the operator to supply. No acceptance records are created by the tool.

The explicit review requests pin `storage.directoryName` to each new server ID.
At draft preparation the wizard omitted directoryName and its planner used a generated leaf;
those targets must not be conflated. Re-review the actual wizard preflight target
before any later live approval. This package does not extend the discovery model.

Regressions load the draft through the existing environment loader and real HTTP
router using non-executable fixtures. Both providers are unavailable in setup
discovery; direct preflight returns LICENSE_ACCEPTANCE_REQUIRED and direct apply
returns APPROVAL_REQUIRED. No verified preview, operation, claim, managed
definition or new runtime directory is produced; simulated old runtimes survive
unchanged. A separate regression rejects changed bundle lineage or reused
approval references. The real source policy remains byte-exact unchanged and
both 023C targets remain absent. No live CREATE, commit or push is authorized by
this review package; JBGH-023C and the console-health finding remain OPEN.

Draft-package validation: lint PASS; focused regressions **45/45 PASS**, including
the two new draft-policy tests; contracts **5/5 PASS**; build PASS with the
existing CJS `import.meta` warning; whitespace checks PASS. Full suite **495/496**,
with only the known unrelated Content Library expected-201/received-422 failure.
No live acceptance or milestone closure is claimed. Changes remain uncommitted.


### 023C reviewed storage target contract

Each enabled operator-owned `setup.profiles` entry must now supply an explicit
`directoryName` alongside its `rootId` and endpoints. Discovery exposes only
`storage: { rootId, directoryName }`, never an absolute managed root. Missing,
unsafe or unsupported directory names leave the setup option unavailable; there
is no generated-leaf fallback in the wizard.

The wizard copies that storage pair into its CREATE request. The friendly server
name remains editable; the reviewed leaf and scoped server identity are fixed.
Immediately after POST /plans, the wizard compares the returned request root and
leaf with its selected setup option before invoking preflight. A differing
preflight directory also prevents review/approval. The HTTP API checks configured
setup storage at plan, preflight and apply, returning SETUP_SCOPE_MISMATCH when
current defaults differ, so a policy change invalidates stale setup requests.
Other provisioning paths without setup defaults retain their existing contract.

The approved 023C targets remain java-023c-live and bedrock-023c-live under their
previously reviewed roots, with the same identities, profiles, endpoints and
artifact/bundle bindings. Adding these exact leaves to the separate acceptance
policy conforms to the existing operator approvals. Reviewed sidecars and the
original real policy must remain unchanged. Live validation for this fix ends at
both real preflights; no apply or first boot is authorized by this validation step.
JBGH-023C remains OPEN pending the subsequent stopped CREATE acceptance.


### Reviewed-target plan/preflight validation - 2026-10-20

The separate scoped acceptance policy now supplies the exact reviewed setup
leaves. The reviewed operator sidecars, their pinned hashes, the original real
policy and all existing 022G policy records remain unchanged. No new approval was
inferred or needed for the conforming target implementation.

Real authenticated discovery and both real preflights passed using the existing
acceptance databases and approved local artifacts. Java resolved exactly to
`D:\jb_gamehub_022g_acceptance\java-023c-live`; Bedrock resolved exactly to
`D:\jb_gamehub_022g_bedrock_acceptance\bedrock-023c-live`. Both public plan requests
and private preview paths matched the approved targets. Browser checks reached
review for both real preflights, with approval unchecked and no apply request.
Changing the friendly name preserved both identities and storage leaves.

Fixture browser tests rejected missing/wrong plan leaves and wrong roots before
preflight, and missing discovery leaves before planning. Desktop (1280px), 390px
and 320px review layouts and keyboard check activation were exercised. Existing
dashboard WebSocket authentication errors remain recorded separately; console
health and overall 023C closure are not claimed.

Validation: lint PASS; focused setup/API tests 43/43 PASS; contracts 5/5 PASS;
build PASS (existing CJS import.meta warning); full suite 503/504, with only the
known unrelated Content Library Bedrock-root 422 failure; diff check PASS.

Both validation servers were stopped. Final checks found both target directories
absent, game ports free and no BDS process. Approved artifact hashes, all 3,028
bundle files and all 3,038 protected source files still match. Existing operations,
claims, managed definitions and receipts are unchanged. Normal initialization
migrated the older Java acceptance database from schema 8 to 10; the added boot
authorization table is empty, and no runtime boot authorization was issued.

Only plan/preflight/audit metadata was persisted. No managed CREATE, first boot,
commit or push was performed. JBGH-023C remains OPEN; this record ends before apply.

## JBGH-023C closure — CLOSED / PASS

Date: **2026-10-21**. JBGH-023A, 023B and 023C are complete at the stopped CREATE
boundary. **JBGH-023 is CLOSED / PASS.** JBGH-022 remains closed; first-run host
onboarding belongs to JBGH-024 and was not implemented in this slice.

Real operator approvals were supplied for the exact fresh 023C scopes. The
separate acceptance policy preserved the existing 022G entries and trusted
artifact/bundle bindings. The original operator policy and reviewed sidecars
remain byte-exact unchanged. No approval was inferred from an earlier server.

### Live stopped CREATE results

| Gate | Java | Bedrock |
| --- | --- | --- |
| Provider / server | `minecraft / java-023c-live` | `minecraft-bedrock / bedrock-023c-live` |
| Approved profile / revision | `java-023c-approved / 1` | `bedrock-023c-raknet-approved / 1` |
| Endpoint | TCP `127.0.0.1:27061` | UDP `0.0.0.0:29242`, `[::]:29243` |
| World intent | `managed-world` | `managed-bedrock-world` |
| Discovery / exact reviewed target / real preflight | PASS | PASS |
| Explicit approval / original apply | `PROVISIONED / applied / MANAGED` | `PROVISIONED / applied / MANAGED` |
| Created files match stored manifest hashes/sizes | 4 / PASS | 3,029 / PASS |
| New retained ownership claims | 3 | 4 |
| Completion / Open Server / refreshed inventory selection | PASS | PASS, after read-only reconciliation |
| Restored from the same existing authoritative database | offline / MANAGED | offline / MANAGED |
| Native launch / first-boot authorization | None | None |
| Game listener after CREATE and final shutdown | Absent | Both absent |
| Unexpected residuals / scratch / world output | None | None; no `eula.txt` |

Java used the reviewed target
`D:\jb_gamehub_022g_acceptance\java-023c-live`; Bedrock used
`D:\jb_gamehub_022g_bedrock_acceptance\bedrock-023c-live`. Those paths are
operator-side evidence, not setup-option browser metadata. Discovery exposes only
the approved `rootId` and `directoryName` and safe endpoint/profile defaults.

The original Java browser assertion expected the friendly name in the existing
inventory row, which displays the server ID. The captured row/status already
showed the correct selected offline server; subsequent live browser checks
verified the exact provider/server selection directly.

The original Bedrock apply outlasted the browser harness's 30-minute response
wait. Its durable operation completed successfully approximately 40 minutes after
submission. That HTTP response was not captured and is not represented as captured
evidence. The timeout is retained as an acceptance finding. No second apply was
sent: the authenticated read-only path below subsequently recovered the original
completed result and proved completion and Open Server against the real runtime.

Both existing databases were restarted separately against their own retained
state; neither was replaced or merged. The exact operations, file intents,
receipts (17 Java / 12,813 Bedrock), managed definitions, claims and journals were
unchanged by restart/reconciliation. SQLite integrity checks passed. All 3,028
approved BDS bundle files and all 3,038 protected source files remained unchanged,
as did the approved Java artifact/runtime hashes. The targets remain available
for later separately authorized lifecycle work. Acceptance GameHub instances were
stopped cleanly, with the three game ports free. Process sampling observed no
Java/BDS process, and browser request capture recorded no lifecycle command.

### Dashboard WebSocket authentication — PASS

The verified setup credential now supplies the dashboard's existing REST Bearer
headers and browser WebSocket upgrade authentication. The key lives only in page
memory, with an explicit Disconnect administrator action. No cookie, localStorage,
sessionStorage or URL credential was introduced. REST authorization requirements
and provisioning CREATE behavior remain unchanged.

`GET /api/websocket-options` exposes only whether authentication is required.
The dashboard waits for a verified credential before attempting a protected socket
or history read. Browser upgrades carry the credential in a dedicated subprotocol
header; the server uses the existing authorizer and negotiates only `jbgh-admin`,
never the credential-bearing protocol. Existing header-authenticated WebSocket
clients remain supported. Missing, invalid and malformed credentials are rejected;
credentials are absent from audit/log/error output and connection URLs.

Live Java and Bedrock dashboard checks passed at 1280px, 390px and 320px:
authenticated connection, forced socket-close/reconnect with the same valid
mechanism, explicit disconnect without reconnection, and no browser/authentication
errors. The previously open WebSocket/operations 401 finding is resolved.

### Lost-response reconciliation — PASS

After connecting, Existing setup reference / Check existing setup reads the
stored plan/creation preview, filtered operation history, the exact matching
operation detail and current inventory through the existing authenticated GET
routes. An error with a retained submission also offers Check saved result.

Completion requires one exact `server.provision.apply` match for providerId,
serverId and `result.planId`, a completed clean `PROVISIONED / applied` result,
offline/MANAGED inventory, and agreement with the currently approved profile,
host, storage pair and endpoints. It does not infer identity from a display name
or an operation-ID prefix. Missing, ambiguous, running, partial, failed or
mismatched evidence remains unconfirmed and requires operator attention. No
absence in a bounded history is treated as permission to retry.

These controls never POST a plan, preflight or apply, never approve a new action,
and never start or clean up a runtime. They do not introduce a provisioning job
system or change collision, ownership, lease, journal or rollback semantics.
Live reconciliation of both original 023C operations reached the real completion
screen, refreshed inventory and selected the exact offline server. Completion at
all three widths, keyboard activation and reset/reopen passed without a duplicate
apply. Existing fixture coverage also proves stale approval, safe rollback,
partial rollback, unknown outcome and pending-close behavior; no destructive live
failure was induced to exercise those screens.

No remaining 023-scoped blocker requires player acceptance or first boot. The
known Content Library native-Bedrock-root HTTP 422 remains pre-existing and
outside JBGH-023; it was not fixed or counted as a passing test.

### Final validation

- TypeScript lint: PASS.
- Focused setup, reviewed-storage, disabled-draft, reconciliation and dashboard
  authentication regressions: **90/90 PASS**.
- Provider/API contracts: **5/5 PASS**.
- Production build: PASS; existing CJS `import.meta` warning remains.
- Full suite: **525/526 PASS**. The sole failure is the known unrelated
  "Content Library API maps Bedrock plans to the configured native provider root"
  assertion, expected HTTP 201 / received 422. The full suite is not green.
- Browser: Chromium via Playwright because the Browser plugin was unavailable;
  actual built application and authenticated live APIs, desktop/390px/320px,
  completion/selection, keyboard activation, reset, socket reconnect/disconnect and
  no unexpected browser/authentication errors. No response simulation was used for
  live completion reconciliation.
- Protected source/artifact, ownership/receipt and SQLite integrity checks: PASS.
- Git working/staged whitespace checks: PASS.

Private live evidence is retained outside the repository; no disposable local
evidence link or operator credential is published here. Provider lifecycle,
FamilyService, runtime validation and provisioning execution semantics were not
changed by this closure slice.
