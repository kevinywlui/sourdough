# Loaf Calc

Mobile-first sourdough loaf-pan recipe calculator. Pure client-side, zero
dependencies, no build step.

## Run

ES modules don't load over `file://`, so serve the directory:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000` — or `http://<laptop-ip>:8000` on your phone.

## Test

```sh
node --test test/
```

## How it works

Baker's math with total flour = 100%, where the flour and water inside the
starter (assumed 100% hydration, AP-fed) count toward the totals. Everything
pivots on total flour `F`:

- **From starter:** `F = starter / starter%`
- **From dough target:** `F = dough / (1 + hydration + salt%)`

Target hydration is derived from the flour blend (AP 67%, bread 72%, whole
wheat 80%, weighted average), nudgeable ±. Displayed grams round with water as
the residual so the table always sums exactly. The bake timeline scales bulk
fermentation with room temperature (rate ~doubles per 8°C) and starter %.

## Files

- `js/recipe.js` — pure recipe math (solving, blend rebalancing, pan presets)
- `js/timeline.js` — pure schedule math
- `js/storage.js` — versioned localStorage wrapper (degrades if blocked)
- `js/ui.js` — all DOM code: single state object, full re-render on change
- `js/app.js` — entry point
- `test/` — `node:test` suites for the math modules
