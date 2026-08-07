# JBGH-007 - Design System Specification

Version: 0.1.0

Status: DRAFT

Product: JB3 GameHub

Document ID: JBGH-007

Dependencies: JBGH-001 -> JBGH-006

Consumed by: frontend implementation, AI Studio, component library, accessibility testing

---

# 1. Purpose

The JB3 GameHub Design System defines the reusable visual, interaction, accessibility, and responsive architecture for the platform.

It must support three fundamentally different experiences from the same underlying system:

1. Administration: parents, educators and administrators.
2. Player: children and community members.
3. Education: learning-focused interfaces and future IsikoloAi integration.

The design system must therefore separate presentation mode from application capability.

---

# 2. Design Principles

### 2.1 Progressive Disclosure

A parent should not need to understand:

- Paper
- Geyser
- Java
- Bedrock
- UDP ports
- manifests
- resource packs
- server configuration

The interface exposes:

Minecraft Server - Online

rather than:

Geyser -> UDP 19132 -> provider runtime -> backend service.

Advanced technical information remains available to administrators.

### 2.2 Provider Agnostic

The UI must never assume Minecraft is the only provider.

Preferred:

```text
GameHub
 +-- Minecraft
 +-- Provider B
 +-- Provider C
```

Not:

```text
Minecraft Dashboard
```

Minecraft-specific controls appear only when the selected provider advertises the relevant capability.

### 2.3 Capability Driven

Components should respond to provider capabilities.

Example:

```json
{
  "capabilities": [
    "server.start",
    "server.stop",
    "world.import",
    "world.export",
    "packs.install",
    "players.manage"
  ]
}
```

The frontend uses capabilities to determine which actions are available.

---

# 3. User Interface Modes

## ADMIN MODE

Target:

- parents
- educators
- administrators
- server owners

Primary information:

```text
Servers
Players
Activity
Time
Rules
Backups
Alerts
```

## PLAYER MODE

Target:

- children
- players
- community members

Primary information:

```text
Play
Worlds
Friends
Achievements
Rewards
Profile
Help
```

Technical infrastructure should be almost completely hidden.

## EDUCATION MODE

Target:

- students
- educators

Primary information:

```text
Learning
Assignments
Progress
Achievements
Quizzes
Rewards
```

The educational layer must remain modular so that IsikoloAi can eventually integrate without making GameHub dependent upon it.

---

# 4. Component Hierarchy

The system follows atomic design.

```text
Design Tokens
      v
Atoms
      v
Molecules
      v
Organisms
      v
Templates
      v
Pages
```

---

# 5. Design Tokens

Tokens are the lowest-level design contract.

```text
colors
typography
spacing
radius
elevation
motion
breakpoints
z-index
```

Example:

```json
{
  "spacing": {
    "xs": "4px",
    "sm": "8px",
    "md": "16px",
    "lg": "24px",
    "xl": "32px"
  }
}
```

Applications must consume tokens rather than hardcoding visual values.

---

# 6. Colour Architecture

GameHub should use a modern gaming/technology visual language while remaining accessible.

Recommended base palette:

```text
Background Primary
Background Secondary
Surface
Surface Elevated
Border
Text Primary
Text Secondary
Success
Warning
Danger
Information
Accent
```

JB3 brand integration can use the existing JB3 visual language without making the entire platform dependent upon branding.

Where appropriate:

```text
Slate Blue Steel  #22324A
Neon Circuit Green #66FF66
Chrome Silver
Cyber Orange #FF6A00
```

The implementation should store these as semantic tokens rather than using raw hexadecimal values throughout components.

---

# 7. Typography

Three hierarchy levels are required.

### Display

Used for:

- player landing screens
- major achievements
- onboarding

### Interface

Used for:

- dashboards
- navigation
- controls
- cards

### Reading

Used for:

- educational material
- instructions
- documentation
- help

Typography must support:

- desktop
- tablet
- mobile
- multilingual content

---

# 8. Core Atoms

Initial atom library:

```text
Button
IconButton
Badge
Avatar
Icon
Text
Heading
Input
Select
Checkbox
Switch
ProgressBar
Tooltip
Divider
StatusIndicator
```

Every atom must have:

```text
default
hover
focus
active
disabled
loading
error
```

states where applicable.

---

# 9. Core Molecules

Initial molecule library:

```text
SearchBar
ServerStatus
PlayerIdentity
ServerSelector
Notification
ConfirmationDialog
FormField
ProgressIndicator
AchievementBadge
TimeRemaining
PackStatus
```

---

# 10. Core Organisms

```text
Sidebar
TopNavigation
ServerCard
PlayerList
ServerControlPanel
WorldSelector
PackManager
ActivityFeed
AnalyticsPanel
ParentControlPanel
AI Assistant Panel
```

---

# 11. Server Card

The server card is a primary reusable component.

Example conceptual structure:

```text
+-------------------------------------+
| Minecraft                           |
| Celestial Castle                    |
|                                     |
| * ONLINE                            |
|                                     |
| 6 Players        2 Worlds           |
|                                     |
| [ PLAY ]       [ MANAGE ]           |
+-------------------------------------+
```

The card should not assume that all providers have:

- worlds
- players
- packs
- a Play action

Those elements appear based upon capabilities.

---

# 12. Server Status

Standard states:

```text
ONLINE
STARTING
STOPPING
OFFLINE
ERROR
UNKNOWN
MAINTENANCE
```

Status must be communicated through:

- text
- iconography
- visual state

Colour alone must never communicate critical state.

---

# 13. Player Experience

The player interface should feel dramatically simpler than the administrator interface.

Example:

```text
WELCOME BACK

[ PLAY ]

Your Worlds
------------
Celestial Castle
Skyblock
Adventure World

Achievements
------------
████████░░ 80%

Time Remaining
------------
01:24:16
```

The player should not encounter:

```text
IP
UDP
TCP
DNS
Provider ID
Java version
Docker
API tokens
```

unless explicitly entering an advanced/debug area.

---

# 14. Parent Dashboard

The parent dashboard prioritizes confidence and clarity.

Example:

```text
GOOD EVENING

Children
------------

Skyler
* Playing
1h 12m today

Server
------------

Family Minecraft
* Online

Today's activity
------------

Play time       72 min
Learning        38 min
Achievements   +3

[ VIEW ACTIVITY ]
```

The parent should understand what happened without understanding how the server works.

---

# 15. Parental Controls

Controls should use human-readable language.

Instead of:

```text
max_session_duration = 7200
```

show:

Daily Play Time

2 hours

Instead of:

```text
allow_server_id = srv_001
```

show:

Allowed Games

Family Minecraft

---

# 16. Educational Interface

Education should use a low-distraction layout.

Core components:

```text
LessonCard
QuizCard
ProgressTracker
Achievement
LearningStreak
Assignment
TeacherFeedback
RewardStatus
```

The architecture permits:

```text
IsikoloAi
     v
Education API
     v
GameHub
```

without making GameHub dependent upon IsikoloAi.

---

# 17. AI Assistant

The AI Studio interface is a first-class platform component.

Conceptual structure:

```text
+-------------------------------+
| AI ASSISTANT                  |
+-------------------------------+
| What's happening?             |
|                               |
| Server failed to start.       |
|                               |
| [ Explain ] [ Fix ]           |
|                               |
| Context                       |
| Minecraft                     |
| Celestial Castle              |
| Pack validation failed        |
+-------------------------------+
```

AI should receive structured context from the backend rather than scraping the UI.

---

# 18. Minecraft Pack Management UI

The current Bedrock add-on problem becomes a concrete UX requirement.

The interface should eventually expose:

```text
World
 +-- Behavior Packs
 |    +-- Installed
 |    +-- Missing
 |    +-- Invalid
 |
 +-- Resource Packs
      +-- Installed
      +-- Missing
      +-- Invalid
```

For each pack:

```text
Name
UUID
Version
Manifest
Installed?
Referenced by world?
Valid?
```

The user should receive:

Missing Pack

rather than a raw server error.

Advanced users can inspect:

```text
manifest.json
world_behavior_packs.json
world_resource_packs.json
```

This is an example of progressive disclosure.

---

# 19. Responsive Architecture

Initial supported ecosystem:

```text
Windows Admin Laptop
        v
Desktop layout

Android Tablet
        v
Tablet/player layout

iPad
        v
Tablet/player layout
```

Recommended logical breakpoints:

```text
Mobile       < 640px
Tablet       640-1023px
Desktop      >= 1024px
Wide Desktop >= 1440px
```

The exact CSS implementation should remain framework-independent.

---

# 20. Navigation

### Desktop

```text
+--------------+-------------------------+
| GAMEHUB      |                         |
|              |                         |
| Dashboard    |                         |
| Servers      |                         |
| Worlds       |                         |
| Players      |                         |
| Activity     |                         |
| AI Studio    |                         |
| Education    |                         |
| Settings     |                         |
|              |                         |
+--------------+-------------------------+
```

### Tablet

Navigation collapses into:

```text
Top Bar
+
Bottom/Drawer Navigation
```

---

# 21. Accessibility

Target:

WCAG 2.2 AA

Requirements include:

- keyboard navigation
- visible focus states
- semantic HTML
- accessible labels
- minimum contrast requirements
- screen-reader compatibility
- reduced-motion support
- touch-friendly controls
- no colour-only status indicators
- accessible error messages

---

# 22. Touch Targets

Tablet interfaces must use sufficiently large interaction areas.

Target:

```text
minimum practical touch target: ~44 x 44px
```

This is especially important for:

- children
- parents using tablets
- accessibility
- Minecraft-style game controls

---

# 23. Notifications

Notifications use severity:

```text
INFO
SUCCESS
WARNING
ERROR
CRITICAL
```

Example:

```text
SUCCESS Server started
WARNING World has 3 missing packs
ERROR Server could not start
```

Critical errors should provide an action:

```text
[ VIEW DETAILS ]
[ ASK AI ]
[ RETRY ]
```

where supported.

---

# 24. Empty States

Empty states must explain what the user can do next.

Bad:

No servers.

Better:

No servers yet

Connect an existing server or create your first one.

```text
[ ADD SERVER ]
```

---

# 25. Loading States

Avoid blank screens.

Use:

```text
skeletons
progress indicators
status messages
```

For long operations:

```text
Importing world...

Step 2 of 4
Validating packs
███████░░░
```

---

# 26. Error Presentation

Three layers:

### Player

Something went wrong. Try again.

### Parent

The Minecraft server could not start.

### Administrator

```text
Provider: Minecraft
Operation: server.start
Error: WORLD_INVALID_CONTENT
World: Celestial Castle
```

### Developer

Full:

```text
provider response
stack/context
operation ID
event ID
logs
```

This is progressive disclosure of complexity implemented directly into the design system.

---

# 27. Design-System File Architecture

The eventual frontend should use a structure similar to:

```text
design-system/
|
+-- tokens/
|   +-- colors
|   +-- typography
|   +-- spacing
|   +-- breakpoints
|   +-- motion
|
+-- atoms/
|
+-- molecules/
|
+-- organisms/
|
+-- templates/
|
+-- themes/
|   +-- admin
|   +-- player
|   +-- education
|
+-- accessibility/
```

The exact framework implementation is intentionally deferred.

---

# 28. AI Studio Consumption Guide

AI Studio must consume this document as a component-generation contract, not as a request to manually build seven pages.

For every requested UI feature AI Studio should determine:

```text
1. Which user mode?
2. Which capability?
3. Which existing component?
4. Which design tokens?
5. Which responsive behaviour?
6. Which accessibility requirements?
7. Which provider data?
8. Which API endpoint?
9. Which loading state?
10. Which error state?
```

Example:

Add a world management screen.

AI Studio should derive:

```text
World Management
      v
Template
      v
ServerSelector
      v
WorldCard
      v
PackStatus
      v
Provider capabilities
      v
World API
```

It should reuse existing components rather than generating a new bespoke UI.

---

# 29. Generation Context

AI Studio must know:

```yaml
product: JB3 GameHub
architecture: provider-agnostic
frontend_modes:
  - admin
  - player
  - education

primary_devices:
  - Windows laptop
  - Android tablet
  - iPad

accessibility:
  target: WCAG 2.2 AA

design_method:
  atomic_design: true
  token_based: true
  progressive_disclosure: true

provider_model:
  capability_driven: true

minecraft:
  java: Paper
  bedrock_bridge: Geyser
  pack_validation: required
```

Generated components must:

- use existing tokens
- use existing components
- expose accessibility semantics
- support responsive layouts
- avoid provider-specific assumptions unless capability metadata requires them
- include loading/error/empty states
- remain independently testable

---

# 30. Validation Checklist

```yaml
document: JBGH-007
version: 0.1.0
status: DRAFT

architecture:
  atomic_design: complete
  token_system: complete
  provider_agnostic: complete
  capability_driven_ui: complete
  progressive_disclosure: complete

interfaces:
  admin: complete
  player: complete
  education: complete
  ai_studio: complete

responsive:
  windows: complete
  android: complete
  ipad: complete

accessibility:
  wcag_2_2_aa: required
  keyboard: required
  screen_reader: required
  touch: required
  reduced_motion: required

minecraft:
  world_management: defined
  behavior_packs: defined
  resource_packs: defined
  manifest_validation: defined

generation:
  ai_consumption: complete
  component_reuse: complete
  validation_rules: complete

pending:
  concrete_component_implementation: implementation phase
  final_visual_tokens: implementation phase
  framework_selection: implementation phase
```

---

# FOUNDATION GATE - COMPLETE

All seven foundation documents now exist at DRAFT level:

| ID | Document | Status |
| --- | --- | --- |
| JBGH-001 | Vision | DRAFT |
| JBGH-002 | Product Requirements | DRAFT |
| JBGH-003 | Master Technical Specification | DRAFT |
| JBGH-004 | Architecture | DRAFT |
| JBGH-005 | API Specification | DRAFT |
| JBGH-006 | Database Schema | DRAFT |
| JBGH-007 | Design System | DRAFT |

### Dependency chain

```text
VISION
  v
PRD
  v
TECHNICAL SPEC
  v
ARCHITECTURE
  v
API
  v
DATABASE
  v
DESIGN SYSTEM
  v
IMPLEMENTATION
```

The architecture-first gate is now satisfied at DRAFT level.
