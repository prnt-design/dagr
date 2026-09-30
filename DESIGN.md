# Dagr design

## Identity

Extend the existing Muslin-derived theme and original Dagr logo. The homepage leads with Dagr. The system atlas pairs a dominant graph viewport with a searchable inspector. A dense overview reveals topology; semantic zoom exposes service configuration, event schemas, and typed ports. Connections support focus navigation and tracing. Keep the page chrome quiet so the graph carries the visual interest.

## Color and surfaces

Use existing theme tokens for the page, text, dividers, and green accent. Maintain light and dark themes. Graph roles may use a limited green, violet, and rust palette with textual labels. Page chrome remains quiet so graph content carries the color.

## Typography

Retain the established sans-serif family from the docs theme. Large, tightly spaced headings establish hierarchy. Monospace is reserved for source paths, types, and small technical labels. Paragraphs stay below 70 characters per line where practical.

## Shape and layout

Square controls, thin complete borders, and occasional 45-degree corner cuts connect Dagr to PRNT. Avoid decorative side stripes. Desktop pairs a dominant graph with a narrower inspector; mobile stacks the inspector and provides a readable node list. No nested feature-card grids.

## Interaction

Node selection updates the inspector without navigating away. Search and connection selection focus the camera. The language panel demonstrates actual VDSL validation. Controls have visible focus and pressed states. Motion explains changes, never blocks reading, and respects reduced-motion preferences. Loading and rendering failures retain a useful path to the documentation.
