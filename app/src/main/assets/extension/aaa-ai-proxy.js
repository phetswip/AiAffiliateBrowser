/**
 * AAA AI Proxy — Managed API Code Subscription Helper
 * Routes AI calls through Supabase Edge Function proxy when user has active subscription.
 * Falls back to direct API calls (existing behavior) when no subscription.
 *
 * Usage:
 *   const result = await window.__aaa_proxy.proxyAICall('openai', 'gpt-4o-mini', payload);
 *   const subscribed = await window.__aaa_proxy.isSubscribed();
 */
(function () {
    'use strict';

    // ── Supabase Config (same as license.js) ──
    const SUPABASE_URL = 'https://zuyazklusqrdtnntwjwq.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1eWF6a2x1c3FyZHRubnR3andxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEzMjE1NTIsImV4cCI6MjA4Njg5NzU1Mn0.2Q8IluWFlHkz9NZrikbVoM1iQvoBN6p2uHO_bV60sWk';
    const API_BASE = SUPABASE_URL + '/functions/v1';

    const STORAGE_KEY = 'aaa_api_subscription';
    const DEVICE_KEY = 'aaa_device_id';

    // ── Device ID ──
    function getDeviceId() {
        return new Promise(resolve => {
            chrome.storage.local.get(DEVICE_KEY, result => {
                if (result[DEVICE_KEY]) {
                    resolve(result[DEVICE_KEY]);
                } else {
                    const id = crypto.randomUUID ? crypto.randomUUID()
                        : 'dev-' + Date.now() + '-' + Math.random().toString(36).substr(2, 12);
                    chrome.storage.local.set({ [DEVICE_KEY]: id });
                    resolve(id);
                }
            });
        });
    }

    // ── Storage helpers ──
    function getSubscription() {
        return new Promise(resolve => {
            chrome.storage.local.get(STORAGE_KEY, result => {
                resolve(result[STORAGE_KEY] || null);
            });
        });
    }

    function saveSubscription(data) {
        return new Promise(resolve => {
            chrome.storage.local.set({ [STORAGE_KEY]: data }, resolve);
        });
    }

    function clearSubscription() {
        return new Promise(resolve => {
            chrome.storage.local.remove(STORAGE_KEY, resolve);
        });
    }

    // ── Sync API Keys from backend response into localStorage ──
    function syncKeys(keys) {
        if (!keys) return;
        try {
            if (keys.openai) {
                localStorage.setItem('openaiKey', JSON.stringify(keys.openai));
                // key synced (log removed for security)
            }
            if (keys.gemini) {
                localStorage.setItem('geminiApiKey', JSON.stringify(keys.gemini));
                // key synced (log removed for security)
            }
            // Always set OpenAI as primary provider when keys come from subscription
            localStorage.setItem('aiProvider', JSON.stringify('openai'));
            // Sync flag for instant UI lock detection (synchronous)
            localStorage.setItem('aaa_sub_active', '1');
            console.log('[AAA Proxy] Set OpenAI as primary provider + sub active flag');
        } catch (e) {
            console.warn('[AAA Proxy] syncKeys error:', e.message);
        }
    }

    // ── Clear synced keys (when deactivating) ──
    function clearSyncedKeys() {
        try {
            // Only clear if keys were managed by subscription
            var oaKey = localStorage.getItem('openaiKey');
            var gmKey = localStorage.getItem('geminiApiKey');
            if (oaKey) localStorage.removeItem('openaiKey');
            if (gmKey) localStorage.removeItem('geminiApiKey');
            // Clear sync flag
            localStorage.removeItem('aaa_sub_active');
            console.log('[AAA Proxy] Cleared synced keys + sub active flag');
        } catch (e) {
            console.warn('[AAA Proxy] clearSyncedKeys error:', e.message);
        }
    }

    // ── Fire expiry event so UI can unlock immediately ──
    function fireExpiredEvent(reason) {
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('aaa-subscription-expired', {
                detail: { reason: reason || 'expired' }
            }));
            console.log('[AAA Proxy] Fired aaa-subscription-expired event:', reason);
        }
    }

    // ── Activate API Code ──
    async function activateCode(code) {
        const deviceId = await getDeviceId();
        const deviceName = (typeof navigator !== 'undefined' ? navigator.userAgent : 'Extension').substring(0, 100);

        const resp = await fetch(API_BASE + '/api-code-activate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ code, deviceId, deviceName })
        });

        const data = await resp.json();
        if (!resp.ok || !data.success) {
            throw new Error(data.error || 'Activation failed');
        }

        // Save subscription locally
        await saveSubscription({
            code,
            expiresAt: data.expiresAt,
            activatedAt: new Date().toISOString(),
            status: 'active'
        });

        // Auto-fill API keys from backend response
        if (data.keys) {
            syncKeys(data.keys);
            // log removed for security
        }

        return data;
    }

    // ── Validate API Code (periodic check) ──
    async function validateCode() {
        const sub = await getSubscription();
        if (!sub || !sub.code) return { valid: false, reason: 'no_subscription' };

        const deviceId = await getDeviceId();

        try {
            const resp = await fetch(API_BASE + '/api-code-validate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_ANON_KEY,
                    'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
                },
                body: JSON.stringify({ code: sub.code, deviceId })
            });

            const data = await resp.json();

            if (!data.valid) {
                // Update local status + revoke API keys immediately
                await saveSubscription({ ...sub, status: data.reason || 'invalid' });
                clearSyncedKeys();
                fireExpiredEvent(data.reason || 'invalid');
            } else if (data.keys) {
                // Sync keys on every successful validation (catch admin key changes)
                syncKeys(data.keys);
            }

            return data;
        } catch (e) {
            // Network error — allow offline grace, don't clear
            console.warn('[AAA Proxy] Validate network error:', e.message);
            return { valid: true, offline: true };
        }
    }

    // ── Check if subscription is active ──
    async function isSubscribed() {
        const sub = await getSubscription();
        if (!sub || !sub.code || sub.status !== 'active') return false;

        // Client-side expiry check
        if (sub.expiresAt && new Date(sub.expiresAt) < new Date()) {
            await saveSubscription({ ...sub, status: 'expired' });
            clearSyncedKeys();
            fireExpiredEvent('expired');
            return false;
        }

        return true;
    }

    // ── Proxy AI Call through Supabase ──
    async function proxyAICall(provider, model, payload) {
        const sub = await getSubscription();
        if (!sub || !sub.code || sub.status !== 'active') return null;

        // Client-side expiry check
        if (sub.expiresAt && new Date(sub.expiresAt) < new Date()) {
            await saveSubscription({ ...sub, status: 'expired' });
            clearSyncedKeys();
            fireExpiredEvent('expired');
            return null;
        }

        const deviceId = await getDeviceId();

        const resp = await fetch(API_BASE + '/api-relay', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
            },
            body: JSON.stringify({
                code: sub.code,
                deviceId,
                provider,
                model,
                payload
            })
        });

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));

            // Handle specific error reasons — revoke keys + notify UI
            if (errData.reason === 'expired') {
                await saveSubscription({ ...sub, status: 'expired' });
                clearSyncedKeys();
                fireExpiredEvent('expired');
            } else if (errData.reason === 'device_mismatch') {
                await saveSubscription({ ...sub, status: 'device_mismatch' });
                clearSyncedKeys();
                fireExpiredEvent('device_mismatch');
            }

            throw new Error(errData.error || errData.reason || 'Proxy error ' + resp.status);
        }

        return resp.json();
    }

    // ── Deactivate (local only) ──
    async function deactivateCode() {
        clearSyncedKeys();
        await clearSubscription();
    }

    // ── Expose globally ──
    const ctx = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined') ? self : globalThis;
    ctx.__aaa_proxy = {
        activateCode,
        validateCode,
        proxyAICall,
        isSubscribed,
        getSubscription,
        getDeviceId,
        deactivateCode,
        clearSubscription,
        syncKeys
    };

    // ── Immediate startup check — catch already-expired codes on page load ──
    (async () => {
        try {
            const sub = await getSubscription();
            if (sub && sub.code && sub.status === 'active') {
                // Client-side expiry check
                if (sub.expiresAt && new Date(sub.expiresAt) < new Date()) {
                    await saveSubscription({ ...sub, status: 'expired' });
                    clearSyncedKeys();
                    // Delay event slightly so UI listeners have time to register
                    setTimeout(() => fireExpiredEvent('expired'), 500);
                    console.log('[AAA Proxy] Startup: code already expired, keys revoked');
                }
            } else if (sub && sub.code && sub.status !== 'active') {
                // Status already non-active — ensure keys are cleared
                clearSyncedKeys();
                setTimeout(() => fireExpiredEvent(sub.status), 500);
                console.log('[AAA Proxy] Startup: code status =', sub.status, '— keys cleared');
            }
        } catch (e) {
            console.warn('[AAA Proxy] Startup check error:', e.message);
        }
    })();

    // ── Periodic validation (every 5 minutes) ──
    setInterval(async () => {
        try {
            const sub = await getSubscription();
            if (!sub || !sub.code || sub.status !== 'active') return;

            const result = await validateCode();
            if (!result.valid && !result.offline) {
                clearSyncedKeys();
                fireExpiredEvent(result.reason);
                console.log('[AAA Proxy] Subscription invalid — keys revoked:', result.reason);
            }
        } catch (e) {
            console.warn('[AAA Proxy] Periodic validation error:', e.message);
        }
    }, 5 * 60 * 1000);

    console.log('[AAA Proxy] Loaded — subscription proxy helper ready');
})();
