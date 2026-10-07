(() => {
  'use strict';

  const config = window.ELKHATTAB_CONFIG || {};
  const state = { products: [], selected: null, grain: 'الكل', search: '' };

  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  const money = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 });
  const integer = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 0 });

  const els = {
    grid: $('#catalogGrid'), error: $('#catalogError'), status: $('#catalogState'),
    refresh: $('#refreshCatalog'), filters: $('#grainFilters'), search: $('#productSearch'),
    count: $('#heroProductCount'), updated: $('#heroUpdated'), modal: $('#orderModal'),
    form: $('#orderForm'), productName: $('#modalProductName'), name: $('#customerName'),
    phone: $('#customerPhone'), qty: $('#orderQty'), unit: $('#orderUnit'), type: $('#orderType'),
    note: $('#orderNote'), estimate: $('#estimateValue'), formError: $('#formError'), toast: $('#toast'),
    phoneLink: $('#phoneLink')
  };

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 3600);
  }

  function messengerUrl() {
    return `https://www.facebook.com/messages/t/${encodeURIComponent(config.messengerPageId || '')}`;
  }

  async function copyAndOpen(message) {
    try {
      if (message && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
        showToast('اتنسخت تفاصيل الرسالة. أول ما يفتح ماسنجر اعمل Paste وابعتها.');
      } else if (message) {
        showToast('افتح ماسنجر وابعت تفاصيل طلبك لفريق المبيعات.');
      }
    } catch {
      showToast('افتح ماسنجر وابعت تفاصيل طلبك لفريق المبيعات.');
    }
    window.open(messengerUrl(), '_blank', 'noopener,noreferrer');
  }

  function describe(product) {
    const bits = [];
    if (product.grain) bits.push(`حبة ${product.grain}`);
    if (product.broken) bits.push(`كسر ${product.broken}`);
    return bits.length ? `${bits.join(' • ')}. مناسب للتوريد التجاري حسب احتياج منشأتك.` : 'متاح للتوريد التجاري حسب حالة المخزون.';
  }

  function skeletons() {
    els.grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
  }

  function setCatalogStatus(kind, text) {
    els.status.className = `catalog-state ${kind || ''}`.trim();
    els.status.textContent = text;
  }

  function buildFilters() {
    const grains = ['الكل', ...new Set(state.products.map(p => p.grain).filter(Boolean))];
    els.filters.innerHTML = grains.map(g => `<button class="filter-pill ${g === state.grain ? 'active' : ''}" data-grain="${escapeHtml(g)}">${escapeHtml(g)}</button>`).join('');
    $$('.filter-pill', els.filters).forEach(btn => btn.addEventListener('click', () => {
      state.grain = btn.dataset.grain;
      buildFilters();
      renderProducts();
    }));
  }

  function filteredProducts() {
    const s = state.search.trim().toLowerCase();
    return state.products.filter(p => {
      const byGrain = state.grain === 'الكل' || p.grain === state.grain;
      const hay = `${p.name} ${p.grain || ''} ${p.broken || ''}`.toLowerCase();
      return byGrain && (!s || hay.includes(s));
    });
  }

  function renderProducts() {
    const list = filteredProducts();
    els.error.classList.add('hidden');
    if (!list.length) {
      els.grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><h3>مفيش نتائج مطابقة</h3><p>جرّب اسم أو فلتر مختلف.</p></div>';
      return;
    }
    els.grid.innerHTML = list.map((p, idx) => `
      <article class="product-card">
        <div class="product-card-head">
          <span class="product-icon" aria-hidden="true">🌾</span>
          <span class="availability ${p.available ? 'available' : 'unavailable'}">${p.available ? 'متاح للطلب' : 'غير متاح حالياً'}</span>
        </div>
        <h3>${escapeHtml(p.name)}</h3>
        <p class="product-desc">${escapeHtml(describe(p))}</p>
        <div class="spec-list">
          <div class="spec"><span>نوع الحبة</span><strong>${escapeHtml(p.grain || '—')}</strong></div>
          <div class="spec"><span>نسبة الكسر</span><strong>${escapeHtml(p.broken || '—')}</strong></div>
        </div>
        <div class="price-row">
          <div class="price"><small>سعر الكيلو الحالي</small><strong>${money.format(p.pricePerKg || 0)} ج.م</strong></div>
          <button class="btn btn-primary" data-product-index="${state.products.indexOf(p)}" ${p.available ? '' : 'disabled'}>${p.available ? 'احسب واطلب' : 'غير متاح'}</button>
        </div>
      </article>`).join('');

    $$('[data-product-index]', els.grid).forEach(btn => btn.addEventListener('click', () => {
      const product = state.products[Number(btn.dataset.productIndex)];
      if (product) openModal(product);
    }));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  const CATALOG_CACHE_KEY = 'elkhattab.catalog.v1';

  function readCatalogCache() {
    try {
      const raw = localStorage.getItem(CATALOG_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.products) || !parsed.products.length) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeCatalogCache(data) {
    try {
      localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({
        products: data.products,
        updatedAt: data.updatedAt || new Date().toISOString(),
        savedAt: new Date().toISOString()
      }));
    } catch {}
  }

  async function fetchWithTimeout(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function applyCatalog(data, mode = 'live') {
    state.products = data.products
      .filter(p => p && p.name && Number(p.pricePerKg) >= 0)
      .map(p => ({
        ...p,
        pricePerKg: Number(p.pricePerKg) || 0,
        available: Boolean(p.available)
      }));

    state.grain = 'الكل';
    buildFilters();
    renderProducts();

    const updated = data.updatedAt ? new Date(data.updatedAt) : new Date();
    const time = Number.isNaN(updated.getTime())
      ? 'غير معروف'
      : updated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    if (mode === 'browser-cache') {
      setCatalogStatus('warning', `اتصال مؤقتاً غير متاح — عرض آخر أسعار محفوظة (${time})`);
    } else if (data.source === 'server-cache') {
      setCatalogStatus('warning', `بيانات محفوظة مؤقتاً — آخر تحديث ${time}`);
    } else {
      setCatalogStatus('ok', `آخر تحديث ${time}`);
    }

    els.count.textContent = integer.format(state.products.length);
    els.updated.textContent = time;
  }

  async function loadCatalog() {
    const url = String(config.catalogApiUrl || '');

    if (!url || url.includes('YOUR-N8N-DOMAIN')) {
      els.grid.innerHTML = '';
      els.error.classList.remove('hidden');
      setCatalogStatus('error', 'واجهة الأسعار غير مربوطة');
      els.count.textContent = '—';
      els.updated.textContent = 'غير مربوط';
      return;
    }

    skeletons();
    els.error.classList.add('hidden');
    setCatalogStatus('', 'جاري تحميل الأسعار...');

    let lastError = null;

    // Retry twice before falling back to the last successful browser cache.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetchWithTimeout(url, 12000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        if (!data?.ok || !Array.isArray(data.products) || !data.products.length) {
          throw new Error('Invalid API payload');
        }

        writeCatalogCache(data);
        applyCatalog(data, 'live');
        return;
      } catch (err) {
        lastError = err;
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 900));
        }
      }
    }

    console.error(lastError);

    const cached = readCatalogCache();
    if (cached) {
      els.error.classList.add('hidden');
      applyCatalog(cached, 'browser-cache');
      return;
    }

    els.grid.innerHTML = '';
    els.error.classList.remove('hidden');

    const message = String(lastError?.message || '');
    if (message.includes('HTTP 404')) {
      setCatalogStatus('error', 'واجهة الأسعار غير مفعلة على n8n');
    } else {
      setCatalogStatus('error', 'تعذر الاتصال بنظام الأسعار');
    }

    els.count.textContent = '—';
    els.updated.textContent = 'غير متاح';
  }

  function openModal(product) {
    state.selected = product;
    els.productName.textContent = product.name;
    els.formError.classList.add('hidden');
    els.modal.classList.add('open');
    els.modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    updateEstimate();
  }

  function closeModal() {
    els.modal.classList.remove('open');
    els.modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function quantityKg() {
    const q = Number(els.qty.value);
    if (!Number.isFinite(q) || q <= 0) return 0;
    return els.unit.value === 'طن' ? q * 1000 : q;
  }

  function updateEstimate() {
    if (!state.selected) return;
    const kg = quantityKg();
    const total = kg * Number(state.selected.pricePerKg || 0);
    els.estimate.textContent = kg > 0 ? `${money.format(total)} ج.م` : '—';
  }

  function validateOrder() {
    const name = els.name.value.trim();
    const phone = els.phone.value.trim();
    if (!quantityKg()) return 'اكتب كمية صحيحة أكبر من صفر.';
    if (els.type.value === 'order') {
      if (!name) return 'اكتب اسم العميل أو الشركة عشان نقدر نسجل الطلب.';
      if (!/^[0-9+\s()-]{7,20}$/.test(phone)) return 'اكتب رقم موبايل صحيح عشان فريق المبيعات يتواصل معاك.';
    }
    return '';
  }

  function buildMessage() {
    const p = state.selected;
    const name = els.name.value.trim();
    const phone = els.phone.value.trim();
    const qty = els.qty.value;
    const unit = els.unit.value;
    const note = els.note.value.trim();
    const isOrder = els.type.value === 'order';
    const total = quantityKg() * Number(p.pricePerKg || 0);

    const parts = [
      'السلام عليكم،',
      isOrder ? `عايز أكد طلب شراء مبدئي لـ ${qty} ${unit} من ${p.name}.` : `محتاج عرض سعر وتوفر لـ ${qty} ${unit} من ${p.name}.`
    ];
    if (name) parts.push(`الاسم/الشركة: ${name}.`);
    if (phone) parts.push(`رقم التواصل: ${phone}.`);
    if (total > 0) parts.push(`التكلفة التقريبية حسب السعر الظاهر: ${money.format(total)} جنيه.`);
    if (note) parts.push(`ملاحظة: ${note}.`);
    return parts.join(' ');
  }

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = validateOrder();
    if (error) {
      els.formError.textContent = error;
      els.formError.classList.remove('hidden');
      return;
    }
    els.formError.classList.add('hidden');
    const message = buildMessage();
    closeModal();
    await copyAndOpen(message);
  });

  els.search.addEventListener('input', () => { state.search = els.search.value; renderProducts(); });
  els.refresh.addEventListener('click', loadCatalog);
  els.qty.addEventListener('input', updateEstimate);
  els.unit.addEventListener('change', updateEstimate);
  $$('[data-close-modal]').forEach(x => x.addEventListener('click', closeModal));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  $$('[data-open-messenger]').forEach(btn => btn.addEventListener('click', () => copyAndOpen('السلام عليكم، محتاج أستفسر عن أصناف وأسعار الأرز المتاحة حالياً.')));

  els.phoneLink.href = `tel:${config.salesPhone || ''}`;
  els.phoneLink.textContent = `اتصال: ${config.salesPhoneDisplay || config.salesPhone || ''}`;

  loadCatalog();
})();
