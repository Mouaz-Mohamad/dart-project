// DART CODE GUIDE | scripts/add-arabic-code-comments.mjs
// الغرض: إضافة شرح عربي قصير وآمن إلى ملفات الكود وإنشاء خريطة عربية لكل الملفات.

import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MARKER = "DART CODE GUIDE";
const ALLOWED_EXTENSIONS = new Set([
  ".js", ".cjs", ".mjs", ".ts", ".css", ".html", ".sql",
  ".sh", ".yml", ".yaml", ".py", ".xml", ".txt",
]);
const IGNORED_DIRS = new Set([
  ".git", "node_modules", ".vercel", "coverage", "dist",
  "Photos", "Icons",
]);

function normalize(file) {
  return file.split(path.sep).join("/");
}

function purposeFor(file) {
  const p = normalize(file);
  const name = path.basename(p).toLowerCase();

  if (p.startsWith(".github/workflows/")) {
    return "إعداد GitHub Actions للتحقق الآلي من الكود قبل الدمج أو النشر.";
  }
  if (p === ".github/dependabot.yml") {
    return "إعداد Dependabot لمتابعة تحديثات واعتمادات المشروع.";
  }
  if (p.startsWith("backend/migrations/")) {
    return "Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.";
  }
  if (p.startsWith("backend/tests/")) {
    return "اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر.";
  }
  if (p.startsWith("tests/")) {
    return "اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.";
  }
  if (p.includes("/middleware/")) {
    return "Middleware مركزي يطبّق قاعدة مشتركة على طلبات HTTP قبل وصولها للـroutes.";
  }
  if (p.includes("/security/")) {
    return "وظائف أمنية مشتركة للمصادقة أو التطبيع أو حماية الجلسات والبيانات الحساسة.";
  }
  if (p.includes("/database/")) {
    return "طبقة PostgreSQL: اتصال أو migration أو seed؛ الخادم هو مصدر الحقيقة للبيانات.";
  }
  if (name.endsWith(".routes.ts")) {
    return "تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.";
  }
  if (name.endsWith(".service.ts")) {
    return "منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح.";
  }
  if (name.endsWith(".types.ts") || name.endsWith(".d.ts")) {
    return "تعريف أنواع TypeScript والعقود المشتركة بين أجزاء الـBackend.";
  }
  if (p === "backend/src/application.ts") {
    return "تجميع تطبيق Express: الأمان وCORS والـrate limits والـrouters ومعالجة الأخطاء.";
  }
  if (p === "backend/src/app.ts") {
    return "إنشاء Runtime وربط الخدمات وقاعدة البيانات بالتطبيق، مع fallback آمن عند سوء الإعداد.";
  }
  if (p === "backend/src/server.ts") {
    return "تشغيل HTTP server وإدارة الإغلاق الآمن واتصال PostgreSQL.";
  }
  if (p.startsWith("backend/scripts/")) {
    return "أداة تشغيل/صيانة للـBackend؛ تُستخدم من npm scripts أو CI ولا تعمل داخل المتصفح.";
  }
  if (p.startsWith("Eye/") && name.endsWith(".js")) {
    return "منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف.";
  }
  if (p.startsWith("Js/") && name.endsWith(".js")) {
    return "وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI.";
  }
  if (p.startsWith("CSS/")) {
    return "تنسيقات الواجهة العامة؛ حافظ على تقسيم base/main/responsive وتجنب تكرار القواعد.";
  }
  if (p.startsWith("Eye/") && name.endsWith(".css")) {
    return "تنسيقات قسم من Dart Eye Dashboard مع دعم الكمبيوتر والموبايل.";
  }
  if (p.startsWith("sections/") && name.endsWith(".html")) {
    return "جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع.";
  }
  if (name.endsWith(".html")) {
    return "صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة.";
  }
  if (p === "sw.js") {
    return "Service Worker للموقع؛ يدير التخزين المؤقت وسلوك الشبكة دون أن يصبح مصدر بيانات تجاري.";
  }
  if (p.endsWith("robots.txt")) {
    return "تعليمات لمحركات البحث حول مسارات الموقع التي يمكن زحفها.";
  }
  if (p.endsWith("sitemap.xml")) {
    return "خريطة صفحات الموقع لمحركات البحث.";
  }
  if (name.endsWith(".sh")) {
    return "سكريبت Shell مساعد للتشغيل أو النشر.";
  }
  if (name.endsWith(".yml") || name.endsWith(".yaml")) {
    return "ملف إعداد تشغيلي/CI؛ تغيير القيم هنا يؤثر على الأتمتة وليس منطق المتجر مباشرة.";
  }
  if (name.endsWith(".sql")) {
    return "SQL خاص بقاعدة البيانات؛ راجع القيود والمعاملات قبل أي تعديل.";
  }
  if (name.endsWith(".py")) {
    return "سكريبت Python للتحقق أو الصيانة داخل المشروع.";
  }
  if (name.endsWith(".xml")) {
    return "ملف XML تشغيلي/تعريفي للمشروع.";
  }
  return "ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله.";
}

function headerFor(file) {
  const p = normalize(file);
  const purpose = purposeFor(p);
  const ext = path.extname(p).toLowerCase();

  if ([".js", ".cjs", ".mjs", ".ts"].includes(ext)) {
    return "// " + MARKER + " | " + p + "\n// الغرض: " + purpose + "\n";
  }
  if (ext === ".css") {
    return "/* " + MARKER + " | " + p + "\n   الغرض: " + purpose + " */\n";
  }
  if (ext === ".html" || ext === ".xml") {
    return "<!-- " + MARKER + " | " + p + "\n     الغرض: " + purpose + " -->\n";
  }
  if (ext === ".sql") {
    return "-- " + MARKER + " | " + p + "\n-- الغرض: " + purpose + "\n";
  }
  if ([".sh", ".yml", ".yaml", ".py", ".txt"].includes(ext)) {
    return "# " + MARKER + " | " + p + "\n# الغرض: " + purpose + "\n";
  }
  return "";
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".github") {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(ROOT, absolute);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) files.push(...await walk(absolute));
      continue;
    }
    files.push(relative);
  }
  return files;
}

function insertHeader(file, content, header) {
  const ext = path.extname(file).toLowerCase();

  if ([".sh", ".py"].includes(ext) && content.startsWith("#!")) {
    const newline = content.indexOf("\n");
    if (newline !== -1) {
      return content.slice(0, newline + 1) + header + content.slice(newline + 1);
    }
  }

  if (ext === ".html" && /^<!doctype html>/i.test(content.trimStart())) {
    const start = content.search(/<!doctype html>/i);
    const newline = content.indexOf("\n", start);
    if (newline !== -1) {
      return content.slice(0, newline + 1) + header + content.slice(newline + 1);
    }
  }

  if (ext === ".xml" && content.trimStart().startsWith("<?xml")) {
    const start = content.indexOf("<?xml");
    const end = content.indexOf("?>", start);
    if (end !== -1) {
      const after = end + 2;
      const suffix = content.slice(after).startsWith("\n") ? "" : "\n";
      return content.slice(0, after) + "\n" + header + suffix + content.slice(after).replace(/^\n/, "");
    }
  }

  return header + content;
}

async function main() {
  const allFiles = await walk(ROOT);
  const candidates = allFiles
    .filter((file) => ALLOWED_EXTENSIONS.has(path.extname(file).toLowerCase()))
    // GitHub Actions' GITHUB_TOKEN cannot rewrite workflow files from a workflow
    // without the workflows permission. Those few files are documented manually.
    .filter((file) => !file.startsWith(".github/"))
    .filter((file) => !file.startsWith("docs/"))
    .sort();

  const changed = [];
  for (const file of candidates) {
    const absolute = path.join(ROOT, file);
    const content = await fs.readFile(absolute, "utf8");
    if (content.includes(MARKER)) continue;
    const header = headerFor(file);
    if (!header) continue;
    await fs.writeFile(absolute, insertHeader(file, content, header), "utf8");
    changed.push(normalize(file));
  }

  const guideRows = allFiles
    .filter((file) => !file.startsWith(".git/"))
    .sort()
    .map((file) => "| `" + normalize(file) + "` | " + purposeFor(file).replace(/\|/g, "\\|") + " |");

  const guide = [
    "# Dart — دليل الكود العربي",
    "",
    "هذا الملف خريطة قراءة للمشروع. التعليقات داخل ملفات الكود تشرح مسؤولية كل ملف باختصار، وهنا توجد خريطة حتى للملفات التي لا تسمح صيغتها بتعليقات مثل JSON والصور.",
    "",
    "## قاعدة القراءة",
    "",
    "- الواجهة لا تُعد مصدر الحقيقة للسعر أو المخزون أو الصلاحيات؛ الـBackend/PostgreSQL هما المرجع.",
    "- ابدأ من الصفحة أو الـroute ثم اتبع الاستدعاء إلى الـservice ثم قاعدة البيانات.",
    "- ملفات migrations تاريخية: لا تعدّل migration مطبق؛ أضف migration جديدًا.",
    "- أي تغيير في Auth/Inventory/Orders/Finance يحتاج اختبارًا آليًا قبل اعتباره مكتملًا.",
    "",
    "## خريطة الملفات",
    "",
    "| الملف | المسؤولية |",
    "|---|---|",
    ...guideRows,
    "",
    "تم توليد هذا الدليل بواسطة `scripts/add-arabic-code-comments.mjs`.",
    "",
  ].join("\n");

  await fs.mkdir(path.join(ROOT, "docs"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "docs", "CODE_GUIDE_AR.md"), guide, "utf8");

  process.stdout.write("Dart comments updated: " + changed.length + " source files.\n");
}

await main();
