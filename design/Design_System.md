# Design System - JB³ GameHub

## 1. Color Tokens

### Base Theme Palette (Dark Mode Default)
| Token Name | Hex Code | Purpose / Usage |
| :--- | :--- | :--- |
| `Background` | `#09090b` | Main application background canvas (Zinc 950) |
| `Surface / Card` | `#18181b` | Primary container card background (Zinc 900) |
| `Surface Hover` | `#27272a` | Interactive hover states for list items & cards |
| `Border Subdued` | `#27272a` | 1px subtle container borders (Zinc 800) |
| `Border Accent` | `#3f3f46` | Focused or highlighted borders (Zinc 700) |
| `Primary / Success` | `#10b981` | Online status, primary buttons, TPS indicators (Emerald 500) |
| `Warning / Accent` | `#f59e0b` | Lag warnings, updating status, memory alerts (Amber 500) |
| `Danger / Error` | `#f43f5e` | Stopped status, offline server, delete actions (Rose 500) |
| `Bedrock Info` | `#3b82f6` | Crossplay badges, Geyser status, network IP (Blue 500) |
| `Plugin Purple` | `#a855f7` | Plugin store badges, world tags (Purple 500) |
| `Text High` | `#f4f4f5` | Main headings, primary values (Zinc 100) |
| `Text Muted` | `#a1a1aa` | Labels, descriptions, secondary text (Zinc 400) |

---

## 2. Typography & Font Hierarchy

- **Primary Font**: `Plus Jakarta Sans` / `Inter` (Sans-serif display)
- **Monospace Font**: `JetBrains Mono` / `Fira Code` (Console logs, IP addresses, ports, TPS numbers)

### Type Scale Ratio (1.25 Major Third)
- **Display Heading**: `text-2xl font-black tracking-tight` (24px - 28px)
- **Section Heading**: `text-lg font-bold text-zinc-100` (18px)
- **Subheading**: `text-sm font-semibold text-zinc-300` (14px)
- **Body Text**: `text-xs text-zinc-400` (12px)
- **Telemetry Label**: `text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-500`

---

## 3. Spacing, Geometry & Radius Math

- **Outer Container Radius**: `rounded-3xl` (24px) for main hero blocks & view containers
- **Inner Card Radius**: `rounded-2xl` (16px) for nested cards & bento grid elements
- **Control / Badge Radius**: `rounded-xl` (12px) or `rounded-lg` (8px) for buttons, inputs, chips
- **Nested Corner Rule**: `Inner Radius = Outer Radius - Padding` (e.g. 24px - 8px = 16px)
- **Touch Target Minimum**: 44px height for interactive buttons and touch controls
