/**
 * fashion-mode-ui.js — Fashion Mode UI Event Handlers
 * Handles: sub-mode cards, PRODUCT SELECTOR (from IndexedDB/localStorage),
 * auto-fill, image uploads, form validation, AI storyboard, pipeline
 */
(function () {
    'use strict';

    /* ════════════════════════════════════════════
       STATE
       ════════════════════════════════════════════ */
    let _selectedMode = 'spin';
    let _selectedScriptIndex = -1;
    let _generatedScripts = [];
    let _clothingImageBase64 = null;
    let _modelImageBase64 = null;
    let _cachedProducts = null;
    let _selectedProduct = null;

    /* Default scene counts per mode */
    const DEFAULT_SCENES = {
        spin: 1, runway: 4, dance: 1, lookbook: 3, shop: 2, tryon: 1
    };

    /* ════════════════════════════════════════════
       INIT — wait for DOM
       ════════════════════════════════════════════ */
    document.addEventListener('DOMContentLoaded', function () {
        initModeCards();
        initUploadHandlers();
        initButtons();
        initLoopControls();
        loadAndPopulateProducts(); // ← Load products from IndexedDB & localStorage
        console.log('[Fashion-UI] Initialized');
    });

    /* ════════════════════════════════════════════
       PRODUCT LOADING via postMessage
       (products live in parent page's localStorage,
        not accessible from this chrome-extension:// iframe)
       ════════════════════════════════════════════ */

    /** Receive products relayed from parent (ui-customizer.js) */
    window.addEventListener('message', function (ev) {
        if (ev.data && ev.data.type === 'FASHION_PRODUCTS_DATA') {
            var products = ev.data.products || [];
            var mapped = products.map(function (p) {
                return {
                    name: p.name || '',
                    highlights: p.highlights || '',
                    imageUrl: p.imageUrl || '',
                    price: p.price || '',
                    code: p.code || ''
                };
            }).filter(function (p) { return p.name; });
            _cachedProducts = mapped;
            _populateDropdown(mapped);
            console.log('[Fashion-UI] Received ' + mapped.length + ' products from parent');
        }
    });

    /** Request products from parent page */
    function requestProductsFromParent() {
        window.parent.postMessage({ type: 'FASHION_REQUEST_PRODUCTS' }, '*');
    }

    /** Populate the product dropdown with loaded products */
    function _populateDropdown(products) {
        var selectEl = document.getElementById('fashionProductSelect');
        if (!selectEl) return;

        selectEl.innerHTML = '';

        // Default placeholder
        var defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.disabled = true;
        defaultOpt.selected = true;
        defaultOpt.textContent = '📦 เลือกสินค้า (' + products.length + ' รายการ)';
        selectEl.appendChild(defaultOpt);

        // Custom input option
        var customOpt = document.createElement('option');
        customOpt.value = 'custom';
        customOpt.textContent = '✏️ กรอกข้อมูลเอง (ไม่เลือกสินค้า)';
        selectEl.appendChild(customOpt);

        // Product options
        products.forEach(function (p, idx) {
            var opt = document.createElement('option');
            opt.value = '' + idx;
            var displayName = p.name.length > 45 ? p.name.substring(0, 45) + '...' : p.name;
            opt.textContent = (idx + 1) + '. ' + displayName;
            selectEl.appendChild(opt);
        });
    }

    /** Setup dropdown + request products on init */
    function loadAndPopulateProducts() {
        var selectEl = document.getElementById('fashionProductSelect');
        if (!selectEl) return;

        // Change handler: auto-fill everything
        selectEl.addEventListener('change', function () {
            handleProductSelection(selectEl.value);
        });

        // Request products from parent page (ui-customizer.js will relay)
        requestProductsFromParent();
    }

    /** Handle product selection → auto-fill all fields */
    function handleProductSelection(value) {
        var clothingDesc = document.getElementById('fashionClothingDesc');
        var productName = document.getElementById('fashionProductName');
        var priceEl = document.getElementById('fashionPrice');
        var clothingPreview = document.getElementById('clothingPreview');
        var clothingPlaceholder = document.getElementById('clothingPlaceholder');

        if (value === 'custom') {
            // Custom mode: unlock fields, let user type
            _selectedProduct = null;
            _clothingImageBase64 = null;
            if (clothingDesc) { clothingDesc.value = ''; clothingDesc.readOnly = false; clothingDesc.placeholder = 'เช่น: เดรสสีแดงลายดอก ผ้าชีฟอง แขนสั้น'; }
            if (productName) { productName.value = ''; productName.readOnly = false; productName.style.opacity = '1'; }
            if (priceEl) { priceEl.value = ''; priceEl.readOnly = false; priceEl.style.opacity = '1'; }
            if (clothingPreview) { clothingPreview.src = ''; clothingPreview.style.display = 'none'; }
            if (clothingPlaceholder) { clothingPlaceholder.style.display = 'flex'; clothingPlaceholder.querySelector('span:last-child').textContent = 'ไม่ได้เลือกสินค้า'; }
            _addLog('✏️ โหมดกรอกเอง — กรอกข้อมูลเสื้อผ้าด้านล่าง', 'info');
            return;
        }

        if (value === '' || !_cachedProducts) return;

        var product = _cachedProducts[parseInt(value)];
        if (!product) return;

        _selectedProduct = product;
        _addLog('📦 เลือกสินค้า: ' + product.name, 'success');

        // Auto-fill clothing description
        if (clothingDesc) {
            var desc = product.name;
            if (product.highlights) desc += '\n' + product.highlights;
            clothingDesc.value = desc;
        }

        // Auto-fill product name
        if (productName) {
            productName.value = product.name;
        }

        // Auto-fill price
        if (priceEl && product.price) {
            priceEl.value = product.price;
        }

        // Auto-fill product image
        if (product.imageUrl) {
            if (product.imageUrl.startsWith('data:')) {
                // Already a data URL
                _clothingImageBase64 = product.imageUrl;
                if (clothingPreview) {
                    clothingPreview.src = product.imageUrl;
                    clothingPreview.style.display = 'block';
                }
                if (clothingPlaceholder) clothingPlaceholder.style.display = 'none';
            } else {
                // URL → fetch → data URL
                (function (url) {
                    fetch(url)
                        .then(function (resp) { return resp.blob(); })
                        .then(function (blob) {
                            var reader = new FileReader();
                            reader.onloadend = function () {
                                _clothingImageBase64 = reader.result;
                                if (clothingPreview) {
                                    clothingPreview.src = reader.result;
                                    clothingPreview.style.display = 'block';
                                }
                                if (clothingPlaceholder) clothingPlaceholder.style.display = 'none';
                            };
                            reader.readAsDataURL(blob);
                        })
                        .catch(function (err) {
                            console.error('[Fashion-UI] Failed to load product image:', err);
                            if (clothingPreview) {
                                clothingPreview.src = url;
                                clothingPreview.style.display = 'block';
                            }
                            if (clothingPlaceholder) clothingPlaceholder.style.display = 'none';
                        });
                })(product.imageUrl);
            }
        }
    }

    /* ════════════════════════════════════════════
       SUB-MODE CARDS
       ════════════════════════════════════════════ */
    function initModeCards() {
        var cards = document.querySelectorAll('.mode-card');
        cards.forEach(function (card) {
            card.addEventListener('click', function () {
                cards.forEach(function (c) { c.classList.remove('active'); });
                card.classList.add('active');
                _selectedMode = card.getAttribute('data-mode');

                var sceneSelect = document.getElementById('fashionSceneCount');
                if (sceneSelect) {
                    sceneSelect.value = String(DEFAULT_SCENES[_selectedMode] || 1);
                }

                console.log('[Fashion-UI] Selected mode:', _selectedMode);
            });
        });
    }

    /* ════════════════════════════════════════════
       IMAGE UPLOAD HANDLERS (Model only now)
       ════════════════════════════════════════════ */
    function initUploadHandlers() {
        // Model upload only (clothing is auto from product)
        _setupUpload(
            'modelUploadArea', 'modelInput', 'modelPreview',
            'modelPlaceholder', 'removeModel',
            function (base64) { _modelImageBase64 = base64; },
            function () { _modelImageBase64 = null; }
        );
    }

    function _setupUpload(areaId, inputId, previewId, placeholderId, removeBtnId, onSet, onRemove) {
        var area = document.getElementById(areaId);
        var input = document.getElementById(inputId);
        var preview = document.getElementById(previewId);
        var placeholder = document.getElementById(placeholderId);
        var removeBtn = document.getElementById(removeBtnId);

        if (area && input) {
            area.addEventListener('click', function () { input.click(); });
            input.addEventListener('change', function (e) {
                var file = e.target.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function (ev) {
                    if (preview) {
                        preview.src = ev.target.result;
                        preview.style.display = 'block';
                    }
                    if (placeholder) placeholder.style.display = 'none';
                    if (removeBtn) removeBtn.style.display = 'block';
                    if (onSet) onSet(ev.target.result);
                };
                reader.readAsDataURL(file);
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                if (preview) { preview.src = ''; preview.style.display = 'none'; }
                if (placeholder) placeholder.style.display = 'flex';
                removeBtn.style.display = 'none';
                if (input) input.value = '';
                if (onRemove) onRemove();
            });
        }
    }

    /* ════════════════════════════════════════════
       BUTTONS
       ════════════════════════════════════════════ */
    function initButtons() {
        var createBtn = document.getElementById('fashionCreateBtn');
        if (createBtn) {
            createBtn.addEventListener('click', handleCreateStoryboard);
        }

        var runBtn = document.getElementById('fashionRunBtn');
        if (runBtn) {
            runBtn.addEventListener('click', handleRunPipeline);
        }

        var stopBtn = document.getElementById('fashionStopBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', function () {
                if (window.__fashionPipeline) {
                    window.__fashionPipeline.stopPipeline();
                }
            });
        }

        var resetBtn = document.getElementById('fashionResetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', handleReset);
        }

        var clearLogBtn = document.getElementById('fashionClearLogBtn');
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', function () {
                var logContainer = document.getElementById('fashionLogContainer');
                if (logContainer) {
                    logContainer.innerHTML = '<p style="font-size: 12px; color: var(--text-muted); padding: 4px 8px;">No activity yet</p>';
                }
            });
        }
    }

    /* ════════════════════════════════════════════
       LOOP CONTROLS
       ════════════════════════════════════════════ */
    function initLoopControls() {
        var loopCheckbox = document.getElementById('fashionLoopEnabled');
        var loopOptions = document.getElementById('fashionLoopOptions');

        if (loopCheckbox && loopOptions) {
            loopCheckbox.addEventListener('change', function () {
                loopOptions.style.display = loopCheckbox.checked ? 'flex' : 'none';
            });
        }
    }

    /* ════════════════════════════════════════════
       CREATE STORYBOARD (AI)
       ════════════════════════════════════════════ */
    async function handleCreateStoryboard() {
        var clothingDesc = (document.getElementById('fashionClothingDesc')?.value || '').trim();
        var postMethod = document.getElementById('fashionPostMethod')?.value;
        var productSelect = document.getElementById('fashionProductSelect')?.value;

        // Validation — relaxed: need either product or manual clothing desc
        var errors = [];
        if (!clothingDesc && !_clothingImageBase64 && !productSelect) errors.push('• เลือกสินค้า หรือ กรอกข้อมูลเสื้อผ้า');
        if (!postMethod) errors.push('• เลือกวิธีลงคลิป');

        if (errors.length > 0) {
            _addLog('❌ กรุณากรอก: ' + errors.join(', '), 'error');
            alert('กรุณากรอกข้อมูลให้ครบ:\n' + errors.join('\n'));
            return;
        }

        var config = _collectConfig();

        var createBtn = document.getElementById('fashionCreateBtn');
        if (createBtn) {
            createBtn.disabled = true;
            createBtn.textContent = '⏳ กำลังสร้าง Script...';
        }

        _addLog('🎨 กำลังสร้าง Fashion Storyboard...', 'info');

        try {
            var FA = window.__fashionAI;
            if (!FA) throw new Error('fashion-ai.js not loaded');

            _generatedScripts = await FA.generateStoryboard(config);

            if (!_generatedScripts || _generatedScripts.length === 0) {
                throw new Error('ไม่สามารถสร้าง Script ได้');
            }

            _addLog('✅ สร้าง Script ' + _generatedScripts.length + ' แบบ', 'success');
            _renderScriptCards(_generatedScripts);

            var scriptSection = document.getElementById('fashionScriptSection');
            if (scriptSection) scriptSection.style.display = 'block';

        } catch (err) {
            _addLog('❌ สร้าง Script ล้มเหลว: ' + err.message, 'error');
            console.error('[Fashion-UI] Storyboard error:', err);
        } finally {
            if (createBtn) {
                createBtn.disabled = false;
                createBtn.textContent = '🎨 Create Fashion Storyboard (AI คิดให้)';
            }
        }
    }

    /* ════════════════════════════════════════════
       RENDER SCRIPT CARDS  
       ════════════════════════════════════════════ */
    function _renderScriptCards(scripts) {
        var container = document.getElementById('fashionScriptList');
        if (!container) return;
        container.innerHTML = '';
        _selectedScriptIndex = -1;

        scripts.forEach(function (script, idx) {
            var card = document.createElement('div');
            card.style.cssText = 'padding: 12px; background: rgba(8, 14, 28, 0.5); border: 2px solid transparent; border-radius: 12px; cursor: pointer; transition: all 0.2s;';
            card.setAttribute('data-script-idx', idx);

            var sceneSummary = (script.scenes || []).map(function (s, i) {
                return '<div style="font-size: 10px; color: rgba(255,255,255,0.4); padding: 2px 0;">Scene ' + (i + 1) + ': ' + (s.scene_name || s.caption_th || '') + '</div>';
            }).join('');

            card.innerHTML =
                '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
                '<div style="font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.9);">' + (idx + 1) + '. ' + (script.title || 'Script ' + (idx + 1)) + '</div>' +
                '<div style="font-size: 10px; color: rgba(168, 85, 247, 0.7);">' + (script.scenes?.length || 0) + ' ฉาก</div>' +
                '</div>' +
                '<div style="font-size: 11px; color: rgba(255,255,255,0.5); margin-bottom: 4px;">' + (script.concept || '') + '</div>' +
                sceneSummary;

            card.addEventListener('click', function () {
                container.querySelectorAll('[data-script-idx]').forEach(function (c) {
                    c.style.borderColor = 'transparent';
                });
                card.style.borderColor = '#a855f7';
                _selectedScriptIndex = idx;
            });

            container.appendChild(card);
        });

        if (scripts.length > 0) {
            var firstCard = container.querySelector('[data-script-idx="0"]');
            if (firstCard) {
                firstCard.style.borderColor = '#a855f7';
                _selectedScriptIndex = 0;
            }
        }
    }

    /* ════════════════════════════════════════════
       RUN PIPELINE
       ════════════════════════════════════════════ */
    async function handleRunPipeline() {
        if (_selectedScriptIndex < 0 || !_generatedScripts[_selectedScriptIndex]) {
            _addLog('⚠️ กรุณาเลือก Script ก่อน', 'warning');
            return;
        }

        var FPipe = window.__fashionPipeline;
        if (!FPipe) {
            _addLog('❌ fashion-pipeline.js not loaded', 'error');
            return;
        }

        var config = _collectConfig();
        var selectedScript = _generatedScripts[_selectedScriptIndex];

        var loopEnabled = document.getElementById('fashionLoopEnabled')?.checked || false;
        FPipe.state.loopEnabled = loopEnabled;
        if (loopEnabled) {
            FPipe.state.loopCount = parseInt(document.getElementById('fashionLoopCount')?.value) || 3;
            FPipe.state.loopDelay = parseInt(document.getElementById('fashionLoopDelay')?.value) || 30;
            FPipe.state.loopIndex = 0;
        }

        await FPipe.runPipeline(config, selectedScript);
    }

    /* ════════════════════════════════════════════
       RESET
       ════════════════════════════════════════════ */
    function handleReset() {
        // Reset form fields
        var formEls = ['fashionClothingDesc', 'fashionProductName', 'fashionPrice',
            'fashionExtraCaption', 'fashionExtraDetails', 'fashionModelDesc'];
        formEls.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });

        // Reset selects
        var selectResets = { fashionCategory: 'dress', fashionLocation: 'studio', fashionTone: 'natural', fashionGender: 'female', fashionSceneCount: '1', fashionAspectRatio: '9:16' };
        Object.keys(selectResets).forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = selectResets[id];
        });

        // Reset product selector
        var productSelect = document.getElementById('fashionProductSelect');
        if (productSelect) productSelect.selectedIndex = 0;
        _selectedProduct = null;
        _clothingImageBase64 = null;

        // Reset post method
        var postMethodEl = document.getElementById('fashionPostMethod');
        if (postMethodEl) postMethodEl.selectedIndex = 0;

        // Reset mode cards
        document.querySelectorAll('.mode-card').forEach(function (c) { c.classList.remove('active'); });
        var spinCard = document.querySelector('.mode-card[data-mode="spin"]');
        if (spinCard) spinCard.classList.add('active');
        _selectedMode = 'spin';

        // Clear clothing preview
        var clothingPreview = document.getElementById('clothingPreview');
        var clothingPlaceholder = document.getElementById('clothingPlaceholder');
        if (clothingPreview) { clothingPreview.src = ''; clothingPreview.style.display = 'none'; }
        if (clothingPlaceholder) clothingPlaceholder.style.display = 'flex';

        // Clear model upload
        var modelPreview = document.getElementById('modelPreview');
        var modelPlaceholder = document.getElementById('modelPlaceholder');
        var removeModel = document.getElementById('removeModel');
        var modelInput = document.getElementById('modelInput');
        if (modelPreview) { modelPreview.src = ''; modelPreview.style.display = 'none'; }
        if (modelPlaceholder) modelPlaceholder.style.display = 'flex';
        if (removeModel) removeModel.style.display = 'none';
        if (modelInput) modelInput.value = '';
        _modelImageBase64 = null;

        // Reset product name/price readonly style
        var productNameEl = document.getElementById('fashionProductName');
        var priceEl = document.getElementById('fashionPrice');
        if (productNameEl) { productNameEl.readOnly = true; productNameEl.style.opacity = '0.8'; }
        if (priceEl) { priceEl.readOnly = true; priceEl.style.opacity = '0.8'; }

        // Clear scripts
        _generatedScripts = [];
        _selectedScriptIndex = -1;
        var scriptSection = document.getElementById('fashionScriptSection');
        if (scriptSection) scriptSection.style.display = 'none';
        var scriptList = document.getElementById('fashionScriptList');
        if (scriptList) scriptList.innerHTML = '';

        // Hide progress
        var progressSection = document.getElementById('fashionProgressSection');
        if (progressSection) progressSection.style.display = 'none';

        // Reset pipeline
        if (window.__fashionPipeline) {
            window.__fashionPipeline.resetPipeline();
        }

        // Reset loop
        var loopCheckbox = document.getElementById('fashionLoopEnabled');
        if (loopCheckbox) loopCheckbox.checked = false;
        var loopOptions = document.getElementById('fashionLoopOptions');
        if (loopOptions) loopOptions.style.display = 'none';

        // Clear log
        var logContainer = document.getElementById('fashionLogContainer');
        if (logContainer) {
            logContainer.innerHTML = '<p style="font-size: 12px; color: var(--text-muted); padding: 4px 8px;">No activity yet</p>';
        }

        // Show run button
        var runBtn = document.getElementById('fashionRunBtn');
        var stopBtn = document.getElementById('fashionStopBtn');
        if (runBtn) runBtn.style.display = 'block';
        if (stopBtn) stopBtn.style.display = 'none';

        _addLog('🔄 Reset ทุกอย่างแล้ว', 'info');
    }

    /* ════════════════════════════════════════════
       HELPERS
       ════════════════════════════════════════════ */
    function _collectConfig() {
        return {
            subMode: _selectedMode,
            clothingDesc: (document.getElementById('fashionClothingDesc')?.value || '').trim(),
            category: document.getElementById('fashionCategory')?.value || 'dress',
            location: document.getElementById('fashionLocation')?.value || 'studio',
            tone: document.getElementById('fashionTone')?.value || 'natural',
            modelGender: document.getElementById('fashionGender')?.value || 'female',
            modelDesc: (document.getElementById('fashionModelDesc')?.value || '').trim(),
            sceneCount: parseInt(document.getElementById('fashionSceneCount')?.value) || 1,
            aspectRatio: document.getElementById('fashionAspectRatio')?.value || '9:16',
            postTiktok: document.getElementById('fashionPostMethod')?.value || 'download',
            productName: (document.getElementById('fashionProductName')?.value || '').trim(),
            price: (document.getElementById('fashionPrice')?.value || '').trim(),
            extraCaption: (document.getElementById('fashionExtraCaption')?.value || '').trim(),
            extraDetails: (document.getElementById('fashionExtraDetails')?.value || '').trim(),
            clothingImageBase64: _clothingImageBase64,
            modelImageBase64: _modelImageBase64,
            selectedProduct: _selectedProduct
        };
    }

    function _addLog(message, type) {
        if (window.__fashionPipeline && window.__fashionPipeline.addFashionLog) {
            window.__fashionPipeline.addFashionLog(message, type);
        } else {
            console.log('[Fashion-UI][' + type + '] ' + message);
        }
    }

    console.log('[Fashion] UI handlers loaded');
})();
