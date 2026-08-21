# PDF Template Editor + Report Engine

English | [繁體中文](README.zh.md)

A general-purpose PDF generator. You lay out the page in the browser (text, data fields, tables, barcodes and images are all drag-and-drop), save it as a template, and from then on your system just sends data and gets back a neatly rendered PDF.

The editor can be embedded in your own product via iframe, so your users design templates without ever leaving your app; producing the PDF is a single API call from your backend. The frontend only handles design and preview — every PDF is drawn by the Go engine on the backend, so what you see in the preview is exactly what the final output looks like.

| Editor | Preview |
|:---:|:---:|
| ![Editor (English UI)](docs/images/editor-en.png) | ![Preview (English UI)](docs/images/preview-en.png) |
| ![Editor (Chinese UI)](docs/images/editor.png) | ![Preview (Chinese UI)](docs/images/preview.png) |

## Quick Start

All you need is [Docker](https://www.docker.com/):

```bash
git clone https://github.com/zerox12311/pdf-report.git
cd pdf-report
cp .env.example .env        # change credentials / port here if you like — it runs fine untouched
docker compose up -d --build
```

Then walk through it once:

**1. Sign in.** Open http://localhost:8090. The default account is `admin` with password `admin1234`.

**2. Design a template.** Create a project, add a template, and you're in the editor. Drag text, tables and barcodes from the palette on the left onto the canvas. For content that gets filled in at render time, use the "Data field" element and give it a key path like `customer.name`.

**3. Preview it.** Switch to the "Preview" tab at the top. Paste a data JSON on the left (or hit "Rebuild from samples" if you'd rather not type one), and the real PDF rendered by the backend shows up on the right.

**4. Generate PDFs from your system.** Issue an API key on the project settings page, then POST your data to the render API:

```bash
curl -X POST "http://localhost:8090/api/templates/<template-id>/render" \
  -H "Authorization: Bearer pdftpl_your_key" \
  -H "Content-Type: application/json" \
  -d '{"data": {"customer": {"name": "Alex Wang"}}}' \
  -o out.pdf
```

If you'd rather not assemble requests by hand, the "🔗 Connect" button in the editor's top-right corner generates an integration guide with your actual template id already filled in — including the iframe embedding snippet — ready to hand to an engineer.

> ⚠️ The default credentials and `SESSION_SECRET` are for playing around locally. Change them before exposing the service anywhere — see the next section.

## Environment variables

The `.env` you copied in Quick Start is picked up automatically by `docker compose`. Every variable has a default, so the stack runs without touching anything; when you do want to tweak something, here's the list ([.env.example](.env.example) has the same info as inline comments):

| Variable | Default | What it's for |
|---|---|---|
| `APP_PORT` | `8090` | The port the service listens on |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / `admin1234` | The administrator created on first start. Only seeded while the user table is empty — after that, just change the password in the console |
| `SESSION_SECRET` | `change-me-in-production` | Signs login sessions and embed tokens. Must be replaced with a random value for any public deployment, e.g. `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | `pdftpl` | Database password; the app's connection string picks up the same value automatically |
| `CORS_ORIGINS` | empty (same-origin only) | Comma-separated allowlist for cross-origin calls. `*` allows everything and is only recommended for demos. If your frontend calls the API from another domain, list that domain here |

If you'd rather run the backend without Docker, there are also `PORT`, `DATABASE_URL`, `STORAGE_ROOT`, `FONTS_DIR` and `WEB_ROOT`; the details are in the architecture section of [CLAUDE.md](CLAUDE.md).

## Where to go next

- Want to contribute, or understand how the project fits together? Start with [CLAUDE.md](CLAUDE.md). It doubles as the handbook for AI coding assistants: architecture, everyday commands, the rules that must not be broken, and the pitfalls we've already hit.
- Want to know how each feature currently behaves? See [docs/](docs/README.md), split into the [editor](docs/editor.md), the [render engine](docs/engine.md), the [HTTP API](docs/api.md) and [iframe embedding](docs/embed.md). (Docs are in Traditional Chinese for now.)
- The template JSON schema is defined by code: `frontend/src/app/core/models/template.model.ts` and `backend/internal/engine/models.go`, always changed together.

## A few deployment notes

- The whole thing is one app container plus one Postgres. The frontend and `/api` share an origin, so no reverse proxy is needed; `/healthz` is there for health checks.
- Postgres listens on :5442 (to stay clear of a local 5432); its data lives in the `pg-data` volume. Uploaded images and fonts go in the `pdf-storage` volume.
- To see what embedding looks like, just open [docs/embed-example.html](docs/embed-example.html) in a browser.
- For local development (frontend on :4300 proxying to the backend on :5043, running tests, building) see the "常用指令" section of [CLAUDE.md](CLAUDE.md).

## Tech stack

- `frontend/`: Angular 20 (standalone, signals, OnPush). The editor layout takes its cues from JasperReports.
- `backend/`: Go + Gin + PostgreSQL/GORM, with [gopdf](https://github.com/signintech/gopdf) for PDF output and boombuler/barcode for barcodes. `internal/engine` is the single source of truth for rendering — the editor preview calls it too.

## About the fonts

The bundled Noto fonts ship in two places: `backend/fonts` for PDF embedding (gopdf subsets them automatically) and `frontend/public/fonts` for the canvas, so what you see while designing is close to the output. They are modified builds of the Noto family (subsetted, with generated oblique variants), distributed under the **SIL OFL 1.1** — the license text is in [backend/fonts/OFL.txt](backend/fonts/OFL.txt), and other third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

To keep the size down, the bundled fonts only cover the common Big5 CJK range (about 5,400 characters) plus ASCII and full-width punctuation, so very rare characters may be missing. If you need broader coverage you have two options: re-subset with fonttools' `pyftsubset` and replace both copies, or simply import your own font through the console (`POST /api/fonts`).
