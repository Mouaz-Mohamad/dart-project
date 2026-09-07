(function () {
  'use strict';

  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  // The rectangle is only a broad map/search safety envelope. Acceptance is
  // decided by the reverse-geocoded administrative governorate below, so a
  // valid address anywhere in Cairo or Giza is not rejected by a city-centre
  // radius while every other governorate is still refused.
  const DELIVERY_BOUNDS = [[27.00, 27.00], [30.65, 32.25]];
  const DELIVERY_VIEWBOX = '27.00,30.65,32.25,27.00';
  const DEFAULT_CENTER = [30.0444, 31.2357];
  const controllers = new Map();
  let lastRequestAt = 0;

  const value = element => String(element?.value || '').trim();
  const setValue = (element, next) => {
    if (!element || next == null || String(next).trim() === '') return;
    if (element.tagName === 'SELECT' && ![...element.options].some(option => option.value === String(next).trim())) {
      element.add(new Option(String(next).trim(), String(next).trim()));
    }
    element.value = String(next).trim();
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function nominatim(path, params) {
    const waitFor = Math.max(0, 1050 - (Date.now() - lastRequestAt));
    if (waitFor) await wait(waitFor);
    lastRequestAt = Date.now();
    const query = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', ...params });
    const response = await fetch(`${NOMINATIM}/${path}?${query}`, {
      headers: { 'Accept-Language': 'en' }
    });
    if (!response.ok) throw new Error('Address service is temporarily unavailable.');
    return response.json();
  }

  function addressParts(result) {
    const a = result?.address || {};
    const rawGovernorate = a.state || a.governorate || a.region || '';
    return {
      country: a.country || 'Egypt',
      governorate: canonicalDeliveryGovernorate(rawGovernorate) || rawGovernorate,
      area: a.suburb || a.neighbourhood || a.city_district || a.town || a.village || a.city || a.county || '',
      street: a.road || a.pedestrian || a.residential || a.footway || '',
      building: a.house_number || a.building || '',
      fullAddress: result?.display_name || ''
    };
  }

  function normalizePlace(value) {
    return String(value || '').trim().toLowerCase().replace(/[\u064B-\u065F\u0670]/g, '').replace(/\s+/g, ' ');
  }

  function canonicalDeliveryGovernorate(value) {
    const name = normalizePlace(value);
    if (name === 'cairo' || name === 'cairo governorate' || name === 'al qahirah' ||
        name === 'القاهرة' || name === 'محافظة القاهرة') return 'Cairo';
    if (name === 'giza' || name === 'giza governorate' || name === 'al jizah' ||
        name === 'الجيزة' || name === 'محافظة الجيزة') return 'Giza';
    return '';
  }

  function isSupportedGovernorateName(value) {
    return Boolean(canonicalDeliveryGovernorate(value));
  }

  function isInsideDeliveryBounds(lat, lng) {
    const latitude = Number(lat), longitude = Number(lng);
    return Number.isFinite(latitude) && Number.isFinite(longitude) &&
      latitude >= DELIVERY_BOUNDS[0][0] && latitude <= DELIVERY_BOUNDS[1][0] &&
      longitude >= DELIVERY_BOUNDS[0][1] && longitude <= DELIVERY_BOUNDS[1][1];
  }

  function isSupportedDeliveryResult(result) {
    const a = result?.address || {};
    const iso = String(a['ISO3166-2-lvl4'] || a['ISO3166-2-lvl3'] || '').toUpperCase();
    const governorate = a.state || a.governorate || a.region || '';
    const administrativeMatch = ['EG-C', 'EG-GZ'].includes(iso) || isSupportedGovernorateName(governorate);
    return administrativeMatch && isInsideDeliveryBounds(result?.lat, result?.lon);
  }

  function create(options) {
    const form = document.querySelector(options.form);
    const mapElement = document.querySelector(options.map);
    if (!form || !mapElement || typeof window.L === 'undefined') return null;
    if (controllers.has(mapElement)) return controllers.get(mapElement);

    const fields = {
      search: document.querySelector(options.search),
      results: document.querySelector(options.results),
      latitude: document.querySelector(options.latitude),
      longitude: document.querySelector(options.longitude),
      fullAddress: document.querySelector(options.fullAddress),
      country: document.querySelector(options.country),
      governorate: document.querySelector(options.governorate),
      area: document.querySelector(options.area),
      street: document.querySelector(options.street),
      building: document.querySelector(options.building),
      floor: document.querySelector(options.floor),
      status: document.querySelector(options.status)
    };

    const map = L.map(mapElement, {
      attributionControl: false,
      zoomControl: false,
      maxBounds: DELIVERY_BOUNDS,
      maxBoundsViscosity: 1
    }).setView(DEFAULT_CENTER, 11);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd'
    }).addTo(map);

    const pin = L.divIcon({
      className: 'dart-address-pin',
      html: '<span aria-hidden="true"><i class="fa-solid fa-location-dot"></i></span>',
      iconSize: [34, 42],
      iconAnchor: [17, 40]
    });

    let marker = null;
    let searchTimer = null;
    let manualTimer = null;
    let requestVersion = 0;
    let lastValidLocation = null;

    function status(message, state = '') {
      if (!fields.status) return;
      fields.status.textContent = message;
      fields.status.dataset.state = state;
    }

    function setCoordinates(lat, lng, source = 'map') {
      if (fields.latitude) fields.latitude.value = Number(lat).toFixed(7);
      if (fields.longitude) fields.longitude.value = Number(lng).toFixed(7);
      form.dataset.dartAddressSource = source;
      form.dataset.dartAddressReady = 'true';
      form.dataset.dartDeliveryZone = 'cairo-giza';
    }

    function clearCoordinates() {
      if (fields.latitude) fields.latitude.value = '';
      if (fields.longitude) fields.longitude.value = '';
      form.dataset.dartAddressReady = 'false';
      form.dataset.dartDeliveryZone = '';
    }

    function applyParts(parts, overwrite = false) {
      form.dataset.dartAddressApplying = 'true';
      try {
        for (const name of ['country', 'governorate', 'area', 'street', 'building']) {
          if (overwrite || !value(fields[name])) setValue(fields[name], parts[name]);
        }
        if (parts.fullAddress) {
          if (fields.fullAddress) fields.fullAddress.value = parts.fullAddress;
          if (fields.search) fields.search.value = parts.fullAddress;
        }
      } finally {
        form.dataset.dartAddressApplying = 'false';
      }
    }

    function setMarker(lat, lng, openPopup = true) {
      if (marker) marker.setLatLng([lat, lng]);
      else {
        marker = L.marker([lat, lng], { icon: pin, draggable: true }).addTo(map);
        marker.on('dragend', event => selectLocation(event.target.getLatLng().lat, event.target.getLatLng().lng));
      }
      map.setView([lat, lng], 16);
      if (openPopup) marker.bindPopup('Delivery location').openPopup();
    }

    async function selectLocation(lat, lng, knownResult = null) {
      const version = ++requestVersion;
      status('Checking that this delivery location is inside Cairo or Giza…', 'loading');
      try {
        const result = knownResult || await nominatim('reverse', { lat, lon: lng, zoom: '18' });
        if (version !== requestVersion) return;
        if (!isSupportedDeliveryResult(result)) {
          clearCoordinates();
          if (lastValidLocation) setMarker(lastValidLocation.lat, lastValidLocation.lng, false);
          else if (marker) { map.removeLayer(marker); marker = null; }
          status('Delivery is currently available in Cairo and Giza only. Choose a location inside the delivery zone.', 'error');
          form.dispatchEvent(new CustomEvent('dart:address-rejected', { bubbles:true, detail:{ reason:'outside-delivery-zone' } }));
          return false;
        }
        const parts = addressParts(result);
        parts.country = 'Egypt';
        parts.governorate = canonicalDeliveryGovernorate(parts.governorate);
        setCoordinates(lat, lng, 'map');
        lastValidLocation = {lat:Number(lat), lng:Number(lng)};
        setMarker(lat, lng);
        applyParts(parts, Boolean(options.overwriteFromMap));
        marker.bindPopup(parts.fullAddress || 'Delivery location').openPopup();
        status(`${parts.governorate} location selected. Complete the building and floor details.`, 'success');
        form.dispatchEvent(new CustomEvent('dart:address-selected', { bubbles: true, detail: { lat, lng, parts } }));
        return true;
      } catch (error) {
        clearCoordinates();
        if (lastValidLocation) setMarker(lastValidLocation.lat, lastValidLocation.lng, false);
        status(navigator.onLine ? 'The location could not be verified. Try again or enter the Cairo/Giza address manually.' : 'You are offline. Reconnect to verify the delivery location.', 'error');
        return false;
      }
    }

    function manualQuery() {
      return [value(fields.building), value(fields.street), value(fields.area), value(fields.governorate), value(fields.country) || 'Egypt']
        .filter(Boolean).join(', ');
    }

    async function locateManualAddress(showErrors = true) {
      const query = manualQuery();
      if (!value(fields.country) || !value(fields.governorate) || !value(fields.area) || !value(fields.street) || !value(fields.building) || !value(fields.floor)) {
        if (showErrors) status('Complete country, governorate, area, street, building and floor first.', 'error');
        return false;
      }
      if (!isSupportedGovernorateName(value(fields.governorate))) {
        clearCoordinates();
        if (showErrors) status('Delivery is currently available in Cairo and Giza only.', 'error');
        return false;
      }
      status('Locating the manually entered address…', 'loading');
      try {
        const results = await nominatim('search', { q: query, countrycodes: 'eg', viewbox:DELIVERY_VIEWBOX, bounded:'1', limit: '5' });
        const result = results.find(isSupportedDeliveryResult);
        if (!result) {
          clearCoordinates();
          status('This address could not be verified inside Cairo or Giza. Refine it or choose a pin inside the delivery zone.', 'error');
          return false;
        }
        const lat = Number(result.lat), lng = Number(result.lon);
        setCoordinates(lat, lng, 'manual');
        lastValidLocation = {lat, lng};
        form.dataset.dartAddressApplying = 'true';
        try {
          setValue(fields.country, 'Egypt');
          setValue(fields.governorate, canonicalDeliveryGovernorate(addressParts(result).governorate));
        } finally {
          form.dataset.dartAddressApplying = 'false';
        }
        if (fields.fullAddress) fields.fullAddress.value = result.display_name || query;
        if (fields.search) fields.search.value = result.display_name || query;
        setMarker(lat, lng, false);
        status('Manual address matched to the Cairo/Giza delivery map.', 'success');
        form.dispatchEvent(new CustomEvent('dart:address-selected', { bubbles: true, detail: { lat, lng, parts: addressParts(result) } }));
        return true;
      } catch (error) {
        status('Address lookup failed. Check the connection or select the pin manually.', 'error');
        return false;
      }
    }

    function validate() {
      const missing = [];
      if (!value(fields.country)) missing.push('country');
      if (!value(fields.governorate)) missing.push('governorate');
      if (!value(fields.area)) missing.push('area');
      if (!value(fields.street)) missing.push('street');
      if (!value(fields.building)) missing.push('building number/name');
      if (!value(fields.floor)) missing.push('floor');
      const hasCoordinates = Boolean(value(fields.latitude) && value(fields.longitude));
      if (missing.length) return { ok: false, message: `Complete: ${missing.join(', ')}.` };
      if (!isSupportedGovernorateName(value(fields.governorate)) || form.dataset.dartDeliveryZone !== 'cairo-giza') {
        return { ok:false, message:'Delivery is currently available in Cairo and Giza only. Verify the address on the map.' };
      }
      if (!hasCoordinates) return { ok: false, message: 'Select a location on the map or locate the manually entered address.' };
      return { ok: true, source: form.dataset.dartAddressSource || 'map', zone:'cairo-giza' };
    }

    map.on('click', event => selectLocation(event.latlng.lat, event.latlng.lng));

    const locateControl = L.control({ position: 'bottomright' });
    locateControl.onAdd = () => {
      const wrap = L.DomUtil.create('div', 'dart-map-actions');
      const button = L.DomUtil.create('button', 'dart-map-locate', wrap);
      button.type = 'button';
      button.title = 'Use my current location';
      button.setAttribute('aria-label', 'Use my current location');
      button.innerHTML = '<i class="fa-solid fa-crosshairs"></i>';
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.on(button, 'click', () => {
        if (!navigator.geolocation) return status('Location access is not supported by this browser.', 'error');
        status('Finding your current location…', 'loading');
        navigator.geolocation.getCurrentPosition(
          position => selectLocation(position.coords.latitude, position.coords.longitude),
          () => status('Location permission was denied. Select the pin manually.', 'error'),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
        );
      });
      return wrap;
    };
    locateControl.addTo(map);

    if (fields.search && fields.results) {
      fields.search.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const query = value(fields.search);
        if (query.length < 3) {
          fields.results.hidden = true;
          fields.results.style.display = 'none';
          return;
        }
        searchTimer = setTimeout(async () => {
          fields.results.hidden = false;
          fields.results.style.display = 'block';
          fields.results.innerHTML = '<li class="dart-address-loading">Searching…</li>';
          try {
            const results = (await nominatim('search', { q: query, countrycodes: 'eg', viewbox:DELIVERY_VIEWBOX, bounded:'1', limit: '8' })).filter(isSupportedDeliveryResult).slice(0, 5);
            fields.results.innerHTML = results.length ? '' : '<li class="dart-address-empty">No verified address found inside Cairo or Giza.</li>';
            results.forEach(result => {
              const item = document.createElement('li');
              const button = document.createElement('button');
              button.type = 'button';
              button.textContent = result.display_name;
              button.addEventListener('click', () => {
                fields.results.hidden = true;
                fields.results.style.display = 'none';
                selectLocation(Number(result.lat), Number(result.lon), result);
              });
              item.appendChild(button);
              fields.results.appendChild(item);
            });
          } catch (error) {
            fields.results.innerHTML = '<li class="dart-address-empty">Address search is temporarily unavailable.</li>';
          }
        }, 650);
      });
    }

    const manualFields = [fields.country, fields.governorate, fields.area, fields.street, fields.building, fields.floor].filter(Boolean);
    const onManualAddressInput = () => {
      if (form.dataset.dartAddressApplying === 'true') return;
      form.dataset.dartAddressSource = 'manual';
      form.dataset.dartAddressReady = 'false';
      form.dataset.dartDeliveryZone = '';
      if (fields.latitude) fields.latitude.value = '';
      if (fields.longitude) fields.longitude.value = '';
      clearTimeout(manualTimer);
      manualTimer = setTimeout(() => {
        if (manualFields.every(input => value(input))) locateManualAddress(false);
      }, 1500);
    };
    manualFields.forEach(field => {
      field.addEventListener('input', onManualAddressInput);
      if (field.tagName === 'SELECT') field.addEventListener('change', onManualAddressInput);
    });

    const manualButton = document.querySelector(options.manualButton);
    manualButton?.addEventListener('click', () => locateManualAddress(true));

    const initialLat = Number(value(fields.latitude));
    const initialLng = Number(value(fields.longitude));
    if (Number.isFinite(initialLat) && Number.isFinite(initialLng) && initialLat && initialLng) selectLocation(initialLat, initialLng);

    const controller = { map, selectLocation, locateManualAddress, validate, fields, invalidate: () => setTimeout(() => map.invalidateSize(), 50) };
    controllers.set(mapElement, controller);
    setTimeout(() => map.invalidateSize(), 200);
    return controller;
  }

  function initCheckout() {
    const form = document.getElementById('checkoutForm');
    if (!form) return null;
    const manual = form.querySelector('.other-addres');
    const toggle = form.querySelector('.arrwo-for-other-adrees');
    if (manual && toggle && !toggle.dataset.dartBound) {
      manual.hidden = true;
      toggle.dataset.dartBound = '1';
      toggle.addEventListener('click', () => {
        manual.hidden = !manual.hidden;
        toggle.setAttribute('aria-expanded', String(!manual.hidden));
      });
      toggle.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle.click(); }
      });
      form.addEventListener('invalid', event => {
        if (manual.contains(event.target)) { manual.hidden = false; toggle.setAttribute('aria-expanded','true'); }
      }, true);
    }
    const controller = create({
      form: '#checkoutForm', map: '#map', search: '#address-input', results: '#results-list',
      latitude: '#lat-input', longitude: '#lng-input', fullAddress: '#formatted-address-input',
      country: '#checkout-country', governorate: '#governorate-select', area: '#area-input',
      street: '#street-input', building: '#checkout-building', floor: '#checkout-floor',
      status: '#checkout-address-status', manualButton: '#locate-manual-address'
    });
    if (controller) window.dartCheckoutAddress = controller;
    return controller;
  }

  window.DartAddress = {
    create,
    initCheckout,
    addressParts,
    canonicalDeliveryGovernorate,
    isSupportedGovernorateName,
    isSupportedDeliveryResult,
    isInsideDeliveryBounds
  };
})();
