// === Story Mode UI Handlers ===
// (ย้ายจาก inline <script> ใน story-mode.html เพื่อให้ทำงานกับ Chrome Extension CSP)

// === Product Integration (IndexedDB + Chunked localStorage) ===
var _cachedProducts = null;

// อ่านสินค้าจาก shared_products (chunked localStorage) — ใช้ใน 8s/16s/Sora/Veo
function loadProductsFromChunkedStorage() {
  try {
    var metaStr = localStorage.getItem('shared_products_meta');
    if (!metaStr) {
      // Fallback: ลองอ่านแบบ single key (old format)
      var singleStr = localStorage.getItem('shared_products');
      if (singleStr) {
        var parsed = JSON.parse(singleStr);
        return Array.isArray(parsed) ? parsed : [];
      }
      return [];
    }
    var meta = JSON.parse(metaStr);
    var allProducts = [];
    for (var i = 0; i < meta.totalChunks; i++) {
      var chunkStr = localStorage.getItem('shared_products_chunk_' + i);
      if (chunkStr) {
        var chunk = JSON.parse(chunkStr);
        if (Array.isArray(chunk)) allProducts = allProducts.concat(chunk);
      }
    }
    return allProducts;
  } catch(err) { return []; }
}

// อ่านสินค้าจาก product_set_rows (IndexedDB) — จาก Product Set
function loadProductsFromIndexedDB() {
  return new Promise(function(resolve) {
    try {
      var request = indexedDB.open('SoraCreatorSuite', 1);
      request.onerror = function() { resolve([]); };
      request.onsuccess = function() {
        var db = request.result;
        if (!db.objectStoreNames.contains('keyValueStore')) { db.close(); resolve([]); return; }
        var tx = db.transaction('keyValueStore', 'readonly');
        var store = tx.objectStore('keyValueStore');
        var getReq = store.get('product_set_rows');
        getReq.onsuccess = function() {
          var rows = getReq.result || [];
          var completed = rows.filter(function(r) { return r.status === 'completed' && r.outputName; });
          var mapped = completed.map(function(r) {
            return { name: r.outputName, highlights: r.outputHighlights || '', imageUrl: r.outputImageUrl || r.productImageUrl || '' };
          });
          db.close();
          resolve(mapped);
        };
        getReq.onerror = function() { db.close(); resolve([]); };
      };
      request.onupgradeneeded = function(e) { e.target.transaction.abort(); resolve([]); };
    } catch(err) { resolve([]); }
  });
}

// รวมสินค้าจากทุกแหล่ง (Manage Products + Product Set)
function loadProductsFromDB() {
  return loadProductsFromIndexedDB().then(function(idbProducts) {
    var sharedProducts = loadProductsFromChunkedStorage();
    // แปลง shared_products ให้เป็นรูปแบบเดียวกัน
    var mapped = sharedProducts.map(function(p) {
      return { name: p.name || '', highlights: p.highlights || '', imageUrl: p.imageUrl || '', code: p.code || '' };
    }).filter(function(p) { return p.name; });
    // รวม: shared_products ก่อน (Manage Products) + product_set_rows (Product Set)
    _cachedProducts = mapped.concat(idbProducts);
    return _cachedProducts;
  });
}

function populateProductDropdown(selectEl) {
  if (!selectEl) return;
  var products = _cachedProducts || [];
  selectEl.innerHTML = '<option value="">-- \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 (' + products.length + ') --</option>';
  var customOpt = document.createElement('option');
  customOpt.value = 'custom';
  customOpt.textContent = '\u270f\ufe0f \u0e01\u0e23\u0e2d\u0e01\u0e0a\u0e37\u0e48\u0e2d + \u0e43\u0e2a\u0e48\u0e23\u0e39\u0e1b\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32\u0e40\u0e2d\u0e07';
  selectEl.appendChild(customOpt);
  products.forEach(function(p, idx) {
    var opt = document.createElement('option');
    opt.value = '' + idx;
    // ตัดชื่อให้สั้น ≤50 ตัวอักษร
    var displayName = p.name.length > 50 ? p.name.substring(0, 50) + '...' : p.name;
    opt.textContent = (idx + 1) + '. ' + displayName;
    selectEl.appendChild(opt);
  });
}

function setupProductDropdown(sceneNum) {
  var selectEl = document.getElementById('storyProduct' + sceneNum + 'Select');
  var inputEl = document.getElementById('storyProduct' + sceneNum + 'Name');
  var previewEl = document.getElementById('storyProduct' + sceneNum + 'Preview');
  var placeholderEl = document.getElementById('storyProduct' + sceneNum + 'Placeholder');
  var removeBtnEl = document.getElementById('storyRemoveProduct' + sceneNum);
  if (!selectEl) return;
  populateProductDropdown(selectEl);
  if (inputEl) inputEl.style.display = 'none';

  selectEl.addEventListener('change', function() {
    var val = selectEl.value;
    if (val === 'custom') {
      // กรอกเอง → ล้างชื่อ + ล้างรูป + ล้าง CTA + แสดง input
      if (inputEl) { inputEl.value = ''; inputEl.style.display = ''; inputEl.focus(); }
      if (previewEl) { previewEl.src = ''; previewEl.style.display = 'none'; }
      if (placeholderEl) placeholderEl.style.display = 'flex';
      if (removeBtnEl) removeBtnEl.style.display = 'none';
    } else if (val !== '' && _cachedProducts && _cachedProducts[parseInt(val)]) {
      var product = _cachedProducts[parseInt(val)];
      if (inputEl) { inputEl.value = product.name; inputEl.style.display = 'none'; }
      // Auto-fill product image (แปลง URL → data URL เพื่อใช้เป็น reference image)
      if (product.imageUrl && previewEl) {
        if (product.imageUrl.startsWith('data:')) {
          // Already a data URL
          previewEl.src = product.imageUrl;
          previewEl.style.display = 'block';
          if (placeholderEl) placeholderEl.style.display = 'none';
          if (removeBtnEl) removeBtnEl.style.display = 'block';
        } else {
          // URL → fetch → data URL
          (function(pEl, phEl, rmEl, url) {
            fetch(url)
              .then(function(resp) { return resp.blob(); })
              .then(function(blob) {
                var reader = new FileReader();
                reader.onloadend = function() {
                  pEl.src = reader.result; // data:image/...;base64,...
                  pEl.style.display = 'block';
                  if (phEl) phEl.style.display = 'none';
                  if (rmEl) rmEl.style.display = 'block';
                };
                reader.readAsDataURL(blob);
              })
              .catch(function(err) {
                console.error('[ProductDropdown] Failed to convert image URL to data URL:', err);
                // Fallback: ใช้ URL ตรงๆ (อาจไม่ทำงานกับ reference image upload)
                pEl.src = url;
                pEl.style.display = 'block';
                if (phEl) phEl.style.display = 'none';
                if (rmEl) rmEl.style.display = 'block';
              });
          })(previewEl, placeholderEl, removeBtnEl, product.imageUrl);
        }
      }
    } else {
      // เลือก "-- เลือกสินค้า --" → ล้างชื่อ + ล้างรูป
      if (inputEl) { inputEl.value = ''; inputEl.style.display = 'none'; }
      if (previewEl) { previewEl.src = ''; previewEl.style.display = 'none'; }
      if (placeholderEl) placeholderEl.style.display = 'flex';
      if (removeBtnEl) removeBtnEl.style.display = 'none';
    }
    // ถ้า toggle ใช้สินค้าเดียวกันทุกฉากเปิดอยู่ + เป็นฉาก 1 → sync ไปทุกฉาก
    if (sceneNum === 1 && window._sameProductToggleOn) {
      syncProductToAllScenes();
    }
  });
}

// Initialize all product dropdowns
function initProductDropdowns(sceneCount) {
  loadProductsFromDB().then(function() {
    for (var i = 1; i <= sceneCount; i++) {
      setupProductDropdown(i);
    }
  });
}

// === Zoom Google Flow Toggle ===
var _zoomFlowBtn = document.getElementById('zoomFlowToggleBtn');
if (_zoomFlowBtn) {
  _zoomFlowBtn.addEventListener('click', function() {
    chrome.runtime.sendMessage({ type: 'TOGGLE_ZOOM_33' });
  });
}

// === Veo 3.1 Lower Priority Toggle ===
var _veoLPToggle = document.getElementById('veoLowerPriorityToggle');
var _veoLPOn = false;

function setVeoLPToggle(on) {
  _veoLPOn = on;
  if (_veoLPToggle) {
    _veoLPToggle.style.background = on ? '#FFB300' : '#444';
    var knob = _veoLPToggle.querySelector('div');
    if (knob) {
      knob.style.left = on ? '20px' : '2px';
      knob.style.background = on ? '#fff' : '#ccc';
    }
  }
  // Save to chrome.storage (shared with other modes)
  try { chrome.storage.local.set({ useVeoLowerPriority: on }); } catch(e) {}
}

// Load saved state
try {
  chrome.storage.local.get('useVeoLowerPriority', function(result) {
    if (result && result.useVeoLowerPriority) setVeoLPToggle(true);
  });
} catch(e) {}

if (_veoLPToggle) {
  _veoLPToggle.addEventListener('click', function() {
    setVeoLPToggle(!_veoLPOn);
  });
}

// === Image Upload Handler ===
function setupImageUpload(uploadAreaId, inputId, previewId, placeholderId, removeBtnId) {
  var area = document.getElementById(uploadAreaId);
  var input = document.getElementById(inputId);
  var preview = document.getElementById(previewId);
  var placeholder = document.getElementById(placeholderId);
  var removeBtn = document.getElementById(removeBtnId);

  if (!area || !input || !preview || !placeholder || !removeBtn) return;

  area.addEventListener('click', function() {
    // ถ้ามีรูปอยู่แล้ว (สินค้า) → กดเพื่อลบออก แทนอัปรูปใหม่
    if (removeBtnId.indexOf('storyRemoveProduct') === 0 && preview.style.display === 'block' && preview.src) {
      removeBtn.click();
      return;
    }
    input.click();
  });
  input.addEventListener('change', function() {
    if (this.files && this.files[0]) {
      var reader = new FileReader();
      reader.onload = function(e) {
        preview.src = e.target.result;
        preview.style.display = 'block';
        placeholder.style.display = 'none';
        removeBtn.style.display = 'block';
      };
      reader.readAsDataURL(this.files[0]);
    }
  });
  removeBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    preview.src = '';
    preview.style.display = 'none';
    placeholder.style.display = 'flex';
    removeBtn.style.display = 'none';
    input.value = '';
    // ถ้าเป็นปุ่มลบรูปสินค้า → เคลียร์ dropdown สินค้าด้วย
    var match = removeBtnId.match(/storyRemoveProduct(\d+)/);
    if (match) {
      var sel = document.getElementById('storyProduct' + match[1] + 'Select');
      if (sel) { sel.value = ''; sel.dispatchEvent(new Event('change')); }
    }
  });
}

// === Setup Character Box 1 (always visible in HTML) ===
setupImageUpload('storyCharacter1UploadArea', 'storyCharacter1Input', 'storyCharacter1Preview', 'storyCharacter1Placeholder', 'storyRemoveCharacter1');
setupImageUpload('storyProduct1UploadArea', 'storyProduct1Input', 'storyProduct1Preview', 'storyProduct1Placeholder', 'storyRemoveProduct1');

// === Init Product Dropdown for Scene 1 ===
initProductDropdowns(1);

// === Post TikTok label sync + ซ่อน/แสดง "กรอกเอง" ===
(function() {
  var sel = document.getElementById('storyPostTiktok');
  var lbl = document.getElementById('storyPostTiktokLabel');
  if (sel && lbl) {
    sel.addEventListener('change', function() {
      lbl.textContent = sel.value ? sel.options[sel.selectedIndex].text : '\u0e40\u0e25\u0e37\u0e2d\u0e01\u0e27\u0e34\u0e18\u0e35\u0e25\u0e07\u0e04\u0e25\u0e34\u0e1b';
      // ซ่อน/แสดง option "กรอกเอง" ในทุก product dropdown
      var isAutoPost = sel.value === 'auto';
      var allProductSelects = document.querySelectorAll('[id^="storyProduct"][id$="Select"]');
      allProductSelects.forEach(function(pSel) {
        for (var i = 0; i < pSel.options.length; i++) {
          if (pSel.options[i].value === 'custom') {
            pSel.options[i].style.display = isAutoPost ? 'none' : '';
            // ถ้ากำลังเลือก custom อยู่ → reset กลับ
            if (isAutoPost && pSel.value === 'custom') {
              pSel.value = '';
              pSel.dispatchEvent(new Event('change'));
            }
            break;
          }
        }
      });
    });
  }
})();

// === Character Data Storage ===
// เก็บข้อมูล character ไว้เมื่อเปลี่ยนจำนวนฉาก
var savedCharacterData = {};

function saveAllCharacterData() {
  savedCharacterData = {};
  for (var i = 1; i <= 10; i++) {
    var nameEl = document.getElementById('storyChar' + i + 'Name');
    var descEl = document.getElementById('storyChar' + i + 'Desc');
    var previewEl = document.getElementById('storyCharacter' + i + 'Preview');

    if (nameEl || descEl || previewEl) {
      var genderEl = document.getElementById('storyChar' + i + 'Gender');
      savedCharacterData[i] = {
        name: nameEl ? nameEl.value : '',
        desc: descEl ? descEl.value : '',
        imageSrc: previewEl && previewEl.style.display !== 'none' ? previewEl.src : '',
        gender: genderEl ? genderEl.value : 'random'
      };
    }
  }
}

function restoreCharacterData(sceneNum) {
  var data = savedCharacterData[sceneNum];
  if (!data) return;

  var nameEl = document.getElementById('storyChar' + sceneNum + 'Name');
  var descEl = document.getElementById('storyChar' + sceneNum + 'Desc');
  var previewEl = document.getElementById('storyCharacter' + sceneNum + 'Preview');
  var placeholderEl = document.getElementById('storyCharacter' + sceneNum + 'Placeholder');
  var removeBtnEl = document.getElementById('storyRemoveCharacter' + sceneNum);

  if (nameEl && data.name) nameEl.value = data.name;
  if (descEl && data.desc) descEl.value = data.desc;
  if (previewEl && data.imageSrc) {
    previewEl.src = data.imageSrc;
    previewEl.style.display = 'block';
    if (placeholderEl) placeholderEl.style.display = 'none';
    if (removeBtnEl) removeBtnEl.style.display = 'block';
  }
  var genderEl = document.getElementById('storyChar' + sceneNum + 'Gender');
  if (genderEl && data.gender) genderEl.value = data.gender;
}

// === Set All Voice Gender (Toggle) ===
window._selectedVoiceGender = null;

window._setAllVoiceGender = function(gender) {
  var femaleBtn = document.getElementById('voiceAllFemaleBtn');
  var maleBtn = document.getElementById('voiceAllMaleBtn');
  var grayStyle = { bg: '#333', border: '#555', color: '#999', fw: 'normal' };

  // กดซ้ำ = toggle ออก (สีเทา)
  if (window._selectedVoiceGender === gender) {
    window._selectedVoiceGender = null;
    // Reset ทุกปุ่มเป็นสีเทา
    if (femaleBtn) { femaleBtn.style.background = grayStyle.bg; femaleBtn.style.borderColor = grayStyle.border; femaleBtn.style.color = grayStyle.color; femaleBtn.style.fontWeight = grayStyle.fw; }
    if (maleBtn) { maleBtn.style.background = grayStyle.bg; maleBtn.style.borderColor = grayStyle.border; maleBtn.style.color = grayStyle.color; maleBtn.style.fontWeight = grayStyle.fw; }
    return;
  }

  // เลือกเพศใหม่
  window._selectedVoiceGender = gender;
  for (var i = 1; i <= 10; i++) {
    var el = document.getElementById('storyChar' + i + 'Gender');
    if (el) el.value = gender;
  }
  // Highlight active button, reset other to gray
  if (femaleBtn && maleBtn) {
    if (gender === 'female') {
      femaleBtn.style.background = 'rgba(233,30,99,0.5)';
      femaleBtn.style.borderColor = '#ec407a';
      femaleBtn.style.color = '#ec407a';
      femaleBtn.style.fontWeight = 'bold';
      maleBtn.style.background = grayStyle.bg;
      maleBtn.style.borderColor = grayStyle.border;
      maleBtn.style.color = grayStyle.color;
      maleBtn.style.fontWeight = grayStyle.fw;
    } else {
      maleBtn.style.background = 'rgba(33,150,243,0.5)';
      maleBtn.style.borderColor = '#42a5f5';
      maleBtn.style.color = '#42a5f5';
      maleBtn.style.fontWeight = 'bold';
      femaleBtn.style.background = grayStyle.bg;
      femaleBtn.style.borderColor = grayStyle.border;
      femaleBtn.style.color = grayStyle.color;
      femaleBtn.style.fontWeight = grayStyle.fw;
    }
  }
};

// Attach click listeners for voice quick-select buttons
var _voiceMaleBtn = document.getElementById('voiceAllMaleBtn');
var _voiceFemaleBtn = document.getElementById('voiceAllFemaleBtn');
if (_voiceMaleBtn) _voiceMaleBtn.addEventListener('click', function() { window._setAllVoiceGender('male'); });
if (_voiceFemaleBtn) _voiceFemaleBtn.addEventListener('click', function() { window._setAllVoiceGender('female'); });

// === Update Character Boxes based on scene count ===
function updateCharacterBoxes(preserveData) {
  // Save existing data before rebuilding
  if (preserveData !== false) {
    saveAllCharacterData();
  }

  var sceneCountEl = document.getElementById('storySceneCount');
  var additionalContainer = document.getElementById('additionalCharacterBoxes');
  var label1 = document.getElementById('characterBoxLabel1');
  var box1 = document.getElementById('characterBox1');

  var sceneCount = sceneCountEl ? parseInt(sceneCountEl.value) || 1 : 1;

  // Update label of box 1
  if (label1) {
    label1.textContent = sceneCount > 1 ? '\u0e09\u0e32\u0e01 1' : '\u0e15\u0e31\u0e27\u0e25\u0e30\u0e04\u0e23';
  }

  // Show/hide delete button for box 1
  var deleteBtn1 = document.getElementById('deleteSceneBtn1');
  if (sceneCount > 1) {
    // Add delete button to box 1 if not exists
    if (!deleteBtn1 && box1) {
      var labelRow1 = box1.querySelector('div');
      if (labelRow1) {
        labelRow1.style.cssText = 'display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #888; margin-bottom: 8px; font-weight: 500;';
        var btn1 = document.createElement('button');
        btn1.id = 'deleteSceneBtn1';
        btn1.style.cssText = 'padding: 2px 8px; background: rgba(244, 67, 54, 0.15); border: 1px solid rgba(244, 67, 54, 0.3); border-radius: 4px; color: #ef5350; font-size: 10px; cursor: pointer; display: flex; align-items: center; gap: 3px;';
        btn1.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>\u0e25\u0e1a';
        btn1.onclick = function() { deleteScene(1); };
        labelRow1.appendChild(btn1);
      }
    }
  } else {
    // Remove delete button from box 1 if exists
    if (deleteBtn1) deleteBtn1.remove();
    // Reset label style
    if (label1) label1.style.cssText = 'font-size: 12px; color: #888; margin-bottom: 8px; font-weight: 500;';
  }

  // Clear additional boxes
  if (additionalContainer) {
    additionalContainer.innerHTML = '';
  }

  // Restore box 1 data
  if (preserveData !== false) {
    restoreCharacterData(1);
  }

  // Only 1 scene → no additional boxes needed
  if (sceneCount <= 1) return;

  // Add boxes for scenes 2+
  for (var i = 2; i <= sceneCount; i++) {
    var box = document.createElement('div');
    box.className = 'character-box';
    box.id = 'characterBox' + i;
    box.style.cssText = 'margin-bottom: 12px; padding: 12px; background: #222; border-radius: 8px; border: 1px solid #333;';
    box.innerHTML =
      '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #888; margin-bottom: 8px; font-weight: 500;">' +
        '<span>\u0e09\u0e32\u0e01 ' + i + '</span>' +
        '<button id="deleteSceneBtn' + i + '" style="padding: 2px 8px; background: rgba(244, 67, 54, 0.15); border: 1px solid rgba(244, 67, 54, 0.3); border-radius: 4px; color: #ef5350; font-size: 10px; cursor: pointer; display: flex; align-items: center; gap: 3px;">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>\u0e25\u0e1a' +
        '</button>' +
      '</div>' +
      '<div style="display: flex; gap: 12px; align-items: flex-start;">' +
        '<div style="flex: 1;">' +
          '<input type="text" id="storyChar' + i + 'Name" placeholder="\u0e0a\u0e37\u0e48\u0e2d \u0e40\u0e0a\u0e48\u0e19: \u0e41\u0e15\u0e07\u0e01\u0e27\u0e32, \u0e1e\u0e35\u0e48\u0e2a\u0e49\u0e21" style="width: 100%; font-size: 12px; margin-bottom: 6px; padding: 8px; background: #1a1a1a; border: 1px solid #444; border-radius: 6px; color: #fff; box-sizing: border-box;">' +
          '<input type="text" id="storyChar' + i + 'Desc" placeholder="\u0e25\u0e31\u0e01\u0e29\u0e13\u0e30 \u0e40\u0e0a\u0e48\u0e19: Pixar 3D \u0e15\u0e31\u0e27\u0e01\u0e25\u0e21" style="width: 100%; font-size: 12px; padding: 8px; background: #1a1a1a; border: 1px solid #444; border-radius: 6px; color: #fff; box-sizing: border-box;">' +
          '<div style="display: flex; align-items: center; gap: 6px; margin-top: 6px;">' +
            '<span style="font-size: 11px; color: #888; white-space: nowrap;">\ud83d\udd0a \u0e40\u0e2a\u0e35\u0e22\u0e07\u0e1e\u0e39\u0e14</span>' +
            '<select id="storyChar' + i + 'Gender" style="flex: 1; font-size: 12px; padding: 8px; background: #1a1a1a; border: 1px solid #444; border-radius: 6px; color: #fff; box-sizing: border-box; cursor: pointer;">' +
              '<option value="random">\ud83c\udfb2 \u0e2a\u0e38\u0e48\u0e21</option>' +
              '<option value="female">\ud83d\udc69 \u0e1c\u0e39\u0e49\u0e2b\u0e0d\u0e34\u0e07</option>' +
              '<option value="male">\ud83d\udc68 \u0e1c\u0e39\u0e49\u0e0a\u0e32\u0e22</option>' +
            '</select>' +
          '</div>' +
          '<div style="display: flex; align-items: center; gap: 6px; margin-top: 6px;">' +
            '<span style="font-size: 11px; color: #888; white-space: nowrap;">\ud83d\udce6 \u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32</span>' +
            '<select id="storyProduct' + i + 'Select" style="flex: 1; font-size: 12px; padding: 8px; background: #1a1a1a; border: 1px solid #444; border-radius: 6px; color: #fff; box-sizing: border-box; cursor: pointer;"><option value="">-- \u0e40\u0e25\u0e37\u0e2d\u0e01\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 --</option></select>' +
            '<input type="text" id="storyProduct' + i + 'Name" placeholder="\u0e0a\u0e37\u0e48\u0e2d\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32 \u0e40\u0e0a\u0e48\u0e19: \u0e04\u0e23\u0e35\u0e21\u0e01\u0e31\u0e19\u0e41\u0e14\u0e14 XYZ" style="flex: 1; font-size: 12px; padding: 8px; background: #1a1a1a; border: 1px solid #444; border-radius: 6px; color: #fff; box-sizing: border-box; display: none;">' +
          '</div>' +
        '</div>' +
        '<div style="width: 80px; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px;">' +
          '<div class="upload-area" id="storyCharacter' + i + 'UploadArea" style="position: relative; min-height: 80px; padding: 6px; background: #1a1a1a; border: 1px dashed #444; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;">' +
            '<div class="upload-placeholder" id="storyCharacter' + i + 'Placeholder" style="text-align: center;">' +
              '<span style="font-size: 20px; display: block;">\ud83d\uddbc\ufe0f</span>' +
              '<span style="color: #666; font-size: 9px;">\u0e15\u0e31\u0e27\u0e25\u0e30\u0e04\u0e23</span>' +
            '</div>' +
            '<img id="storyCharacter' + i + 'Preview" class="preview-image" style="display: none; max-height: 60px; max-width: 100%; border-radius: 4px;">' +
            '<button id="storyRemoveCharacter' + i + '" class="remove-btn" style="display: none; position: absolute; top: 2px; right: 2px; background: #ff4444; color: white; border: none; border-radius: 50%; width: 18px; height: 18px; cursor: pointer; font-size: 10px;">\u2715</button>' +
          '</div>' +
          '<input type="file" id="storyCharacter' + i + 'Input" accept=".png,.jpg,.jpeg,.webp" hidden>' +
          '<div class="upload-area" id="storyProduct' + i + 'UploadArea" style="position: relative; min-height: 80px; padding: 6px; background: #1a1a1a; border: 1px dashed #444; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;">' +
            '<div class="upload-placeholder" id="storyProduct' + i + 'Placeholder" style="text-align: center;">' +
              '<span style="font-size: 20px; display: block;">\ud83d\udce6</span>' +
              '<span style="color: #666; font-size: 9px;">\u0e2a\u0e34\u0e19\u0e04\u0e49\u0e32</span>' +
            '</div>' +
            '<img id="storyProduct' + i + 'Preview" class="preview-image" style="display: none; max-height: 60px; max-width: 100%; border-radius: 4px;">' +
            '<button id="storyRemoveProduct' + i + '" class="remove-btn" style="display: none; position: absolute; top: 2px; right: 2px; background: #ff4444; color: white; border: none; border-radius: 50%; width: 18px; height: 18px; cursor: pointer; font-size: 10px;">\u2715</button>' +
          '</div>' +
          '<input type="file" id="storyProduct' + i + 'Input" accept=".png,.jpg,.jpeg,.webp" hidden>' +
        '</div>' +
      '</div>';
    additionalContainer.appendChild(box);

    // Setup delete button click handler
    (function(sceneNum) {
      var deleteBtn = document.getElementById('deleteSceneBtn' + sceneNum);
      if (deleteBtn) {
        deleteBtn.onclick = function() { deleteScene(sceneNum); };
      }
    })(i);

    // Setup image upload for this box
    setupImageUpload(
      'storyCharacter' + i + 'UploadArea',
      'storyCharacter' + i + 'Input',
      'storyCharacter' + i + 'Preview',
      'storyCharacter' + i + 'Placeholder',
      'storyRemoveCharacter' + i
    );
    setupImageUpload(
      'storyProduct' + i + 'UploadArea',
      'storyProduct' + i + 'Input',
      'storyProduct' + i + 'Preview',
      'storyProduct' + i + 'Placeholder',
      'storyRemoveProduct' + i
    );
    // Setup product dropdown for this scene
    setupProductDropdown(i);

    // Restore data for this box
    if (preserveData !== false) {
      restoreCharacterData(i);
    }
  }

  // Sync voice gender กับปุ่ม quick-select ที่เลือกไว้
  if (window._selectedVoiceGender) {
    for (var g = 1; g <= sceneCount; g++) {
      var gEl = document.getElementById('storyChar' + g + 'Gender');
      if (gEl) gEl.value = window._selectedVoiceGender;
    }
  }
}

// === Delete a specific scene ===
function deleteScene(sceneNum) {
  var sceneCountEl = document.getElementById('storySceneCount');
  var currentCount = sceneCountEl ? parseInt(sceneCountEl.value) || 1 : 1;

  if (currentCount <= 1) return; // Can't delete if only 1 scene

  // Save all data first
  saveAllCharacterData();

  // Shift data: move scenes after deleted one up by 1
  var newSavedData = {};
  for (var i = 1; i <= currentCount; i++) {
    if (i < sceneNum) {
      // Keep scenes before deleted one
      newSavedData[i] = savedCharacterData[i];
    } else if (i > sceneNum) {
      // Shift scenes after deleted one up by 1
      newSavedData[i - 1] = savedCharacterData[i];
    }
    // Scene at sceneNum is deleted (skipped)
  }
  savedCharacterData = newSavedData;

  // Decrease scene count
  var newCount = currentCount - 1;
  if (sceneCountEl) {
    sceneCountEl.value = newCount.toString();
  }

  // Rebuild character boxes (data already saved and shifted)
  updateCharacterBoxes();
}

// === Toggle "เหมือนกันทุกฉาก" ===
var sameCharToggleOn = false; // false = OFF (show per-scene boxes), true = ON (use same for all)

function setSameCharToggle(on) {
  sameCharToggleOn = on;
  var toggle = document.getElementById('storySameCharToggle');
  var dot = document.getElementById('storySameCharDot');
  if (toggle) {
    toggle.style.background = on ? '#FFB300' : '#444';
  }
  if (dot) {
    dot.style.left = on ? '18px' : '2px';
    dot.style.background = on ? '#fff' : '#888';
  }
  // Update character boxes display
  var additionalContainer = document.getElementById('additionalCharacterBoxes');
  var label1 = document.getElementById('characterBoxLabel1');
  var sceneCountEl = document.getElementById('storySceneCount');
  var sceneCount = sceneCountEl ? parseInt(sceneCountEl.value) || 1 : 1;

  if (on || sceneCount <= 1) {
    // ON: show only box 1
    if (additionalContainer) additionalContainer.innerHTML = '';
    if (label1) label1.textContent = '\u0e15\u0e31\u0e27\u0e25\u0e30\u0e04\u0e23';
  } else {
    // OFF: show all boxes per scene
    updateCharacterBoxes();
  }
}

// Expose toggle state and function globally so pipeline can read/set it
window._sameCharToggleOn = false;
window.setSameCharToggle = setSameCharToggle;

function toggleSameChar() {
  sameCharToggleOn = !sameCharToggleOn;
  window._sameCharToggleOn = sameCharToggleOn;
  setSameCharToggle(sameCharToggleOn);
}

// Event listeners
var sceneCountEl = document.getElementById('storySceneCount');
var sameCharLabel = document.getElementById('storySameCharLabel');
if (sceneCountEl) sceneCountEl.addEventListener('change', function() {
  if (sameCharToggleOn) {
    // Toggle ON → keep showing only box 1
    var label1 = document.getElementById('characterBoxLabel1');
    if (label1) label1.textContent = '\u0e15\u0e31\u0e27\u0e25\u0e30\u0e04\u0e23';
  } else {
    updateCharacterBoxes();
  }
});
if (sameCharLabel) sameCharLabel.addEventListener('click', toggleSameChar);

// ============================================================
// TOGGLE: ใช้สินค้าเดียวกันทุกฉาก
// ============================================================
var sameProductToggleOn = false;
window._sameProductToggleOn = false;

function setSameProductToggle(on) {
  sameProductToggleOn = on;
  window._sameProductToggleOn = on;
  var toggle = document.getElementById('storySameProductToggle');
  var dot = document.getElementById('storySameProductDot');
  if (toggle) toggle.style.background = on ? '#FFB300' : '#444';
  if (dot) {
    dot.style.left = on ? '18px' : '2px';
    dot.style.background = on ? '#fff' : '#888';
  }
  if (on) {
    // เมื่อเปิด → sync สินค้าจากฉาก 1 ไปทุกฉาก
    syncProductToAllScenes();
  } else {
    // เมื่อปิด → เคลียร์สินค้าฉากอื่นทั้งหมด (ยกเว้นฉาก 1)
    clearProductAllScenes();
  }
}

function clearProductAllScenes() {
  var sceneCountEl = document.getElementById('storySceneCount');
  var sceneCount = sceneCountEl ? parseInt(sceneCountEl.value) || 1 : 1;
  for (var i = 1; i <= sceneCount; i++) {
    var sel = document.getElementById('storyProduct' + i + 'Select');
    if (sel) {
      sel.value = '';
      sel.dispatchEvent(new Event('change'));
    }
  }
}

function syncProductToAllScenes() {
  var src = document.getElementById('storyProduct1Select');
  if (!src) return;
  var srcVal = src.value;
  var sceneCountEl = document.getElementById('storySceneCount');
  var sceneCount = sceneCountEl ? parseInt(sceneCountEl.value) || 1 : 1;
  for (var i = 2; i <= sceneCount; i++) {
    var dst = document.getElementById('storyProduct' + i + 'Select');
    if (dst) {
      dst.value = srcVal;
      dst.dispatchEvent(new Event('change'));
    }
  }
}

function toggleSameProduct() {
  sameProductToggleOn = !sameProductToggleOn;
  setSameProductToggle(sameProductToggleOn);
}

var sameProductLabel = document.getElementById('storySameProductLabel');
if (sameProductLabel) sameProductLabel.addEventListener('click', toggleSameProduct);

// === Run button inside Script section ===
var storyRunBtn = document.getElementById('storyRunBtn');
var storyStopBtn = document.getElementById('storyStopBtn');
if (storyRunBtn) {
  storyRunBtn.addEventListener('click', function() {
    if (window.StoryPipeline) {
      // Guard: ป้องกันกดซ้ำขณะ pipeline ทำงาน
      if (window.StoryPipeline.isRunning?.()) return;
      // Reset loop index เมื่อกด Create ใหม่
      window.StoryPipeline.storyState.loopIndex = 0;
      window.StoryPipeline.startStoryModeFlow();
      window.parent.postMessage({ type: 'STORY_STATUS', running: true }, '*');
      // สลับปุ่ม Create → Stop
      storyRunBtn.style.display = 'none';
      if (storyStopBtn) storyStopBtn.style.display = 'block';
    }
  });
}
if (storyStopBtn) {
  storyStopBtn.addEventListener('click', function() {
    if (window.StoryPipeline) {
      window.StoryPipeline.stopStoryMode();
      window.parent.postMessage({ type: 'STORY_STATUS', running: false }, '*');
    }
    // สลับปุ่ม Stop → Create
    storyStopBtn.style.display = 'none';
    if (storyRunBtn) storyRunBtn.style.display = 'block';
  });
}

// Listen for Run/Stop commands from parent React wrapper
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'STORY_RUN') {
    if (window.StoryPipeline) {
      // Guard: ป้องกันรันซ้อนผ่าน message
      if (window.StoryPipeline.isRunning?.()) return;
      window.StoryPipeline.startStoryModeFlow();
      window.parent.postMessage({ type: 'STORY_STATUS', running: true }, '*');
    }
  }
  if (e.data && e.data.type === 'STORY_STOP') {
    if (window.StoryPipeline) {
      window.StoryPipeline.stopStoryMode();
      window.parent.postMessage({ type: 'STORY_STATUS', running: false }, '*');
    }
  }
});

// Clear Log button
var clearLogBtn = document.getElementById('clearLogBtn');
if (clearLogBtn) {
  clearLogBtn.addEventListener('click', function() {
    var logContainer = document.getElementById('storyLogContainer');
    if (logContainer) {
      logContainer.innerHTML = '<p style="font-size: 12px; color: #9ca3af; padding: 4px 8px;">No activity yet</p>';
    }
    // Reset log counter
    if (typeof resetLogCounter === 'function') {
      resetLogCounter();
    }
  });
}

// Reset button with custom modal
var resetAllBtn = document.getElementById('resetAllBtn');
var resetConfirmModal = document.getElementById('resetConfirmModal');
var resetConfirmYes = document.getElementById('resetConfirmYes');
var resetConfirmNo = document.getElementById('resetConfirmNo');

if (resetAllBtn && resetConfirmModal) {
  // Show modal
  resetAllBtn.addEventListener('click', function() {
    resetConfirmModal.style.display = 'flex';
  });

  // Confirm reset
  if (resetConfirmYes) {
    resetConfirmYes.addEventListener('click', function() {
      resetConfirmModal.style.display = 'none';
      if (typeof resetAllStoryData === 'function') {
        resetAllStoryData();
      }
    });
  }

  // Cancel
  if (resetConfirmNo) {
    resetConfirmNo.addEventListener('click', function() {
      resetConfirmModal.style.display = 'none';
    });
  }

  // Close when clicking outside
  resetConfirmModal.addEventListener('click', function(e) {
    if (e.target === resetConfirmModal) {
      resetConfirmModal.style.display = 'none';
    }
  });
}

// === Concatenate All Scenes Button ===
var concatenateAllBtn = document.getElementById('concatenateAllBtn');
var resumeBtn = document.getElementById('resumeBtn');

// ฟังก์ชันเช็คว่ามีอย่างน้อย 1 ฉากที่มีวิดีโอแล้ว
function hasCompletedVideos() {
  var scenes = window.StoryPipeline?.getScenes() || [];
  return scenes.some(function(s) { return s.videoCreated === true; });
}

// ฟังก์ชันเช็คว่ามีฉากที่ยังไม่เสร็จแต่มีบางฉากที่มีรูปแล้ว
function hasIncompleteScenes() {
  var scenes = window.StoryPipeline?.getScenes() || [];
  if (scenes.length === 0) return false;
  var hasIncomplete = scenes.some(function(s) { return !s.videoCreated; });
  var hasImage = scenes.some(function(s) { return s.imageCreated; });
  return hasIncomplete && hasImage;
}

// แสดง/ซ่อนปุ่มดาวน์โหลดคลิปที่เสร็จแล้ว
function updateConcatenateButton() {
  if (!concatenateAllBtn) return;
  concatenateAllBtn.style.display = hasCompletedVideos() ? 'block' : 'none';
}

// แสดง/ซ่อนปุ่มทำต่อจากที่ค้าง
function updateResumeButton() {
  if (!resumeBtn) return;
  resumeBtn.style.display = hasIncompleteScenes() ? 'block' : 'none';
}

// อัพเดทปุ่มทั้งสอง
function updateActionButtons() {
  updateConcatenateButton();
  updateResumeButton();
}

// Event listener สำหรับปุ่มต่อฉากทั้งหมด
if (concatenateAllBtn) {
  concatenateAllBtn.addEventListener('click', function() {
    if (window.StoryPipeline && window.StoryPipeline.concatenateAllScenes) {
      // Guard: ป้องกันกดซ้ำขณะ pipeline ทำงาน
      if (window.StoryPipeline.isRunning?.()) return;
      window.StoryPipeline.concatenateAllScenes();
    } else {
      console.error('concatenateAllScenes function not found in StoryPipeline');
    }
  });
}

// Event listener สำหรับปุ่มทำต่อจากที่ค้าง
if (resumeBtn) {
  resumeBtn.addEventListener('click', function() {
    if (window.StoryPipeline && window.StoryPipeline.resumeFromLastScene) {
      // Guard: ป้องกันกดซ้ำขณะ pipeline ทำงาน
      if (window.StoryPipeline.isRunning?.()) return;
      window.StoryPipeline.resumeFromLastScene();
      // สลับปุ่ม Resume → Stop
      resumeBtn.style.display = 'none';
      if (storyStopBtn) storyStopBtn.style.display = 'block';
      if (storyRunBtn) storyRunBtn.style.display = 'none';
    } else {
      console.error('resumeFromLastScene function not found in StoryPipeline');
    }
  });
}

// Expose functions globally สำหรับเรียกจาก pipeline
window.updateActionButtons = updateActionButtons;
window.updateConcatenateButton = updateConcatenateButton;
window.updateResumeButton = updateResumeButton;

console.log('Story Mode UI loaded. Ready to use with storyboard-ai.js and story-pipeline.js');
