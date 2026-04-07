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
