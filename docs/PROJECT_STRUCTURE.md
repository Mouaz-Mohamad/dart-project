# Dart project structure

This package contains one canonical copy of every runtime page and shared asset.

- Root HTML files are the public and operational pages. Keeping their current locations preserves existing Vercel URLs.
- `CSS/` contains stylesheets only.
- `Js/` contains customer-site JavaScript only.
- `Photos/` contains shared and product images.
- `Icons/` contains SVG icons only.
- `sections/` contains reusable HTML fragments only. `sections/leaderboard-card.html` is the single Leaderboard fragment.
- `Eye/` contains the dashboard page and all dashboard-only CSS, JavaScript and images.
- `tests/` contains automated checks only.
- `docs/` contains project reports, code maps and the backend API contract.

The repository history directory (`.git`), Windows metadata (`desktop.ini`), generated screenshots and recursively copied project folders are intentionally excluded from this delivery package.
