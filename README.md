# Cool STEM Games

The source for **[coolstemgames.com](https://coolstemgames.com)** a hub for cool
science, technology, engineering and math games, apps, learning and exploration.

Inspired by the intersection of best educational practices and fun).

## Project layout

```
/                  static homepage (index.html, styles.css, main.js)
apps.js            list of games/apps shown on the homepage (edit this to add more)
/<app-slug>/       each self-contained app lives in its own folder and is hosted at
                   coolstemgames.com/<app-slug>/
```

External apps (like `moonlanding.site`) are listed in `apps.js` with
`external: true` and link out directly.

## Adding a new game

1. Drop the app's static files into `/<app-slug>/` (with its own `index.html`).
2. Add an entry to `apps.js`:

   ```js
   {
     title: "Constellation Draw",
     sub: "Connect the stars",
     href: "/constellation-draw/",
     bg: "radial-gradient(circle at 50% 60%, #1c2541 0%, #0a0f1e 80%)",
   }
   ```
3. Commit & push — Cloudflare Pages will rebuild automatically.

## Local preview

Any static file server works:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Hosting / DNS (Cloudflare)

See [`DEPLOY.md`](./DEPLOY.md) for the one-time Cloudflare Pages + DNS setup.

---

## Collatz Cascade

**[coolstemgames.com/collatz-cascade/](https://coolstemgames.com/collatz-cascade/)**

A 3D exploration tool for the Collatz conjecture (the "3n+1 problem"). Type positive integers and watch a living graph grow in your browser.

### The Collatz conjecture

Pick any positive integer. If it's even, halve it. If it's odd, triple it and add one. Repeat. The conjecture (unproven since 1937) claims you always reach 1.

The sequences are wildly unpredictable. Starting at 27, the value soars to 9,232 before crashing back to 1 over 111 steps. Starting at 26, it takes just 10 steps. That volatility is what the visualization reveals.

### How it works

Type a number and press **Add**. The app computes its full Collatz sequence and draws every value as a node in a shared 3D graph. Sequences share nodes -- when a new path merges into existing structure, the merge point flares. Over time the graph grows into a tree rooted at 1, and you see the conjecture's core claim with your own eyes: everything falls home.

- **Nodes** are spheres sized by log(value), colored by stopping time (steps to reach 1) on a violet-to-red ramp.
- **Edges** connect each number to its Collatz successor, with gradient color matching the endpoints.
- **Color rescaling**: when a new input raises the graph's maximum stopping time, every node smoothly recolors against the new scale. Old nodes cool, the new frontier warms.
- **Merge flares**: when a new sequence hits an existing node, that node pulses bright and scales up briefly.
- **Orbit controls**: drag to rotate, scroll to zoom, pinch on mobile.

### Layout modes

Four ways to arrange the graph in 3D space, switchable via the panel on the left:

| Mode | What positions encode | How it looks |
|------|----------------------|--------------|
| **Particles** | Nothing (force-directed) | Organic clustering. Nodes repel each other, edges act as springs, gentle gravity holds it together. Reveals connectivity but no math meaning to positions. |
| **Value** | Y = log2(value) | Vertical tower. Small numbers sit low, large numbers sit high. XZ uses golden-angle spiral so same-height nodes spread apart. You see Collatz climbs (3n+1 pushes up) and falls (n/2 drops down). |
| **Parity** | X = even (left) / odd (right) | Two columns. Every edge crosses between them since 3n+1 always produces an even number. Makes the even/odd alternation pattern strikingly visible. Y = log2(value) for vertical spread. |
| **Stopping Time** | Radius = steps to reach 1 | Concentric rings. Node 1 at center, shallow numbers on inner rings, deep numbers (like 27 with 111 steps) on wide outer rings. Gentle vertical rise separates rings in 3D. Shows at a glance how far each number is from home. |

Switching modes smoothly animates all nodes from their current positions to the new target layout.

### Tech

Built with [Three.js](https://threejs.org/) (v0.170.0) loaded via CDN import map. No build step, no npm, no framework -- pure ES modules in a static folder. Self-contained in `/collatz-cascade/` with zero shared code.

```
collatz-cascade/
  index.html          entry point (import map, canvas, UI overlay)
  style.css           dark theme, overlay positioning, responsive
  js/
    main.js           scene setup, render loop
    collatz.js        sequence computation, memoized caching
    graph.js          3D nodes/edges, force-directed + target layouts
    animate.js        draw-in, merge flare, color rescale transitions
    camera.js         orbit controls, auto-framing, fly-to
    ui.js             input, mode selector, recent panel, tooltips
    constants.js      all tunable parameters
```
