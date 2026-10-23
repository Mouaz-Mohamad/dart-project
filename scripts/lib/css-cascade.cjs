// Preserve source order: remove only declarations covered for the same selector and condition.
const postcss = require('postcss');

const storefront = ['CSS/main.css', 'CSS/base.css', 'CSS/responsive.css'];
const dashboard = [
  'Eye/dart.css',
  'Eye/dart-inventory.css',
  'Eye/dart-finance.css',
  'Eye/dart-settings.css',
  'Eye/dart-news.css',
  'Eye/dart-live-operations.css',
  'Eye/dart-dashboard-ui.css',
];
const groups = {
  storefront,
  dashboard,
  about: ['CSS/about-paint-fix.css'],
  news: ['CSS/news-article.css'],
};
const sides = ['top', 'right', 'bottom', 'left'];
const shorthands = {
  margin: sides.map((side) => `margin-${side}`),
  padding: sides.map((side) => `padding-${side}`),
  inset: sides,
  background: [
    'background-color',
    'background-image',
    'background-position',
    'background-size',
    'background-repeat',
    'background-origin',
    'background-clip',
    'background-attachment',
  ],
  'border-color': sides.map((side) => `border-${side}-color`),
  'border-style': sides.map((side) => `border-${side}-style`),
  'border-width': sides.map((side) => `border-${side}-width`),
  'border-radius': ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(
    (corner) => `border-${corner}-radius`,
  ),
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
  'flex-flow': ['flex-direction', 'flex-wrap'],
  gap: ['row-gap', 'column-gap'],
  overflow: ['overflow-x', 'overflow-y'],
  outline: ['outline-color', 'outline-style', 'outline-width'],
  columns: ['column-width', 'column-count'],
  'column-rule': [
    'column-rule-width',
    'column-rule-style',
    'column-rule-color',
  ],
  'list-style': ['list-style-type', 'list-style-position', 'list-style-image'],
  'place-items': ['align-items', 'justify-items'],
  'place-content': ['align-content', 'justify-content'],
  'place-self': ['align-self', 'justify-self'],
};
for (const side of sides)
  shorthands[`border-${side}`] = ['width', 'style', 'color'].map(
    (part) => `border-${side}-${part}`,
  );
shorthands['border-image'] = [
  'source',
  'slice',
  'width',
  'outset',
  'repeat',
].map((part) => `border-image-${part}`);
shorthands.border = [
  ...sides.flatMap((side) => shorthands[`border-${side}`]),
  ...shorthands['border-image'],
];

function selectorKey(selector) {
  // Whitespace around a combinator is insignificant; quoted/attribute values are not.
  let result = '',
    quote = '',
    brackets = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (char === '\\') {
      result += char + (selector[++index] || '');
      continue;
    }
    if (quote) {
      result += char;
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      continue;
    }
    if (char === '[') brackets += 1;
    if (char === ']') brackets -= 1;
    if (!brackets && /[>+~]/.test(char)) {
      result = result.trimEnd() + char;
      while (
        /\s/.test(selector[index + 1] || '') &&
        index + 1 < selector.length
      )
        index += 1;
    } else result += char;
  }
  return result.trim();
}

function property(declaration) {
  return declaration.prop.startsWith('--')
    ? declaration.prop
    : declaration.prop.toLowerCase();
}
function coverage(declaration) {
  const name = property(declaration);
  return shorthands[name] || [name];
}
function condition(rule) {
  if (/::?-(?:webkit|moz|ms|o)-/.test(rule.selector)) return null;
  const ancestors = [];
  for (
    let parent = rule.parent;
    parent && parent.type !== 'root';
    parent = parent.parent
  ) {
    // Nested selectors and anonymous layers have separate cascade scopes.
    if (
      parent.type !== 'atrule' ||
      /keyframes|font-face|layer|scope/i.test(parent.name)
    )
      return null;
    const params = /[\"'\\]/.test(parent.params)
      ? parent.params
      : parent.params
          .replace(/\s+/g, ' ')
          .replace(/\s*([:(),])\s*/g, '$1')
          .trim();
    ancestors.unshift(`@${parent.name.toLowerCase()} ${params}`);
  }
  return ancestors.join(' > ');
}
function keepsFallback(older, newer) {
  if (older.value === newer.value) return false;
  const modern =
    /(?:-webkit-|-moz-|image-set\(|color-mix\(|light-dark\(|anchor-size\(|\bsubgrid\b|\b[\d.]+(?:dvh|svh|lvh|dvw|svw|lvw)\b|env\()/i;
  return (
    modern.test(older.value) ||
    modern.test(newer.value) ||
    /\brevert(?:-layer)?\b/.test(newer.value)
  );
}
function describe(declaration) {
  return {
    file: declaration.source?.input.from,
    line: declaration.source?.start.line,
    property: declaration.prop,
    value: declaration.value,
    important: !!declaration.important,
  };
}

function analyze(inputs) {
  const roots = inputs.map((input) =>
    postcss.parse(input.css, { from: input.file }),
  );
  const rules = roots.flatMap((root) => {
    const list = [];
    root.walkRules((rule) => {
      if (condition(rule) !== null) list.push(rule);
    });
    return list;
  });
  const important = new Map();
  const key = (rule, selector, longhand) =>
    JSON.stringify([condition(rule), selectorKey(selector), longhand]);
  for (const rule of rules)
    for (const declaration of rule.nodes) {
      if (declaration.type !== 'decl' || !declaration.important) continue;
      for (const selector of rule.selectors)
        for (const longhand of coverage(declaration))
          important.set(key(rule, selector, longhand), declaration);
    }
  const later = new Map();
  const removed = [];
  const kept = new Map();
  for (const rule of [...rules].reverse()) {
    const selectors = rule.selectors;
    for (const declaration of [...rule.nodes].reverse()) {
      if (declaration.type !== 'decl') continue;
      const retainedSelectors = [];
      for (const selector of selectors) {
        const winners = coverage(declaration).map((longhand) => {
          const identifier = key(rule, selector, longhand);
          const stronger = !declaration.important && important.get(identifier);
          const following = later.get(identifier);
          if (stronger) return stronger;
          if (following && (!!following.important || !declaration.important))
            return following;
          return null;
        });
        if (
          winners.every(
            (winner) =>
              winner &&
              winner !== declaration &&
              !keepsFallback(declaration, winner),
          )
        ) {
          removed.push({
            selector,
            condition: condition(rule) || 'all',
            obsolete: describe(declaration),
            winners: [...new Set(winners)].map(describe),
          });
        } else {
          retainedSelectors.push(selector);
        }
        for (const longhand of coverage(declaration)) {
          const identifier = key(rule, selector, longhand);
          const following = later.get(identifier);
          if (!following || (declaration.important && !following.important))
            later.set(identifier, declaration);
        }
      }
      kept.set(declaration, retainedSelectors);
    }
  }
  return { roots, rules, removed, kept };
}

function clean(inputs) {
  const result = analyze(inputs);
  for (const rule of result.rules) {
    let current = null;
    let signature = '';
    for (const node of rule.nodes) {
      if (node.type !== 'decl') {
        if (current) current.append(node.clone());
        continue;
      }
      const selectors = result.kept.get(node);
      if (!selectors.length) continue;
      const next = JSON.stringify(selectors);
      if (next !== signature) {
        current = rule.clone({ selector: selectors.join(',\n') });
        current.removeAll();
        rule.before(current);
        signature = next;
      }
      current.append(node.clone());
    }
    rule.remove();
  }
  for (const root of result.roots)
    root.walkAtRules((atRule) => {
      if (atRule.nodes && atRule.nodes.every((node) => node.type === 'comment'))
        atRule.remove();
    });
  return {
    ...result,
    output: result.roots.map((root, index) => ({
      file: inputs[index].file,
      css: root.toString(),
    })),
  };
}
module.exports = { groups, analyze, clean };
