# Browser source ownership

Edit the sources here. Browser URLs continue to use `Js/` and `Eye/`.

| Source | Responsibility | Delivery file |
| --- | --- | --- |
| `dashboard/core/` | Existing dashboard state, renderers, workflows, editors and startup | `Eye/dart.js` |
| `storefront/platform/` | Customer identity, analytics, cart, checkout, profile, rewards and startup | `Js/dart-platform.js` |
| `dashboard/catalog-admin.js` | Versioned catalog record writes | `Eye/dart-catalog-admin.js` |
| `dashboard/staff-admin.js` | Staff editor | `Eye/dart-staff.js` |
| `dashboard/staff-permissions.js` | Dashboard permission adapter | `Eye/dart-permissions.js` |
| `dashboard/dashboard-ui.js` | Dashboard record summaries, dialogs and status colors | `Eye/dart-dashboard-ui.js` |
| `dashboard/display-preferences.js` | Dashboard display preferences | `Eye/dart-display-preferences.js` |
| `dashboard/news-admin.js` | News management and authorized prefetch | `Eye/dart-news-admin.js` |
| `dashboard/sets-admin.js` | Set editor and authorized prefetch | `Eye/dart-sets-admin.js` |
| `storefront/catalog.js` | Catalog hydration, version recovery and projections | `Js/dart-catalog.js` |
| `storefront/profile-records.js` | Profile order, return and waiting summaries | `Js/dart-profile-records.js` |
| `storefront/home-ui.js` | Curated Home UI | `Js/dart-ui.home.min.js` |

`runtime-layout.json` is the ordered source list for the two large readable runtimes.
Its source units contain complete statements. They intentionally share the existing
scope: dashboard globals stay global, and the customer platform stays inside its
original private closure. Moving declarations or listener registration across this
list changes execution order and must be treated as a functional change.

Build with `npm run build:js`. The existing Home build command invokes this source
composition before minification, so CI and Vercel need no separate preparation step.
No extra browser requests, script tags, global application objects or runtime loaders
are introduced by this source split.

Page scripts such as `Js/dart-rep.js`, `Js/dart-tracking.js`, and the independently
loaded dashboard features remain maintained in their current locations. Shared CSS
continues to use `CSS/base.css`, `CSS/main.css`, and `CSS/responsive.css`.

Run `npm run check` to verify source ownership, syntax, formatting, generated output
freshness and all maintained frontend static checks. The source-layout check fails
when a new source file is not wired into a build. Check generated files into the
same commit as their source changes.
