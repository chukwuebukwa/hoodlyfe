# 0023 - Versioned Level Editor Document And Explicit Runtime Adapters

## Status

Accepted

## Context

The district now has a complete visual map, resident collision and road grids, an authored
lane graph, junctions, roadblocks, and a player spawn. Editing each artifact by hand makes it
difficult to inspect the complete world, preserve cross-file references, validate placement,
or apply changes safely. A tool that directly mutates unrelated runtime files from UI handlers
would couple the editor to every gameplay domain and become another monolith.

## Decision

The editor owns a browser-safe, versioned `LevelEditorDocument`. Source adapters assemble it
from current runtime artifacts. Export adapters produce a fixed-path game bundle while
preserving source fields the editor does not own. Domain validation runs against the editor
document before a bundle is applied.

React owns declarative tool UI and the inspector. Canvas2D owns the map viewport, visible-cell
rendering, direct manipulation, and hit testing. History uses commands; tile strokes store
compact cell patches and structural commands rely on immutable documents with shared layer
arrays. IndexedDB owns local autosave. A CLI validates and atomically replaces each runtime
artifact after an explicit export.

Simulation code does not import editor modules. Editor modules may describe runtime data but
must not execute gameplay systems. Adding a new domain requires a type, source/export adapter,
validator, renderer/hit test, and focused inspector.

## Consequences

- The editor can evolve independently from Three.js rendering and server simulation.
- Generated visual art remains read-only and cannot be corrupted by collision or lane edits.
- Cross-file changes are reviewable as ordinary runtime artifacts after bundle application.
- Future interiors, signals, services, zones, and mission anchors have a repeatable integration
  path instead of adding special cases to one UI component.
- The initial runtime adapter emits only the existing default player-spawn contract; other
  modeled spawn kinds require future catalog adapters before they become runtime-owned data.
