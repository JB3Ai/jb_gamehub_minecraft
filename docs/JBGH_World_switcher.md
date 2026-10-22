**JBGH-020 — Smart Worlds Framework & PRD**

Objective: Design a provider-neutral, on-demand world management system for JB³ GameHub, using current Minecraft server, proxy, world-routing and backup technologies.

The target experience is:

6 selectable worlds · Maximum 3 running · Automatic wake-on-join · Automatic sleep · Safe saves and backups · Java/Bedrock crossplay.

This should be a proper architectural addition to JBGH, not a collection of Minecraft scripts.

**1\. Product requirements**

| **Requirement**      | **Proposed behaviour**                         |
| -------------------- | ---------------------------------------------- |
| World library        | 6 installed worlds initially, expandable later |
| Active capacity      | Maximum 3 concurrent world instances           |
| Player experience    | Select a world card and join                   |
| Sleeping worlds      | Start automatically when requested             |
| Independent sessions | Kids and adults can play different worlds      |
| Idle detection       | Start countdown when last player disconnects   |
| Sleep delay          | 15 minutes, configurable                       |
| World preservation   | Graceful save and shutdown                     |
| Backup               | Verified backup after shutdown                 |
| Capacity reached     | Queue requests; never interrupt active players |
| Access control       | Existing JBGH parental policies and rewards    |
| Client support       | Java and Bedrock through Geyser/Floodgate      |
| Management           | Dashboard, REST API, events and audit trail    |

The crucial architectural decision is to treat a world, a running server instance, and a player's connection as three separate resources.

That separation allows JBGH to manage six worlds without requiring six running Paper processes.

**2\. Technology research — October 2026**

The strongest approach is Velocity + Geyser/Floodgate + independent Paper instances, with JBGH owning the lifecycle and policy decisions.

| **Technology**  | **Role**                                     | **Assessment**                            |
| --------------- | -------------------------------------------- | ----------------------------------------- |
| Velocity        | Stable player entry point, backend routing   | Recommended                               |
| GeyserMC        | Bedrock-to-Java crossplay                    | Recommended                               |
| Floodgate       | Bedrock player identity                      | Recommended                               |
| Paper           | One independent server per active world      | Recommended                               |
| Multiverse-Core | Multiple loaded worlds in one Paper instance | Alternative, not the primary architecture |
| Impulse         | Dynamic backend startup/shutdown             | Reference implementation                  |
| AutoStopper     | Idle shutdown and wake-on-demand             | Reference implementation                  |

PaperMC recommends Velocity over the end-of-life Waterfall proxy, and its current documentation supports modern player forwarding and dynamic plugin development.

![](data:image/png;base64,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)

PaperMC Docs

+2

Geyser's current proxy documentation recommends installing Geyser at the Velocity layer rather than on every Paper backend. Floodgate can also run on backends when its APIs or additional skin functionality are needed.

![](data:image/png;base64,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)

GeyserMC

+1

**What existing auto-start projects teach us**

Impulse demonstrates dynamically creating, starting and stopping backend servers through a Velocity plugin, with different deployment mechanisms.

![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAb1BMVEX///8kKS74+PgsMTY+Q0f8/Pzw8PGRk5ZNUVXr6+xDSEzCxMUpLjLV1tYuMzc/Q0i3ubuUl5lbX2NTV1uLjpFKTlKxs7Xh4uOFh4rn5+h3en1vcnZ9gIPc3d6/wcJzd3o3PECmqKpjZ2rOz9CfoaRP5W5KAAABU0lEQVQ4jW1T7aKCIAzdEEUTSUuzLMtuvf8zXtiQVDx/lJ3DvgEIEPU9l1rL/F4LiFEMCQYkj2JDC6VxhaRJl3x2xgin7MePMuYRD7cQftrjrcL7ELk9nNt8yXXtyRm5mquzXADKA6LpzgZRlgBPZ1WO7yn/yrmqyGdGn95Zjav2hbNghZHMV3uNG3DZCigEmhRq+pmyrUAcifj4CO+49xciWqAe6p3pCJrNH1ATp5gH6KghQLrDnoB8GxaYPYFkhpONipjrl+wI61hQ8tB5EvYb4eTL5Ebhd8u/2f4EYfhvvWJpw9ZJ0LQfb5uxbMKi3pp5xVp30miexZHbRriHvUnojrKt7isXqWRBFQQNF2w3aYCPUl8/EREWzxtuE+pVI/wbkSGp0a51Nyg1F+L5/nel56xXgt+zcMgeC0FK27gdTzVoPXtI9DBuO2tRhJj94m3/A1GiDZXoM3d5AAAAAElFTkSuQmCC)

GitHub

AutoStopper demonstrates readiness checks, coalescing simultaneous wake requests, idle shutdown and bounded retries. Its Docker socket access has significant security implications, so I would not copy that privilege model into JBGH.

![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAb1BMVEX///8kKS74+PgsMTY+Q0f8/Pzw8PGRk5ZNUVXr6+xDSEzCxMUpLjLV1tYuMzc/Q0i3ubuUl5lbX2NTV1uLjpFKTlKxs7Xh4uOFh4rn5+h3en1vcnZ9gIPc3d6/wcJzd3o3PECmqKpjZ2rOz9CfoaRP5W5KAAABU0lEQVQ4jW1T7aKCIAzdEEUTSUuzLMtuvf8zXtiQVDx/lJ3DvgEIEPU9l1rL/F4LiFEMCQYkj2JDC6VxhaRJl3x2xgin7MePMuYRD7cQftrjrcL7ELk9nNt8yXXtyRm5mquzXADKA6LpzgZRlgBPZ1WO7yn/yrmqyGdGn95Zjav2hbNghZHMV3uNG3DZCigEmhRq+pmyrUAcifj4CO+49xciWqAe6p3pCJrNH1ATp5gH6KghQLrDnoB8GxaYPYFkhpONipjrl+wI61hQ8tB5EvYb4eTL5Ebhd8u/2f4EYfhvvWJpw9ZJ0LQfb5uxbMKi3pp5xVp30miexZHbRriHvUnojrKt7isXqWRBFQQNF2w3aYCPUl8/EREWzxtuE+pVI/wbkSGp0a51Nyg1F+L5/nel56xXgt+zcMgeC0FK27gdTzVoPXtI9DBuO2tRhJj94m3/A1GiDZXoM3d5AAAAAElFTkSuQmCC)

GitHub

PterodactylPowerAction demonstrates a waiting-server experience while the selected backend starts, but its maintainer explicitly describes support as limited.

![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAAAb1BMVEX///8kKS74+PgsMTY+Q0f8/Pzw8PGRk5ZNUVXr6+xDSEzCxMUpLjLV1tYuMzc/Q0i3ubuUl5lbX2NTV1uLjpFKTlKxs7Xh4uOFh4rn5+h3en1vcnZ9gIPc3d6/wcJzd3o3PECmqKpjZ2rOz9CfoaRP5W5KAAABU0lEQVQ4jW1T7aKCIAzdEEUTSUuzLMtuvf8zXtiQVDx/lJ3DvgEIEPU9l1rL/F4LiFEMCQYkj2JDC6VxhaRJl3x2xgin7MePMuYRD7cQftrjrcL7ELk9nNt8yXXtyRm5mquzXADKA6LpzgZRlgBPZ1WO7yn/yrmqyGdGn95Zjav2hbNghZHMV3uNG3DZCigEmhRq+pmyrUAcifj4CO+49xciWqAe6p3pCJrNH1ATp5gH6KghQLrDnoB8GxaYPYFkhpONipjrl+wI61hQ8tB5EvYb4eTL5Ebhd8u/2f4EYfhvvWJpw9ZJ0LQfb5uxbMKi3pp5xVp30miexZHbRriHvUnojrKt7isXqWRBFQQNF2w3aYCPUl8/EREWzxtuE+pVI/wbkSGp0a51Nyg1F+L5/nel56xXgt+zcMgeC0FK27gdTzVoPXtI9DBuO2tRhJj94m3/A1GiDZXoM3d5AAAAAElFTkSuQmCC)

GitHub

Research conclusion: Reuse the established Minecraft networking technologies, but implement a small JBGH-specific orchestration layer. Existing auto-start plugins are useful design references, not substitutes for JBGH's parental policies, persistent operations, audit history and backup guarantees.

One compatibility warning: current Velocity 4.x documentation requires Java 25, while the earlier JBGH Paper test environment used Java 21. We should support separate Java runtimes per managed process instead of assuming one Java installation runs everything.

![](data:image/png;base64,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)

PaperMC Docs

**3\. Recommended architecture**

JBGH Dashboard / World Carousel

Selection · Permissions · Status · Progress

JBGH Smart Worlds Orchestrator

Policies · Capacity · Queues · Lifecycle · Backup

Provider Manager + Runtime Adapter

Process control · Health checks · Persistent state

Paper 1

On demand

Paper 2

On demand

Paper 3

On demand

Player Connection Layer

**Java + Bedrock → Velocity / Geyser / Floodgate → Selected Paper instance**

The proxy should route players, not independently launch processes, issue rewards or decide parental permissions. Those decisions remain inside JBGH.

A lightweight always-on lobby or waiting connection can show "Waking Castle Kingdom…" while Paper starts. The world carousel can also request a wake before the player connects.

The first implementation should favour explicit dashboard selection and authenticated routing. Automatic wake from a direct in-game server selection can follow after the connection and identity boundaries are proven.

**4\. PRD — Functional specification**

JBGH-SW-001 · Draft v0.1 · 19 October 2026

**World states**

Each world needs an explicit lifecycle, rather than a simple online/offline boolean.

Simplified successful lifecycle. Failed, degraded and recovery states are handled separately.

Additional states must include BACKING_UP, FAILED, RECOVERING and MAINTENANCE. A failed backup must not falsely mark the world as backed up.

**Core functional requirements**

| **ID** | **Requirement**                                       | **Priority** |
| ------ | ----------------------------------------------------- | ------------ |
| SW-01  | Six world cards, with preview images and metadata     | P0           |
| SW-02  | Maximum three concurrent running/starting instances   | P0           |
| SW-03  | One idempotent wake operation per world               | P0           |
| SW-04  | Player identity and policy checks before routing      | P0           |
| SW-05  | Real readiness checks before transfer                 | P0           |
| SW-06  | Player presence tracking and 15-minute idle timer     | P0           |
| SW-07  | Graceful save and stop                                | P0           |
| SW-08  | Consistent backup, checksum and retention policy      | P0           |
| SW-09  | Persistent lifecycle state and restart reconciliation | P0           |
| SW-10  | Queue and capacity feedback                           | P0           |
| SW-11  | Java/Bedrock routing via proxy                        | P0           |
| SW-12  | Backup history and manual restore                     | P1           |
| SW-13  | World-specific RAM/CPU profiles                       | P1           |
| SW-14  | World thumbnails, favourites and recent play          | P1           |
| SW-15  | In-game lobby with world selection                    | P2           |

**Capacity rules**

A world in STARTING, ONLINE, IDLE_WAIT, SAVING or STOPPING reserves a capacity slot. It releases that slot only after the managed process has actually exited.

This prevents the dangerous situation where JBGH thinks a server has stopped while it is still using memory.

A sleeping world uses disk storage but no active Paper process. The proxy, JBGH services and optional waiting lobby remain online.

**Auto-sleep and backup rules**

The default flow should be:

Last player leaves → 15-minute idle period → recheck player presence → save → graceful stop → confirm exit → backup → verify → sleeping.

A new join during the idle countdown cancels sleep. A new join during shutdown waits for the lifecycle operation to finish rather than racing against it.

Backups must use temporary files, atomic finalization where supported, integrity checks and explicit retention. Large 12K worlds need disk-space checks and incremental backup support as a future optimization.

For resilience, sleep completion and backup completion should be separate statuses. If a backup fails after a clean stop, JBGH can safely show "Sleeping — backup needs attention" without restarting the world unnecessarily.

**5\. Security and parental-policy integration**

This is where JBGH differs from a generic Minecraft hosting panel.

A world wake request must pass through the existing authorization and entitlement resolver. A child with exhausted allowance cannot wake a world to bypass the policy. A parent can have access to a different world without changing the child's permissions.

The proxy must recheck authorization when transferring players, not rely solely on a dashboard button clicked earlier.

PaperMC's security documentation explicitly warns that backend servers behind a proxy must be protected from direct access. Use Velocity modern forwarding, a private backend network or loopback binding, and firewall rules.

![](data:image/png;base64,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)

PaperMC Docs

+1

Floodgate keys must be protected as secrets and must never appear in dashboard logs, backup downloads or audit payloads.

![](data:image/png;base64,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)

GeyserMC

**Proposed provider-neutral interfaces**

interface WorldRuntimeAdapter {

start(worldId: string, operationId: string): Promise&lt;void&gt;;

getReadiness(worldId: string): Promise&lt;Readiness&gt;;

getPlayers(worldId: string): Promise&lt;PlayerIdentity\[\]&gt;;

save(worldId: string): Promise&lt;void&gt;;

stop(worldId: string): Promise&lt;void&gt;;

getResourceUsage(worldId: string): Promise&lt;ResourceUsage&gt;;

}

interface WorldRouter {

prepareRoute(playerId: string, worldId: string): Promise&lt;RouteTicket&gt;;

transfer(ticket: RouteTicket): Promise&lt;TransferResult&gt;;

}

interface WorldBackupAdapter {

createBackup(worldId: string): Promise&lt;BackupRecord&gt;;

verifyBackup(backupId: string): Promise&lt;VerificationResult&gt;;

restoreBackup(backupId: string): Promise&lt;void&gt;;

}

The interfaces are proposed contracts, not claims about existing JBGH code. They would be integrated with the current Provider Manager, persistence repositories, operations, event bus and audit services.

**Proposed API surface**

| **Endpoint**                     | **Purpose**                              |
| -------------------------------- | ---------------------------------------- |
| GET /api/worlds/catalog          | List world cards and availability        |
| GET /api/worlds/:id/runtime      | Live state, players, resource usage      |
| POST /api/worlds/:id/wake        | Authorized, idempotent startup           |
| POST /api/worlds/:id/join-intent | Request a time-limited connection ticket |
| POST /api/worlds/:id/sleep       | Authorized controlled shutdown           |
| GET /api/worlds/:id/backups      | Backup history                           |
| POST /api/worlds/:id/backups     | Create backup                            |
| POST /api/worlds/:id/restore     | Controlled restore, with confirmation    |
| GET /api/worlds/capacity         | Active slots, reservations and queue     |

Existing JBGH API naming and contract conventions should take precedence when implementing these routes.

**6\. Implementation framework and milestones**

I would divide this into four deliverable phases, rather than attempting everything in one Codex implementation.

Phase A — World Registry and Orchestrator

Build six-world registry, three-slot capacity controller, persistent state machine, queue, idle scheduler and provider-neutral runtime contracts.

First build

Phase B — Velocity / Geyser Integration

Add the proxy adapter, crossplay routing, identity forwarding, connection tickets, startup waiting experience and real Paper acceptance tests.

Phase C — Smart Sleep and Backup

Implement real player-count reconciliation, idle countdown, safe shutdown, backup verification, restore and crash recovery.

Phase D — World Explorer Dashboard

Add six visual cards, live statuses, player counts, wake progress, capacity indicator, queue and backup history.

**7\. Real-world acceptance requirements**

Before declaring Smart Worlds production-ready, JBGH must demonstrate all of the following with real Paper instances and Java/Bedrock clients:

- Two children play World 1 while two adults independently wake and join World 2.
- World 3 starts without interrupting Worlds 1 and 2; World 4 is queued when capacity reaches three.
- The last player leaving starts the idle countdown; reconnecting cancels it.
- After 15 minutes empty, a world saves, stops, backs up and releases its capacity slot.
- A sleeping world wakes and retains all builds, inventories and player data.
- Parental bedtime and exhausted allowance block unauthorized joins, including direct proxy attempts.
- Simultaneous wake requests do not launch duplicate instances.
- Failed startups, crashes, failed backups and JBGH restarts recover without deleting or corrupting world data.

Performance acceptance should include measurements of cold-start time, peak RAM, CPU load, backup duration and disk consumption. Three active worlds remains a proposed cap, not a hardware-validated guarantee, until your server is benchmarked.

**8\. Decisions I would lock**

**Architecture Decision Record**

Proposed

| **Decision**         | **Selection**               |
| -------------------- | --------------------------- |
| Networking           | Velocity                    |
| Crossplay            | Geyser + Floodgate          |
| World execution      | Independent Paper instances |
| World catalogue      | 6 initially                 |
| Active capacity      | 3 maximum                   |
| Idle timeout         | 15 minutes                  |
| Backup               | On successful shutdown      |
| Lifecycle owner      | JBGH Orchestrator           |
| Policy owner         | Existing JBGH services      |
| Primary UI           | World Explorer carousel     |
| Implementation style | Provider-neutral, API-first |

**Official technical references**

These are the main sources I'd use during implementation:

- [PaperMC — Velocity setup and Java requirements](https://docs.papermc.io/velocity/getting-started/?utm_source=chatgpt.com)
- [PaperMC — Secure player forwarding](https://docs.papermc.io/velocity/player-information-forwarding/?utm_source=chatgpt.com)
- [PaperMC — Backend security](https://docs.papermc.io/velocity/security/?utm_source=chatgpt.com)
- [GeyserMC — Current setup and crossplay](https://geysermc.org/wiki/geyser/setup/?utm_source=chatgpt.com)
- [Floodgate — Authentication configuration](https://geysermc.org/wiki/floodgate/setup/?utm_source=chatgpt.com)
- [Impulse — Dynamic server lifecycle reference](https://github.com/Arson-Club/Impulse?utm_source=chatgpt.com)
- [AutoStopper — Readiness and idle-shutdown reference](https://github.com/Criseda/AutoStopper?utm_source=chatgpt.com)

**Recommendation**

Approve this as the JBGH Smart Worlds architecture and PRD draft, but keep it separate from the existing JBGH-020 Content Library milestone until numbering is reconciled.

The key architectural outcome is that the World Explorer is not merely a visual world selector. It becomes a controlled, resource-aware game hosting experience:

Choose world → authorize player → reserve capacity → wake Paper → verify readiness → join → play → idle → save → stop → verify backup → sleep.

The next concrete action is to inspect the current JBGH repository against this PRD, identify reusable Provider Manager and lifecycle components, and produce a gap analysis before implementation. That will prevent duplicating the functionality already proven in JBGH-019 and earlier milestones.

For fast-changing Minecraft versions, I'd also recheck the exact Velocity, Paper, Geyser and Floodgate release compatibility immediately before installing the test environment.

recheck the exact Velocity, Paper, Geyser and Floodgate release compatibility

**JBGH Smart Worlds — Compatibility Recheck**

Checked 20 October 2026 · Official PaperMC and GeyserMC sources

The proposed Velocity + Paper + Geyser + Floodgate architecture remains appropriate, but there's an important change to account for: Minecraft's newer 26.x releases and the Bedrock NetherNet transition.

**Current release findings**

| **Component** | **Latest identified**                                        | **JBGH implication**                                                 |
| ------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Velocity      | 4.3.0 build 44                                               | Java 25 minimum                                                      |
| Paper         | 26.2 build 123 on the retrieved download listing             | Current Paper candidate; check for newer builds before installation  |
| Geyser        | Current documentation targets Java 26.3, Bedrock 26.30–26.52 | Backend must accept the Java protocol Geyser uses                    |
| Floodgate     | Current Velocity-compatible build available                  | Use Velocity-specific artifact; exact build still needs confirmation |

Sources: PaperMC downloads and documentation, GeyserMC downloads and setup.

![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABMlBMVEVHcEyR2gCtO0mN0wE7OzuRPkH95z86Ozt2tUo5OjuvpS2gPkXq5zw6ebA9irw8PDyEPD+X2QDpXExEg9C5OUyFOj3+QWQpMDpucWj54jo+jeBDb21+lqLJdDzbxyzBuDphOjv+UFj96kb/TVj+RFhXan960QDy3DX/9UetqGH76EWnQEd6tgDEjDNBj+CfpoqbWjt0jwomh+f75kb45EaKxwD/6kB+dTtlXz1xOTu7fzZ0oAF4eSammTv/S1jEsjWavgBIcVZBa3NDkeH8T1b/6TqUbyw9daJzj6RF/0X/Qv5DQ0P///86QkL+/v4+PkE3Nzc7Oz5BQED/T1cqKiqjo6MwMDDOzs7BwcHp6elWVlb19fW1tbWIiIj/SFo2hNthYWF6enqampra2trg4OBHcEzh48ltAAAAZnRSTlMA/e/6h+/8g/KV8uwd9u9L65X59u70Enz09MTm8O/287lee8lA6XOWEfJG5frzWfLl5zbiM/TFupXsju/h2pSK8R/rGpa067H88////////////////////////////v///////wC/pSoXAAAB00lEQVQ4jZWSCW+bQBCFOW2Cje0Y2/HtpLmbO25637e0C8thwMZ32v//GzoLBYGMK/UJIaH3sTvzZhjmPzU8vW8zxe3+8/7PpSKxJ1v9gVqS2Ae5d2hn+t9uStLgqrpY2LbdSDnlHaoXzc53juMKYqVSebW/U04AeURlEYtokRASYrtxsI8ylI+Br3ZdS3uGmwKO7EoKMN3ZZJQAdi8XYgIgo/kUewDsxQBfLcSA5a5+Yx07BjLlKNAfbO8iAgxrjLGu47mJSDMXEtdLSeZCwBw5GOPJVMcrgqzOTe5ZQLQVvqYFl6+ncLrnwREmfN6VBgHxtK9KtwC4/i9Mb5/BizZBbiW1PwSg2Dov3RFkzKiNm4+0BA9y0GoPSje4otjqdixE5nDAxFyDHzQBgCwt7wPibHhs0RJ8Z+RTX8drAgDXY5XrsNGzd+Rvwt6EdqmvKFCo8rtRVntRDOP541jHU6gRgMUlnx43BRzfRc44AET7NbMBzHxIyDBQCLzfACDqeGha/fBgE0gqniZIgB9CEdOCJwCEBFAWhLooFrjaxds3n4/ll3mQkFxaEGx69eojL6nd1hMmS0eNE5aVFPU8l+0Hq/Vp2f6QO93qg77A9P/lZ+kPKf6Up7h4lvUAAAAASUVORK5CYII=)

PaperMC

+5

Important: These findings do not yet establish one fully tested, exact four-component build combination. In particular, Paper 26.2 and Geyser's advertised Java 26.3 protocol target require an additional compatibility decision.

**Critical update: Bedrock NetherNet**

GeyserMC announced on 8 October 2026 that Bedrock 26.60, planned for 27 October 2026, will discontinue RakNet connections.

Geyser build 1237 or newer supports NetherNet, but the transport must be enabled in configuration. NetherNet also requires TCP signaling alongside UDP gameplay.

![](data:image/png;base64,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)

GeyserMC

This needs to become a mandatory JBGH compatibility requirement.

**Recommended installation matrix**

| **Component**     | **Recommended target**                                     |
| ----------------- | ---------------------------------------------------------- |
| Velocity          | 4.3.0 build 44                                             |
| Java runtime      | Java 25 for Velocity                                       |
| Paper             | 26.3, in a fresh isolated test instance                    |
| Geyser            | Latest Geyser-Velocity.jar, build ≥1237                    |
| Floodgate         | Latest floodgate-velocity.jar                              |
| ViaVersion        | Install on older Paper backends, including 1.21.4          |
| Bedrock transport | NetherNet, with dual transport during transition if needed |

Paper 26.3 is confirmed released, although I couldn't establish its exact latest build number from the available official download results.

![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABMlBMVEVHcEyR2gCtO0mN0wE7OzuRPkH95z86Ozt2tUo5OjuvpS2gPkXq5zw6ebA9irw8PDyEPD+X2QDpXExEg9C5OUyFOj3+QWQpMDpucWj54jo+jeBDb21+lqLJdDzbxyzBuDphOjv+UFj96kb/TVj+RFhXan960QDy3DX/9UetqGH76EWnQEd6tgDEjDNBj+CfpoqbWjt0jwomh+f75kb45EaKxwD/6kB+dTtlXz1xOTu7fzZ0oAF4eSammTv/S1jEsjWavgBIcVZBa3NDkeH8T1b/6TqUbyw9daJzj6RF/0X/Qv5DQ0P///86QkL+/v4+PkE3Nzc7Oz5BQED/T1cqKiqjo6MwMDDOzs7BwcHp6elWVlb19fW1tbWIiIj/SFo2hNthYWF6enqampra2trg4OBHcEzh48ltAAAAZnRSTlMA/e/6h+/8g/KV8uwd9u9L65X59u70Enz09MTm8O/287lee8lA6XOWEfJG5frzWfLl5zbiM/TFupXsju/h2pSK8R/rGpa067H88////////////////////////////v///////wC/pSoXAAAB00lEQVQ4jZWSCW+bQBCFOW2Cje0Y2/HtpLmbO25637e0C8thwMZ32v//GzoLBYGMK/UJIaH3sTvzZhjmPzU8vW8zxe3+8/7PpSKxJ1v9gVqS2Ae5d2hn+t9uStLgqrpY2LbdSDnlHaoXzc53juMKYqVSebW/U04AeURlEYtokRASYrtxsI8ylI+Br3ZdS3uGmwKO7EoKMN3ZZJQAdi8XYgIgo/kUewDsxQBfLcSA5a5+Yx07BjLlKNAfbO8iAgxrjLGu47mJSDMXEtdLSeZCwBw5GOPJVMcrgqzOTe5ZQLQVvqYFl6+ncLrnwREmfN6VBgHxtK9KtwC4/i9Mb5/BizZBbiW1PwSg2Dov3RFkzKiNm4+0BA9y0GoPSje4otjqdixE5nDAxFyDHzQBgCwt7wPibHhs0RJ8Z+RTX8drAgDXY5XrsNGzd+Rvwt6EdqmvKFCo8rtRVntRDOP541jHU6gRgMUlnx43BRzfRc44AET7NbMBzHxIyDBQCLzfACDqeGha/fBgE0gqniZIgB9CEdOCJwCEBFAWhLooFrjaxds3n4/ll3mQkFxaEGx69eojL6nd1hMmS0eNE5aVFPU8l+0Hq/Vp2f6QO93qg77A9P/lZ+kPKf6Up7h4lvUAAAAASUVORK5CYII=)

PaperMC

Geyser explicitly requires backends to accept Java 26.3 connections, and recommends ViaVersion on older backends.

![](data:image/png;base64,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)

GeyserMC

**Recommended JBGH layout**

JBGH

├── Velocity 4.3.0

│ ├── Geyser-Velocity (NetherNet-capable)

│ └── Floodgate-Velocity

│

├── World 1 → Paper 26.3

├── World 2 → Paper 26.3

├── World 3 → Paper 26.3

│

└── Legacy test → Paper 1.21.4 + ViaVersion

Only three world instances would run concurrently. The legacy environment should be isolated from production worlds.

Do not upgrade your existing 1.21.4 integration worlds in place. Paper warns that worlds upgraded to 26.3 cannot be downgraded.

![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAABMlBMVEVHcEyR2gCtO0mN0wE7OzuRPkH95z86Ozt2tUo5OjuvpS2gPkXq5zw6ebA9irw8PDyEPD+X2QDpXExEg9C5OUyFOj3+QWQpMDpucWj54jo+jeBDb21+lqLJdDzbxyzBuDphOjv+UFj96kb/TVj+RFhXan960QDy3DX/9UetqGH76EWnQEd6tgDEjDNBj+CfpoqbWjt0jwomh+f75kb45EaKxwD/6kB+dTtlXz1xOTu7fzZ0oAF4eSammTv/S1jEsjWavgBIcVZBa3NDkeH8T1b/6TqUbyw9daJzj6RF/0X/Qv5DQ0P///86QkL+/v4+PkE3Nzc7Oz5BQED/T1cqKiqjo6MwMDDOzs7BwcHp6elWVlb19fW1tbWIiIj/SFo2hNthYWF6enqampra2trg4OBHcEzh48ltAAAAZnRSTlMA/e/6h+/8g/KV8uwd9u9L65X59u70Enz09MTm8O/287lee8lA6XOWEfJG5frzWfLl5zbiM/TFupXsju/h2pSK8R/rGpa067H88////////////////////////////v///////wC/pSoXAAAB00lEQVQ4jZWSCW+bQBCFOW2Cje0Y2/HtpLmbO25637e0C8thwMZ32v//GzoLBYGMK/UJIaH3sTvzZhjmPzU8vW8zxe3+8/7PpSKxJ1v9gVqS2Ae5d2hn+t9uStLgqrpY2LbdSDnlHaoXzc53juMKYqVSebW/U04AeURlEYtokRASYrtxsI8ylI+Br3ZdS3uGmwKO7EoKMN3ZZJQAdi8XYgIgo/kUewDsxQBfLcSA5a5+Yx07BjLlKNAfbO8iAgxrjLGu47mJSDMXEtdLSeZCwBw5GOPJVMcrgqzOTe5ZQLQVvqYFl6+ncLrnwREmfN6VBgHxtK9KtwC4/i9Mb5/BizZBbiW1PwSg2Dov3RFkzKiNm4+0BA9y0GoPSje4otjqdixE5nDAxFyDHzQBgCwt7wPibHhs0RJ8Z+RTX8drAgDXY5XrsNGzd+Rvwt6EdqmvKFCo8rtRVntRDOP541jHU6gRgMUlnx43BRzfRc44AET7NbMBzHxIyDBQCLzfACDqeGha/fBgE0gqniZIgB9CEdOCJwCEBFAWhLooFrjaxds3n4/ll3mQkFxaEGx69eojL6nd1hMmS0eNE5aVFPU8l+0Hq/Vp2f6QO93qg77A9P/lZ+kPKf6Up7h4lvUAAAAASUVORK5CYII=)

PaperMC

**Final compatibility verdict**

Architecture supported

Integration testing required

The proposed stack is compatible at the documented protocol and platform level, but the exact selected JAR builds have not yet passed a joint live acceptance test.

I'd add a JBGH Smart Worlds compatibility gate that records actual JAR versions, Java runtimes, Bedrock transport mode, successful Java and Bedrock joins, proxy transfers and reconnects before allowing the stack into the six-world environment.

This is particularly important now because of the imminent NetherNet transition.