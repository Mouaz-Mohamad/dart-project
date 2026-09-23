from pathlib import Path
import re

base = Path('CSS/base.css')
text = base.read_text(encoding='utf-8')
replacements = {
    "--font-main: 'Readex Pro', 'Montserrat', sans-serif;": "--font-main: 'Readex Pro', sans-serif;",
    "--font-itim: 'Itim', cursive;": "--font-itim: 'Cabin Condensed', sans-serif;",
    "--font-cairo: 'Cairo', sans-serif;": "--font-cairo: 'Readex Pro', sans-serif;",
    "--font-irish: 'Irish Grover', cursive;": "--font-irish: 'Cabin Condensed', sans-serif;",
    "--font-inter: 'Inter', sans-serif;": "--font-inter: 'Readex Pro', sans-serif;",
}
for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'Missing expected base.css token: {old}')
    text = text.replace(old, new)
base.write_text(text, encoding='utf-8')

links = {
    'index.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600;700&family=Readex+Pro:wght@200;300;500;600;700&display=swap',
    'products.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600;700&family=Readex+Pro:wght@200;300;500;600;700&display=swap',
    'cart-checkout.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600;700&family=Readex+Pro:wght@200;300;500;600;700&display=swap',
    'profile.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600;700&family=Readex+Pro:wght@200;300;400;500;600;700&display=swap',
    'about.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600;700&family=Readex+Pro:wght@200;300;500;700&display=swap',
    'policies.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600&family=Readex+Pro:wght@200;300;500&display=swap',
    'Contact us.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600&family=Readex+Pro:wght@200;300;500&display=swap',
    'form-return.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600&family=Readex+Pro:wght@200;300;500;700&display=swap',
    'search-serial.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600&family=Readex+Pro:wght@200;300;500;700&display=swap',
    'track.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600&family=Readex+Pro:wght@200;300;500;700&display=swap',
    'rep.html': 'https://fonts.googleapis.com/css2?family=Cabin+Condensed:wght@400;500;600&family=Readex+Pro:wght@200;300;500;600;700&display=swap',
    'Sign Up modern.html': 'https://fonts.googleapis.com/css2?family=Poppins:wght@200;500;700&display=swap',
    'Eye/Dart Eye.html': 'https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700;800;900&display=swap',
}
font_re = re.compile(r'https://fonts\.googleapis\.com/css2[^"\']+')
for file, url in links.items():
    path = Path(file)
    src = path.read_text(encoding='utf-8')
    found = font_re.findall(src)
    if len(found) != 1:
        raise SystemExit(f'{file}: expected one Google Fonts URL, got {len(found)}')
    path.write_text(src.replace(found[0], url, 1), encoding='utf-8')

storefront = [p for p in links if p not in {'Sign Up modern.html', 'Eye/Dart Eye.html'}]
for file in storefront:
    src = Path(file).read_text(encoding='utf-8')
    url = font_re.findall(src)[0]
    families = re.findall(r'family=([^:&]+(?:\+[^:&]+)*)', url)
    if len(families) > 2:
        raise SystemExit(f'{file}: more than two font families remain: {families}')
    for forbidden in ['Montserrat', 'Itim', 'Cairo', 'Inter', 'Irish+Grover']:
        if forbidden in url:
            raise SystemExit(f'{file}: forbidden storefront font still loaded: {forbidden}')

base_src = base.read_text(encoding='utf-8')
for forbidden in ["'Montserrat'", "'Itim'", "'Cairo'", "'Irish Grover'", "'Inter'"]:
    if forbidden in base_src:
        raise SystemExit(f'base.css still directly references {forbidden}')

print('STOREFRONT_FONT_FAMILIES_AFTER=2')
print('STEP3_FONTS_OK')
