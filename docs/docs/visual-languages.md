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

Graph interfaces are most useful when composition and dependencies are central
to the task: materials, geometry, signals, workflows, and data pipelines.
They can coexist with text rather than replace it. A node may contain code,
a preview, or configuration, while edges describe how those pieces connect.

Dagr targets that composition layer. It does not provide the evaluator,
the domain vocabulary, or a general-purpose visual programming language.

A visual language works best with a focused vocabulary. Dagr is deliberately the
layer *below* that narrowness, the part that is the same whether you are
wiring audio or compiling a query.

## What Dagr provides, and what you provide

**Dagr provides** the graph model with stable node identity and patch-based
mutation, incremental layout with explicit deltas, and
instanced GPU rendering. Picking, selection and drag-to-connect
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
generalises is the mechanism, a port has a type token, a connection is legal
if your predicate says so, not the vocabulary.

## Layout stability is the thesis

Recomputing layout after an edit can disturb the user's mental map. Dagr
retains stable IDs and previous pipeline state, then reports a delta alongside
the new layout so a renderer can animate the change.

This is not a guarantee that every unaffected node stays at the same position.
The graph, edit, and layout stages determine how far a change propagates.
The [incremental layout guide](./incremental-layout.md) documents the measured
behavior and limitations.

Animation helps readers follow the change; predictable layout reduces the
amount they need to relearn after each edit.

## Encapsulation

Larger graphs often need named, reusable groups. Dagr's roadmap separates two
possible interfaces: navigating into a subgraph, and drawing nested groups
inline. These require different layout and lifecycle decisions.

The graph model already supports a node `parent` reference, reparenting, and
containment invariants. Navigation into subgraphs and compound layout are
separate, planned capabilities. A parent reference alone does not make the
renderer draw a nested group. See the [graph model](./graph-model.md).

## Status

`@dagr/vdsl` is planned for v0.2 and has started: the [node spec
toolkit](./vdsl.md) page covers the pieces that exist, which are the adapter
interface and the registry that resolves a node to a spec (M6.1), and port
type tokens with connection validation (M6.2). Drag-to-connect and subgraph
nodes are M6.3 to M6.6 and are not built.

`@dagr/graph` and `@dagr/layout` are usable today: you can model and lay out a
node graph on them now, and hit-testing, selection and drag-to-connect are
yours to write until M4.8, M5.2 and M6.3 land. The toolkit will be convenience
over those, not a separate engine.

See the [roadmap](https://github.com/prnt-design/dagr/blob/main/ROADMAP.md) for
the task breakdown.
