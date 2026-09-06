# Loaf Calc

Mobile-first sourdough loaf-pan recipe calculator. Pure client-side, zero
dependencies, no build step.

## Run

Open `index.html` directly in a browser (plain scripts, so `file://` works),
or serve the directory to use it from your phone:

```sh
python3 -m http.server 8000
```

Then open `http://<laptop-ip>:8000` on the phone.

## Test

```sh
node --test test/
```

## How it works

Baker's math with total flour = 100%, where the flour and water inside the
starter (100% hydration) count toward the totals. The blend describes only
the flour you **add**; the starter's flour counts toward whichever flour it
is fed with (AP/WW/bread selector). Everything pivots on total flour `F`:

- **From starter:** `F = starter / starter%`
- **From dough target:** `F = dough / (1 + hydration + salt%)`

Target hydration is a weighted average over what's actually in the dough
(AP 67%, bread 72%, whole wheat 80% — added flours plus the starter's),
nudgeable ±. Displayed grams round with water as the residual so the table
always sums exactly.

## Files

The JS modules are UMD-style: plain `<script>` tags in the browser (so
`file://` works — no bundler, no modules), `require()` in the tests.

- `js/recipe.js` — pure recipe math (solving, blend rebalancing, pan presets)
- `js/storage.js` — versioned localStorage wrapper (degrades if blocked)
- `js/ui.js` — all DOM code: single state object, full re-render on change
- `test/` — `node:test` suites for the math modules
