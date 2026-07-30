# lifeApp — ADAMTOOL

The code repo behind **ADAMTOOL**, a curated public directory of small
precision/AI web tools. (Folder + GitHub repo are still named `lifeApp` for
historical reasons; the brand is ADAMTOOL.) Static frontend + Cloudflare
Pages Functions backend + Supabase. Live at **adamtool.online** /
**adamtool.pages.dev**. Repo: `github.com/lakar-team/lifeApp`.

For the full architecture, deployment shape, and history, see [[adamtool]] in
the wiki — check it before non-trivial work here.

## Operational constraints

- **`main` is production.** Cloudflare Pages deploys the site from `main`,
  and the GitHub Action (`.github/workflows/sync-apps.yml`) syncs tool
  manifests on push to `main`. Don't push half-finished work to `main` —
  it publishes to the live site.
- **To add/change a tool:** create/edit `public/apps/<slug>/` with an
  `index.html` and an **`app.json`** manifest (`name`, `slug`, `path`,
  `icon`, `description`, `status`, `sort_order`, `tags`). On push to `main`,
  `scripts/sync-apps.js` upserts every `app.json` into the Supabase `apps`
  table — **don't hand-edit that table**; the manifests are the source of
  truth. Each tool must be self-contained (its own assets under its folder).
- **Secrets** live in Cloudflare Pages env vars and local `.env.local`
  (gitignored) — `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `CREATOR_EMAIL`. Never commit keys; see
  `.env.example`.
- **Ignore the legacy bits.** Root-level `apps/` is old pre-`public/apps/`
  staging; `server.js` + `package.json` (`app-hub-portal`, Express) is an old
  local portal, not the deployed backend. Production is Cloudflare Pages
  (`public/` + `functions/`).

## The pdf-to-dxf backend (Render)

`services/pdf-to-dxf-backend/` is a Python FastAPI contour-tracing service
deployed to **Render** (free Docker web service, `pdf-to-dxf-2zcz.onrender.com`,
Lakarteam2025) that the `public/apps/pdf-to-dxf/` frontend POSTs to. It's the
deploy copy of `../pdf to dxf/dxf_contour_service/` — keep them in sync.
Fitting the 512MB free tier took adaptive tiling + streamed output + per-request
subprocess isolation; see [[pdf-to-dxf]] and the service's own `CLAUDE.md`
before changing it. Render pulls this repo publicly (no push webhook) — trigger
a deploy via the Render API/dashboard after pushing backend changes.

## Code changes — fix root causes, not symptoms

Drive-wide rule applies here (see the root `CLAUDE.md`): prefer a structural
fix over a symptom patch, and say so explicitly if a quick patch really is
the right call.

<!-- wiki-chain
id: lifeapp-claude
status: ADAMTOOL tools directory (Cloudflare Pages + Supabase), live at adamtool.online; 10 tools under public/apps/ incl. pdf-to-dxf (contour PDF->DXF/vector-PDF; backend in services/pdf-to-dxf-backend on Render free tier, made to fit 512MB via tiling + subprocess isolation, live 2026-07-31).
updated: 2026-07-31
links: [adamtool, pdf-to-dxf, ai-platforms-claude]
-->
