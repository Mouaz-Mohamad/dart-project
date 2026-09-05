from html.parser import HTMLParser
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]

class Parser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids=[]; self.images=[]; self.assets=[]
    def handle_starttag(self, tag, attrs):
        data=dict(attrs)
        if data.get('id'): self.ids.append(data['id'])
        if tag=='img': self.images.append(data)
        if tag=='script' and data.get('src'): self.assets.append(data['src'])
        if tag=='link' and data.get('href') and ('stylesheet' in data.get('rel','') or data.get('rel')=='manifest'): self.assets.append(data['href'])

errors=[]
for path in ROOT.rglob('*.html'):
    parser=Parser(); parser.feed(path.read_text(encoding='utf-8'))
    duplicates=sorted({item for item in parser.ids if parser.ids.count(item)>1})
    if duplicates: errors.append(f'{path.relative_to(ROOT)} duplicate IDs: {duplicates}')
    for image in parser.images:
        if 'alt' not in image or not image.get('alt','').strip(): errors.append(f'{path.relative_to(ROOT)} image missing useful alt: {image.get("src","")}')
    if path.parent.name != 'sections':
        for asset in parser.assets:
            if not asset or asset.startswith(('http://','https://','//','data:')): continue
            target = ROOT / asset.lstrip('/') if asset.startswith('/') else path.parent / asset
            if not target.exists(): errors.append(f'{path.relative_to(ROOT)} missing local asset: {asset}')

dashboard=(ROOT/'Eye/Dart Eye.html').read_text(encoding='utf-8')
for required in ['dashboard-order-map','orderLatitude','orderLongitude','orderFullAddress','modal-rep-id-front','modal-rep-id-back','modal-rep-face','password-requests-modal','size-chart-modal','dashboard-size-chart-body']:
    if f'id="{required}"' not in dashboard: errors.append(f'Dashboard missing #{required}')
if not re.search(r'id="orderFloor"[^>]+required',dashboard): errors.append('Dashboard floor must be required')

products=(ROOT/'products.html').read_text(encoding='utf-8')
for required in ['toggleProductFilters','productFiltersPanel','productSearchInput','productSizeFilter','productColorFilter','productAvailabilityFilter','productPriceFilter','productSortSelect','clearProductFilters','productSizeChartBtn','productSizeChartPanel']:
    if f'id="{required}"' not in products: errors.append(f'Products page missing #{required}')
if 'dart-size-chart-v5.js' not in dashboard: errors.append('Dashboard size-chart behavior script is not loaded')
if dashboard.count('id="size-chart-modal"') != 1: errors.append('Dashboard must contain exactly one reusable size-chart modal')

for page_name in ['index.html','products.html']:
    page=(ROOT/page_name).read_text(encoding='utf-8')
    if page.count('id="productSizeChartPanel"') != 1: errors.append(f'{page_name} must contain exactly one reusable product size-chart panel')

address=(ROOT/'Js/dart-address.js').read_text(encoding='utf-8')
for required_text in ['DELIVERY_BOUNDS','isSupportedDeliveryResult','outside-delivery-zone','Giza','floor']:
    if required_text not in address: errors.append(f'Address module missing delivery-zone rule: {required_text}')

rep=(ROOT/'rep.html').read_text(encoding='utf-8')
for required in ['repAuthCard','repLoginForm','repRegisterForm','repChangePasswordForm','repOrdersList','repLocationStatus']:
    if f'id="{required}"' not in rep: errors.append(f'Representative portal missing #{required}')
if 'id="repDeliveryMap"' in rep: errors.append('Representative portal must not include an embedded map')

tracking=(ROOT/'track.html').read_text(encoding='utf-8')
for required in ['trackingMapShell','tracking-map','trackingMapDisabled','trackingMapSummary','etaTime']:
    if f'id="{required}"' not in tracking: errors.append(f'Tracking page missing #{required}')

fixes=(ROOT/'CSS/fixes.css').read_text(encoding='utf-8')
if not re.search(r'#representative\s+\.row-action-btns\s*\{[^}]*width:\s*300px',fixes,re.S):
    errors.append('Representative Action cell must be fixed at 300px')

checkout_code=(ROOT/'Js/one .js').read_text(encoding='utf-8')
for required_text in ["sessionStorage.setItem('dart_last_order_id'", "window.location.href = 'index.html'", 'dartCheckoutAddress?.invalidate']:
    if required_text not in checkout_code: errors.append(f'Checkout flow missing: {required_text}')

dashboard_ops=(ROOT/'Eye/dart-operations-v4.js').read_text(encoding='utf-8')
if "emptyKeys.forEach(key => write(key, []))" in dashboard_ops:
    errors.append('Dashboard still clears website orders during first initialization')

all_code='\n'.join(path.read_text(encoding='utf-8') for pattern in ('*.js','*.html') for path in ROOT.rglob(pattern))
for forbidden in [r'toFixed\(2\)', r'\.00 EGP', r'step="0\.01"']:
    if re.search(forbidden,all_code): errors.append(f'Forbidden decimal display remains: {forbidden}')

if errors:
    print('\n'.join(f'FAIL {error}' for error in errors)); sys.exit(1)
print('PASS static HTML, assets, accessibility and integer-money checks')
