# AggBoard roadmap

## Done

### Drawing and handling
- Pen with pressure, 5 colours, 3 widths; shape-preserving ink for fast writing; interrupted strokes are kept; iPad system gestures blocked; palm guard.
- Stroke eraser, laser pointer, undo/redo per page covering every change.
- Shape snapping: hold at the end of a stroke for lines (snapped to 0/45/90°), angled lines, arrows (one or two strokes), triangles, rectangles, polygons, circles and ellipses. Curvy handwriting is left alone.
- Lasso selection: move, scale, duplicate, delete, recolour; whatever is selected moves with any tool.
- Finger input: Auto (Pencil detection) / Draw / Pan & zoom.

### Aggregates and chains
- Aggregate tool: draw a box, it fills with a 3D fractal aggregate; live monomer size and D_f; new random; colour; advanced k_f with an automatic default valid for D_f 1–3.
- Two tunable generators, both exact: **cluster–cluster** (default, realistic anisotropy, D_f 1–2.3, automatic fallback above) and **particle–cluster** (D_f 1–3, keeps its core when resized). Readout: N, R_g, fitted D_f, anisotropy.
- Handles: bottom-right scales, bottom-left refills, top-right rotates in 3D. The box refits tightly to the projection. Aggregates fill square boxes well (in-plane orientation search). Up to 5000 monomers, with a message when the limit is reached.
- Live updates while dragging sliders, also when generation is slower than the slider; structures always drawn at their correct size.
- Two ways to place an aggregate (Settings → New aggregates): **Box** (drag a box) or **Circle** (drag from the centre: horizontal distance = outer radius, vertical offset = monomer size; live circle, monomer ring and N estimate; real aggregate when the pencil rests). Circle-placed aggregates keep a true circle fit when regenerated. During the circle gesture a D_f scale appears for the other hand (arrow keys with a keyboard), and the label shows D_f, a and N. *To decide after trying both: keep one or both.*
- Tap selects an aggregate in any tool; double-tap opens its settings; the settings panel stays put while editing.
- Particle-chain tool with temperature; attaching to aggregates and chains, bridging, branches and rings, collision-free junctions; "edited" aggregates (scale instead of regenerate, Regenerate… to undo the edits).

### Pages, boards, export
- Pages; clear page (broom in the page bar, Undo in the message); delete page.
- Dark board per page, with adaptive ink and aggregate shading.
- Export: page as PNG; page or selection as SVG (vector strokes, shaded vector spheres, cropped selection on transparent background).

### Platform
- IndexedDB autosave; notebook save/open as a versioned file (format version 2).
- Offline support (service worker) with a Reload prompt for new versions; warning when files from different releases are mixed; version number in the menu.
- Input diagnostics recorder (copyable log) for device problems.
- Menu on the left, grouped into This page / Export / Notebook / Settings / Help; help text organised by topic.
- Name: AggBoard. License: MIT (Copyright (c) 2026 Carsten Dominik).

## Open

### Aggregates
- **Teaching overlays:** optionally show N, D_f, a, R_g next to an aggregate, or draw the R_g circle.
- **Brighter spheres on the dark board,** if aggregates look dim on the projector.
- **Import from the Aggregation Gallery** (cdominik.github.io/apps/coag_gallery): place a simulated DLA/BPCA/BCCA/DLCA aggregate on the page as an object to rotate, scale and annotate. Needs an export in the gallery apps and an import here (`index radius x y z` text format).
- **Export coordinates** of an aggregate in the same text format.
- **Polydisperse monomers:** a size-spread control (log-normal). Needs a decision on which scaling-law convention to enforce (definition of R_g and a; e.g. FracVAL's).
- **Per-sphere radii:** needed for polydispersity and to bridge aggregates with different monomer sizes (currently the chain connects to the first one only). Requires a data-format extension.
- **Cluster–cluster subcluster size** as an advanced setting (currently automatic, about N^0.4).
- **Temperature for generated aggregates** near D_f = 1 (drawn chains already have it).
- **Chains in depth:** chains avoid overlaps, but their depth runs linearly between the two ends; they don't wrap around an aggregate in 3D on purpose.
- **Depth-cue control** per aggregate.
- **Projection hint:** at D_f > 2 the 2D view looks nearly solid; rotating shows the structure.

### Drawing
- **Highlighter:** wide translucent strokes (would work with shape snapping for straight highlight bars).
- **Page patterns:** grid, lined, dot grid.
- **Text labels** (typed).
- **Inserting images or PDF slides** — larger feature, maybe never.

### Pages and notebooks
- **Page management:** reorder, duplicate, thumbnails strip.
- **Multiple named notebooks** with a notebook list.
- **PDF export** of the whole notebook.

### Platform and maintenance
- **"Menu on the right" setting** for left-handed use.
- **Performance on very long notebooks:** cache rendered pages; render only changed regions.
- **Automated test suite in the repository:** the tests used during development (simulated browser with real canvas rendering) could be included so changes can be checked before publishing.
- **Optional cloud sync** (only if ever needed), e.g. Supabase or Firebase. The data format is already serialisable, so this would be an addition, not a rewrite.
