# Fibonacci Things in the World — content reference

A working catalog of Fibonacci/φ phenomena in nature, mathematics, and culture, used as the **canonical content store** for the Fibonacci Zoom gallery (`GALLERY` in `index.html`), level facts (`LEVEL_FACTS`), achievement copy (`ACHIEVEMENTS`), and any future expansion. When you're picking a new gallery entry or writing a fact for a new level, start here.

Every entry includes:
- **Where used** — currently shipped in `GALLERY` / `LEVEL_FACTS` / `ACHIEVEMENTS`, or "candidate" if a future addition.
- **Connection** — exactly *how* the item relates to Fibonacci. We do not list things that are merely "spiral-shaped"; the connection has to be a Fibonacci count, ratio, or angle.
- **Image source candidate** — a Wikipedia / Wikimedia file name (use `https://en.wikipedia.org/wiki/Special:FilePath/<filename>?width=640` to fetch). The `<img>` element in the gallery has an `onerror` fallback to the emoji placeholder, so a broken URL degrades gracefully.

This file is human-edited prose, not consumed by the build. Update both this doc and the corresponding catalog when you ship a new entry.

---

## Currently shipped — Gallery (`GALLERY`)

| `at` | Emoji | Title | Connection | Wikipedia file |
|-----:|:------|:------|:-----------|:---------------|
| 3 | 🐚 | Nautilus Shell | Each chamber grows ≈φ× larger; perfect logarithmic spiral. | `NautilusCutawayLogarithmicSpiral.jpg` |
| 6 | 🌻 | Sunflower Seed Head | Disc florets pack in 21/34 (or 34/55, or 55/89) opposing spirals. | HSW Static `fibonacci-update.jpg` |
| 9 | 🌀 | Hurricane Isabel | Spiral arms trace a near-perfect logarithmic spiral. | `Hurricane_Isabel_from_ISS.jpg` |
| 12 | 🖼️ | Mona Lisa | Composition contains multiple golden-ratio rectangles (face, horizon, hair). | `Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg` |
| 15 | 🌌 | Messier 74 Galaxy | "Grand design" spiral; arms follow a logarithmic curve. | `Messier_74_by_HST.jpg` |
| 18 | 🌿 | Romanesco Broccoli | Each bud is itself a smaller fractal of buds in Fibonacci counts. | `Fractal_Broccoli.jpg` |
| 21 | 🌲 | Pinecone Spirals | Two families of spirals: typically 8 + 13, or 5 + 8. | `Pineconespiral.jpg` |
| 24 | 🍍 | Pineapple | Three spiral families: 5, 8, and 13 hexagonal "eyes". | `Pineapple_(4006).JPG` |
| 27 | 🐌 | Snail Shell | Each new chamber is φ× larger than the previous. | `Helix_aspersa_shell.jpg` |
| 30 | 🧬 | DNA Double Helix | B-form DNA: 21 Å wide, 34 Å per turn. The ratio is φ. | `DNA_orbit_animated.gif` |
| 33 | 🌵 | Spiral Aloe | *Aloe polyphylla* leaves rotate by the golden angle (≈137.5°). | `Aloe_polyphylla_1.jpg` |
| 36 | 🐚 | Ammonite Fossil | Logarithmic-spiral shells preserved across 350M years. | `Asteroceras_obtusum_BMNH_full.jpg` |
| 39 | 🌼 | Daisy Phyllotaxis | Disc florets in 21/34 interlocking spirals, every time. | `Bellis_perennis_white_(aka).jpg` |
| 42 | 🌵 | Saguaro Cactus Ribs | 13/21/34 vertical ribs that expand like an accordion. | `Saguaro_in_Saguaro_National_Park_near_Tucson,_Arizona_during_November_(83).jpg` |

---

## Candidate gallery entries — natural-world

Strong fits for future expansion past F(42). Don't ship more than one new entry per release — the gallery is meant to feel discovered, not bulk-dumped. Suggested file names link directly to known Wikipedia articles.

| Subject | Suggested `at` | Connection | Wikipedia file candidate |
|:--------|---:|:-----------|:--------|
| Aloe spiral on giant cactus (Cardón) | 45 | 21-/34-rib variants on Pachycereus pringlei. | `Pachycereus_pringlei.jpg` |
| Black-eyed Susan | 48 | 13-petal head, disc-floret 13/21 spirals. | `Rudbeckia_hirta.jpg` |
| Chameleon tail | 51 | Coiled tail traces a near-logarithmic spiral. | `Trioceros_jacksonii.jpg` |
| Fern fiddlehead | 54 | The unfurling crozier is a tight logarithmic spiral. | `Fiddlehead_fern.jpg` |
| Snail shell cross-section (Argonauta) | 57 | Logarithmic spiral nautiloid relative. | `Argonauta_argo.jpg` |
| Sunflower (close-up disc) | 60 | Higher-magnification view: 89/144 spirals on giant cultivars. | `Helianthus_annuus_NRCS-1.jpg` |
| Ram's-horn squid | 63 | Internal calcareous shell forms a perfect logarithmic spiral. | `Spirula_spirula.jpg` |
| Pineapple cross-section | 66 | Reveals the 5/8/13 eye lattice. | `Pineapple_cross_section.jpg` |
| Cauliflower (white, fractal) | 69 | Less-fractal cousin of romanesco, still Fibonacci floret counts. | `Cauliflower_-_Brassica_oleracea_var._botrytis.jpg` |
| Pine cone (closed, dramatic) | 72 | Tight spiral seed scales, Fibonacci counts. | `Pinecone_close.jpg` |

### Animal world

| Subject | Suggested `at` | Connection |
|:--------|---:|:-----------|
| Argonaut octopus egg case | — | Logarithmic-spiral chambered shell. |
| Bee wing venation | — | Fibonacci-related branching ratios in some species. |
| Ammonoid suture lines | — | Recursive curves with Fibonacci-related self-similarity. |
| Butterfly wing scale arrangement | — | Some species (Heliconius) tile in Fibonacci-count rows. |
| Honeybee family tree | — | Drone has 1 parent, 2 grandparents, 3 great-grandparents… |

(Family-tree one is already used as a level-fact at n=18; don't double-up in the gallery.)

### Astronomy + physics

| Subject | Suggested `at` | Connection |
|:--------|---:|:-----------|
| Whirlpool Galaxy (M51) | 75 | Two-armed grand-design spiral, distinct from M74. |
| Spiral nebula (e.g. Helix Nebula) | — | Concentric-spiral structure (caveat: not strictly logarithmic). |
| Solar prominence loop | — | Magnetic-field arches sometimes form spiral structures. |
| Crab Nebula filament | — | Filaments curl in approximate logarithmic spirals. |

### Mathematics & culture (avoid for gallery; better as level-facts)

| Subject | Use as |
|:--------|:-------|
| Pascal's triangle shallow diagonals | Level-fact (already at n=13) |
| Continued-fraction expansion of φ | Level-fact (candidate for n=44) |
| Lucas numbers | Level-fact (already at n=20) |
| Penrose tiling | Level-fact candidate (n=46) — connection via φ |
| Golden rectangle in architecture | Gallery candidate at any `at` post-50 |
| Stradivarius violin proportions | Gallery candidate (cultural) |

---

## Currently shipped — Level Facts (`LEVEL_FACTS`)

Every n from 3..34 has a fact. After 34, sparse Fibonacci-only milestones (55, 89, 144). Gaps at 35..54, 56..88, 90..143, 145+ are intentional — these are deep-game indices where dense facts would be overwhelming. **If you fill gaps, prioritise:**

- 36, 39, 42 — currently have gallery entries; a fact reinforces the unlock.
- 44 — a candidate for the continued-fraction φ expansion.
- 46 — Penrose tiling fact.
- 50 — the "fifty" milestone; nothing Fibonacci-special but a round-number anchor.

---

## Currently shipped — Achievements (`ACHIEVEMENTS`)

23 entries as of v2.0.2. Categories: progression (7), negative exploration (2), engagement (4), oddity (3), Tier-3 bonuses (3), late-game recognition (4 — added in v2.0.2).

### Candidate achievements not yet shipped

| id | title | unlock |
|:---|:------|:-------|
| `frenzy_master` | Frenzy Master | Cross 5 levels during a single Frenzy |
| `streak_55` | Streak Sage | 55-day streak (the 10th Fibonacci number worth of days) |
| `negaspace` | Antimatter Voyager | Reach n=−21 |
| `silent_runner` | Silent Runner | Earn 10,000 ticks from the engine while never clicking the spiral manually |
| `time_traveler` | Time Traveler | Collect offline progress 8 distinct times |
| `gallery_complete` | Naturalist | View every Found-in-Nature entry |

---

## Style guide for new entries

- **Facts are sentences, not equations.** "The 3rd Fibonacci number is 2" beats "F(3) = 2".
- **One concrete real-world hook per fact.** No generic "Fibonacci appears everywhere" — name the species, the artifact, the number.
- **Don't repeat hooks across catalogs.** If the gallery uses sunflowers, the level-fact at the same `n` should be about something else.
- **Image URLs**: use `https://en.wikipedia.org/wiki/Special:FilePath/<file>` with `?width=640`. Wikipedia auto-redirects on file rename, so URLs survive longer than direct upload.wikimedia.org links.
- **Achievement copy**: `unlock` is the button-side hint ("Reach the 13th Fibonacci number (233)"). `fact` is the post-unlock reward — give it educational weight, not just flavor.
