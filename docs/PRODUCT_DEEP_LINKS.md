# Product deep links — Dart | for you

Dart keeps its existing fast product Modal. A model does **not** become a traditional standalone product page.

## URL contract

- Collection: `/products`
- Model: `/products/<model-name>--<model-code>`
- Example: `/products/cairo-wide-leg-jeans--dw-101`

The model code suffix is the stable lookup key. If the product title changes later, an older URL can still resolve to the same model by its code and the runtime publishes the newest URL as canonical.

## Runtime behavior

1. Clicking a product card opens the current Modal exactly as before.
2. The browser URL is updated with `history.replaceState`; there is no reload and no second product-data request.
3. Closing the Modal uses the existing browser-history behavior and returns to `/products`.
4. Opening a deep link directly loads `products.html` once through the Vercel rewrite, waits for the server-authoritative catalog, and opens the requested Model in the same Modal.
5. Back/Forward navigation replays the Modal state without forcing a page refresh.

## Search metadata

When a model route is active, the runtime publishes a model-specific title, description, canonical URL, Open Graph/Twitter values and `Product` JSON-LD with:

- Brand: `Dart | for you`
- Alternative brand name: `Dart Wear`
- model code as SKU
- current price in EGP
- stock availability from the already hydrated public catalog
- first usable product image

Product titles inside rendered cards become crawlable `<a href>` links while normal clicks are intercepted so the customer still gets the Modal experience.

## Performance rule

Deep linking must never replace the Modal with page-to-page navigation. Opening models from the collection stays in-memory and does not call `location.reload`, `location.assign`, or `location.replace`.
