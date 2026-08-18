---
id: visual-languages
title: Visual languages
sidebar_position: 5
---

# Visual languages

Dagr exists to draw graphs that change. The reason that is worth engineering is
that a large class of tools are, underneath, a node graph someone edits: shader
and texture networks, compositing trees, audio and signal chains, data
pipelines, build and workflow orchestration, parametric geometry. `@dagr/vdsl`
(planned for v0.2) is the toolkit layer for building one of those.

This page is the design brief for that layer, published early because it
explains choices already visible in `@dagr/graph` and `@dagr/layout`.

## The domain where node graphs actually win

Visual programming has a mixed record, and it is worth being precise about
which half Dagr is in.

General-purpose visual *languages* have largely failed. The constraint is
usually stated as the Deutsch limit — you can fit only so many primitives on a
screen — and text wins decisively below a certain granularity. Every attempt to
replace a general-purpose textual language with boxes and wires has stayed a
curiosity.

Domain-specific ones have won outright, repeatedly, wherever the domain is
genuinely dataflow-shaped:

| Tool | Domain |
| --- | --- |
| LabVIEW | instrumentation and test |
| Simulink | control systems |
| Nuke | film compositing |
| Substance Designer | material and texture authoring |
| Houdini | procedural geometry |
| Blender geometry and shader nodes | modelling and shading |
| Max/MSP, Pure Data | audio and interactive media |
| Grasshopper | parametric architecture |
| Node-RED | event wiring |
| ComfyUI | diffusion pipelines |

The pattern that holds across all of them: **the graph handles composition and
dependency; text handles computation.** Nuke has expressions, Houdini has VEX
snippets, Node-RED nodes contain JavaScript. None of them tried to make the
leaves visual. A toolkit should not push you to either.

The second pattern: successful node tools are narrow. Dagr is deliberately the
layer *below* that narrowness — the part that is the same whether you are
wiring audio or compiling a query.

## What Dagr provides, and what you provide

**Dagr provides** the graph model with stable node identity and patch-based
mutation, layout that is incremental and does not reshuffle on edit, and
rendering at a scale DOM cannot reach. Picking, selection and drag-to-connect
are planned (M4.8, M5.2, M6.3).

**You provide** the meaning. What node kinds exist, what a port carries,
whether two ports may connect, what a config field is, and what evaluating the
graph does.

Dagr will not ship an ontology. There is no built-in `Source` or `Transform`,
no config schema format of Dagr's invention, and no opinion about what
categories your nodes fall into. `@dagr/vdsl` takes an adapter describing your
node kinds and validates against it.

This is a deliberate reversal of the obvious design. An ontology is the part
every adopter has already decided for themselves, usually correctly, and a
library that decides it again has no way to know which answer is right. What
generalises is the mechanism — a port has a type token, a connection is legal
if your predicate says so — not the vocabulary.

## Layout stability is the thesis

The common way to lay out an editable node graph is to run a batch layout
after every change. `dagre` and ELK are both batch engines: neither preserves
prior positions across an edit. That works right up until the graph is
something a person is editing, at which point adding one node rearranges the
other forty and the user loses their place.

Dagr treats that as the central problem rather than a rough edge. Node identity
is stable across layouts, ordering decisions are carried forward rather than
recomputed from scratch, and the engine emits a delta so a renderer can animate
from the old positions to the new ones instead of cutting. [Incremental
layout](./layout.md) covers the mechanics.

If you are building a visual language, this is the property that decides
whether the editor feels like a document or like a slideshow.

## Encapsulation

The one thing a flat DAG genuinely cannot express is naming and reuse. Past a
screenful of nodes, a graph needs a way to say "this cluster is one thing,
called this" — and every serious node tool converged on the same answer: a node
that contains other nodes, which you navigate into.

Houdini calls them subnets, Nuke calls them Groups, Blender node groups, Max
subpatchers, Simulink subsystems, LabVIEW subVIs, Unreal collapsed graphs. A
subgraph node is, functionally, a function.

Containment in Dagr is a reference on a node, not a nested `Graph` instance.
That keeps one patch stream and one delta flow, which is what lets collapse and
expand rebind boundary edges in a single atomic patch.

The two ways to draw it have very different costs:

- **Drill-down**, planned for v0.2, replaces the canvas with the container's
  children. This needs no layout *algorithm* change — the children lay out as
  an ordinary graph. It does need one engine per container, kept alive across
  navigation: an engine retains a single graph and a single warm start, so
  re-running it on a different view is a cold run, and a cold run on every
  drill-in is the reshuffle this page just argued against.
- **Inline compound layout** draws parents and children together as nested
  boxes. Much harder — containment constrains ranking, and the barycentre
  crossing-reduction pass does not survive it — and is tracked separately.

M5.5 reserves containment in the graph model before v0.1 publishes — the
`parent` field, the `update-node-parent` patch op, and the invariants — so that
neither choice needs a breaking change to `PatchOp` later.

## Status

`@dagr/vdsl` is planned for v0.2 and does not exist yet. `@dagr/graph` and
`@dagr/layout` are usable today: you can model and lay out a node graph on them
now, and hit-testing, selection and drag-to-connect are yours to write until
M4.8, M5.2 and M6.3 land. The toolkit will be convenience over those, not a
separate engine.

See the [roadmap](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md) for
the task breakdown.
