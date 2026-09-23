from pathlib import Path
from PIL import Image
import re

files = [p for p in Path('Photos').rglob('*') if p.is_file() and p.suffix.lower() == '.jfif']
print(f'JFIF_COUNT={len(files)}')
print(f'JFIF_BASELINE_BYTES={sum(p.stat().st_size for p in files)}')
for src in files:
    out = src.with_suffix('.webp')
    with Image.open(src) as im0:
        im = im0.convert('RGB')
        im.save(out, 'WEBP', quality=80, method=5)
print(f'JFIF_WEBP_BYTES={sum(p.with_suffix(".webp").stat().st_size for p in files)}')

img_re = re.compile(r'<img\b[^>]*\bsrc=(?P<q>["\'])(?P<src>(?:\.\./)?Photos/[^"\']+?\.jfif)(?P=q)[^>]*>', re.I | re.S)
for path in Path('.').rglob('*.html'):
    text = path.read_text(encoding='utf-8')
    def wrap(m):
        start = m.start()
        prefix = text[max(0, start - 240):start]
        if prefix.rfind('<picture') > prefix.rfind('</picture>'):
            return m.group(0)
        src = m.group('src')
        webp = re.sub(r'\.jfif$', '.webp', src, flags=re.I)
        return f'<picture class="dart-picture"><source srcset="{webp}" type="image/webp">{m.group(0)}</picture>'
    updated = img_re.sub(wrap, text)
    if updated != text:
        path.write_text(updated, encoding='utf-8')

css_re = re.compile(r'url\((?P<q>["\']?)(?P<src>(?:\.\./)?Photos/[^)"\']+?\.jfif)(?P=q)\)', re.I)
for path in Path('.').rglob('*.css'):
    text = path.read_text(encoding='utf-8')
    updated = css_re.sub(lambda m: f'image-set(url("{re.sub(r"\.jfif$", ".webp", m.group("src"), flags=re.I)}") type("image/webp"), url("{m.group("src")}") type("image/jpeg"))', text)
    if updated != text:
        path.write_text(updated, encoding='utf-8')

js_re = re.compile(r'(?P<q>["\'])(?P<src>(?:\.\./)?Photos/[^"\']+?)\.jfif(?P=q)', re.I)
for path in list(Path('Js').rglob('*.js')) + list(Path('Eye').rglob('*.js')):
    text = path.read_text(encoding='utf-8')
    updated = js_re.sub(lambda m: f"{m.group('q')}{m.group('src')}.webp{m.group('q')}", text)
    if updated != text:
        path.write_text(updated, encoding='utf-8')

for target in [Path('Js/dart-ui.js'), Path('Eye/dart.js')]:
    text = target.read_text(encoding='utf-8')
    text = text.replace("var candidates = ['.png', '.jpg', '.jpeg'];", "var candidates = ['.png', '.jpg', '.jpeg', '.jfif'];")
    target.write_text(text, encoding='utf-8')

missing = [str(p) for p in files if not p.with_suffix('.webp').exists()]
if missing:
    raise SystemExit('Missing JFIF WebP siblings: ' + ', '.join(missing))
print('STEP1B_JFIF_OK')
