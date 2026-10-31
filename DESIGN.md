# Dagr design

## Identity

Extend the existing Muslin-derived theme and original Dagr logo. The homepage leads with Dagr's renderer-first identity: big directed graphs that animate as they change. Show working rendering and interaction alongside accessible explanations of what changed. Performance claims link to reproducible evidence and name the workload, backend, adapter and limits; partial motion does not establish the all-moving 10k smooth-edge target.

The System Atlas remains an example: a dominant graph viewport with a searchable inspector, rich node content, semantic zoom and focus navigation. Its commerce language does not define Dagr's identity or require every consumer to use the same visual language. Keep page chrome quiet so the graph carries the visual interest. Follow [ROADMAP.md](ROADMAP.md) for scheduled work; this guidance does not request a showcase rewrite.

## Color and surfaces

Use existing theme tokens for the page, text, dividers, and green accent. Maintain light and dark themes. Graph roles may use a limited green, violet, and rust palette with textual labels. Page chrome remains quiet so graph content carries the color.

## Typography

Retain the established sans-serif family from the docs theme. Large, tightly spaced headings establish hierarchy. Monospace is reserved for source paths, types, and small technical labels. Paragraphs stay below 70 characters per line where practical.

## Shape and layout

Square controls, thin complete borders, and occasional 45-degree corner cuts connect Dagr to PRNT. Avoid decorative side stripes. Desktop pairs a dominant graph with a narrower inspector; mobile stacks the inspector and provides a readable node list. No nested feature-card grids.

## Interaction

Node selection updates the inspector without navigating away. Search and connection selection focus the camera. Where an example includes a language panel, it demonstrates actual VDSL validation. Controls have visible focus and pressed states. Motion explains changes, never blocks reading, and respects reduced-motion preferences. Loading and rendering failures retain a useful path to the documentation.

## Accessibility

Target WCAG AA in changed surfaces. Preserve keyboard operation, visible focus, readable graph alternatives, light and dark themes, and labels that do not depend on color or hover alone. Animation must respect reduced motion and keep content readable while the graph changes.
