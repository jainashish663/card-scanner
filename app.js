// ---------- IndexedDB storage ----------
const DB_NAME = 'cardScannerDB';
const DB_VERSION = 1;
const STORE = 'cards';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbAdd(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------- Image capture helpers ----------
function compressImageFile(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- Toast ----------
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------- Screen navigation ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

document.querySelectorAll('.back-btn').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.target));
});

// ---------- Scan screen state ----------
let frontDataUrl = null;
let backDataUrl = null;
let ocrWorker = null;

const frontInput = document.getElementById('front-input');
const backInput = document.getElementById('back-input');
const frontPreview = document.getElementById('front-preview');
const backPreview = document.getElementById('back-preview');
const btnExtract = document.getElementById('btn-extract');

function resetScanScreen() {
  frontDataUrl = null;
  backDataUrl = null;
  frontPreview.hidden = true;
  backPreview.hidden = true;
  frontPreview.removeAttribute('src');
  backPreview.removeAttribute('src');
  frontInput.value = '';
  backInput.value = '';
  document.getElementById('front-box').querySelector('.capture-placeholder').hidden = false;
  document.getElementById('back-box').querySelector('.capture-placeholder').hidden = false;
  btnExtract.disabled = true;
  document.getElementById('ocr-progress').hidden = true;
  setProgress(0, 'Preparing…');
}

document.getElementById('btn-new-scan').addEventListener('click', () => {
  resetScanScreen();
  showScreen('screen-scan');
});

frontInput.addEventListener('change', async () => {
  const file = frontInput.files[0];
  if (!file) return;
  frontDataUrl = await compressImageFile(file);
  frontPreview.src = frontDataUrl;
  frontPreview.hidden = false;
  document.getElementById('front-box').querySelector('.capture-placeholder').hidden = true;
  btnExtract.disabled = !frontDataUrl;
});

backInput.addEventListener('change', async () => {
  const file = backInput.files[0];
  if (!file) return;
  backDataUrl = await compressImageFile(file);
  backPreview.src = backDataUrl;
  backPreview.hidden = false;
  document.getElementById('back-box').querySelector('.capture-placeholder').hidden = true;
});

// ---------- OCR ----------
function setProgress(pct, label) {
  document.getElementById('progress-fill').style.width = `${Math.round(pct * 100)}%`;
  document.getElementById('progress-label').textContent = label;
}

function friendlyStatus(status) {
  const map = {
    'loading tesseract core': 'Loading OCR engine…',
    'initializing tesseract': 'Starting OCR engine…',
    'loading language traineddata': 'Downloading language data…',
    'initializing api': 'Initializing…',
    'recognizing text': 'Reading text…',
  };
  return map[status] || status;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function getWorker() {
  if (!ocrWorker) {
    ocrWorker = await withTimeout(
      Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (typeof m.progress === 'number') {
            setProgress(m.progress, friendlyStatus(m.status));
          }
        },
      }),
      60000,
      'Timed out starting the OCR engine. Check your internet connection and try again.'
    );
    // PSM 4: single column of text of variable sizes — matches the
    // stacked, mixed-font-size layout of a typical business card far
    // better than the fully-automatic default, which was dropping
    // large heading-style lines (e.g. the firm name).
    await ocrWorker.setParameters({ tessedit_pageseg_mode: '4' });
  }
  return ocrWorker;
}

async function runOcr(dataUrl) {
  const worker = await getWorker();
  const { data } = await withTimeout(
    worker.recognize(dataUrl),
    60000,
    'Timed out reading the card. Try again with a clearer photo.'
  );
  return data.text || '';
}

btnExtract.addEventListener('click', async () => {
  if (!frontDataUrl) return;
  btnExtract.disabled = true;
  document.getElementById('ocr-progress').hidden = false;
  setProgress(0, ocrWorker ? 'Preparing…' : 'Downloading OCR engine (~5MB, first time only)…');

  try {
    const frontText = await runOcr(frontDataUrl);
    let backText = '';
    if (backDataUrl) {
      backText = await runOcr(backDataUrl);
    }
    const parsed = parseCardText(frontText, backText);
    openFormScreen({ mode: 'new', parsed, front: frontDataUrl, back: backDataUrl });
  } catch (err) {
    console.error(err);
    showToast(err && err.message ? err.message : 'OCR failed — check your connection and try again.');
  } finally {
    btnExtract.disabled = false;
    document.getElementById('ocr-progress').hidden = true;
  }
});

// ---------- Form (review new / edit existing) ----------
let formMode = 'new'; // 'new' | 'edit'
let editingCardId = null;
let formFrontImage = null;
let formBackImage = null;

const fieldFirm = document.getElementById('field-firm');
const fieldName = document.getElementById('field-name');
const fieldMobile = document.getElementById('field-mobile');
const fieldAddress = document.getElementById('field-address');
const rawTextEl = document.getElementById('raw-text');
const formThumbs = document.getElementById('form-thumbs');
const btnDelete = document.getElementById('btn-delete');
const singleContactFields = document.getElementById('single-contact-fields');
const multiContactFields = document.getElementById('multi-contact-fields');
const contactsList = document.getElementById('contacts-list');
const btnAddContact = document.getElementById('btn-add-contact');

// A scanned card can hold more than one person (e.g. a firm listing
// several people, each with their own number) — each row here becomes
// its own saved card, sharing the firm name/address/photos.
function createContactRow(name = '', mobile = '') {
  const row = document.createElement('div');
  row.className = 'contact-row';
  row.innerHTML = `
    <input class="field-input contact-name" type="text" placeholder="Name" />
    <input class="field-input contact-mobile" type="tel" placeholder="Mobile number" />
    <button type="button" class="remove-contact-btn" aria-label="Remove person">×</button>
  `;
  row.querySelector('.contact-name').value = name;
  row.querySelector('.contact-mobile').value = mobile;
  row.querySelector('.remove-contact-btn').addEventListener('click', () => {
    if (contactsList.children.length > 1) row.remove();
  });
  return row;
}

function renderContactRows(contacts) {
  contactsList.innerHTML = '';
  const list = contacts && contacts.length ? contacts : [{ name: '', mobile: '' }];
  list.forEach(c => contactsList.appendChild(createContactRow(c.name, c.mobile)));
}

btnAddContact.addEventListener('click', () => {
  contactsList.appendChild(createContactRow());
});

function openFormScreen({ mode, parsed, front, back, id }) {
  formMode = mode;
  editingCardId = id ?? null;
  formFrontImage = front || null;
  formBackImage = back || null;

  document.getElementById('form-title').textContent = mode === 'edit' ? 'Edit Card' : 'Review Card';
  btnDelete.hidden = mode !== 'edit';

  fieldFirm.value = parsed.firmName || '';
  fieldAddress.value = parsed.address || '';
  rawTextEl.textContent = parsed.rawText || '(no raw text)';

  if (mode === 'edit') {
    singleContactFields.hidden = false;
    multiContactFields.hidden = true;
    fieldName.value = parsed.personName || '';
    fieldMobile.value = parsed.mobile || '';
  } else {
    singleContactFields.hidden = true;
    multiContactFields.hidden = false;
    renderContactRows(parsed.contacts);
  }

  formThumbs.innerHTML = '';
  if (formFrontImage) {
    const img = document.createElement('img');
    img.src = formFrontImage;
    formThumbs.appendChild(img);
  }
  if (formBackImage) {
    const img = document.createElement('img');
    img.src = formBackImage;
    formThumbs.appendChild(img);
  }

  showScreen('screen-form');
}

document.getElementById('btn-save').addEventListener('click', async () => {
  const firmName = fieldFirm.value.trim();
  const address = fieldAddress.value.trim();
  const now = new Date().toISOString();

  if (formMode === 'edit' && editingCardId != null) {
    const personName = fieldName.value.trim();
    const mobile = fieldMobile.value.trim();
    if (!firmName && !personName && !mobile) {
      showToast('Add at least a name, firm, or mobile number.');
      return;
    }
    const existing = await dbGet(editingCardId);
    await dbPut({
      ...existing,
      firmName, personName, mobile, address,
      updatedAt: now,
    });
    showToast('Card updated');
  } else {
    const entries = Array.from(contactsList.querySelectorAll('.contact-row'))
      .map(row => ({
        personName: row.querySelector('.contact-name').value.trim(),
        mobile: row.querySelector('.contact-mobile').value.trim(),
      }))
      .filter(e => e.personName || e.mobile);

    if (!firmName && entries.length === 0) {
      showToast('Add at least a firm name or one person.');
      return;
    }
    if (entries.length === 0) entries.push({ personName: '', mobile: '' });

    for (const entry of entries) {
      await dbAdd({
        firmName, personName: entry.personName, mobile: entry.mobile, address,
        rawText: rawTextEl.textContent,
        frontImage: formFrontImage,
        backImage: formBackImage,
        createdAt: now,
        updatedAt: now,
      });
    }
    showToast(entries.length > 1 ? `${entries.length} cards saved` : 'Card saved');
  }

  showScreen('screen-home');
  renderCardList(document.getElementById('search-input').value);
});

btnDelete.addEventListener('click', async () => {
  if (editingCardId == null) return;
  if (!confirm('Delete this card? This cannot be undone.')) return;
  await dbDelete(editingCardId);
  showToast('Card deleted');
  showScreen('screen-home');
  renderCardList(document.getElementById('search-input').value);
});

// ---------- Home / list ----------
const cardListEl = document.getElementById('card-list');
const emptyStateEl = document.getElementById('empty-state');

async function renderCardList(filter = '') {
  const all = await dbGetAll();
  all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const q = filter.trim().toLowerCase();
  const filtered = q
    ? all.filter(c =>
        (c.firmName || '').toLowerCase().includes(q) ||
        (c.personName || '').toLowerCase().includes(q) ||
        (c.mobile || '').toLowerCase().includes(q))
    : all;

  cardListEl.innerHTML = '';
  emptyStateEl.hidden = all.length > 0;

  filtered.forEach(card => {
    const li = document.createElement('li');
    li.className = 'card-item';
    li.innerHTML = `
      ${card.frontImage ? `<img src="${card.frontImage}" alt="">` : '<img alt="">'}
      <div class="card-item-text">
        <div class="firm">${escapeHtml(card.firmName || 'Untitled')}</div>
        <div class="name">${escapeHtml(card.personName || '')}</div>
        <div class="mobile">${escapeHtml(card.mobile || '')}</div>
      </div>
    `;
    li.addEventListener('click', () => {
      openFormScreen({
        mode: 'edit',
        id: card.id,
        parsed: {
          firmName: card.firmName,
          personName: card.personName,
          mobile: card.mobile,
          address: card.address,
          rawText: card.rawText,
        },
        front: card.frontImage,
        back: card.backImage,
      });
    });
    cardListEl.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('search-input').addEventListener('input', (e) => {
  renderCardList(e.target.value);
});

// ---------- Export to Excel ----------
document.getElementById('btn-export').addEventListener('click', async () => {
  const all = await dbGetAll();
  if (!all.length) {
    showToast('No cards to export yet.');
    return;
  }
  all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const rows = all.map(c => ({
    'Firm / Company Name': c.firmName || '',
    'Name': c.personName || '',
    'Mobile Number': c.mobile || '',
    'Address': c.address || '',
    'Date Added': c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '',
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 40 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Business Cards');
  XLSX.writeFile(wb, `business-cards-${new Date().toISOString().slice(0, 10)}.xlsx`);
});

// ---------- Init ----------
renderCardList();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
