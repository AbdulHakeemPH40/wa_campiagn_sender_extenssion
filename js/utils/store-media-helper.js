/* Store Media Helper – extracted from campign_send_logic smphE.js
 * This script must run in the WhatsApp page context.
 * It locates window.Store via webpack and defines window.sendImage(chatId, file, caption, wait).
 */
(function() {
  if (window.sendImage) return; // already injected

  function getStore(modules) {
    let found = {
      Store: window.Store ?? undefined,
      MediaCollection: window.Store?.MediaCollection,
      SendTextMsgToChat: window.Store?.SendTextMsgToChat
    };
    const needed = {
      // Some WA builds export objects directly, others under `default`.
      Store: (m) => {
        if (!m) return null;
        if (m.Chat && m.Msg) return m;                    // direct export
        if (m.default && m.default.Chat && m.default.Msg) return m.default; // default export
        return null;
      },
      MediaCollection: (m) => {
        const target = m?.default || m;
        if (!target || !target.prototype) return null;
        if (target.prototype.processAttachments || target.prototype.processFiles) return target;
        return null;
      },
      SendTextMsgToChat: (m) => {
        if (!m) return null;
        if (typeof m.sendTextMsgToChat === 'function') return m.sendTextMsgToChat;
        if (m.default && typeof m.default.sendTextMsgToChat === 'function') return m.default.sendTextMsgToChat;
        return null;
      }
    };
    for (let idx in modules) {
      if ((typeof modules[idx] === 'object') && (modules[idx] !== null)) {
        Object.keys(needed).forEach((key) => {
          if (!needed[key] || found[key]) return;
          const result = needed[key](modules[idx]);
          if (result) found[key] = result;
        });
        if (found.Store && found.MediaCollection && found.SendTextMsgToChat) break;
      }
    }
    if (!found.Store) return null;
    window.Store = found.Store;
    window.Store.MediaCollection = found.MediaCollection;
    window.Store.SendTextMsgToChat = found.SendTextMsgToChat;
    return window.Store;
  }

  // Webpack traversal – compatible with modern webpackChunk
  const tryLoad = () => {
    if (window.Store && window.Store.Chat) return Promise.resolve();
    return new Promise((resolve) => {
      const id = 'parasite' + Date.now();
      const injectParasite = (webpackRequire) => {
        try {
          if (!webpackRequire) return;
          const moduleExports = [];
          if (webpackRequire.m) {
            Object.keys(webpackRequire.m).forEach((modId) => {
              try { moduleExports.push(webpackRequire(modId)); } catch {}
            });
          }
          getStore(moduleExports);
        } catch(err) { console.warn('[StoreHelper] injectParasite error', err); }
      };

      if (window.webpackJsonp) {
        window.webpackJsonp([], { [id]: (o, e, t) => injectParasite(t) }, [id]);
      } else if (window.webpackChunkwhatsapp_web_client) {
        window.webpackChunkwhatsapp_web_client.push([
          [id], {}, function(o, e, t) { injectParasite(t); }
        ]);
      }

      // Fallback: brute-force scan already-loaded modules (new WA builds)
      const bruteModulesScan = () => {
        try {
          let modules = [];
          if (window.__webpack_require__) {
            if (window.__webpack_require__.m) {
              modules.push(...Object.values(window.__webpack_require__.m));
            }
            if (window.__webpack_require__.c) {
              modules.push(...Object.values(window.__webpack_require__.c).map(c=>c?.exports).filter(Boolean));
            }
          } else {
            const chunkKey = Object.keys(window).find(k => k.startsWith('webpackChunk'));
            if (chunkKey && Array.isArray(window[chunkKey])) {
              window[chunkKey].forEach((chunk) => {
                if (Array.isArray(chunk) && chunk.length >= 2 && typeof chunk[1] === 'object') {
                  modules.push(...Object.values(chunk[1]));
                }
              });
            }
          }
          // Also try executing each module to obtain its exports (heavy but effective)
          if (window.__webpack_require__ && window.__webpack_require__.m) {
            Object.keys(window.__webpack_require__.m).forEach((modId) => {
              try {
                const exp = window.__webpack_require__(modId);
                if (exp) modules.push(exp);
              } catch {}
            });
          }
          if (modules.length) {
            getStore(modules);
          }
        } catch (err) {
          console.warn('[StoreHelper] bruteModulesScan failed:', err);
        }
      };

      bruteModulesScan();
      setTimeout(resolve, 500);
    });
  };

  tryLoad().then(() => {
    if (!window.Store || !window.Store.MediaCollection) {
      console.warn('[StoreHelper] failed to init – will retry');
      let attempts = 0;
      const maxAttempts = 5; // after 5 quick retries we give up to not stall campaigns
      const retryInterval = 1200;
      const retry = () => {
        attempts++;
        if (maxAttempts && attempts > maxAttempts) {
          console.error('[StoreHelper] Max retries reached. Store could not be initialized. Marking unavailable.');
          window.__waStoreApiUnavailable = true;
          return;
        }
        tryLoad().then(recheck);
      };
      const recheck = () => {
        if (window.Store && window.Store.MediaCollection) {
          console.log(`[StoreHelper] init succeeded on retry ${attempts}/${maxAttempts}`);
          // recursively call main code again to set window.sendImage
          initSendImage();
        } else {
          console.warn(`[StoreHelper] retry ${attempts}/${maxAttempts} failed, retrying in ${retryInterval}ms`);
          setTimeout(retry, retryInterval);
        }
      };
      console.log(`[StoreHelper] Starting initial retry attempt in ${retryInterval}ms`);
      setTimeout(retry, retryInterval);
      return;
    }
    initSendImage();

    function initSendImage() {
      window.sendImage = async function(chatId, file, caption = '', wait = 1) {
        console.log('[StoreHelper] sendImage called:', { chatId, file, caption, wait });
        if (!window.Store || !window.Store.Chat || !window.Store.MediaCollection) {
          console.warn('[StoreHelper] sendImage: Store or required components not ready.');
          return Promise.reject(new Error('Store not ready for sendImage')); // Return a rejected promise
        }
        try {
          const chat = await window.Store.Chat.find(chatId);
          console.log('[StoreHelper] sendImage: Chat found:', chat);
          if (!chat) throw new Error('Chat not found');

          const mc = new window.Store.MediaCollection(chat);
          console.log('[StoreHelper] sendImage: MediaCollection instantiated:', mc);

          const processFn = mc.processAttachments || mc.processFiles;
          if (!processFn) throw new Error('MediaCollection lacks processAttachments/processFiles');

          console.log('[StoreHelper] sendImage: Calling media processor with file:', file);
          await processFn.call(mc, [{ file }], wait, chat);

          if (!mc._models || mc._models.length === 0) {
            throw new Error('No media models processed');
          }

          console.log('[StoreHelper] sendImage: processAttachments completed. Models:', mc._models);

          const isMediaWithCaption = file && file.type && (file.type.startsWith('image') || file.type.startsWith('video'));

          // Send media (with caption for images/videos)
          mc._models[0].sendToChat(chat, { caption: isMediaWithCaption ? caption : '' });
          console.log('[StoreHelper] sendImage: sendToChat executed. isMediaWithCaption =', isMediaWithCaption);

          // For docs/PDFs etc., send caption as separate text
          if (!isMediaWithCaption && caption) {
            try {
              await window.Store.SendTextMsgToChat(chat, caption, {});
              console.log('[StoreHelper] sendImage: standalone caption sent for non-media file.');
            } catch (textErr) {
              console.warn('[StoreHelper] sendImage: failed to send standalone caption:', textErr);
            }
          }

          return { success: true, info: 'media (and caption where applicable) sent' };
        } catch (err) {
          console.error('[StoreHelper] sendImage: Error during sendImage flow:', err);
          return Promise.reject(err);
        }
      };
      console.log('[StoreHelper] sendImage ready');

      /**
       * Bridge listener – allows the isolated-world content script to request
       * an attachment send by dispatching a CustomEvent on `document` since
       * it cannot call `window.sendImage` directly.
       *
       * Expected event detail:
       * {
       *   chatId:   '<jid>@c.us',
       *   base64:   'data:image/png;base64,...' OR raw b64 without prefix,
       *   mimeType: 'image/png',
       *   fileName: 'photo.png',
       *   caption:  'optional caption'
       * }
       */

      if (!window.__waSendImageBridgeAttached) {
        window.__waSendImageBridgeAttached = true;
        document.addEventListener('WASendImage', async (evt) => {
          try {
            const { chatId, base64, mimeType = 'application/octet-stream', fileName = 'file', caption = '' } = evt.detail || {};
            if (!chatId || !base64) {
              throw new Error('Missing chatId or base64 in WASendImage detail');
            }

            // Support both full data URL and plain base64 payload
            const b64 = base64.includes(',') ? base64.split(',')[1] : base64;
            const byteStr = atob(b64);
            const ab = new ArrayBuffer(byteStr.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
            const blob = new Blob([ab], { type: mimeType });
            const file = new File([blob], fileName, { type: mimeType });

            await window.sendImage(chatId, file, caption, 1);
            document.dispatchEvent(new CustomEvent('WASendImageResult', { detail: { chatId, success: true } }));
          } catch (err) {
            console.error('[StoreHelper] WASendImage bridge error:', err);
            document.dispatchEvent(new CustomEvent('WASendImageResult', { detail: { chatId: (evt.detail||{}).chatId, success: false, error: err.message } }));
          }
        });
        console.log('[StoreHelper] WASendImage bridge attached');

        // Signal readiness to the content script (some versions wait for this)
        try {
          document.dispatchEvent(new CustomEvent('WASendImageBridgeReady', { bubbles: true }));
        } catch {}
      }
    }
  });
})();