// Compare maintained/staged styles to a reviewed git revision on identical DOMs.
// Local: DART_CSS_BASE_REF=HEAD node tests/css-cascade-browser.cjs
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');
const { groups } = require('../scripts/lib/css-cascade.cjs');
const root = path.resolve(__dirname, '..');
const baselineRef = execFileSync(
  'git',
  ['rev-parse', process.env.DART_CSS_BASE_REF || 'HEAD'],
  { cwd: root },
).toString().trim();
const reportFile = process.env.DART_CSS_VISUAL_REPORT;
const removed = require('../docs/css-audit/removed-declarations.json');
const originals = new Map();
for (const file of [
  ...Object.values(groups).flat(),
  'CSS/home.css',
  'CSS/home.min.css',
]) {
  originals.set(
    '/' + file,
    execFileSync('git', ['show', `${baselineRef}:${file}`], {
      cwd: root,
      maxBuffer: 8e6,
    }),
  );
}
const freeze =
  '<style data-css-freeze>*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important;content-visibility:visible!important;contain-intrinsic-size:none!important}</style>';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://test');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('.css')) {
    response.setHeader('Content-Type', 'text/css');
    response.end(
      url.searchParams.get('cssPhase') === 'before' && originals.has(pathname)
        ? originals.get(pathname)
        : fs.readFileSync(path.join(root, 'public', pathname)),
    );
    return;
  }
  if (pathname.startsWith('/__css-probes-')) {
    const name = pathname.includes('storefront') ? 'storefront' : 'dashboard';
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><html><head>' +
        groups[name]
          .map(
            (file) =>
              `<link rel="stylesheet" href="/${file}?cssPhase=${url.searchParams.get('cssPhase') || 'before'}">`,
          )
          .join('') +
        freeze +
        '</head><body></body></html>',
    );
    return;
  }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    let content = fs.readFileSync(file);
    if (file.endsWith('.html')) {
      response.setHeader('Content-Type', 'text/html');
      content = content
        .toString()
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(
          /<link\b[^>]*rel=["'](?:preload|modulepreload)["'][^>]*>/gi,
          '',
        );
      for (const [id, partial] of [
        ['header-container', 'Nav-Bar.html'],
        ['footer', 'footer.html'],
        ['leaderboard-card', 'leaderboard-card.html'],
        ['birthday', 'birthday.html'],
        ['feedback-form', 'form-feedback.html'],
        ['why', 'why-dart.html'],
        ['product-modal-host', 'product-modal.html'],
        ['dart-for-you', 'dart-for-you.html'],
      ]) {
        content = content.replace(
          new RegExp(
            `(<(?:header|footer|div|section)\\b[^>]*\\bid=["']${id}["'][^>]*>)\\s*(</(?:header|footer|div|section)>)`,
            'i',
          ),
          (_, open, close) =>
            open +
            fs.readFileSync(path.join(root, 'sections', partial), 'utf8') +
            close,
        );
      }
      content = content.replace(
        /(<link\b[^>]*href=["'])([^"'?#]+\.css)(?:\?[^"']*)?(["'][^>]*>)/gi,
        (_, open, href, close) =>
          open +
          href +
          '?cssPhase=' +
          (url.searchParams.get('cssPhase') || 'before') +
          close,
      );
      content = content.replace('</head>', freeze + '</head>');
    } else
      response.setHeader(
        'Content-Type',
        {
          '.jpg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml',
        }[path.extname(file)] || 'application/octet-stream',
      );
    response.end(content);
  } catch {
    response.writeHead(404).end();
  }
});

async function initialize(page, origin, file, phase) {
  await page.route('**/*', (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );
  await page.goto(`${origin}/${encodeURI(file)}?cssPhase=${phase}`, {
    waitUntil: 'networkidle',
  });
  if (file.startsWith('__css-probes-'))
    await page.evaluate(
      (selectors) => {
        for (const selector of selectors) {
          if (selector === 'body') continue;
          const wrapper = document.createElement('div');
          document.body.append(wrapper);
          let parent = wrapper;
          for (const token of selector.replace(/\s*>\s*/g, ' ').split(/\s+/)) {
            const tag = token.match(/^[a-z][a-z0-9-]*/i)?.[0] || 'div';
            const node = document.createElement(tag);
            for (const match of token.matchAll(/([.#])([\w-]+)/g)) {
              if (match[1] === '#') node.id = match[2];
              else node.classList.add(match[2]);
            }
            for (const match of token.matchAll(
              /\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g,
            ))
              node.setAttribute(match[1], match[2] || '');
            parent.append(node);
            parent = node;
          }
          parent.textContent = 'Dart fixture';
        }
      },
      [
        ...new Set(
          removed[file.includes('storefront') ? 'storefront' : 'dashboard'].map(
            (entry) => entry.selector,
          ),
        ),
      ],
    );
  await page.evaluate(async () => {
    // Populate the static product and leaderboard templates without API writes.
    const card = document.getElementById('productTemplate');
    if (card) {
      const clone = card.cloneNode(true);
      clone.removeAttribute('id');
      clone.style.display = '';
      card.after(clone);
    }
    const list = document.querySelector('.leaderboard-list');
    if (list)
      list.innerHTML =
        '<li class="leaderboard-item"><span class="rank">1</span><span>Fixture customer</span><strong>250</strong></li>';
    const chart = document.getElementById('productSizeChartContent');
    if (chart)
      chart.innerHTML =
        '<div class="product-size-chart-table-wrap"><table class="product-size-chart-table"><thead><tr><th>Size</th><th>Width</th></tr></thead><tbody><tr><th>M</th><td>54 cm</td></tr></tbody></table></div>';
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) => {
        image.loading = 'eager';
        return image.decode().catch(() => {});
      }),
    );
    window.cssSnapshot = () =>
      [...document.querySelectorAll('body, body *')]
        .filter(
          (node) =>
            !['STYLE', 'SCRIPT', 'LINK'].includes(node.tagName) &&
            !node.closest('.dashboard-section[hidden]'),
        )
        .map((node) => ({
          label: `${node.tagName}#${node.id}.${node.className}`,
          rect: JSON.stringify(node.getBoundingClientRect().toJSON()),
          styles: ['', '::before', '::after'].map((pseudo) => {
            const style = getComputedStyle(node, pseudo || null);
            if (pseudo && ['none', 'normal'].includes(style.content))
              return { content: style.content };
            return Object.fromEntries(
              [...style]
                .filter((prop) => !prop.startsWith('--'))
                .map((prop) => [prop, style.getPropertyValue(prop)]),
            );
          }),
        }));
  });
}
async function activate(page, state) {
  await page.evaluate((state) => {
    if (
      ['page', 'size-chart', 'set'].includes(state) ||
      state.startsWith('product')
    ) {
      const modal = document.getElementById('SectionModel');
      if (modal) {
        modal.style.display =
          state.startsWith('product') || state === 'size-chart'
            ? 'flex'
            : 'none';
        modal.setAttribute(
          'aria-hidden',
          !(state.startsWith('product') || state === 'size-chart'),
        );
      }
      const chart = document.getElementById('productSizeChartPanel');
      if (chart) chart.hidden = state !== 'size-chart';
      const set = document.getElementById('dartSetModal');
      if (set) set.hidden = state !== 'set';
      return;
    }
    document.body.classList.toggle('dart-admin-locked', state === 'auth');
    document.getElementById('dart-admin-auth').hidden = state !== 'auth';
    document.querySelectorAll('.dashboard-section').forEach((node) => {
      node.classList.toggle('active-section', node.id === state);
      node.hidden = node.id !== state;
    });
  }, state);
  await page.mouse.up();
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.activeElement?.blur());
  if (state === 'product-focus') await page.locator('#modalBuyBtn').focus();
  if (state === 'product-hover' || state === 'product-active')
    await page.locator('#modalBuyBtn').hover();
  if (state === 'product-active') await page.mouse.down();

  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
async function digest(page) {
  return page.evaluate(async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(cssSnapshot()));
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  });
}
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  try {
    const pages = fs
      .readdirSync(root)
      .filter((file) => file.endsWith('.html'))
      .concat([
        'Eye/Dart Eye.html',
        'api/news-template.html',
        '__css-probes-storefront.html',
        '__css-probes-dashboard.html',
      ]);
    for (const file of pages) {
      for (const width of [370, 480, 767, 768, 1440]) {
        // Separate fresh pages avoid compositor repaint differences caused by swapping live sheets.
        const beforePage = await browser.newPage({
          viewport: { width, height: 900 },
        });
        const afterPage = await browser.newPage({
          viewport: { width, height: 900 },
        });
        try {
          await initialize(beforePage, origin, file, 'before');
          await initialize(afterPage, origin, file, 'after');
          const states = file.startsWith('Eye/')
            ? await beforePage
                .locator('.dashboard-section')
                .evaluateAll((nodes) => [
                  'auth',
                  ...nodes.map((node) => node.id),
                ])
            : file === 'products.html'
              ? [
                  'page',
                  'product',
                  'size-chart',
                  'set',
                  'product-hover',
                  'product-focus',
                  'product-active',
                ]
              : ['page'];
          for (const state of states) {
            await activate(beforePage, state);
            await activate(afterPage, state);
            const beforeDigest = await digest(beforePage),
              afterDigest = await digest(afterPage);
            if (beforeDigest !== afterDigest) {
              const baseline = await beforePage.evaluate(() => cssSnapshot());
              const differences = await afterPage.evaluate((cssBefore) => {
                const after = cssSnapshot(),
                  differences = [];
                if (after.length !== cssBefore.length)
                  return ['DOM size changed'];
                for (let i = 0; i < after.length; i++) {
                  if (after[i].rect !== cssBefore[i].rect)
                    differences.push(`${after[i].label}: geometry`);
                  for (let pseudo = 0; pseudo < 3; pseudo++)
                    for (const [prop, value] of Object.entries(
                      after[i].styles[pseudo],
                    )) {
                      if (cssBefore[i].styles[pseudo][prop] !== value)
                        differences.push(
                          `${after[i].label} ${pseudo} ${prop}: ${cssBefore[i].styles[pseudo][prop]} -> ${value}`,
                        );
                      if (differences.length >= 15) return differences;
                    }
                }
                return differences;
              }, baseline);
              assert.deepEqual(
                differences,
                [],
                `${file} / ${state} / ${width}px: computed styles changed`,
              );
            }
            const before = await beforePage.screenshot({
              animations: 'disabled',
            });
            const after = await afterPage.screenshot({
              animations: 'disabled',
            });
            let pixelDifferences = 0,
              rawPixelDifferences = 0;
            if (!before.equals(after)) {
              const a = PNG.sync.read(before),
                b = PNG.sync.read(after);
              assert.equal(a.width, b.width);
              assert.equal(a.height, b.height);
              // Native controls can repaint edge antialiasing with identical computed geometry.
              pixelDifferences = pixelmatch(
                a.data,
                b.data,
                null,
                a.width,
                a.height,
                { threshold: 0, includeAA: false },
              );
              rawPixelDifferences = pixelmatch(
                a.data,
                b.data,
                null,
                a.width,
                a.height,
                { threshold: 0, includeAA: true },
              );
            }
            if (pixelDifferences && reportFile) {
              fs.writeFileSync(
                path.join(path.dirname(reportFile), 'pixel-before.png'),
                before,
              );
              fs.writeFileSync(
                path.join(path.dirname(reportFile), 'pixel-after.png'),
                after,
              );
            }
            assert.equal(
              pixelDifferences,
              0,
              `${file} / ${state} / ${width}px: rendered pixels changed`,
            );
            results.push({
              page: file,
              state,
              width,
              computedDifferences: 0,
              pixelDifferences,
              rawPixelDifferences,
              screenshotSha256: crypto
                .createHash('sha256')
                .update(after)
                .digest('hex'),
            });
          }
        } finally {
          await beforePage.close();
          await afterPage.close();
        }
        console.log(`PASS CSS viewport: ${file} / ${width}px`);
      }
      console.log(`PASS CSS equivalence: ${file}`);
    }
    if (reportFile)
      fs.writeFileSync(
        reportFile,
        JSON.stringify(
          { baselineRef, comparisons: results.length, results },
          null,
          2,
        ) + '\n',
      );
    console.log(
      `PASS ${results.length} CSS comparisons: computed styles, pseudo-elements, geometry and pixels.`,
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
