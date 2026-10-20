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
- Polydisperse monomers: size spread σ_g (1–1.4, log-normal truncated to a_g/2…2a_g); N = k_f (R_g/a_g)^D_f with mass-weighted R_g, enforced in mass form during growth (avoids sorting monomers by size), so it holds on average; separate engine path so σ_g = 1 is bit-for-bit identical to the monodisperse engine; spread-aware automatic k_f; chains attach to monomers of any size and bridge aggregates of different monomer sizes; file format version 4 only when needed.
- Advanced settings per aggregate (panel → Advanced): k_f (auto or fixed) and cluster–cluster subcluster size (auto ≈ N^0.4 or 2–500). New aggregates use the last values; defaults reproduce the previous aggregates exactly.
- Decided against temperature for generated aggregates: it can only bend low-D_f chains by breaking the scaling law, and its effect was not intuitive. Lowering D_f slightly (1.2–1.3) gives bent strings with an exact law; temperature stays in the chain tool.
- Teaching overlays per aggregate: numbers (N, D_f, k_f, a, R_g, R_out, filling factor φ = N (a/R)^3 with R = √(5/3) R_g) and the R_g circle (with R_out circle and centre of mass); colouring by growth order (particle–cluster) or subcluster (cluster–cluster), hand-drawn parts grey; mass–radius rings (around the monomer nearest the centre of mass) with counts, and a log-log plot of the centre-averaged ⟨N(r)⟩ whose fitted slope (3a…0.7 R_g, matches D_f within ~0.05) is compared with D_f; in exports, follow spin.
- Spin ("show 3D"): one rotation (8 s) on tap, continuous on hold, selection-only if something is selected, paused while touching the page, tilted axis; display only (stored orientation is saved/exported and restored). Settings → Spin: Rotate | Rock (rock = ±35° swing, 4.5 s per swing).
- Animated GIF export of rotate or rock (page or selection, 480/800/1200 px, 15/25 frames/s): one seamless cycle, shared median-cut palette (no flicker), changed-rectangle frames with transparency; built-in encoder.
- Page overview (tap the page number or ⋯ → Notebook: Pages): thumbnails of all pages, go to a page, move earlier/later, duplicate (new ids throughout), delete with Undo (also from the menu; no more confirmation dialog), new page at the end.
- Finger toggle next to ⋯: shows who draws (Pencil, or fingers, tinted); a tap lets fingers draw, the next Pencil contact switches back (replaces the Auto/Draw/Pan setting; iPadOS gives web pages no way to tell whether the Pencil is attached or charging).
- Menu reorganised: compact rows for page, export and notebook actions; settings and input diagnostics in a Settings view inside the menu.
- Coordinate export per aggregate (Settings → Coordinates…): text file `index radius x y z` in units of a, orientation as shown (right-handed), origin at the centre of mass, header with N, Df, kf, method, seed, Rg.
- Video (MP4, H.264) export of the same animation via WebCodecs, frame-exact; built-in MP4 muxer (validated against x264/ffmpeg frame by frame, including B-frames, and with GPAC MP4Box).
- Live updates while dragging sliders, also when generation is slower than the slider; structures always drawn at their correct size.
- Two ways to place an aggregate (Settings → New aggregates): **Box** (drag a box) or **Circle** (drag from the centre: horizontal distance = outer radius, vertical offset = monomer size; live circle, monomer ring and N estimate; real aggregate when the pencil rests). Circle-placed aggregates keep a true circle fit when regenerated. A D_f scale on the left edge (while the aggregate tool is active, and for the freshly placed aggregate) sets D_f before or after drawing; during the gesture, small loops change D_f (the "dial": clockwise = higher, about 0.3 per loop; kept alongside the scale, which sets D_f in advance), or Z/X, arrow keys, mouse wheel. Two-handed use (finger on the scale while the pencil draws) is impossible on iPad: the system withholds finger touches while the pencil is down. Circle is the default; Box remains available as a setting.
- Tap selects an aggregate in any tool; double-tap opens its settings; the settings panel stays put while editing.
- Particle-chain tool with temperature; attaching to aggregates and chains, bridging, branches and rings, collision-free junctions; "edited" aggregates (scale instead of regenerate, Regenerate… to undo the edits).

### Pages, boards, export
- Page format per page: Screen, 16:9, 16:10, 4:3, A4 landscape (same width, height varies; new pages inherit; file format version 3).
- Pages; clear page (broom in the page bar, Undo in the message); delete page.
- Dark board per page, with adaptive ink, and aggregates shaded brighter there (higher brightness floor, gentler depth fading, light rim) so they read on a projector.
- Export: page as PNG; page or selection as SVG (vector strokes, shaded vector spheres, cropped selection on transparent background).

### Platform
- IndexedDB autosave; notebook save/open as a versioned file (format version 2).
- Offline support (service worker) with a Reload prompt for new versions; warning when files from different releases are mixed; version number in the menu.
- Input diagnostics recorder (copyable log) for device problems.
- Writing-hand setting: with "Left", the ⋯ button, the menu and the D_f scale move to the right.
- Menu on the left, grouped into This page / Export / Notebook / Settings / Help; help text organised by topic.
- Name: AggBoard. License: MIT (Copyright (c) 2026 Carsten Dominik).

## Open

### Aggregates
- **Import from the Aggregation Gallery** (cdominik.github.io/apps/coag_gallery): place a simulated DLA/BPCA/BCCA/DLCA aggregate on the page as an object to rotate, scale and annotate. Needs an export in the gallery apps and an import here (`index radius x y z` text format).
- **Chains in depth:** chains avoid overlaps, but their depth runs linearly between the two ends; they don't wrap around an aggregate in 3D on purpose.
- **Depth-cue control** per aggregate.

### Drawing
- **Highlighter:** wide translucent strokes (would work with shape snapping for straight highlight bars).
- **Page patterns:** grid, lined, dot grid.
- **Text labels** (typed).
- **Inserting images or PDF slides** — larger feature, maybe never.

### Pages and notebooks
- Page reordering by drag and drop in the page overview (buttons work now; dragging conflicts with scrolling on the iPad, so it needs a long-press design).
- **Multiple named notebooks** with a notebook list.
- **PDF export** of the whole notebook.

### Platform and maintenance
- **Performance on very long notebooks:** cache rendered pages; render only changed regions.
- **Automated test suite in the repository:** the tests used during development (simulated browser with real canvas rendering) could be included so changes can be checked before publishing.
- **Optional cloud sync** (only if ever needed), e.g. Supabase or Firebase. The data format is already serialisable, so this would be an addition, not a rewrite.

## Separate projects (not for AggBoard)

- **Modelling the experiment's Df measurement:** generate populations of aggregates in random orientations, compute what the instrument sees (projected area or brightness, depending on the optics; projected size), apply the same fit as the analysis, and compare the recovered D_f with the true one. Key caveat: projected area tracks N only for open aggregates and saturates at a projected dimension of 2. Better as a standalone tool, e.g. next to the Aggregation Gallery.

