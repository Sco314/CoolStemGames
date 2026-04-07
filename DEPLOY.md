# Connecting `coolstemgames.com` via Cloudflare Pages

This is a one-time setup. After it's done, every push to `main` re-deploys
the site automatically.

## 1. Make sure the domain is on Cloudflare

If `coolstemgames.com` is **not** already on Cloudflare:

1. Log in to <https://dash.cloudflare.com> → **Add a site** → enter `coolstemgames.com`.
2. Pick the Free plan.
3. Cloudflare will scan existing DNS and give you two **nameservers** (e.g.
   `xxx.ns.cloudflare.com`).
4. Go to your domain registrar (where you bought `coolstemgames.com`) and replace
   its nameservers with the two Cloudflare gave you. Propagation usually takes
   minutes to a few hours.

If it is already on Cloudflare, skip this step.

## 2. Create the Cloudflare Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create application** →
   **Pages** tab → **Connect to Git**.
2. Authorize Cloudflare's GitHub app and pick `sco314/CoolStemGames`.
3. Build settings:
   - **Production branch:** `main`
   - **Framework preset:** *None*
   - **Build command:** *(leave blank)*
   - **Build output directory:** `/`
4. Click **Save and Deploy**. You'll get a preview URL like
   `coolstemgames.pages.dev` once it's done.

## 3. Attach the custom domain

1. Inside the Pages project → **Custom domains** → **Set up a custom domain**.
2. Enter `coolstemgames.com` → **Continue** → **Activate domain**.
3. Repeat for `www.coolstemgames.com` if you want it to work too.

Cloudflare will automatically add the necessary `CNAME` (or flattened apex)
records and provision an SSL cert. After ~1 minute the site is live at
<https://coolstemgames.com>.

## 4. (Optional) Make `MoonLanding.site` feel like part of the family

Since Moon Landing lives on its own domain, the homepage card just links out
to it (it's marked `external: true` in `apps.js`). If later you want it under
`coolstemgames.com/moon-landing/` instead, you can either:

- Move its static files into `/moon-landing/` in this repo, **or**
- Add a Cloudflare Worker / Pages redirect from `/moon-landing/` →
  `https://moonlanding.site`.

## 5. Future apps

For each new game/app:

1. Add its files in this repo under `/<app-slug>/index.html` (+ assets).
2. Add a card entry in `apps.js`.
3. `git push` — Cloudflare Pages re-deploys automatically and the new app is
   reachable at `https://coolstemgames.com/<app-slug>/`.

## Troubleshooting

- **Domain stuck on "Verifying nameservers"** — wait, or re-check the
  nameservers at the registrar.
- **404 on `/<app-slug>/`** — make sure that folder contains an `index.html`.
- **CSS/JS 404** — paths in `index.html` are absolute (`/styles.css`), which
  is what Pages expects.
