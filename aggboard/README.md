# AggBoard

A notebook-style whiteboard for teaching, with one special tool: drag a box and it fills with a real 3D fractal aggregate that you can resize, rotate, and tune (monomer size, fractal dimension) live.

Static site, no build step, no server code. Works on iPad (Apple Pencil), desktop browsers and phones.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure and styles |
| `app.js` | The whiteboard: drawing, pages, selection, storage, aggregate objects |
| `aggregate-engine.js` | Aggregate generator. Runs as a Web Worker; also loaded on the page as a fallback |
| `manifest.webmanifest`, `icon-*.png` | Home Screen / install support |
| `ROADMAP.md` | Ideas deliberately left out of version 1 |

## Hosting

Upload the folder as-is to any static host (GitHub Pages, your own web server). It must be served over `http(s)://` — opening `index.html` directly from disk (`file://`) blocks the Web Worker; the app then falls back to generating aggregates on the main thread, which works but can stutter.

To test locally:

```
cd aggboard
python3 -m http.server 8000
```

then open `http://localhost:8000` (or `http://<your-computer's-IP>:8000` on the iPad, same network).

## Configuration

At the top of `app.js`:

- `MENU_URL` — set to e.g. `'../index.html'` to show a back button to your app menu. Leave `null` for a standalone install.
- `N_MAX` — maximum monomers per aggregate (default 3000).
- `PAGE_W`, `PAGE_H` — page size in page units (default 1600 × 900, 16:9).

## Storage

Notebooks are stored in the browser's IndexedDB on each device. Nothing is uploaded anywhere.

- On iPad, **add the app to the Home Screen**. Safari may otherwise delete a website's stored data after about a week without visits.
- Use **⋯ → Save notebook to file** for backups and for giving a notebook to someone; **Open notebook from file** loads one. The file format (`*.aggboard.json`) carries a version number (currently 2) so future versions can read old files; older copies of the app refuse newer files with a clear message instead of misreading them.

## The aggregate engine

Tunable particle–cluster aggregation (Filippov, Zurita & Rosner, *J. Colloid Interface Sci.* 229, 261, 2000): each monomer is placed at the distance from the centre of mass that keeps N = k_f (R_g/a)^D_f exact, touching at least one monomer, overlapping none.

- k_f defaults to a function of D_f (`kfAuto` in `aggregate-engine.js`). A fixed k_f cannot span D_f = 1 to 3: a straight chain needs k_f ≥ √3, random dense packing needs k_f ≲ 1. With the default, the fitted D_f matches the target to three decimals over the whole range 1.0–3.0 (tested for N = 1500).
- Growth is deterministic for a given (D_f, k_f, seed), so smaller aggregates are prefixes of larger ones. Filling a box therefore grows one cluster and picks the prefix length that fills the box best (after aligning its principal axes with the box). Changing the monomer size or the box keeps the same core structure.
- Typical speed: 2000 monomers in 5–20 ms, so sliders can regenerate live.
- **Particle chains** (chain tool) are laid as touching spheres along the drawn stroke: a walk whose aim point advances one diameter along the path per step, with correlated 3D noise scaled by the temperature. N stays ≈ length / 2a at any temperature. Chains that start or end on a sphere (of an aggregate or another chain) attach at that sphere's depth, in exact contact, and are merged into its coordinate frame; such "edited" aggregates are never regenerated. New chain spheres avoid overlapping the joined structure and the chain itself (a collision grid; blocked steps tilt away from the preferred direction, and the closing sphere is placed on the circle of positions that touch both neighbours).
- Each aggregate stores its monomer coordinates in the notebook, so it looks the same after reloading even if the engine changes later. The seed is kept for regenerating.
