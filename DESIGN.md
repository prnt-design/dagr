# Dagr design

## Identity

Extend the existing Muslin-derived theme and original Dagr logo. The approved direction is the “Inside the graph” workbench: an explorable graph canvas and a contextual inspector, preceded by a concise introduction. The chess atlas leads with branching miniature boards, move labels, family filters, and a readable position inspector; architecture remains the explanatory companion.

## Color and surfaces

Use existing theme tokens for the page, text, dividers, and green accent. Maintain light and dark themes. Graph roles may use a limited green, violet, and rust palette with textual labels. Page chrome remains quiet so graph content carries the color.

## Typography

Retain the established sans-serif family from the docs theme. Large, tightly spaced headings establish hierarchy. Monospace is reserved for source paths, types, and small technical labels. Paragraphs stay below 70 characters per line where practical.

## Shape and layout

Square controls, thin complete borders, and occasional 45-degree corner cuts connect Dagr to PRNT. Avoid decorative side stripes. Desktop pairs a dominant graph with a narrower inspector; mobile stacks the inspector and provides a readable node list. No nested feature-card grids.

## Interaction

Architecture selection updates the inspector without navigating away. Modes distinguish the architecture, a guided edit, and rich content. Controls have visible focus and pressed states. Motion explains changes, never blocks reading, and respects reduced-motion preferences. Loading and rendering failures retain a useful path to the documentation.
