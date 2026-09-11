// ==========================================
// 1. مصفوفات البيانات (المنتجات، التقييمات، والمخزون)
// ==========================================
let productsData = DartCatalog.products();

// Keep model codes unique until the real catalog API becomes the source of truth.
const usedProductCodes = new Set();
productsData.forEach(product => {
    const baseCode = String(product.code || `DA-${product.id}`);
    product.code = usedProductCodes.has(baseCode)
        ? `${baseCode}-${String(product.id).padStart(2, '0')}`
        : baseCode;
    usedProductCodes.add(product.code);
});

// Only approved dashboard reviews are public. No fabricated launch reviews.
const reviewsData = (() => {
    try {
        return (JSON.parse(localStorage.getItem('dart_reviews')) || [])
            .filter(review => review.status === 'Active' && !review.isArchived && !review.isDeleted)
            .map(review => ({
                name: review.clientName || 'Dart Customer',
                date: review.date || '',
                rating: Number(review.rating) || 0,
                title: review.title || '',
                comment: review.review || ''
            }));
    } catch {
        return [];
    }
})();

let cartData = JSON.parse(localStorage.getItem('dart_cart')) || [];
let appliedDiscountRate = 0;

let selectedSize = null;
let selectedColor = null;
let activeProduct = null;
let modalQuantity = 1;
let modalCarouselIndex = 0;

// ==========================================
// 2. الدوال المساعدة الأساسية
// ==========================================

let cachedProductTemplate = null;
const productFilterState = {
    query: '',
    category: 'all',
    size: 'all',
    color: 'all',
    availability: 'all',
    price: 'all',
    sort: 'featured'
};

function escapeCatalogHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
}

function createUiState(type, title, message, actionLabel = '', action = null) {
    const state = document.createElement('div');
    state.className = `dart-ui-state dart-ui-state-${type}`;
    state.setAttribute('role', type === 'error' ? 'alert' : 'status');
    state.innerHTML = `
        <span class="dart-ui-state-icon" aria-hidden="true"></span>
        <div><strong>${escapeCatalogHtml(title)}</strong><p>${escapeCatalogHtml(message)}</p></div>
    `;
    if (actionLabel && typeof action === 'function') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dart-ui-state-action';
        button.textContent = actionLabel;
        button.addEventListener('click', action);
        state.appendChild(button);
    }
    return state;
}

function setUiState(container, type, title, message, actionLabel = '', action = null) {
    if (!container) return null;
    const state = createUiState(type, title, message, actionLabel, action);
    container.replaceChildren(state);
    return state;
}

function publicCatalogProducts() { return DartStorefront.cards(); }

function productStockPairs(product) {
    const pairs = [];
    Object.entries(product.stock || {}).forEach(([size, colors]) => {
        Object.keys(colors || {}).filter(color => !product.cardColor || color === product.cardColor).forEach(color => pairs.push({
            size: String(size),
            color: String(color),
            quantity: getAvailableStock(product, size, color)
        }));
    });
    return pairs;
}

function filterCatalogProducts(source = publicCatalogProducts()) {
    const query = productFilterState.query.toLocaleLowerCase().trim();
    let result = source.filter(product => {
        const searchable = [product.title, product.code, product.category, product.description]
            .join(' ').toLocaleLowerCase();
        if (query && !searchable.includes(query)) return false;
        if (productFilterState.category !== 'all' && String(product.category).toLocaleLowerCase() !== productFilterState.category.toLocaleLowerCase()) return false;

        const pairs = productStockPairs(product);
        const matchingPairs = pairs.filter(pair =>
            (productFilterState.size === 'all' || pair.size === productFilterState.size) &&
            (productFilterState.color === 'all' || pair.color === productFilterState.color)
        );
        if ((productFilterState.size !== 'all' || productFilterState.color !== 'all') && !matchingPairs.length) return false;
        const relevantPairs = matchingPairs.length ? matchingPairs : pairs;
        const available = relevantPairs.some(pair => Number(pair.quantity) > 0);
        if (productFilterState.availability === 'in-stock' && !available) return false;
        if (productFilterState.availability === 'out-of-stock' && available) return false;

        const price = Number(product.price) || 0;
        if (productFilterState.price === 'under-500' && price >= 500) return false;
        if (productFilterState.price === '500-750' && (price < 500 || price > 750)) return false;
        if (productFilterState.price === '750-1000' && (price <= 750 || price > 1000)) return false;
        if (productFilterState.price === 'over-1000' && price <= 1000) return false;
        return true;
    });

    const sorters = {
        newest: (a, b) => Number(b.id) - Number(a.id),
        'price-low': (a, b) => Number(a.price) - Number(b.price),
        'price-high': (a, b) => Number(b.price) - Number(a.price),
        name: (a, b) => String(a.title).localeCompare(String(b.title), ['en', 'ar'])
    };
    if (sorters[productFilterState.sort]) result = [...result].sort(sorters[productFilterState.sort]);
    return result;
}

function clearRenderedProducts(container) {
    if (!container) return;
    [...container.children].forEach(child => {
        if (child.id !== 'productTemplate') child.remove();
    });
}

function appendProductCards(container, products, template, animate = false) {
    if (!container) return;
    products.forEach(item => {
        const card = createProductCard(item, template);
        if (animate) card.classList.add('fade-in');
        container.appendChild(card);
    });
}

function productFiltersAreDefault() {
    return productFilterState.query === '' && productFilterState.category === 'all' &&
        productFilterState.size === 'all' && productFilterState.color === 'all' &&
        productFilterState.availability === 'all' && productFilterState.price === 'all' &&
        productFilterState.sort === 'featured';
}

function renderProductPageResults() {
    const template = getProductTemplate();
    const part1 = document.getElementById('productsPart1');
    const part2 = document.getElementById('productsPart2');
    if (!template || (!part1 && !part2)) return;
    const filtered = filterCatalogProducts();
    clearRenderedProducts(part1);
    clearRenderedProducts(part2);

    if (!filtered.length) {
        if (part1) part1.appendChild(createUiState(
            'empty',
            'No products match these filters',
            'Try another size, color, category or price range.',
            'Clear filters',
            resetProductFilters
        ));
    } else if (productFiltersAreDefault()) {
        appendProductCards(part1, filtered.slice(0, 6), template);
        appendProductCards(part2, filtered.slice(6), template);
    } else {
        appendProductCards(part1, filtered, template, true);
    }

    const count = document.getElementById('productResultsCount');
    if (count) count.textContent = `${filtered.length} product${filtered.length === 1 ? '' : 's'}`;
}

// يرجع مصفوفة صور المنتج مهما كانت شكل البيانات (images[] أو image واحدة قديمة)
function getProductImages(item) {
    if (item && Array.isArray(item.images) && item.images.length) return item.images;
    if (item && item.image) return [item.image];
    return [];
}

function getAvailableStock(product, size, color) { return DartCatalog.available(DartCatalog.model(product.code),size,color,window.DartPlatform?.cartReservationId||""); }

function getProductTemplate() {
    if (!cachedProductTemplate) {
        const templateEl = document.getElementById('productTemplate');
        if (templateEl) {
            cachedProductTemplate = templateEl.cloneNode(true);
        }
    }
    return cachedProductTemplate;
}

async function loadSection(containerId, filePath) {
    const container = document.getElementById(containerId);
    if (!container) return;

    setUiState(container, 'loading', 'Loading', 'Preparing this section…');
    try {
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        const html = await response.text();
        container.innerHTML = html;
    } catch (error) {
        console.error(`Failed to load (${filePath}):`, error);
        setUiState(
            container,
            'error',
            'This section could not be loaded',
            navigator.onLine ? 'Please retry.' : 'Reconnect to the internet, then retry.',
            'Retry',
            () => loadSection(containerId, filePath)
        );
    }
}

function initHeader() {
    const iconMenu = document.querySelector('.icon-menu');
    const sideMenu = document.querySelector('.side-menu');
    const menuFacke = document.querySelector('.menu-facke');

    if (iconMenu) {
        iconMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            if (sideMenu) sideMenu.classList.toggle('active');
            if (menuFacke) menuFacke.classList.toggle('active');
        });

        document.addEventListener('click', (event) => {
            if (sideMenu && !sideMenu.contains(event.target) && !iconMenu.contains(event.target)) {
                sideMenu.classList.remove('active');
            }
            if (menuFacke && !menuFacke.contains(event.target) && !iconMenu.contains(event.target)) {
                menuFacke.classList.remove('active');
            }
        });

        window.addEventListener('scroll', () => {
            if (sideMenu) sideMenu.classList.remove('active');
            if (menuFacke) menuFacke.classList.remove('active');
        });
    }
}

function renderProductsLogic() {
    const productTemplate = getProductTemplate();
    if (!productTemplate) return;

    const productsContainer = document.getElementById('productsContainer');
    if (productsContainer) {
        clearRenderedProducts(productsContainer);
        const homeProducts = publicCatalogProducts().slice(0, 8);
        appendProductCards(productsContainer, homeProducts, productTemplate);
        if (!homeProducts.length) productsContainer.appendChild(createUiState('empty', 'No products yet', 'New Dart products will appear here.'));
    }

    const bestProductsContainer = document.getElementById('bestProductsContainer');
    if (bestProductsContainer) {
        clearRenderedProducts(bestProductsContainer);
        const bestProducts = publicCatalogProducts().filter(product => productStockPairs(product).some(pair => pair.quantity > 0)).slice(0, 5);
        appendProductCards(bestProductsContainer, bestProducts, productTemplate);
        if (!bestProducts.length) bestProductsContainer.appendChild(createUiState('empty', 'No best sellers yet', 'Available products will appear here.'));
    }

    const part1Container = document.getElementById('productsPart1');
    const part2Container = document.getElementById('productsPart2');

    if (part1Container || part2Container) renderProductPageResults();
}

function createProductCard(item, template) {
    const card = template.cloneNode(true);
    card.removeAttribute('id');
    card.style.display = 'flex';
    card.style.position = 'relative';
    card.setAttribute('data-id', item.id);
    card.dataset.color = item.cardColor || '';
    card.setAttribute('tabindex','0');

    // فحص العناصر قبل استخدامها لتفادي توقف الكود
    const img = card.querySelector('.product-img');
    if (img) {
        const images = getProductImages(item);
        img.src = images[0] || '';
        img.alt = item.title;
        img.addEventListener('error', () => {
            img.hidden = true;
            if (!card.querySelector('.dart-product-image-error')) {
                const fallback = document.createElement('div');
                fallback.className = 'dart-product-image-error';
                fallback.setAttribute('role', 'img');
                fallback.setAttribute('aria-label', `Image unavailable for ${item.title}`);
                fallback.innerHTML = '<i class="fa-regular fa-image" aria-hidden="true"></i><span>Image unavailable</span>';
                img.insertAdjacentElement('afterend', fallback);
            }
        }, { once: true });
    }

    const category = card.querySelector('.product-category');
    if (category) category.textContent = item.category;

    const title = card.querySelector('.product-title');
    if (title) title.textContent = item.title;

    const code = card.querySelector('.product-code');
    if (code) code.textContent = `Code : ${item.code}`;

    const price = card.querySelector('.product-price');
    if (price) price.textContent = `EGP ${Math.trunc(Number(item.price) || 0)}`;

    let totalStock = 0;
    if (item.stock) {
        Object.entries(item.stock).forEach(([size, sizeObj]) => {
            Object.keys(sizeObj).forEach(color => {
                if (!item.cardColor || color === item.cardColor) totalStock += DartCatalog.available(DartCatalog.model(item.code),size,color);
            });
        });
    }

    if (totalStock <= 0) {
        card.classList.add('out-of-stock');
        const badge = document.createElement('span');
        badge.className = 'out-of-stock-badge';
        badge.textContent = 'Sold Out';
        card.appendChild(badge);
    }

    const cartBtn = card.querySelector('.cart-btn');
    if (cartBtn) {
        cartBtn.setAttribute('data-id', item.id);
    }

    return card;
}

function renderReviewsLogic() {
    const reviewsContainer = document.getElementById('reviewsContainer');
    const reviewTemplate = document.getElementById('reviewTemplate');

    if (reviewsContainer && reviewTemplate) {
        [...reviewsContainer.children].forEach(child => { if (child.id !== 'reviewTemplate') child.remove(); });
        if (!reviewsData.length) {
            reviewsContainer.appendChild(createUiState('empty', 'No reviews yet', 'Verified customer reviews will appear here after delivered orders.'));
            return;
        }
        reviewsData.forEach(item => {
            const card = reviewTemplate.cloneNode(true);
            card.removeAttribute('id');
            card.style.display = 'flex';

            const starsContainer = card.querySelector('.stars');
            starsContainer.innerHTML = '';
            for (let i = 1; i <= 5; i++) {
                const star = document.createElement('i');
                star.className = i <= item.rating ? 'fa-solid fa-star' : 'fa-regular fa-star';
                starsContainer.appendChild(star);
            }

            card.querySelector('.review-title').textContent = item.title;
            card.querySelector('.review-text').textContent = item.comment;
            card.querySelector('.user-name-').textContent = item.name;
            card.querySelector('.review-date').textContent = item.date;

            reviewsContainer.appendChild(card);
        });
    }
}

// ==========================================
// 3. نظام المودال (عرض التفاصيل، المقاسات، الألوان)
// ==========================================

document.addEventListener('click', (e) => {
    const sizeChartButton = e.target.closest('#productSizeChartBtn');
    if (sizeChartButton) {
        const panel = document.getElementById('productSizeChartPanel');
        if (panel) {
            panel.hidden = !panel.hidden;
            sizeChartButton.setAttribute('aria-expanded', String(!panel.hidden));
        }
        return;
    }

    if (e.target.closest('#closeProductSizeChart')) {
        const panel = document.getElementById('productSizeChartPanel');
        if (panel) panel.hidden = true;
        document.getElementById('productSizeChartBtn')?.setAttribute('aria-expanded', 'false');
        return;
    }

    const openSizeChartPanel = document.getElementById('productSizeChartPanel');
    if (openSizeChartPanel && !openSizeChartPanel.hidden && e.target === openSizeChartPanel) {
        openSizeChartPanel.hidden = true;
        document.getElementById('productSizeChartBtn')?.setAttribute('aria-expanded', 'false');
        return;
    }

    const productCard = e.target.closest('.product-card');
    const cartBtn = e.target.closest('.cart-btn');

    if (productCard || cartBtn) {
        document.body.classList.add('modal-open');
        const targetElement = cartBtn || productCard;
        const productId = targetElement.getAttribute('data-id');

        activeProduct = productsData.find(p => p.id == productId);
        if(activeProduct) activeProduct = {...activeProduct,cardColor:(productCard || cartBtn.closest(".product-card"))?.dataset.color};
        if (activeProduct) {
            openProductModal(activeProduct);
        }
    }

    if (e.target.closest('.model .fa-x')) {
        closeProductModal();
    }

    const modal = document.getElementById('SectionModel');
    if (e.target === modal) {
        closeProductModal();
    }
});

document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const panel = document.getElementById('productSizeChartPanel');
    if (panel && !panel.hidden) {
        panel.hidden = true;
        document.getElementById('productSizeChartBtn')?.setAttribute('aria-expanded', 'false');
    }
});

window.addEventListener('popstate', () => {
    const modal = document.getElementById('SectionModel');
    if (modal && modal.style.display === 'flex') {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
        document.body.classList.remove('modal-open');
    }
});

function closeProductModal() {
    const modal = document.getElementById('SectionModel');
    if (!modal) return;

    modal.style.display = 'none';
    const sizeChartPanel = modal.querySelector('#productSizeChartPanel');
    if (sizeChartPanel) sizeChartPanel.hidden = true;
    modal.querySelector('#productSizeChartBtn')?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = 'auto';
    document.body.classList.remove('modal-open');

    if (history.state && history.state.modalOpen) {
        history.back();
    }
}

function setProductOptionStatus(message, state = '') {
    const status = document.getElementById('productOptionStatus');
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
}

function getStoredProductSizeChart(product) {
    try {
        const models = JSON.parse(localStorage.getItem('dart_models') || '[]');
        const model = models.find(row => String(row.modelId) === String(product.code));
        const source = model?.sizeChart;
        const rows = Array.isArray(source) ? source : Array.isArray(source?.rows) ? source.rows : [];
        return {
            model,
            unit: Array.isArray(source) ? 'cm' : String(source?.unit || 'cm'),
            rows: rows.filter(row => row && String(row.size || '').trim())
        };
    } catch {
        return { model: null, unit: 'cm', rows: [] };
    }
}

function renderProductSizeChart(product) {
    const content = document.getElementById('productSizeChartContent');
    const title = document.getElementById('productSizeChartTitle');
    const button = document.getElementById('productSizeChartBtn');
    const panel = document.getElementById('productSizeChartPanel');
    if (!content || !button || !panel) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    const chart = getStoredProductSizeChart(product);
    if (title) title.textContent = `Size Chart — ${chart.model?.name || product.title}`;
    content.replaceChildren();

    if (!chart.rows.length) {
        content.appendChild(createUiState(
            'empty',
            'Size chart is being prepared',
            'Measurements for this model are not available yet. Contact Dart before ordering if you need help choosing a size.'
        ));
        button.dataset.chartAvailable = 'false';
        return;
    }

    button.dataset.chartAvailable = 'true';
    const definitions = [
        ['size', 'Size'], ['chest', 'Chest'], ['waist', 'Waist'], ['hip', 'Hip'],
        ['length', 'Length'], ['shoulder', 'Shoulder'], ['sleeve', 'Sleeve'],
        ['inseam', 'Inseam'], ['notes', 'Notes']
    ];
    const visibleColumns = definitions.filter(([key]) => key === 'size' || chart.rows.some(row => String(row[key] || '').trim()));
    const tableWrap = document.createElement('div');
    tableWrap.className = 'product-size-chart-table-wrap';
    const table = document.createElement('table');
    table.className = 'product-size-chart-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    visibleColumns.forEach(([key, label]) => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = key === 'size' || key === 'notes' ? label : `${label} (${chart.unit})`;
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    const tbody = document.createElement('tbody');
    chart.rows.forEach(row => {
        const tr = document.createElement('tr');
        visibleColumns.forEach(([key]) => {
            const td = document.createElement('td');
            td.textContent = String(row[key] || '—');
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.append(thead, tbody);
    tableWrap.appendChild(table);
    const note = document.createElement('p');
    note.className = 'product-size-chart-note';
    note.textContent = `Measurements are in ${chart.unit}. Measure a similar garment laid flat for the closest comparison.`;
    content.append(tableWrap, note);
}

function openProductModal(product) { return DartStorefront.open(product); }

function updateColorsAvailability(product, size) {
    const modal = document.getElementById('SectionModel');
    const colorBtns = modal.querySelectorAll('.color-btn');
    
    colorBtns.forEach(btn => {
        const color = btn.getAttribute('data-color');
        const qty = getAvailableStock(product, size, color);
        
        if (qty <= 0) {
            btn.classList.add('disabled');
            if (selectedColor === color) {
                btn.classList.remove('active');
                selectedColor = null;
            }
        } else {
            btn.classList.remove('disabled');
        }
    });
}

// ==========================================
// كاروسيل صور المنتج داخل المودال
// ==========================================

function renderModalCarousel(images, altText) {
    const modal = document.getElementById('SectionModel');
    const carousel = modal.querySelector('#modelCarousel');
    const track = modal.querySelector('#carouselTrack');
    const dotsContainer = modal.querySelector('#carouselDots');
    const prevBtn = modal.querySelector('#carouselPrev');
    const nextBtn = modal.querySelector('#carouselNext');

    if (!carousel || !track || !dotsContainer) return;

    const slides = images.length ? images : [''];

    track.innerHTML = slides.map(src => `
        <div class="carousel-slide">
            <img src="${src}" alt="${altText || ''}" loading="lazy">
        </div>
    `).join('');

    dotsContainer.innerHTML = slides.map((_, i) => `
        <button type="button" class="carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}" aria-label="Image ${i + 1}"></button>
    `).join('');

    const showArrows = slides.length > 1;
    if (prevBtn) prevBtn.classList.toggle('hidden', !showArrows);
    if (nextBtn) nextBtn.classList.toggle('hidden', !showArrows);
    dotsContainer.classList.toggle('hidden', !showArrows);

    modalCarouselIndex = 0;
    updateCarouselPosition(track);

    dotsContainer.querySelectorAll('.carousel-dot').forEach(dot => {
        dot.onclick = () => {
            modalCarouselIndex = parseInt(dot.getAttribute('data-index'), 10) || 0;
            updateCarouselPosition(track);
        };
    });

    if (prevBtn) {
        prevBtn.onclick = () => {
            modalCarouselIndex = (modalCarouselIndex - 1 + slides.length) % slides.length;
            updateCarouselPosition(track);
        };
    }

    if (nextBtn) {
        nextBtn.onclick = () => {
            modalCarouselIndex = (modalCarouselIndex + 1) % slides.length;
            updateCarouselPosition(track);
        };
    }

    // دعم السحب باللمس على الموبايل
    let touchStartX = 0;
    track.ontouchstart = (e) => {
        touchStartX = e.touches[0].clientX;
    };
    track.ontouchend = (e) => {
        const diff = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(diff) < 40) return;
        if (diff < 0) {
            modalCarouselIndex = (modalCarouselIndex + 1) % slides.length;
        } else {
            modalCarouselIndex = (modalCarouselIndex - 1 + slides.length) % slides.length;
        }
        updateCarouselPosition(track);
    };
}

function updateCarouselPosition(track) {
    window.DartStorefront?.onSlide();
    const modal = document.getElementById('SectionModel');
    track.style.transform = `translateX(-${modalCarouselIndex * 100}%)`;

    modal.querySelectorAll('.carousel-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === modalCarouselIndex);
    });
}

// ==========================================
// عداد الكمية داخل المودال (قبل الإضافة للسلة)
// ==========================================

function initModalQtyControl(product) {
    const modal = document.getElementById('SectionModel');
    const decreaseBtn = modal.querySelector('#modalQtyDecrease');
    const increaseBtn = modal.querySelector('#modalQtyIncrease');
    const valueEl = modal.querySelector('#modalQtyValue');

    if (!decreaseBtn || !increaseBtn || !valueEl) return;

    valueEl.textContent = modalQuantity;

    decreaseBtn.onclick = () => {
        if (modalQuantity <= 1) return;
        modalQuantity -= 1;
        valueEl.textContent = modalQuantity;
        updateModalQtyMax(product);
    };

    increaseBtn.onclick = () => {
        if (!selectedSize || !selectedColor) {
            setProductOptionStatus('Choose an available size and color before changing quantity.', 'error');
            showToast('Choose a size and color first.');
            return;
        }

        const maxQty = getAvailableStock(product, selectedSize, selectedColor);
        if (modalQuantity >= maxQty) {
            setProductOptionStatus(`Only ${maxQty} item${maxQty === 1 ? '' : 's'} available for this option.`, 'error');
            showToast(`Only ${maxQty} item${maxQty === 1 ? '' : 's'} available.`);
            return;
        }

        modalQuantity += 1;
        valueEl.textContent = modalQuantity;
        updateModalQtyMax(product);
    };
}

function updateModalQtyMax(product) {
    const modal = document.getElementById('SectionModel');
    const decreaseBtn = modal.querySelector('#modalQtyDecrease');
    const increaseBtn = modal.querySelector('#modalQtyIncrease');
    const valueEl = modal.querySelector('#modalQtyValue');

    if (!decreaseBtn || !increaseBtn || !valueEl) return;

    const maxQty = (selectedSize && selectedColor)
        ? getAvailableStock(product, selectedSize, selectedColor)
        : 0;

    if (modalQuantity > maxQty && maxQty > 0) {
        modalQuantity = maxQty;
    }
    if (maxQty === 0) {
        modalQuantity = 1;
    }

    valueEl.textContent = modalQuantity;
    decreaseBtn.classList.toggle('disabled-btn', modalQuantity <= 1);
    increaseBtn.classList.toggle('disabled-btn', modalQuantity >= maxQty);
}

// ==========================================
// 4. دوال السلة، الخصم، وإتمام الطلب
// ==========================================

function showToast(message) {
    const existingToast = document.querySelector('.custom-toast');
    if (existingToast) existingToast.remove();

    const toast = document.createElement('div');
    toast.className = 'custom-toast';
    toast.innerText = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

function updateConnectivityBanner() {
    let banner = document.getElementById('dartConnectivityBanner');
    const offline = !navigator.onLine;
    if (!banner && !offline) return;
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'dartConnectivityBanner';
        banner.className = 'dart-connectivity-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        document.body.prepend(banner);
    }
    banner.textContent = offline
        ? 'You are offline. Product availability, address verification and checkout may be unavailable.'
        : 'Connection restored.';
    if (offline) {
        banner.classList.add('is-visible');
        banner.classList.remove('is-restored');
    } else {
        banner.classList.add('is-visible', 'is-restored');
        clearTimeout(window.dartConnectivityTimer);
        window.dartConnectivityTimer = setTimeout(() => banner.classList.remove('is-visible', 'is-restored'), 1800);
    }
}

window.addEventListener('offline', updateConnectivityBanner);
window.addEventListener('online', updateConnectivityBanner);
window.addEventListener('dart:cart-reservation-expired', event => {
    cartData = [];
    renderCart();
    updateCartCount();
    showToast('Your 15-minute cart reservation expired. The items are available to other customers again.');
    const cartContainer = document.getElementById('cartItemsContainer');
    if (cartContainer) {
        cartContainer.querySelector('.dart-cart-empty-state')?.remove();
        const state = createUiState('warning', 'Cart reservation expired', 'Add the products again to start a new 15-minute reservation.');
        state.classList.add('dart-cart-empty-state');
        cartContainer.appendChild(state);
    }
});

function updateCartCount() {
    const totalItems = cartData.reduce((sum, item) => sum + (item.quantity || 1), 0);
    
    const elements = document.querySelectorAll('.cart-count, #cartCount');
    elements.forEach(el => {
        el.textContent = totalItems;
        el.style.display = totalItems > 0 ? 'inline-block' : 'none';
    });
}

function syncBirthdayCheckoutDiscount(showNotice = false) {
    const birthdayReward = window.DartPlatform?.activeBirthdayReward?.();
    const discountInput = document.getElementById('discountInput');
    const discountBtn = document.getElementById('applyDiscountBtn');
    const discountBox = discountInput?.closest('.discount-box');
    let note = document.querySelector('.birthday-auto-discount-note');

    if (birthdayReward) {
        window.dartAppliedPromotion = { ...birthdayReward, type: 'Birthday' };
        appliedDiscountRate = Math.max(0, Math.min(1, Number(birthdayReward.discountPercent || 30) / 100));
        if (discountInput) {
            discountInput.value = `BIRTHDAY ${Math.round(appliedDiscountRate * 100)}% — AUTO`;
            discountInput.disabled = true;
        }
        if (discountBtn) {
            discountBtn.disabled = true;
            discountBtn.textContent = 'Applied';
        }
        if (discountBox && !note) {
            note = document.createElement('p');
            note.className = 'birthday-auto-discount-note';
            discountBox.insertAdjacentElement('afterend', note);
        }
        if (note) note.textContent = 'Your birthday discount is applied automatically and takes priority over other discounts.';
        if (showNotice) showToast(`تم تطبيق خصم عيد الميلاد ${Math.round(appliedDiscountRate * 100)}% تلقائيًا.`);
        return true;
    }

    if (window.dartAppliedPromotion?.type === 'Birthday') {
        window.dartAppliedPromotion = null;
        appliedDiscountRate = 0;
    }
    if (discountInput?.disabled) {
        discountInput.disabled = false;
        discountInput.value = '';
    }
    if (discountBtn?.disabled) {
        discountBtn.disabled = false;
        discountBtn.textContent = 'Apply';
    }
    note?.remove();
    return false;
}

function updateCartTotals() {
    syncBirthdayCheckoutDiscount();
    const subtotalEl = document.getElementById('subtotalVal');
    const totalEl = document.getElementById('totalVal');
    const discountEl = document.getElementById('discountVal');

    let subtotal = cartData.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    let discountAmount = subtotal * appliedDiscountRate;
    let finalTotal = subtotal - discountAmount;

    if (subtotalEl) subtotalEl.textContent = `${Math.trunc(subtotal)} EGP`;
    if (discountEl) discountEl.textContent = `${Math.trunc(discountAmount)} EGP`;
    if (totalEl) totalEl.textContent = `${Math.trunc(finalTotal)} EGP`;
}

function renderCart() {
    const container = document.getElementById('cartItemsContainer');
    const template = document.getElementById('cartItemTemplate');
    
    if (!container || !template) return;

    container.querySelectorAll('.cart-product-card:not(#cartItemTemplate)').forEach(el => el.remove());
    container.querySelector('.dart-cart-empty-state')?.remove();

    if (!cartData.length) {
        const empty = createUiState('empty', 'Your cart is empty', 'Choose a product, size and color to start a 15-minute reservation.');
        empty.classList.add('dart-cart-empty-state');
        container.appendChild(empty);
    }

    cartData.forEach((item, index) => {
        const card = template.cloneNode(true);
        card.removeAttribute('id');
        card.style.display = 'flex';

        card.querySelector('.cart-product-img').src = item.image;
        card.querySelector('.cart-product-img').alt = `${item.title} in ${item.color}, size ${item.size}`;
        card.querySelector('.cart-product-title').textContent = item.title;
        card.querySelector('.p-size').textContent = item.size;
        card.querySelector('.p-color').textContent = item.color;
        card.querySelector('.cart-item-price').textContent = `${Math.trunc(Number(item.price) || 0)} EGP`;
        card.querySelector('.qty-value').textContent = item.quantity;
        card.querySelector('.p-total').textContent = Math.trunc(item.price * item.quantity);

        card.querySelector('.increase').addEventListener('click', () => {
            const product = productsData.find(p => p.id === item.id);
            const availableStock = product ? getAvailableStock(product, item.size, item.color) : 0;

            if (cartData[index].quantity >= availableStock) {
                showToast(`عذراً، المتاح بالمخزون ${availableStock} قطع فقط.`);
                return;
            }

            cartData[index].quantity += 1;
            saveCartToLocalStorage();
            renderCart();
        });

        card.querySelector('.decrease').addEventListener('click', () => {
            if (cartData[index].quantity > 1) {
                cartData[index].quantity -= 1;
                saveCartToLocalStorage();
                renderCart();
            }
        });

        card.querySelector('.remove-item-btn').addEventListener('click', () => {
            cartData.splice(index, 1);
            saveCartToLocalStorage();
            renderCart();
        });

        container.appendChild(card);
    });

    updateCartTotals();
    updateCartCount();
}

function saveCartToLocalStorage() {
    const previous = JSON.parse(localStorage.getItem('dart_cart') || '[]');
    try {
        if (window.DartPlatform?.reserveCart) window.DartPlatform.reserveCart(cartData);
        else localStorage.setItem('dart_cart', JSON.stringify(cartData));
        if (window.dartAppliedPromotion?.cardId) {
            const used=Number(window.dartAppliedPromotion.purchasedItems||0),limit=Number(window.dartAppliedPromotion.itemLimit||window.dartAppliedPromotion.purchasedLimit||10),count=cartData.reduce((sum,line)=>sum+Number(line.quantity||0),0);
            if(count>limit-used){window.dartAppliedPromotion=null;appliedDiscountRate=0;showToast(`تم إلغاء Dart Card: المتبقي في الكارت ${Math.max(0,limit-used)} قطع.`);}
        }
        return true;
    } catch (error) {
        cartData = previous;
        showToast(error.message || 'تعذر حجز القطعة. حاول مرة أخرى.');
        return false;
    }
}

function initCartAndCheckoutEvents() {
    const cartView = document.getElementById('cartView');
    const checkoutView = document.getElementById('checkoutView');
    const toCheckoutBtn = document.getElementById('toCheckoutBtn');
    const checkoutForm = document.getElementById('checkoutForm');
    const modalBuyBtn = document.getElementById('modalBuyBtn');
    
    const discountBtn = document.getElementById('applyDiscountBtn');
    const discountInput = document.getElementById('discountInput');

    window.DartPlatform?.cleanupCartReservations?.();
    cartData = JSON.parse(localStorage.getItem('dart_cart') || '[]');
    if (cartView) cartView.style.display = 'block';

    renderCart();

    if (modalBuyBtn) {
        modalBuyBtn.addEventListener('click', () => {
            if (!selectedSize) {
                setProductOptionStatus('Choose an available size before adding this product.', 'error');
                showToast('Choose a size first.');
                return;
            }
            if (!selectedColor) {
                setProductOptionStatus('Choose an available color before adding this product.', 'error');
                showToast('Choose a color first.');
                return;
            }

            const availableStock = getAvailableStock(activeProduct, selectedSize, selectedColor);
            const existingItem = cartData.find(c =>
                c.id === activeProduct.id && c.size === selectedSize && c.color === selectedColor
            );
            const requestedTotal = (existingItem ? existingItem.quantity : 0) + modalQuantity;

            if (requestedTotal > availableStock) {
                setProductOptionStatus(`Only ${availableStock} item${availableStock === 1 ? '' : 's'} available for this size and color.`, 'error');
                showToast(`Only ${availableStock} item${availableStock === 1 ? '' : 's'} available for this size and color.`);
                return;
            }

            if (existingItem) {
                existingItem.quantity = requestedTotal;
            } else {
                cartData.push({
                    id: activeProduct.id,
                    title: activeProduct.title,
                    price: activeProduct.price,
                    size: selectedSize,
                    color: selectedColor,
                    quantity: modalQuantity,
                    image: DartCatalog.cover(DartCatalog.model(activeProduct.id), selectedColor)
                });
            }

            if (!saveCartToLocalStorage()) { renderCart(); return; }
            showToast("تم إضافة المنتج إلى السلة بنجاح!");
            updateCartCount();
            showCartBanner(activeProduct.title);
            closeProductModal();
            renderCart();
        });
    }

    if (discountBtn && discountInput) {
        discountBtn.addEventListener('click', () => {
            if (syncBirthdayCheckoutDiscount(true)) {
                updateCartTotals();
                return;
            }
            const code = discountInput.value.trim().toUpperCase();
            let promotion = null;
            try {
                const today = new Date();
                promotion = (JSON.parse(localStorage.getItem('dart_promotions')) || []).find(item =>
                    String(item.code || '').toUpperCase() === code &&
                    item.status === 'Active' &&
                    (!item.startsAt || new Date(item.startsAt) <= today) &&
                    (!item.endsAt || new Date(item.endsAt) >= today)
                );
                if (!promotion && window.DartPlatform) {
                    const user = window.DartPlatform.currentUser();
                    promotion = (JSON.parse(localStorage.getItem('dart_cards')) || []).find(card =>
                        String(card.cardId || '').toUpperCase() === code &&
                        card.clientId === user?.customerId && card.status === 'Active' &&
                        Number(card.purchasedItems || 0) < Number(card.itemLimit || card.purchasedLimit || 10) &&
                        cartData.reduce((sum,line)=>sum+Number(line.quantity||0),0) <= Number(card.itemLimit || card.purchasedLimit || 10)-Number(card.purchasedItems||0) &&
                        (!card.expDate || (() => { const parts=String(card.expDate).split(/[-/]/).map(Number);const expiry=parts[0]>999?new Date(parts[0],parts[1]-1,parts[2],23,59,59):new Date(parts[2],parts[1]-1,parts[0],23,59,59);return expiry>=today; })())
                    );
                    if (promotion) promotion.percent = 40;
                }
            } catch {}
            if (promotion) {
                window.dartAppliedPromotion = promotion;
                appliedDiscountRate = Math.min(0.40, Math.max(0, Number(promotion.percent || promotion.discount) / 100));
                showToast(`تم تطبيق خصم ${Math.round(appliedDiscountRate * 100)}% بنجاح!`);
            } else {
                window.dartAppliedPromotion = null;
                appliedDiscountRate = 0;
                showToast("كود الخصم غير صحيح أو غير متاح لهذا الحساب.");
            }
            updateCartTotals();
        });
    }

    if (toCheckoutBtn && checkoutView) {
        toCheckoutBtn.addEventListener('click', () => {
            if (cartData.length === 0) {
                showToast("السلة فارغة، أضف منتجات أولاً!");
                return;
            }
            checkoutView.style.display = 'block';
            window.scrollTo({ top: checkoutView.offsetTop, behavior: 'smooth' });
            setTimeout(() => window.dartCheckoutAddress?.invalidate?.(), 60);
            setTimeout(() => window.dartCheckoutAddress?.invalidate?.(), 320);
        });
    }

    if (checkoutForm) {
        checkoutForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (window.DartPlatform?.checkout) {
                try {
                    const order = await window.DartPlatform.checkout(checkoutForm);
                    sessionStorage.setItem('dart_last_order_id', order.orderId);
                    sessionStorage.setItem('dart_internal_navigation', '1');
                    cartData = [];
                    localStorage.setItem('dart_cart', '[]');
                    appliedDiscountRate = 0;
                    updateCartCount();
                    renderCart();
                    showToast(`تم إنشاء الطلب ${order.orderId} بنجاح.`);
                    setTimeout(() => {
                        window.location.href = 'index.html';
                    }, 700);
                } catch (error) {
                    showToast(error.message || "تعذر إنشاء الطلب.");
                }
                return;
            }

            // فحص وجود موقع من الخريطة/GPS
            const latVal = document.getElementById('lat-input')?.value.trim();
            const addressInputVal = document.getElementById('address-input')?.value.trim();
            const hasGpsAddress = Boolean(latVal || addressInputVal);

            // فحص إدخال أي عنوان يدوياً داخل other-addres
            const manualInputs = document.querySelectorAll('.other-addres input');
            let hasManualAddress = false;
            manualInputs.forEach(inputEl => {
                if (inputEl.value.trim() !== '') {
                    hasManualAddress = true;
                }
            });

            // الشرط: إما إحداثيات/عنوان الخريطة أو أحد الحقول اليدوية
            if (!hasGpsAddress && !hasManualAddress) {
                showToast("يرجى تحديد الموقع على الخريطة أو إدخال العنوان يدوياً لإتمام الطلب!");
                return;
            }

            cartData = [];
            saveCartToLocalStorage();
            appliedDiscountRate = 0;
            updateCartCount();
            showToast("تم إتمام طلبك بنجاح! شكراً لك.");
            setTimeout(() => {
                window.location.href = "index.html";
            }, 1500);
        });
    }
}


// ==========================================
// 5. تهيئة الخريطة والبحث عن العنوان (معتمد على GPS و OpenStreetMap)
// ==========================================
function initAddressMap() {
    if (window.DartAddress) {
        window.DartAddress.initCheckout();
        return;
    }
    const mapElement = document.getElementById('map');
    const input = document.getElementById('address-input');
    const resultsList = document.getElementById('results-list');

    if (!mapElement || typeof L === 'undefined') return;

    // Fallback only: use a broad Cairo/Giza envelope, then verify the returned
    // administrative governorate. The primary implementation lives in
    // Js/dart-address.js and follows the same rule.
    const CAIRO_GIZA_BOUNDS = L.latLngBounds([27.00, 27.00], [30.65, 32.25]);

    function isWithinCairoGizaEnvelope(lat, lng) {
        return CAIRO_GIZA_BOUNDS.contains(L.latLng(lat, lng));
    }

    function fallbackGovernorate(result) {
        const address = result?.address || {};
        const raw = String(address.state || address.governorate || address.region || '').trim().toLocaleLowerCase();
        const iso = String(address['ISO3166-2-lvl4'] || address['ISO3166-2-lvl3'] || '').toUpperCase();
        if (iso === 'EG-C' || ['cairo', 'cairo governorate', 'al qahirah', 'القاهرة', 'محافظة القاهرة'].includes(raw)) return 'Cairo';
        if (iso === 'EG-GZ' || ['giza', 'giza governorate', 'al jizah', 'الجيزة', 'محافظة الجيزة'].includes(raw)) return 'Giza';
        return '';
    }

    // إخفاء حقول العنوان اليدوي والتحكم في ظهورها عند النقر على السهم
    const otherAddressDiv = document.querySelector('.other-addres');
    const arrowBtn = document.querySelector('.arrwo-for-other-adrees');

    if (otherAddressDiv) {
        otherAddressDiv.style.display = 'none';
    }

    if (arrowBtn && otherAddressDiv) {
        arrowBtn.addEventListener('click', () => {
            const isHidden = otherAddressDiv.style.display === 'none';
            otherAddressDiv.style.display = isHidden ? 'block' : 'none';
        });
    }

    try {
        if (window.orderMap) window.orderMap.remove();

        // Keep navigation around the two launch governorates.
        const map = L.map('map', { 
            attributionControl: false,
            zoomControl: false,
            maxBounds: CAIRO_GIZA_BOUNDS,
            maxBoundsViscosity: 1
        }).setView([30.0444, 31.2357], 11);
        
        window.orderMap = map;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19
        }).addTo(map);

        setTimeout(() => map.invalidateSize(), 300);

        if (window.ResizeObserver) {
            new ResizeObserver(() => map.invalidateSize()).observe(mapElement);
        }

        const customIcon = L.divIcon({
            className: 'custom-map-pin',
            html: `<div style="color: #ef4444; font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3)); cursor: pointer;">
                    <i class="fa-solid fa-location-dot"></i>
                   </div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 30]
        });

        let marker = null;
        let selectedAddressData = null;
        let timeout = null;

        window.getCartAddressData = function() {
            return selectedAddressData || {
                address: input ? input.value : '',
                lat: document.getElementById('lat-input')?.value || null,
                lng: document.getElementById('lng-input')?.value || null
            };
        };

        async function setLocation(lat, lon, knownResult = null) {
            if (!isWithinCairoGizaEnvelope(lat, lon)) {
                if (typeof showToast === 'function') {
                    showToast("Delivery is currently available in Cairo and Giza only.");
                } else {
                    alert("Delivery is currently available in Cairo and Giza only.");
                }
                return false;
            }

            let result = knownResult;
            try {
                if (!result?.address) {
                    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lon}`);
                    if (!response.ok) throw new Error('Address lookup failed');
                    result = await response.json();
                }
            } catch {
                if (typeof showToast === 'function') showToast('The delivery governorate could not be verified. Try again.');
                return false;
            }

            const governorate = fallbackGovernorate(result);
            if (!governorate) {
                if (typeof showToast === 'function') showToast('Delivery is currently available in Cairo and Giza only.');
                else alert('Delivery is currently available in Cairo and Giza only.');
                return false;
            }

            const addressName = result.display_name || `${lat}, ${lon}`;

            const latInp = document.getElementById('lat-input');
            const lngInp = document.getElementById('lng-input');
            const fmtInp = document.getElementById('formatted-address-input');

            if (latInp) latInp.value = lat;
            if (lngInp) lngInp.value = lon;

            map.setView([lat, lon], 16);

            if (marker) {
                marker.setLatLng([lat, lon]);
            } else {
                marker = L.marker([lat, lon], { draggable: true, icon: customIcon }).addTo(map);

                marker.on('dragend', (e) => {
                    const position = e.target.getLatLng();
                    if (!isWithinCairoGizaEnvelope(position.lat, position.lng)) {
                        if (typeof showToast === 'function') {
                            showToast("Choose a location inside Cairo or Giza.");
                        }
                        marker.setLatLng([lat, lon]); // إرجاعه للموقع السابق
                        return;
                    }
                    setLocation(position.lat, position.lng);
                });
            }

            if (input) input.value = addressName;
            if (fmtInp) fmtInp.value = addressName;

            selectedAddressData = { address: addressName, lat: lat, lng: lon, governorate };
            marker.bindPopup(addressName).openPopup();

            localStorage.setItem('user_last_address', JSON.stringify(selectedAddressData));
        }

        map.on('click', (e) => {
            setLocation(e.latlng.lat, e.latlng.lng);
        });

        const savedLoc = localStorage.getItem('user_last_address');
        if (savedLoc) {
            try {
                const parsed = JSON.parse(savedLoc);
                if (isWithinCairoGizaEnvelope(parsed.lat, parsed.lng)) {
                    setLocation(parsed.lat, parsed.lng);
                } else {
                    fetchGPS();
                }
            } catch {
                fetchGPS();
            }
        } else {
            fetchGPS();
        }

        function fetchGPS() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => setLocation(pos.coords.latitude, pos.coords.longitude),
                    (err) => console.log('تعذر جلب موقع GPS تلقائياً:', err),
                    { enableHighAccuracy: true, timeout: 8000 }
                );
            }
        }

        const controlsGroup = L.control({ position: 'bottomright' });
        controlsGroup.onAdd = function() {
            const container = L.DomUtil.create('div', 'map-controls-container');
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '8px';
            container.style.margin = '10px';

            const locateBtn = document.createElement('button');
            locateBtn.type = 'button';
            locateBtn.title = 'Use my current location';
            locateBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i>';
            Object.assign(locateBtn.style, {
                backgroundColor: '#ffffff', border: 'none', borderRadius: '50%',
                width: '40px', height: '40px', cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: '#111827'
            });
            locateBtn.onclick = (e) => { L.DomEvent.stopPropagation(e); fetchGPS(); };

            const resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.title = 'Clear saved address';
            resetBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            Object.assign(resetBtn.style, {
                backgroundColor: '#ffffff', border: 'none', borderRadius: '50%',
                width: '40px', height: '40px', cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: '#ef4444'
            });
            resetBtn.onclick = (e) => {
                L.DomEvent.stopPropagation(e);
                localStorage.removeItem('user_last_address');
                selectedAddressData = null;
                if (input) input.value = '';
                if (document.getElementById('lat-input')) document.getElementById('lat-input').value = '';
                if (document.getElementById('lng-input')) document.getElementById('lng-input').value = '';
                if (document.getElementById('formatted-address-input')) document.getElementById('formatted-address-input').value = '';
                if (marker) map.removeLayer(marker);
                marker = null;
            };

            container.appendChild(locateBtn);
            container.appendChild(resetBtn);
            return container;
        };
        controlsGroup.addTo(map);

        if (input && resultsList) {
            input.addEventListener('input', () => {
                clearTimeout(timeout);
                const query = input.value.trim();

                if (query.length < 2) {
                    resultsList.style.display = 'none';
                    return;
                }

                resultsList.innerHTML = '<li style="color:#888; padding:10px;"><i class="fa-solid fa-spinner fa-spin"></i> Searching…</li>';
                resultsList.style.display = 'block';

                timeout = setTimeout(async () => {
                    try {
                        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&countrycodes=eg&addressdetails=1`);
                        const data = (await response.json()).filter(item => isWithinCairoGizaEnvelope(item.lat, item.lon) && fallbackGovernorate(item));
                        resultsList.innerHTML = '';

                        if (data && data.length > 0) {
                            data.forEach(item => {
                                const li = document.createElement('li');
                                li.textContent = item.display_name;
                                li.onclick = () => {
                                    setLocation(parseFloat(item.lat), parseFloat(item.lon), item);
                                    resultsList.style.display = 'none';
                                };
                                resultsList.appendChild(li);
                            });
                        } else {
                            resultsList.innerHTML = '<li style="color:#888; padding:10px;">No verified address found inside Cairo or Giza.</li>';
                        }
                    } catch {
                        resultsList.innerHTML = '<li style="color:red; padding:10px;">Address search is temporarily unavailable.</li>';
                    }
                }, 400);
            });

            document.addEventListener('click', (e) => {
                if (e.target !== input) resultsList.style.display = 'none';
            });
        }
    } catch (err) {
        console.error("خطأ في الخريطة:", err);
    }
}

// ==========================================
// 6. خريطة تتبع الطلب (وجهة ثابتة + موقع متغير)
// ==========================================
function initTrackingMap(destLat = 30.0444, destLng = 31.2357) {
    const mapElement = document.getElementById('tracking-map');
    if (!mapElement || typeof L === 'undefined') return;

    const map = L.map('tracking-map', {
        attributionControl: false,
        zoomControl: false
    }).setView([destLat, destLng], 13);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(map);

    setTimeout(() => map.invalidateSize(), 200);

    // 1. الوجهة الثابتة
    const destIcon = L.divIcon({
        className: 'custom-dest-pin',
        html: `<div style="color: #ef4444; font-size: 28px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                <i class="fa-solid fa-location-dot"></i>
               </div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });

    const fixedMarker = L.marker([destLat, destLng], { icon: destIcon }).addTo(map);
    fixedMarker.bindPopup("<b>عنوان التوصيل (ثابت)</b>").openPopup();

    // 2. إعداد المتغيرات (لن تظهر النقطة أو الخط إلا بعد توفر الموقع)
    const userIcon = L.divIcon({
        className: 'custom-user-pin',
        html: `<div style="color: #2563eb; font-size: 22px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
                <i class="fa-solid fa-circle-dot"></i>
               </div>`,
        iconSize: [25, 25],
        iconAnchor: [12, 12]
    });

    let userMarker = null;
    let routePolyline = null;

    if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
            (pos) => {
                const currentLat = pos.coords.latitude;
                const currentLng = pos.coords.longitude;

                // 1. إظهار النقطة الزرقاء لأول مرة أو تحديث مكانها
                if (!userMarker) {
                    userMarker = L.marker([currentLat, currentLng], { icon: userIcon }).addTo(map);
                    userMarker.bindPopup("الموقع الحالي");
                } else {
                    userMarker.setLatLng([currentLat, currentLng]);
                }

                // 2. جلب المسار الشارعي نحو النقطة الثابتة ورسم الاتجاهات
                const routeUrl = `https://router.project-osrm.org/route/v1/driving/${currentLng},${currentLat};${destLng},${destLat}?overview=full&geometries=geojson`;

                fetch(routeUrl)
                    .then(res => res.json())
                    .then(data => {
                        if (data.routes && data.routes[0]) {
                            const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);

                            if (routePolyline) {
                                routePolyline.setLatLngs(coords);
                            } else {
                                routePolyline = L.polyline(coords, {
                                    color: '#2563eb',
                                    weight: 5,
                                    opacity: 0.8,
                                    lineJoin: 'round'
                                }).addTo(map);
                            }
                        }
                    })
                    .catch(err => console.error('خطأ في جلب الاتجاهات:', err));

                // 3. احتواء الموقعين داخل الشاشة
                const bounds = L.latLngBounds([
                    [destLat, destLng],
                    [currentLat, currentLng]
                ]);
                map.fitBounds(bounds, { padding: [50, 50] });
            },
            (err) => console.warn('تعذر تحديث الموقع المباشر:', err.message),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
}
// ==========================================
// 6. الفلترة والبانر
// ==========================================

function filterProductsByCategory(selectedCat) {
    productFilterState.category = !selectedCat || selectedCat.toLocaleLowerCase() === 'all' ? 'all' : selectedCat;
    renderProductPageResults();
}

function setProductFilterSelectOptions(select, values, firstLabel) {
    if (!select) return;
    const current = select.value || 'all';
    select.replaceChildren(new Option(firstLabel, 'all'));
    values.forEach(value => select.add(new Option(value, value)));
    select.value = [...select.options].some(option => option.value === current) ? current : 'all';
}

function resetProductFilters() {
    Object.assign(productFilterState, {
        query: '', category: 'all', size: 'all', color: 'all',
        availability: 'all', price: 'all', sort: 'featured'
    });
    const query = document.getElementById('productSearchInput');
    if (query) query.value = '';
    ['productSizeFilter', 'productColorFilter', 'productAvailabilityFilter', 'productPriceFilter']
        .forEach(id => { const select = document.getElementById(id); if (select) select.value = 'all'; });
    const sort = document.getElementById('productSortSelect');
    if (sort) sort.value = 'featured';
    document.querySelectorAll('#filterContainer .filter-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.category?.toLocaleLowerCase() === 'all');
    });
    renderProductPageResults();
}

function initProductFilterToggle() {
    const button = document.getElementById('toggleProductFilters');
    const panel = document.getElementById('productFiltersPanel');
    if (!button || !panel || button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', () => {
        panel.hidden = !panel.hidden;
        button.setAttribute('aria-expanded', String(!panel.hidden));
        const label = button.querySelector('span');
        if (label) label.textContent = panel.hidden ? 'Filter products' : 'Hide filters';
    });
}

function renderFilterButtons() {
    const filterContainer = document.getElementById('filterContainer');
    if (!filterContainer || !productsData.length) return;

    const catalog = publicCatalogProducts();
    const categories = ['All', ...new Set(catalog.map(p => p.category).filter(Boolean))];
    const pairs = catalog.flatMap(productStockPairs);
    const sizes = [...new Set(pairs.map(pair => pair.size))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const colors = [...new Set(pairs.map(pair => pair.color))].sort((a, b) => a.localeCompare(b, ['en', 'ar']));

    filterContainer.innerHTML = categories.map((cat, index) => `
        <button type="button" class="filter-btn ${index === 0 ? 'active' : ''}" data-category="${escapeCatalogHtml(cat)}">
            ${escapeCatalogHtml(cat)}
        </button>
    `).join('');

    setProductFilterSelectOptions(document.getElementById('productSizeFilter'), sizes, 'All sizes');
    setProductFilterSelectOptions(document.getElementById('productColorFilter'), colors, 'All colors');

    filterContainer.onclick = function(e) {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;

        filterContainer.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const cat = btn.getAttribute('data-category');
        filterProductsByCategory(cat);
    };

    const bindings = [
        ['productSearchInput', 'input', element => { productFilterState.query = element.value.trim(); }],
        ['productSizeFilter', 'change', element => { productFilterState.size = element.value; }],
        ['productColorFilter', 'change', element => { productFilterState.color = element.value; }],
        ['productAvailabilityFilter', 'change', element => { productFilterState.availability = element.value; }],
        ['productPriceFilter', 'change', element => { productFilterState.price = element.value; }],
        ['productSortSelect', 'change', element => { productFilterState.sort = element.value; }]
    ];
    bindings.forEach(([id, eventName, update]) => {
        const element = document.getElementById(id);
        if (!element || element.dataset.dartFilterBound) return;
        element.dataset.dartFilterBound = '1';
        element.addEventListener(eventName, () => { update(element); renderProductPageResults(); });
    });
    const clear = document.getElementById('clearProductFilters');
    if (clear && !clear.dataset.dartFilterBound) {
        clear.dataset.dartFilterBound = '1';
        clear.addEventListener('click', resetProductFilters);
    }
    renderProductPageResults();
}

function showCartBanner(productTitle) {
    let banner = document.getElementById('cartBanner');

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'cartBanner';
        banner.className = 'cart-banner';
        document.body.appendChild(banner);
    }

    banner.innerHTML = `
        <span style="font-size: 13px;">تم إضافة "${productTitle}" للسلة</span>
        <div style="display: flex; gap: 10px; align-items: center;">
            <a href="#cartView" id="bannerGoToCart" style="color: #fff; background: #000; padding: 5px 10px; border-radius: 4px; text-decoration: none; font-size: 12px;">السلة</a>
            <span onclick="document.getElementById('cartBanner').classList.remove('show')" style="cursor: pointer; font-size: 16px; font-weight: bold;">&times;</span>
        </div>
    `;

    banner.classList.add('show');

    clearTimeout(window.cartBannerTimeout);
    window.cartBannerTimeout = setTimeout(() => {
        banner.classList.remove('show');
    }, 2500);
}

// ==========================================
// 7. معلومات المستخدم والملف الشخصي
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    const sections = document.querySelectorAll('.profile-details, .order-info, .return-info');
    if (!sections.length) return;

    function closeAllSections() {
        sections.forEach(sec => sec.classList.remove('active'));
        document.body.classList.remove('no-scroll');
    }

    function openTargetSection(selector) {
        const targetSection = document.querySelector(selector);
        if (targetSection) {
            closeAllSections();
            targetSection.classList.add('active');
            document.body.classList.add('no-scroll');
            history.pushState({ activeSection: selector }, '');
        }
    }

    const profileBtns = document.querySelectorAll('.profile');
    if (profileBtns.length) {
        profileBtns.forEach(el => el.addEventListener('click', () => openTargetSection('.profile-details')));
    }

    const orderBtns = document.querySelectorAll('.orde2r');
    if (orderBtns.length) {
        orderBtns.forEach(el => el.addEventListener('click', () => openTargetSection('.order-info')));
    }

    const returnBtns = document.querySelectorAll('.retur2n');
    if (returnBtns.length) {
        returnBtns.forEach(el => el.addEventListener('click', () => openTargetSection('.return-info')));
    }

    const closeBtns = document.querySelectorAll('.fa-arrow-right-from-bracket');
    if (closeBtns.length) {
        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                if (history.state && history.state.activeSection) {
                    history.back();
                } else {
                    closeAllSections();
                }
            });
        });
    }

    window.addEventListener('popstate', () => {
        closeAllSections();
    });

    sections.forEach(section => {
        let startX = 0;
        let startY = 0;

        section.addEventListener('touchstart', (e) => {
            if (e.touches && e.touches[0]) {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            }
        }, { passive: true });

        section.addEventListener('touchend', (e) => {
            if (!e.changedTouches || !e.changedTouches[0]) return;

            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;

            if (endX - startX > 100 || endY - startY > 150) {
                if (history.state && history.state.activeSection) {
                    history.back();
                } else {
                    closeAllSections();
                }
            }
        });
    });
});

// Authentication is handled by dart-platform.js and, later, the Express API.

// ==========================================
// 8. صفحة المندوب (Page REP)
// ==========================================

var countdownTimer = null;
var watchId = null;

window.onload = function() {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => { console.log("GPS Permission Granted"); },
            (error) => { console.warn("GPS Permission Warning: ", error.message); },
            { enableHighAccuracy: true }
        );
    }

    const savedState = localStorage.getItem('order_45_state');
    if (savedState === 'on_the_way') {
        restoreActiveState();
    } else if (savedState === 'delivered') {
        restoreCompletedState();
    }
};

function startCountdown() {
    const goBtn = document.getElementById('goBtn');
    let count = 3;

    goBtn.disabled = true;
    goBtn.innerText = `Opening Maps in ${count}...`;

    countdownTimer = setInterval(() => {
        count--;
        if (count > 0) {
            goBtn.innerText = `Opening Maps in ${count}...`;
        } else {
            clearInterval(countdownTimer);
            startDelivery();
        }
    }, 1000);
}

function startDelivery() {
    localStorage.setItem('order_45_state', 'on_the_way');
    restoreActiveState();

    const addressText = document.getElementById('customerAddress')?.innerText.trim() || '';
    const encodedAddress = encodeURIComponent(addressText);
    
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodedAddress}&travelmode=driving`, '_blank');
}

function restoreActiveState() {
    const statusBadge = document.getElementById('orderStatus');
    const goBtn = document.getElementById('goBtn');
    const completeBtn = document.getElementById('completeBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const gpsStatus = document.getElementById('gpsStatus');

    if (!statusBadge || !goBtn) return;

    statusBadge.innerText = "On the Way (Step 4)";
    statusBadge.className = "rep-status-badge rep-status-active";

    goBtn.style.display = 'none';
    if (completeBtn) completeBtn.style.display = 'flex';
    if (cancelBtn) cancelBtn.style.display = 'flex';
    if (gpsStatus) gpsStatus.style.display = 'block';

    startGpsTracking();
}

function startGpsTracking() {
    if ("geolocation" in navigator && typeof watchId !== 'undefined' && !watchId) {
        watchId = navigator.geolocation.watchPosition(
            (position) => {
                console.log(`Driver Lat: ${position.coords.latitude}, Lng: ${position.coords.longitude}`);
            },
            (error) => { console.warn("Tracking Warning: ", error.message); },
            { enableHighAccuracy: true }
        );
    }
}

function cancelDelivery() {
    if (typeof countdownTimer !== 'undefined' && countdownTimer) clearInterval(countdownTimer);
    if (typeof watchId !== 'undefined' && watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    localStorage.removeItem('order_45_state');

    const goBtn = document.getElementById('goBtn');
    const statusBadge = document.getElementById('orderStatus');
    const completeBtn = document.getElementById('completeBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const gpsStatus = document.getElementById('gpsStatus');

    if (goBtn) {
        goBtn.disabled = false;
        goBtn.innerText = "GO (Start Delivery)";
        goBtn.style.display = 'flex';
    }

    if (statusBadge) {
        statusBadge.innerText = "Assigned (Step 3)";
        statusBadge.className = "rep-status-badge";
    }

    if (completeBtn) completeBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (gpsStatus) gpsStatus.style.display = 'none';
}

function completeDelivery() {
    if (typeof watchId !== 'undefined' && watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    localStorage.setItem('order_45_state', 'delivered');
    restoreCompletedState();
}

function restoreCompletedState() {
    const statusBadge = document.getElementById('orderStatus');
    const goBtn = document.getElementById('goBtn');
    const completeBtn = document.getElementById('completeBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const gpsStatus = document.getElementById('gpsStatus');

    if (!statusBadge) return;

    statusBadge.innerText = "Delivered (Step 5)";
    statusBadge.className = "rep-status-badge rep-status-completed";

    if (goBtn) goBtn.style.display = 'none';
    if (completeBtn) completeBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';

    if (gpsStatus) {
        gpsStatus.style.display = 'block';
        gpsStatus.innerText = "Order Completed";
        gpsStatus.style.color = "#16a34a";
    }
}

// ==========================================
// 9. التشغيل عند تحميل الصفحة
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadSection('header-container', 'sections/Nav-Bar.html'),
        loadSection('search-serial-container', 'sections/search-serial.html'),
        loadSection('leaderboard-card', 'sections/leaderboard-card.html'),
        loadSection('birthday', 'sections/birthday.html'),
        loadSection('feedback-form', 'sections/form-feedback.html'),
        loadSection('return-form', 'sections/form-return.html'),
        loadSection('contact-form', 'sections/form-contact.html'),
        loadSection('story', 'sections/story.html'),
        loadSection('dart-for-you', 'sections/dart-for-you.html'),
        loadSection('birthday-details', 'sections/birthday-details.html'),
        loadSection('card-details', 'sections/card.html'),
        loadSection('why', 'sections/why-dart.html'),
        loadSection('footer', 'sections/footer.html'),
    ]);

    initHeader();
    renderProductsLogic();
    renderFilterButtons();
    initProductFilterToggle();
    renderReviewsLogic();
    initCartAndCheckoutEvents();
    initAddressMap();
    updateCartCount();
    if (!navigator.onLine) updateConnectivityBanner();
});
