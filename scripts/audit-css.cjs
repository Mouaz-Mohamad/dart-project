const fs = require('node:fs');
const path = require('node:path');
const { groups, analyze } = require('./lib/css-cascade.cjs');
const report = {};
for (const [name, files] of Object.entries(groups)) {
  const result = analyze(
    files.map((file) => ({ file, css: fs.readFileSync(file, 'utf8') })),
  );
  report[name] = result.removed.map((entry) => ({
    ...entry,
    obsolete: {
      ...entry.obsolete,
      file: path.relative(process.cwd(), entry.obsolete.file),
    },
    winners: entry.winners.map((winner) => ({
      ...winner,
      file: path.relative(process.cwd(), winner.file),
    })),
  }));
}
const count = Object.values(report).reduce(
  (sum, entries) => sum + entries.length,
  0,
);
if (process.argv.includes('--json'))
  console.log(JSON.stringify(report, null, 2));
else
  console.log(
    `CSS cascade audit: ${count} overridden selector/property entries across ${Object.keys(groups).length} delivery groups.`,
  );
if (process.argv.includes('--check') && count) process.exitCode = 1;
