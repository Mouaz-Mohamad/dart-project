const assert = require('node:assert/strict');
const fs = require('node:fs');
const { analyze, clean, groups } = require('../scripts/lib/css-cascade.cjs');
const postcss = require('postcss');
const input = (css) => [{ file: 'fixture.css', css }];
const output = (css) => clean(input(css)).output[0].css;
const declarations = (css) => {
  const values = [];
  postcss
    .parse(css)
    .walkDecls((d) => values.push([d.parent.selector, d.prop, d.value]));
  return values;
};

// A later rule with another property must not move an earlier declaration across .b.
assert.deepEqual(
  declarations(output('.a{font-size:12px}.b{font-size:14px}.a{color:red}')),
  [
    ['.a', 'font-size', '12px'],
    ['.b', 'font-size', '14px'],
    ['.a', 'color', 'red'],
  ],
);
// Split a grouped selector only for the property actually covered.
assert.deepEqual(
  declarations(output('.a,.b{color:red;padding:8px}.a{color:blue}')),
  [
    ['.b', 'color', 'red'],
    ['.a,\n.b', 'padding', '8px'],
    ['.a', 'color', 'blue'],
  ],
);
assert.equal(
  analyze(input('.a{color:red!important}.a{color:blue}')).removed.length,
  1,
);
assert.deepEqual(
  declarations(output('.a{color:red!important}.a{color:blue}')),
  [['.a', 'color', 'red']],
);
assert.equal(
  analyze(
    input(
      '.a{color:red}.a:hover{color:blue}@media(max-width:600px){.a{color:green}}',
    ),
  ).removed.length,
  0,
);
assert.equal(
  analyze(
    input(
      '@media(max-width:600px){.a{color:red}}@media (max-width: 600px){.a{color:blue}}',
    ),
  ).removed.length,
  1,
);
assert.equal(
  analyze(input('.a{padding:8px}.a{padding-left:4px}')).removed.length,
  0,
);
assert.deepEqual(declarations(output('.a{margin-top:8px}.a{margin:0}')), [
  ['.a', 'margin', '0'],
]);
assert.deepEqual(
  declarations(output('.a{overflow-x:hidden;overflow:scroll}')),
  [['.a', 'overflow', 'scroll']],
);
assert.equal(
  analyze(input('.a{height:100vh;height:100dvh}')).removed.length,
  0,
);
assert.equal(
  analyze(input('.a{display:-webkit-box;display:flex}')).removed.length,
  0,
);
assert.equal(analyze(input('.a{color:red;color:revert}')).removed.length, 0);
assert.equal(
  analyze(input('@keyframes pulse{from{opacity:0}to{opacity:1}}')).removed
    .length,
  0,
);
assert.equal(
  analyze(input('@layer{.a{color:red}}@layer{.a{color:blue}}')).removed.length,
  0,
);
assert.equal(analyze(input('.a{--Tone:red;--tone:blue}')).removed.length, 0);
assert.equal(
  analyze(input('.a,::-webkit-unknown{color:red}.a{color:blue}')).removed
    .length,
  0,
);
assert.equal(
  analyze(
    input(
      '@supports(font-family:"a : b"){.a{color:red}}@supports(font-family:"a:b"){.a{color:blue}}',
    ),
  ).removed.length,
  0,
);

for (const [name, files] of Object.entries(groups)) {
  const result = analyze(
    files.map((file) => ({ file, css: fs.readFileSync(file, 'utf8') })),
  );
  assert.equal(
    result.removed.length,
    0,
    `${name}: remove covered declarations; run npm run audit:css -- --json for locations`,
  );
}
const main = postcss.parse(fs.readFileSync('CSS/main.css', 'utf8'));
main.walkAtRules('media', () =>
  assert.fail('Storefront media rules belong in responsive.css'),
);
const responsive = postcss.parse(fs.readFileSync('CSS/responsive.css', 'utf8'));
assert(
  responsive.nodes.every(
    (node) =>
      node.type === 'comment' ||
      (node.type === 'atrule' && node.name === 'media'),
  ),
);
console.log(
  'CSS cascade contracts passed: selector groups, ordering, states, media, importance, shorthand coverage and fallbacks.',
);

// Audit embedded styles in their own insertion scope; conditional JS styles are not global overrides.
const htmlFiles = fs
  .readdirSync('.')
  .filter((file) => file.endsWith('.html'))
  .concat(['Eye/Dart Eye.html', 'api/news-template.html']);
const injectedFiles = [
  'Js/dart-profile-records.js',
  'Js/dart-password-visibility.js',
  'Js/dart-set-modal-ui.js',
  'Js/dart-dialog.js',
  'Js/dart-auth-social.js',
  'src/storefront/platform/authentication.js',
];
for (const file of [...htmlFiles, ...injectedFiles]) {
  const pattern = file.endsWith('.html')
    ? /<style\b[^>]*>([\s\S]*?)<\/style>/gi
    : /style\.textContent\s*=\s*`([\s\S]*?)`/g;
  for (const block of fs.readFileSync(file, 'utf8').matchAll(pattern)) {
    const css = block[1].replace(
      /\$\{[^}]+\}/g,
      'var(--dart-audit-interpolation)',
    );
    assert.equal(
      analyze([{ file, css }]).removed.length,
      0,
      `${file}: covered declarations in embedded style`,
    );
  }
}
