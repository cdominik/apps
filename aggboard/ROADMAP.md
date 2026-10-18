# AggBoard roadmap

Version 1 covers: pen with pressure, 5 colours, 3 widths, stroke eraser, lasso selection (move, scale, duplicate, delete, recolour), laser pointer, pages, undo/redo per page (including all aggregate edits), finger-drawing vs. pan-and-zoom setting with Pencil auto-detection, IndexedDB autosave, notebook save/open as a versioned file, page export as PNG, the aggregate tool (box fill, live monomer size and D_f, new random, resize, move, 3D rotate, colour, advanced k_f), and the particle-chain tool (chains with temperature; attaching chains to aggregates and bridging two aggregates of equal monomer size; "edited" aggregates).

Ideas deliberately left for later, grouped as discussed.

## Aggregates

- **Temperature for low D_f.** Drawn chains have temperature now. Still open: a temperature control for *generated* aggregates near D_f = 1, which currently come out as gently curved chains.
- **Per-sphere radii.** Needed to bridge aggregates with different monomer sizes (currently the chain connects to the first aggregate only) and for polydisperse monomers. Requires a data-format extension (a radius per monomer).
- **Chains and depth.** Chains now avoid overlapping the structure they join (and themselves), but their depth still runs linearly between the two ends; they don't wrap around an aggregate in 3D on purpose.
- **Chains following a shape in depth.** E.g. draw the same chain from two views, or set depth with a second gesture.
- **Teaching overlays.** Optionally show N, D_f, a, R_g next to the aggregate, or draw the R_g circle on it.
- **Polydisperse monomers.** A size-spread control (log-normal), as in the Sphere Aggregate app.
- **Depth-cue control** per aggregate (strength of atmospheric fading).
- **Export coordinates** of an aggregate in the `index radius x y z` text format.
- **Projection note.** At D_f > 2 the 2D rendering looks nearly solid because projections saturate; rotating in 3D shows the structure. Possibly add a short hint in the panel.
- **Cluster–cluster algorithm (FracVAL-style)** as an alternative generator, if particle–cluster shapes look too regular at some D_f.

## Drawing

- **Highlighter**: wide translucent strokes.
- **Straight lines and arrows**: e.g. hold at the end of a stroke to snap it straight; arrowhead option.
- **Page backgrounds**: blank, grid, lined, dark board for projection.
- **Text labels** (typed).
- **Inserting images or PDF slides** — larger feature, maybe never.

## Pages and notebooks

- **Page management**: reorder, duplicate, thumbnails strip.
- **Multiple named notebooks** with a notebook list.
- **PDF export** of the whole notebook.

## Platform and maintenance

- **Offline support and update flow**: a service worker for offline use, plus a version check with a "reload to update" prompt so installed copies don't keep running an old version.
- **Performance on very long notebooks**: cache rendered pages; render only changed regions.
- **Name and licence**: pick a final name; decide whether to publish the code (e.g. MIT on GitHub).
- **Optional cloud sync** (only if ever needed): a hosted backend such as Supabase or Firebase. The data format is already serialisable, so this would be an addition, not a rewrite.
