# Dart project structure

This package contains one canonical copy of every runtime page and shared asset.

- Root HTML files are the public and operational pages. Keeping their current locations preserves existing Vercel URLs.
- `CSS/` contains stylesheets only.
- `Js/` contains customer-site JavaScript only.
- `Photos/` contains shared and product images.
- `Icons/` contains SVG icons only.
- `sections/` contains reusable HTML fragments only. `sections/leaderboard-card.html` is the single Leaderboard fragment.
- `Eye/` contains the dashboard page and all dashboard-only CSS, JavaScript and images.
- `src/` contains the readable sources for the composed dashboard core, customer platform, and generated editor/Home runtimes. `src/runtime-layout.json` preserves their execution order; see `src/README.md` before editing generated files.
- `scripts/` contains build, validation, and operational tools. Browser editor sources are maintained in `src/`, rather than beside these tools.
- `backend/` contains the server-authoritative TypeScript/Express service, PostgreSQL migrations, OpenAPI contract and backend tests.
- `.agents/skills/dart-quality-review/` contains the mandatory pre-completion review skill.
- `tests/` contains automated checks only.
- `docs/` contains project reports, code maps and the backend API contract.

The root `package.json` exposes the existing frontend build/check commands without adding runtime dependencies. `npm run build` prepares the same production paths, and `npm run check` runs source validation plus the maintained frontend static suite. Backend commands remain in `backend/package.json`.

The repository history directory (`.git`), Windows metadata (`desktop.ini`), generated screenshots and recursively copied project folders are intentionally excluded from this delivery package.
