(() => {
    "use strict";
    console.log('[MyWAppConnector] Initializing...');

    // Debounce and
    // Global state for the connector
    let storeCheckInterval = null;
    let selectors = { // These might be dynamically set later by content script if needed
        LIBHOOK_WEBPACK: "webpackChunkwhatsapp_web_client", // Default, might need to check for webpackJsonp too
        // LIBHOOK_WEBPACK_NEW: "LWM", // Placeholder from fl.js, may refer to a more complex structure
        // SHELL_LOADED_INDICATOR: "div[data-asset-chat-background-dark]" // Example selector
    };
    let isStoreInitialized = false;

    // The core definitions of WhatsApp internal modules we need to find
    // Adapted from the 't' array in the J(r) function of fl.js
    const moduleDefinitions = [
        { id: "Store", conditions: (m) => {
            const cand = m?.default ?? m;
            if (!cand) return null;

            // 1. Classic structure – both Chat & Msg collections
            if (cand.Chat && cand.Msg) return cand;

            // 2. Variants where Chat exists but Msg is nested deeper or renamed; we also accept WidFactory + sendTextMsgToChat combo
            if (cand.Chat && Object.keys(cand.Chat).length > 0) return cand;

            // 3. Some builds expose the collections under a .models or .conn sub-object. Dive one level.
            for (const k of Object.keys(cand)) {
                const inner = cand[k];
                if (!inner || typeof inner !== 'object') continue;
                if (inner.Chat && inner.Msg) return inner;

                // Fallback heuristic: key contains 'Chat' and sibling key contains 'Msg'
                const keys = Object.keys(inner);
                const hasChatLike = keys.some(key => key.toLowerCase().includes('chat'));
                const hasMsgLike = keys.some(key => key.toLowerCase().includes('msg'));
                if (hasChatLike && hasMsgLike) return inner;
            }

            // 4. Very defensive – candidate itself has keys that *look* like collections (chat / msg) even if not exact
            const keysTop = Object.keys(cand);
            if (keysTop.some(k => k.toLowerCase().includes('chat')) && keysTop.some(k => k.toLowerCase().includes('msg'))) {
                return cand;
            }

            return null;
        } },
        { id: "MediaCollection", conditions: m => m.default && m.default.prototype && (typeof m.default.prototype.processFiles !== 'undefined' || typeof m.default.prototype.processAttachments !== 'undefined') ? m.default : null },
        { id: "MediaProcess", conditions: m => (m?.BLOB || m?.default?.BLOB) ? (m.default ?? m) : null }, // Might need refinement
        { id: "Wap", conditions: m => m.createGroup ? m : null }, // For group creation, etc.
        { id: "SendTextMsgToChat", conditions: m => m.sendTextMsgToChat ? m.sendTextMsgToChat : null },
        { id: "SendSeen", conditions: m => m.sendSeen ? m : null },
        { id: "addAndSendMsgToChat", conditions: m => m.addAndSendMsgToChat ? m : null },
        { id: "UserConstructor", conditions: m => m.default && m.default.prototype && m.default.prototype.isServer && m.default.prototype.isUser ? m.default : null }, // WAsender uses this for WidFactory
        { id: "WidFactory", conditions: m => m.isWidlike && m.createWid && m.createWidFromWidLike ? m : null }, // More direct
        { id: "Participants", conditions: m => m.addParticipants && m.removeParticipants && m.promoteParticipants && m.demoteParticipants ? m : null},
        { id: "Cmd", conditions: m => m.Cmd ? m : null },
        // Add more definitions from fl.js's 't' array as needed, especially those related to media sending if not covered by MediaCollection
        // For example, things related to 'MediaUpload', 'UploadUtils', 'WWebJS.processMediaData' if that's a separate module.
        // For now, focusing on what seems essential for MediaCollection and Chat.
    ];

    function findAndExposeModules(webpackModules) {
        if (isStoreInitialized) return;
        console.log('[MyWAppConnector] findAndExposeModules: Starting. Received webpackModules type:', typeof webpackModules);

        if (typeof webpackModules !== 'object' || webpackModules === null) {
            console.error('[MyWAppConnector] findAndExposeModules: webpackModules is not a valid object.');
            return;
        }
        const moduleKeys = Object.keys(webpackModules);
        console.log(`[MyWAppConnector] findAndExposeModules: Iterating over approx ${moduleKeys.length} modules.`);

        let S = window.MyWAppStore || {}; 
        let foundCount = 0;
        let checkedCount = 0;

        try {
            for (const modId of moduleKeys) { // Iterate using keys for potentially better performance/safety
                checkedCount++;
                const currentModule = webpackModules[modId];
                let candidates = [];
                if (typeof currentModule === 'object' && currentModule !== null) {
                    candidates.push(currentModule);
                } else if (typeof currentModule === 'function') {
                    // Some WA modules export a factory function that returns the actual object when executed with no args.
                    // Calling arbitrary functions can be risky, so only attempt if the function takes 0 arguments.
                    try {
                        if (currentModule.length === 0) {
                            const res = currentModule();
                            if (res && typeof res === 'object') {
                                candidates.push(res);
                            }
                        }
                    } catch(e){ /* ignore errors from invoking unexpected factories */ }
                }

                candidates.forEach((cand) => {
                    moduleDefinitions.forEach(definition => {
                        if (S[definition.id]) return;
                        let conditionResult = null;
                        try {
                            conditionResult = definition.conditions(cand);
                        } catch(e){ /* ignore condition errors */ }
                        if (conditionResult !== null) {
                            S[definition.id] = conditionResult;
                            foundCount++;
                            console.log(`[MyWAppConnector] Found module: ${definition.id} in modId: ${modId}`);
                        }
                    });
                });
            }
        } catch (e) {
            console.error('[MyWAppConnector] Error during module iteration:', e);
        }
        console.log(`[MyWAppConnector] findAndExposeModules: Finished iteration. Checked ${checkedCount} modules. Found ${foundCount} new modules.`);

        // Success criteria: we have at least the main Store object. The other helpers can be
        // filled in later once they become available.
        if (S.Store) {
            window.MyWAppStore = S;
            // Also expose a legacy-compatible global so that other helper scripts (e.g., store-media-helper.js)
            // that still expect window.Store can work without modification.
            if (!window.Store) {
                window.Store = S.Store;
                console.log('[MyWAppConnector] window.Store global exposed for legacy helpers.');
            }
            isStoreInitialized = true;
            console.log('[MyWAppConnector] MyWAppStore initialized:', window.MyWAppStore);
            
            // Add any convenience functions or patches like fl.js does (e.g., Chat._find)
            if (window.MyWAppStore.Store && window.MyWAppStore.Store.Chat && !window.MyWAppStore.Store.Chat._find) {
                 window.MyWAppStore.Store.Chat._find = (wid) => {
                    const chat = window.MyWAppStore.Store.Chat.get(wid);
                    return Promise.resolve(chat || { id: wid }); // Simplified fallback
                };
                console.log('[MyWAppConnector] Patched Store.Chat._find');
            }

            // Potentially define WWebJS-like utilities if needed by sendAttachment logic
            // window.MyWApp_WWebJS = { ... }; 
            // ... based on WWebJS functions in fl.js if they are essential for media sending

            // Notify content script that the LibHook (this script) is ready
            // This would be via the C3-like channel if we fully implement it,
            // or a simpler custom event for now.
            document.dispatchEvent(new CustomEvent('MyWAppConnectorReady'));
            console.log('[MyWAppConnector] MyWAppConnectorReady event dispatched.');

            if (storeCheckInterval) {
                clearInterval(storeCheckInterval);
                storeCheckInterval = null;
            }
            return true;
        }
        console.log('[MyWAppConnector] Not all critical modules found yet. Found:', S);
        return false;
    }

    function attemptWebpackStoreExtraction() {
        if (isStoreInitialized) return;
        console.log("[MyWAppConnector] Attempting webpack store extraction...");

        // Try to resolve the actual webpack chunk holder.  New WA builds sometimes
        // rename the `webpackChunkwhatsapp_web_client` global to something with a
        // hash suffix (e.g. `webpackChunkwhatsapp_web_client_123abc`).  If the
        // hard-coded selector fails, scan `window` for any property that starts
        // with `webpackChunk` or the legacy `webpackJsonp`.

        let webpackInstance = window[selectors.LIBHOOK_WEBPACK];

        if (!webpackInstance) {
            const dynamicKey = Object.keys(window).find(k => {
                try {
                    const potentialWebpack = window[k];
                    // Check if it's an array with a push method (like webpackChunk)
                    if (Array.isArray(potentialWebpack) && typeof potentialWebpack.push === 'function') {
                        // Further heuristic: check if it contains arrays, and those arrays contain objects (modules)
                        // This is a more robust check than just string prefixes
                        const hasModuleLikeContent = potentialWebpack.some(item =>
                            Array.isArray(item) && item.some(subItem => subItem !== null && !Array.isArray(subItem))
                        );
                        if (hasModuleLikeContent) {
                            console.log(`[MyWAppConnector] Found potential webpack-like array at window.${k}. Value:`, potentialWebpack);
                            return true;
                        }
                    }
                } catch (e) {
                    // Ignore errors during inspection of window properties
                }
                return false;
            });
            if (dynamicKey) {
                console.log(`[MyWAppConnector] Detected dynamic webpack chunk key: ${dynamicKey}`);
                selectors.LIBHOOK_WEBPACK = dynamicKey;
                webpackInstance = window[dynamicKey];
            } else {
                console.warn('[MyWAppConnector] No global webpack chunk array found via dynamic scan.');
            }
        }

        // FAST PATH: if WhatsApp has already exposed the universal __webpack_require__ or legacy window.require
        if (typeof window.__webpack_require__ === 'function' && window.__webpack_require__.m) {
            try {
                console.log('[MyWAppConnector] Using global __webpack_require__ to extract modules.');
                const modulesRaw = {};
                let collected = 0;
                for (const moduleId in window.__webpack_require__.m) {
                    try {
                        modulesRaw[moduleId] = window.__webpack_require__(moduleId);
                        collected++;
                    } catch(e) { /* ignore */ }
                }
                console.log(`[MyWAppConnector] __webpack_require__ path: collected exports from ${collected} modules.`);
                if (findAndExposeModules(modulesRaw)) return; // success
            } catch(err) { console.error('[MyWAppConnector] __webpack_require__ extraction failed:', err); }
        }

        // Legacy require() fallback
        // FAST PATH: if WhatsApp has already exposed the universal require fn (observed in older builds and still used by WAsender)
        if (typeof window.require === 'function' && window.require.m && Object.keys(window.require.m).length) {
            try {
                console.log('[MyWAppConnector] Using global window.require to extract modules.');
                const modulesFromRequire = {};
                let loadedCount = 0;
                for (const moduleId in window.require.m) {
                    try {
                        if (Object.prototype.hasOwnProperty.call(window.require.m, moduleId)) {
                            // Prefer cached exports if available
                            if (window.require.c && window.require.c[moduleId]) {
                                modulesFromRequire[moduleId] = window.require.c[moduleId].exports;
                            } else {
                                modulesFromRequire[moduleId] = window.require(moduleId);
                            }
                            loadedCount++;
                        }
                    } catch(e){ /* ignore individual failures */ }
                }
                console.log(`[MyWAppConnector] window.require path: collected exports from ${loadedCount} modules.`);
                if (findAndExposeModules(modulesFromRequire)) {
                    return; // success
                }
            } catch(requireErr) {
                console.error('[MyWAppConnector] Error while using window.require extraction:', requireErr);
            }
        }

        // Install a push-hook so every new chunk that WhatsApp loads at runtime gets inspected automatically.
        try {
            if (webpackInstance && typeof webpackInstance.push === 'function' && !webpackInstance.__waPushHooked) {
                const origPush = webpackInstance.push.bind(webpackInstance);
                webpackInstance.push = function(chunk) {
                    const res = origPush(chunk);
                    try {
                        if (Array.isArray(chunk)) {
                            // Extract modules object (any plain-object element in the tuple)
                            const modulesObj = chunk.find((el) => el && typeof el === 'object' && !Array.isArray(el));
                            if (modulesObj && Object.keys(modulesObj).length) {
                                findAndExposeModules(modulesObj);
                            }
                        }
                    } catch(e) { /* ignore extraction errors */ }
                    return res;
                };
                webpackInstance.__waPushHooked = true;
                console.log('[MyWAppConnector] webpackInstance.push hooked for live module introspection.');
            }
        } catch(hookErr) {
            console.error('[MyWAppConnector] Error while hooking webpackInstance.push:', hookErr);
        }

        console.log("[MyWAppConnector] webpackInstance type:", typeof webpackInstance, "Value:", webpackInstance);

        if (typeof webpackInstance === 'function') { 
            try {
                console.log("[MyWAppConnector] Trying webpackJsonp-style access...");
                webpackInstance([], { parasite: (r, e, t) => {
                    console.log('[MyWAppConnector] webpackJsonp callback: received modules type:', typeof t);
                    if (t) console.log('[MyWAppConnector] webpackJsonp callback: module count:', Object.keys(t).length);
                    findAndExposeModules(t);
                } }, ["parasite"]);
            } catch (e) {
                console.error('[MyWAppConnector] Error with webpackJsonp-style access:', e);
            }
        } else if (typeof webpackInstance === 'object' && typeof webpackInstance.push === 'function') { // Newer webpackChunk style
            try {
                console.log("[MyWAppConnector] Trying webpackChunk-style access... Pushing function with ID [\"parasite\"]");
                webpackInstance.push([
                    ["parasite"], // Using the exact ID seen in fl.js logs/analysis
                    {},
                    function(webpackRequire, currentChunk, thirdArg) { 
                        console.log('[MyWAppConnector] INSIDE webpackChunk.push CALLBACK!');
                        let modulesToSearch = null;

                        if (typeof webpackRequire === 'function' && typeof webpackRequire.m === 'object' && webpackRequire.m !== null) {
                            console.log('[MyWAppConnector] Callback: webpackRequire.m found. Attempting to load modules from it.');
                            modulesToSearch = {};
                            let loadedCount = 0;
                            let failedLoadCount = 0;
                            for (const moduleId in webpackRequire.m) {
                                try {
                                    // Only try to require if it's own property and perhaps if it hasn't been loaded yet in cache (webpackRequire.c)
                                    if (Object.prototype.hasOwnProperty.call(webpackRequire.m, moduleId)) {
                                        // Check cache first - webpackRequire.c contains already loaded modules
                                        if (webpackRequire.c && webpackRequire.c[moduleId]) {
                                            modulesToSearch[moduleId] = webpackRequire.c[moduleId].exports;
                                        } else {
                                            // If not in cache, execute the factory function to load it
                                            modulesToSearch[moduleId] = webpackRequire(moduleId);
                                        }
                                        loadedCount++;
                                    }
                                } catch (e) {
                                    // It's common for some modules to fail to load if their dependencies aren't met yet, or if they are placeholders
                                    // console.warn(`[MyWAppConnector] Failed to require module ${moduleId}:`, e.message);
                                    failedLoadCount++;
                                }
                            }
                            console.log(`[MyWAppConnector] Callback: Loaded ${loadedCount} modules via webpackRequire.m, ${failedLoadCount} failures.`);
                        } else if (typeof thirdArg === 'object' && thirdArg !== null && Object.keys(thirdArg).length > 0) {
                            console.log('[MyWAppConnector] Callback: Third argument appears to be the modules object directly.');
                            modulesToSearch = thirdArg;
                        } else {
                            console.warn('[MyWAppConnector] Callback: Could not reliably access webpack modules via webpackRequire.m or third argument.');
                        }

                        if (modulesToSearch && Object.keys(modulesToSearch).length > 0) {
                            console.log('[MyWAppConnector] Callback: modulesToSearch populated. Total modules to search (approx):', Object.keys(modulesToSearch).length);
                            findAndExposeModules(modulesToSearch);
                        } else {
                            console.warn('[MyWAppConnector] Callback: modulesToSearch is empty. Skipping findAndExposeModules.');
                        }
                    }
                ]);
                console.log("[MyWAppConnector] Function pushed to webpackChunk.");
            } catch (e) {
                console.error('[MyWAppConnector] Error with webpackChunk-style access:', e);
            }
            // NEW FALLBACK: If .push is still Array.prototype.push (not yet hooked by Webpack) we can still
            // scrape the modules that have already been loaded into the array entries themselves.
            try {
                if (webpackInstance.push === Array.prototype.push) {
                    console.log('[MyWAppConnector] Detected native Array.push – attempting direct chunk inspection fallback.');
                    const modulesFromChunks = {};
                    let inspectedChunks = 0;
                    webpackInstance.forEach((chunkTuple) => {
                        if (!Array.isArray(chunkTuple)) return;
                        inspectedChunks++;
                        // Iterate through every item in the tuple – WA sometimes puts the modules object at index 2 or 3.
                        chunkTuple.forEach((maybeObj) => {
                            if (maybeObj && typeof maybeObj === 'object' && !Array.isArray(maybeObj)) {
                                Object.assign(modulesFromChunks, maybeObj);
                            }
                        });
                    });
                    console.log('[MyWAppConnector] Fallback: inspected ' + inspectedChunks + ' existing chunks. Collected ~' + Object.keys(modulesFromChunks).length + ' raw factory modules.');

                    // If the universal require is available we can resolve each factory to its real exports – this drastically
                    // improves the chances of matching our heuristics on modern WhatsApp builds where simply looking at the
                    // factory functions won\'t expose any of the Chat / MediaCollection objects.
                    const resolvedExports = {};
                    if (typeof window.__webpack_require__ === 'function') {
                        Object.keys(modulesFromChunks).forEach((modId) => {
                            try {
                                resolvedExports[modId] = window.__webpack_require__(modId);
                            } catch (e) {
                                /* some modules might throw if executed prematurely – ignore */
                            }
                        });
                        console.log('[MyWAppConnector] Fallback: resolved exports for', Object.keys(resolvedExports).length, 'modules via __webpack_require__.');
                    } else {
                        // If we cannot resolve, at least pass the raw factories so that future retries (once __webpack_require__ exists)
                        // can pick them up again.
                        Object.assign(resolvedExports, modulesFromChunks);
                    }

                    if (Object.keys(resolvedExports).length) {
                        findAndExposeModules(resolvedExports);
                    }
                }
            } catch (fallbackErr) {
                console.error('[MyWAppConnector] Fallback chunk inspection failed:', fallbackErr);
            }
        } else {
             // Fallback: try the LWM / importNamespace approach from fl.js if applicable
             // This part is more complex and might require the exact LWM string from fl.js's selectors
             // const lwmSelector = _.selectors[g.LIBHOOK_WEBPACK_NEW] // from fl.js
             // if (window.importNamespace && lwmSelector) { ... }
            console.warn("[MyWAppConnector] Webpack instance not found or not in a known format.");
        }
    }

    function initialPoll() {
        if (isStoreInitialized) {
            if (storeCheckInterval) clearInterval(storeCheckInterval);
            return;
        }
        // Try a more general selector for the main app panel / chat list area
        // The old selector was 'div[data-testid="chat-list-header"]'
        // WAsender's fl.js uses a dynamic selector via _.selectors[g.SHELL_LOADED_INDICATOR]
        // Let's try a common one: '#pane-side' or '#app div[role="application"]'. 
        // '#pane-side' is often the container for the chat list.
        if (document.querySelector('#pane-side') || document.querySelector('#app div[data-asset-chat-background-dark]')) { 
            console.log('[MyWAppConnector] WhatsApp shell appears loaded (found #pane-side or #app div[data-asset-chat-background-dark]). Attempting extraction.');
            attemptWebpackStoreExtraction();
            // If still not initialized after first attempt, subsequent polls will try again
            if (isStoreInitialized && storeCheckInterval) {
                 clearInterval(storeCheckInterval);
                 storeCheckInterval = null;
            }
        } else {
            console.log('[MyWAppConnector] WhatsApp shell not detected yet...');
        }
    }

    // Start polling
    // More robust would be to wait for a specific event from WA page or content script.
    // For now, simple polling like fl.js.
    if (!isStoreInitialized) {
        console.log('[MyWAppConnector] Starting polling for WA readiness.');
        storeCheckInterval = setInterval(initialPoll, 2000); // Poll every 2 seconds
        initialPoll(); // Try immediately too
    }

    /*
     * LAST-DITCH FALLBACK – some WA builds attach the Store object directly on a
     * random global (e.g. via webpack runtime) and never expose the chunk array
     * we hook into.  Every five seconds we therefore iterate over all enumerable
     * window properties and inspect the value.  If it looks like the canonical
     * Store (has Chat & Msg collections) we use it.
     */
    const bruteScanGlobals = () => {
        if (isStoreInitialized) return;
        try {
            for (const key of Object.keys(window)) {
                // Skip obvious primitives / DOM nodes quickly
                if (!key || key.length < 3) continue;
                const val = window[key];
                if (!val || typeof val !== 'object') continue;

                if (val.Chat && val.Msg && Object.keys(val.Chat).length) {
                    console.log(`[MyWAppConnector] Brute-scan found potential Store at window.${key}`);
                    findAndExposeModules({ Store: val });
                    if (isStoreInitialized) return;
                }
            }
        } catch(e) { /* ignore */ }
    };

    setInterval(bruteScanGlobals, 5000);

    // Fast path: global Store already present (some builds expose it directly)
    try {
      if (window.Store && window.Store.Chat) {
        console.log('[MyWAppConnector] window.Store detected globally – using it directly');
        findAndExposeModules({ Store: window.Store, MediaCollection: window.Store.MediaCollection });
        if (isStoreInitialized) return; // findAndExposeModules set flag
      }
    } catch(e) { /* ignore */ }

    // -------- Facebook/Meta packager path (requireLazy) --------
    if (typeof window.requireLazy === 'function' && !window.__waRequireLazyHookAll) {
        window.__waRequireLazyHookAll = true;
        try {
            const origRL = window.requireLazy;
            window.requireLazy = function(modNames, callback) {
                const wrappedCb = (...mods) => {
                    // Iterate over each provided module export
                    const tmpObj = {};
                    mods.forEach((mExp, idx) => {
                        const key = modNames[idx] || ('idx_' + idx);
                        tmpObj[key] = mExp;
                    });
                    findAndExposeModules(tmpObj);
                    try {
                        return callback(...mods);
                    } catch(cbErr) {
                        console.error('[MyWAppConnector] Error in original requireLazy callback:', cbErr);
                    }
                };
                return origRL(modNames, wrappedCb);
            };
            console.log('[MyWAppConnector] requireLazy global wrapper installed.');
        } catch(e) {
            console.error('[MyWAppConnector] Failed installing requireLazy wrapper:', e);
        }
    }

    // Periodically scan __webpack_require__.c cache once it becomes available – this catches builds where the runtime is lazy-loaded.
    const requireCacheScanner = setInterval(() => {
        if (isStoreInitialized) {
            clearInterval(requireCacheScanner);
            return;
        }
        try {
            if (typeof window.__webpack_require__ === 'function' && window.__webpack_require__.c) {
                const cached = window.__webpack_require__.c;
                const exportsMap = {};
                for (const modId in cached) {
                    try {
                        exportsMap[modId] = cached[modId].exports;
                    } catch(e) { /* ignore bad modules */ }
                }
                if (Object.keys(exportsMap).length) {
                    console.log('[MyWAppConnector] Periodic scan of __webpack_require__.c found', Object.keys(exportsMap).length, 'cached modules.');
                    findAndExposeModules(exportsMap);
                }
            }
        } catch(e) { /* ignore */ }
    }, 3000);

})(); 