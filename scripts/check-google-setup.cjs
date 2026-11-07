// Dart release contract: manual-only checkout; Google login and courier map remain available.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
const checkout = read('public/cart-checkout.html');
const rep = read('public/rep.html');
const auth = read('public/Sign Up modern.html');
const config = read('public/Js/dart-google-maps-config.js');
const maps = read('public/Js/dart-google-maps.js');
const social = read('public/Js/dart-auth-social.js');
const address = read('public/Js/dart-address.js');
const googleCheckout = read('public/Js/dart-checkout-google.js');
const courier = read('public/Js/dart-rep.js');
const csp = JSON.parse(read('vercel.json')).headers
  .flatMap((row) => row.headers || [])
  .find((row) => row.key === 'Content-Security-Policy')?.value || '';

function present(text, token, label) {
  assert.ok(text.includes(token), 'Missing Dart Google integration: ' + label);
}
present(rep, 'Js/dart-google-maps-config.js', 'representative browser key');
present(rep, 'Js/dart-google-maps.js', 'representative Maps renderer');
present(checkout, 'Js/dart-google-maps-config.js', 'checkout browser key');
present(checkout, 'Js/dart-checkout-google.js', 'Google-only checkout controller');
present(checkout, 'id="dart-checkout-google-map"', 'Google location viewport');
assert.ok(!/leaflet|openstreetmap|dart-checkout-manual-address/i.test(checkout),
  'Checkout must not load legacy map or manual-only controller');
assert.equal((auth.match(/data-social-login="google"/g) || []).length, 2,
  'Both Dart customer login and registration need Google sign-in');
present(auth, 'Js/dart-auth-social.js', 'Google auth handler');
present(social, '/api/v1/auth/social/challenge', 'server challenge');
present(social, 'claimGuestCartAfterAuth', 'guest cart recovery');
present(googleCheckout, 'dart:checkout-address-ready', 'Google checkout validation bridge');
present(courier, 'dart:rep-road-route', 'real road path bridge');
present(maps, 'window.DART_GOOGLE_MAPS_BROWSER_KEY', 'browser map configuration');
present(maps, 'dart:address-selected', 'checkout point updates');
present(maps, 'destroyRepresentatives', 'delivery map disposal');
present(maps, 'gm_authFailure', 'visible Google Maps key error handling');
present(maps, 'recoverLeaflet()', 'independent backup map source');
present(courier, 'void window.DartGoogleMaps?.attachRepresentatives?.(orders);', 'Google courier map called before legacy Leaflet guard');
present(courier, 'renderOrders: () => { lastOrderRenderSignature = ""; renderOrders(); }', 'courier fallback map re-initialization');
present(csp, 'https://maps.googleapis.com', 'Google Maps CSP');
present(csp, 'https://maps.gstatic.com', 'Google assets CSP');
assert.match(config, /^window\.DART_GOOGLE_MAPS_BROWSER_KEY = "(?:AIza[0-9A-Za-z_-]{30,})?";\n$/,
  'Generated browser config must contain only an empty or restricted browser API key');
for (const [file, source] of [['Maps JS', maps], ['Social JS', social], ['Address JS', address], ['Google Checkout JS', googleCheckout], ['Rep JS', courier]]) {
  try { new Function(source); } catch (error) { throw new Error(file + ' invalid JavaScript: ' + error.message); }
}
console.log('Dart Google-only checkout, manual fallback and courier-map build contracts passed.');
