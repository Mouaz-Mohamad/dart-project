from pathlib import Path
import re

script_re = re.compile(r'<script\b(?P<attrs>[^>]*)\bsrc=(?P<q>["\'])(?P<src>(?:\.\./)?Js/[^"\']+\.js)(?P=q)(?P<tail>[^>]*)></script>', re.I)
changed_files = []
changed_tags = 0

for path in Path('.').rglob('*.html'):
    text = path.read_text(encoding='utf-8')
    def add_defer(m):
        nonlocal_marker = None
        attrs = m.group('attrs') + m.group('tail')
        if re.search(r'\bdefer\b', attrs, re.I):
            return m.group(0)
        before_src = m.group('attrs')
        src = m.group('src')
        q = m.group('q')
        tail = m.group('tail')
        return f'<script{before_src} src={q}{src}{q}{tail} defer></script>'
    updated, count = script_re.subn(add_defer, text)
    if count and updated != text:
        path.write_text(updated, encoding='utf-8')
        changed_files.append(path.as_posix())
        changed_tags += count

missing = []
for path in Path('.').rglob('*.html'):
    text = path.read_text(encoding='utf-8')
    for tag in re.findall(r'<script\b[^>]*\bsrc=["\'](?:\.\./)?Js/[^"\']+\.js["\'][^>]*></script>', text, flags=re.I):
        if not re.search(r'\bdefer\b', tag, re.I):
            missing.append(f'{path}: {tag}')
if missing:
    raise SystemExit('Local Js scripts without defer:\n' + '\n'.join(missing))

print(f'DEFER_TAGS_ADDED={changed_tags}')
print('DEFER_FILES=' + ','.join(changed_files))
print('STEP2_DEFER_OK')
