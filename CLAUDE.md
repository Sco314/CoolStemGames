# CLAUDE.md — CoolStemGames repo workflow

Read this at the start of every session before pushing any commits.

---

## Branch / PR workflow — **read this first**

**The owner tests on production (`coolstemgames.com`), not on feature branches or Cloudflare Pages preview URLs.** That means follow-up fixes after a deploy live on a *different* branch from the original work — not on the same branch you just shipped.

### The rule

Before every push, check whether the current branch's PR is already merged into `main`.

```sh
git fetch origin main
git log origin/main --oneline -10 | grep -i "Merge pull request #<N>"   # or just inspect the log
```

- **If the branch is unmerged**: push to it, follow up on the existing PR.
- **If the branch is already merged into main**: STOP. Do not push to it. Instead:
  1. `git checkout -b claude/<descriptive-new-name> origin/main`
  2. Cherry-pick or re-apply the fix onto the new branch.
  3. `git push -u origin <new-branch>`
  4. Open a **new** PR against `main`.

Pushing follow-up commits to an already-merged branch is invisible to the owner — it produces no testable artifact on production and forces them to ask for the fix again. Don't do it.

### Why the system prompt's "develop on branch X" line is misleading

The session-launch prompt names a single feature branch ("develop on branch `claude/moonlander-repo-table-…`"). That instruction applies to the **initial task only**. Once that PR merges, the branch is dead. Treating the named branch as a permanent home for all future commits is the failure mode this file exists to prevent.

### Checklist before any `git push`

- [ ] `git fetch origin main`
- [ ] Is my branch's PR already merged? If yes → branch off `origin/main`, don't push to the old branch.
- [ ] Is my branch behind `origin/main` by more than my own commits? If yes → I'm probably about to push to a stale branch; verify or rebase first.
- [ ] Branch name is `claude/<descriptive>` and reflects what this PR does, not a generic carry-over from a prior task.

---

## Repo layout

- `moonlander/` — the lunar lander / walk-mode game (Three.js, vanilla JS, no bundler)
- `fibonacci-zoom/` — separate single-file web app (has its own `CLAUDE.md`)
- `scripts/` — asset bake tools (`bake-terrain.mjs`, etc.)

Each game directory may have additional context; check for a sub-`CLAUDE.md` or `README.md` before working in one.

---

## GitHub MCP scope

This session's GitHub tools are restricted to `sco314/coolstemgames`. Don't try to read or write any other repo.
