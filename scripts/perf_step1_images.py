from pathlib import Path
from PIL import Image
import re

root = Path('.')
photo_dir = Path('Photos')
exts = {'.png', '.jpg', '.jpeg'}
sources = [p for p in photo_dir.rglob('*') if p.is_file() and p.suffix.lower() in exts]
before_total = sum(p.stat().st_size for p in sources)
print(f'IMAGE_BASELINE_BYTES={before_total}')
print(f'IMAGE_SOURCE_COUNT={len(sources)}')

def save_webp(src: Path):
    out = src.with_suffix('.webp')
    with Image.open(src) as im0:
        im = im0.copy()
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA' if 'transparency' in im.info else 'RGB')
        im.save(out, 'WEBP', quality=80, method=6)
        target = 300 * 1024
        while out.stat().st_size > target and max(im.size) > 900:
            scale = max(0.78, min(0.92, (target / out.stat().st_size) ** 0.5 * 0.97))
            new_size = (max(1, int(im.width * scale)), max(1, int(im.height * scale)))
            im = im.resize(new_size, Image.Resampling.LANCZOS)
            im.save(out, 'WEBP', quality=80, method=6)
    return out

webps = [save_webp(p) for p in sources]
after_total = sum(p.stat().st_size for p in webps)
print(f'IMAGE_WEBP_BYTES={after_total}')
print(f'IMAGE_WEBP_COUNT={len(webps)}')

key_names = {'hero 1.png','hero 2.png','dart.png','dart_logo.png','logo-1to1.png','card.png','me.png'}
for src in sources:
    if src.name in key_names:
        out = src.with_suffix('.webp')
        print(f'KEY_IMAGE {src.as_posix()} {src.stat().st_size} -> {out.stat().st_size}')

img_re = re.compile(r'<img\b[^>]*\bsrc=(?P<q>["\'])(?P<src>(?:\.\./)?Photos/[^"\']+?\.(?:png|jpe?g))(?P=q)[^>]*>', re.I | re.S)
for path in root.rglob('*.html'):
    text = path.read_text(encoding='utf-8')
    def wrap_img(m):
        start = m.start()
        prefix = text[max(0, start - 240):start]
        if prefix.rfind('<picture') > prefix.rfind('</picture>'):
            return m.group(0)
        src = m.group('src')
        webp = re.sub(r'\.(?:png|jpe?g)$', '.webp', src, flags=re.I)
        return f'<picture class="dart-picture"><source srcset="{webp}" type="image/webp">{m.group(0)}</picture>'
    updated = img_re.sub(wrap_img, text)
    if updated != text:
        path.write_text(updated, encoding='utf-8')

css_url_re = re.compile(r'url\((?P<q>["\']?)(?P<src>(?:\.\./)?Photos/[^)"\']+?\.(?:png|jpe?g))(?P=q)\)', re.I)
for path in root.rglob('*.css'):
    text = path.read_text(encoding='utf-8')
    def css_swap(m):
        src = m.group('src')
        ext = Path(src).suffix.lower()
        mime = 'image/png' if ext == '.png' else 'image/jpeg'
        webp = re.sub(r'\.(?:png|jpe?g)$', '.webp', src, flags=re.I)
        return f'image-set(url("{webp}") type("image/webp"), url("{src}") type("{mime}"))'
    updated = css_url_re.sub(css_swap, text)
    if updated != text:
        path.write_text(updated, encoding='utf-8')

js_path_re = re.compile(r'(?P<q>["\'])(?P<src>(?:\.\./)?Photos/[^"\']+?)\.(?P<ext>png|jpe?g)(?P=q)', re.I)
for path in list(Path('Js').rglob('*.js')) + list(Path('Eye').rglob('*.js')):
    text = path.read_text(encoding='utf-8')
    updated = js_path_re.sub(lambda m: f"{m.group('q')}{m.group('src')}.webp{m.group('q')}", text)
    if updated != text:
        path.write_text(updated, encoding='utf-8')

fallback_code = r'''/* BEGIN WebP runtime fallback for dynamically assigned local images */
(function installDartWebpFallback() {
  if (window.__dartWebpFallbackInstalled) return;
  window.__dartWebpFallbackInstalled = true;
  document.addEventListener('error', function (event) {
    var img = event.target;
    if (!img || img.tagName !== 'IMG') return;
    var src = img.getAttribute('src') || '';
    if (!/\.webp(?:[?#].*)?$/i.test(src)) return;
    var base = src.replace(/\.webp(?=([?#].*)?$)/i, '');
    var stage = Number(img.dataset.dartFallbackStage || 0);
    var candidates = ['.png', '.jpg', '.jpeg'];
    if (stage >= candidates.length) return;
    img.dataset.dartFallbackStage = String(stage + 1);
    img.src = base + candidates[stage];
  }, true);
})();
/* END WebP runtime fallback for dynamically assigned local images */

'''
for target in [Path('Js/dart-ui.js'), Path('Eye/dart.js')]:
    text = target.read_text(encoding='utf-8')
    if 'BEGIN WebP runtime fallback' not in text:
        target.write_text(fallback_code + text, encoding='utf-8')

missing = [str(p) for p in sources if not p.with_suffix('.webp').exists()]
if missing:
    raise SystemExit('Missing WebP siblings: ' + ', '.join(missing))
oversized = [str(p) for p in webps if p.stat().st_size > 300 * 1024]
if oversized:
    print('WARN_WEBP_OVER_300KB=' + ','.join(oversized))
print('STEP1_IMAGE_OPTIMIZATION_OK')
