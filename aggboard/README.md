# AggBoard

A notebook-style whiteboard for teaching, with one special tool: draw a circle (or a box) and it fills with a real 3D fractal aggregate that you can resize, rotate, spin and tune live (method, fractal dimension, monomer size and size spread). Overlays show the numbers, R_g, the growth history and the mass–radius relation; aggregates export as PNG, SVG, video (MP4) or GIF animations, and as coordinate files.

Static site, no build step, no server code. Works on iPad (Apple Pencil), desktop browsers and phones.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure and styles |
| `app.js` | The whiteboard: drawing, pages, selection, storage, aggregate objects |
| `aggregate-engine.js` | Aggregate generator. Runs as a Web Worker; also loaded on the page as a fallback |
| `manifest.webmanifest`, `icon-*.png` | Home Screen / install support |
| `sw.js` | Service worker: offline copy of the app, controlled updates |
| `ROADMAP.md` | Done and open ideas |
| `LICENSE` | MIT license |

## Hosting

Upload the folder as-is to any static host (GitHub Pages, your own web server). It must be served over `http(s)://` — opening `index.html` directly from disk (`file://`) blocks the Web Worker; the app then falls back to generating aggregates on the main thread, which works but can stutter.

To test locally:

```
cd aggboard
python3 -m http.server 8000
```

then open `http://localhost:8000` (or `http://<your-computer's-IP>:8000` on the iPad, same network).

## Offline and releases

`sw.js` stores a complete copy of the app per release, so it starts without network after the first visit (needs `https://` or `localhost`). A new release downloads in the background; the app shows a **Reload** prompt and switches only when the user taps it.

When you change any file, bump the version string in **all four places**: `VERSION` in `app.js` and `sw.js`, `release` in `aggregate-engine.js`, and the two `?v=` script URLs plus `want` in `index.html`. The version shown in the menu is the one from `app.js`; the page warns if the files don't match.

## Configuration

At the top of `app.js`:

- `MENU_URL` — set to e.g. `'../index.html'` to show a back button to your app menu. Leave `null` for a standalone install.
- `N_MAX` — maximum monomers per aggregate (default 5000).
- `PAGE_W`, `PAGE_H` — page width and default height in page units (1600 × 900, 16:9). Other formats (menu → This page → Format) keep the width and change the height.

## Storage

Notebooks are stored in the browser's IndexedDB on each device. Nothing is uploaded anywhere.

- On iPad, **add the app to the Home Screen**. Safari may otherwise delete a website's stored data after about a week without visits.
- Use **⋯ → Notebook: Save to file** for backups and for giving a notebook to someone; **Open file** loads one. The file format (`*.aggboard.json`) carries a version number (currently 3, or 4 when it contains polydisperse monomers) so future versions can read old files; older copies of the app refuse newer files with a clear message instead of misreading them.

## The aggregate engine

Two tunable methods, both enforcing N = k_f (R_g/a)^D_f exactly for equal monomers:

- **Cluster–cluster (default):** subclusters (about N^0.4 monomers) are grown with the particle–cluster method, then merged hierarchically in pairs of similar size. Each merge puts the centres of mass at Γ² = N²/(N₁N₂)·R_g² − N/N₂·R_g1² − N/N₁·R_g2² and searches for a touching, overlap-free orientation (contact circle + spin about the contact axis, with collision grid); a ballistic approach is the last-resort fallback. Validated: every merge exact and fitted D_f = target for D_f 1.1–2.3 (1.0 gives 1.002), no overlaps, always connected, ≤ ~0.4 s for 4000 monomers. Above D_f 2.3 compact clusters cannot meet the required distance, so the app uses particle–cluster there. Box filling regenerates for a few N values (no prefix property), so resizing gives a new structure.
- **Particle–cluster:** details below.

### Particle–cluster

Tunable particle–cluster aggregation (Filippov, Zurita & Rosner, *J. Colloid Interface Sci.* 229, 261, 2000): each monomer is placed at the distance from the centre of mass that keeps N = k_f (R_g/a)^D_f exact, touching at least one monomer, overlapping none.

- k_f defaults to a function of D_f (`kfAuto` in `aggregate-engine.js`). A fixed k_f cannot span D_f = 1 to 3: a straight chain needs k_f ≥ √3, random dense packing needs k_f ≲ 1. With the default, the fitted D_f matches the target to three decimals over the whole range 1.0–3.0 (tested for N = 1500).
- Growth is deterministic for a given (D_f, k_f, seed), so smaller aggregates are prefixes of larger ones. Filling a box therefore grows one cluster and picks the prefix length that fills the box best, trying several in-plane orientations relative to its principal axes (elongated, low-D_f aggregates fill squarish boxes better on a diagonal). Changing the monomer size or the box keeps the same core structure.
- Typical speed: 2000 monomers in 5–20 ms, so sliders can regenerate live.
- **Particle chains** (chain tool) are laid as touching spheres along the drawn stroke: a walk in which each step aims one diameter beyond the chain's current position along the drawn line (the last sphere projected onto it), with an independent random 3D shift per sphere scaled by the temperature (the noise model of the original drawing tool: 0.6 T radii per axis, T = 3 × the slider value), so deviations stay local and even along the chain. The walk continues until it reaches the end of the line, so a straight chain has N ≈ length / 2a and a warmer, wigglier one more spheres. The drawn path is first thinned to points at least half a monomer radius apart, so the Pencil's sub-pixel tremor does not lengthen it. Chains that start or end on a sphere (of an aggregate or another chain) attach at that sphere's depth, in exact contact, and are merged into its coordinate frame; such "edited" aggregates are never regenerated. New chain spheres avoid overlapping the joined structure and the chain itself (a collision grid; blocked steps tilt away from the preferred direction, and the closing sphere is placed on the circle of positions that touch both neighbours).
- **Polydisperse monomers** (size spread σ_g > 1): radii from a truncated log-normal (a_g/2 … 2a_g) drawn from their own random stream, so σ_g = 1 reproduces the monodisperse aggregates bit for bit. R_g is mass-weighted, and growth follows the accumulated mass rather than the monomer count (otherwise small monomers end up at the rim and large ones in the centre); the law then holds on average, typically within a few percent.
- Each aggregate stores its monomer coordinates in the notebook, so it looks the same after reloading even if the engine changes later. The seed is kept for regenerating.

## Exports

PNG (twice the page size), SVG (page or selection), coordinates (`index radius x y z` with a `#` header, per aggregate), and the spin as an animation. Animations are encoded in the app without libraries: GIF with a shared median-cut palette and changed-rectangle frames; MP4 (H.264) through the browser's WebCodecs encoder and a built-in MP4 muxer. Video needs WebCodecs (current Chrome, Edge, Safari, every browser on a current iPad); GIF works everywhere.

## License

MIT License, Copyright (c) 2026 Carsten Dominik. See `LICENSE`.
