# Product

## Register

brand

## Users

Developers building interactive data visualizations, including large, changing directed-graph interfaces, are the primary audience. Engineering peers, potential collaborators, and portfolio visitors also need a direct path from working examples to usable documentation and reproducible evidence.

## Product Purpose

Dagr is a general data visualization toolkit. The maintainer's 2026-11-07 direction broadens the [2026-10-17 renderer-first decision](specs/roadmap-notes.md#priority-reset-webgpu-renderer-first-2026-10-17-utc), retaining stable graph identity, incremental layout and animated GPU rendering as strengths. Claims about the renderer name the workload, adapter and measured limit. WebGL2 is the fallback, with parity verified separately.

The graph model owns identity and patches; layout owns positions and routes; the renderer owns drawing and motion; React binds those layers to applications. Explorer adds graph reading and navigation, while VDSL adapts a consumer's node and connection types. The private chart package currently adds animated bar and line charts through GPU or SVG rendering. It is not published or forwarded by the public umbrella; a separately authorized release is required. This direction does not promise additional chart types or editor features.

The System Atlas remains a rich-node VDSL example, not the product identity. Scheduling follows the [ROADMAP.md](ROADMAP.md) 2026-10-29 priority refresh: mobile usability, portable skills, then library readiness. Distinguish measured capability from performance targets. One scheduled daily owner resumes eligible existing PRs across tracks before new work, including report-format delivery; new report implementation retains its dedicated track. Weekly process and agentic-development, OSS and data visualization research informs bounded proposals without automatically changing priorities.

## Brand Personality

Precise, geometric, exploratory. Preserve the existing Dagr mark and the relationship to PRNT's Muslin design system. Dagr is the product identity. The System Atlas demonstrates a consumer-defined visual language.

## Anti-references

Do not lead with the campaign/DND fixture, generic feature-card marketing, fabricated telemetry, or complexity that makes the architecture harder to understand.

## Design Principles

- Show working behavior before explaining implementation detail.
- Let visitors explore relationships and inspect meaning.
- Distinguish source-derived architecture, illustrative examples, and measurements.
- Keep current capabilities and planned editor features separate.
- Preserve experiments as artifacts without making them the public showcase.

## Accessibility & Inclusion

Target WCAG AA in changed surfaces. Use keyboard-operable controls, visible focus, readable architecture alternatives, reduced-motion support, and labels that do not depend on color or hover alone.
