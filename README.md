# Loaf Calc

Mobile-first sourdough loaf-pan recipe calculator. Pure client-side, zero
dependencies, no build step.

## Run

Open `public/index.html` directly in a browser (plain scripts, so `file://`
works), or serve it to use it from your phone:

```sh
python3 -m http.server 8000 -d public
```

Then open `http://<laptop-ip>:8000` on the phone. Deploys to Cloudflare via
`wrangler.jsonc` (static assets from `public/`, no build step). Served over
HTTPS it's an installable PWA and works offline.

## Test

```sh
node --test test/
```

## How it works

Baker's math with total flour = 100%, where the flour and water inside the
starter (100% hydration) count toward the totals. The blend describes only
the flour you **add**; the starter's flour counts toward whichever flour it
is fed with (AP/WW/bread selector).

You enter BOTH the dough target `D` and the starter `S` you have, so
inoculation (starter ÷ total flour) is derived, not chosen. If you haven't
built the starter yet, a suggest button inverts the same formula to tell
you how much to prepare for a 20% inoculation. With `x = S/2`,
`Hb` = the added blend's weighted hydration, and `hst` = the starter
flour's hydration, total flour solves in closed form:

```
F = (D − x·(hst − Hb)) / (1 + Hb + salt% + nudge)
```

Target hydration is a weighted average over what's actually in the dough
(AP 67%, bread 72%, whole wheat 80% — added flours plus the starter's),
nudgeable ±. The solver warns (rather than blocking) on unusual inoculation
or hydration. Displayed grams round with water as the residual so the table
always sums exactly to the target.

## Files

The JS modules are UMD-style: plain `<script>` tags in the browser (so
`file://` works — no bundler, no modules), `require()` in the tests.

- `public/` — the deployed site: `index.html`, `style.css`, PWA manifest,
  service worker (`sw.js`, network-first with offline fallback), icons
- `public/js/recipe.js` — pure recipe math (solving, blend rebalancing,
  pan presets)
- `public/js/ui.js` — all DOM code plus a small localStorage wrapper:
  single state object, full re-render on change
- `test/` — `node:test` suite for the math module
