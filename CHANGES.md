# Dart corrections

- Added local account registration/login with normalized unique email and phone checks.
- Added dynamic profile fields and editing; customer ID remains immutable.
- Connected website orders, inventory, customers, returns and reviews to the same local development store used by Dart Eye.
- Limited checkout to cash on delivery.
- Added dynamic order tracking and representative status updates.
- Removed fake public reviews, leaderboard identities and demo dashboard defaults.
- Added verified-purchase review and 14-day return eligibility checks.
- Applied birthday discount 30% and Dart Card 40%, maximum 10 items or one year.
- Excluded customers with an active Dart Card from later monthly draws until the card expires by time or 10 delivered items.
- Added 15-minute physical-item cart reservations with automatic release and a visible countdown.
- Locked feedback until the signed-in customer has at least one Delivered order.
- Rebuilt Profile order and return views as detailed responsive cards.
- Added responsive/accessibility corrections without changing the desktop identity.
- Added unique page metadata, canonical URLs, robots.txt, sitemap.xml and a working service worker.
- Added policies and a Node.js/Express API handoff contract.

Security note: localStorage is suitable only for frontend development. Production authentication, uniqueness, authorization and data integrity require the backend controls in `API_CONTRACT.md`.
