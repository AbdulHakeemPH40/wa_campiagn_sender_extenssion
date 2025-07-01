// content.js - WhatsApp Web Content Script


// Config flags
// Enable WhatsApp internal Store-API pathway (≈5-10× faster because the chat UI doesn't need to open).
// If it causes issues on some WA builds simply toggle it back to false.
// Disable experimental Store-API fast-send path by default. It adds heavy probing overhead on builds where
// WhatsApp's internal objects are obfuscated or unavailable, which slows campaigns dramatically.
const USE_STORE_API = true; // retry capped helper will avoid slowdown
// Allow silent-attachment helper to run (clipboard/invisible input) even on Windows so we can skip the + clip menu.
// By default we keep strict mode ON (no silent attachment on Windows/macOS) but Turbo mode overrides this at runtime.
const STRICT_SILENT_ATTACHMENT = true; // When true, silent-attachment is attempted only on Linux – unless turbo override.

// Global variables
let isWhatsAppLoaded = false;
let isConnected = false;
let activeCampaign = null;
let campaignStatus = null;
let messageQueue = [];
let processingQueue = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
let isInitialized = false;
let backgroundPort = null;

// Tab visibility and focus tracking
let isTabVisible = true;
let isTabFocused = true;
let queuedMessages = [];
let lastActivityTime = Date.now();

// ===== Logging Control =====
// Set WA_DEBUG to true to enable console output. When false (default) ALL
// console methods become no-ops and common error/promise-rejection events are
// prevented from cluttering DevTools.
// Verbose logging can flood DevTools and add overhead.  Toggle back to `true` when actively debugging.
const WA_DEBUG = true;


if (!WA_DEBUG && typeof window !== 'undefined') {
  ['log', 'info', 'debug', 'warn', 'error'].forEach(m => {
    if (console[m]) console[m] = () => {};
  });

  // Suppress unhandled promise rejections & runtime script errors
  window.addEventListener('unhandledrejection', e => { e.preventDefault(); });
  window.addEventListener('error', e => { e.preventDefault(); });

  // Inject a small external script (web-accessible) to silence console/errors in the
  // page context without violating the site's CSP (inline scripts are blocked).
  try {
    const silenceUrl = chrome.runtime.getURL('js/injected/console-silence.js');
    const sc = document.createElement('script');
    sc.src = silenceUrl;
    sc.type = 'text/javascript';
    (document.head || document.documentElement).appendChild(sc);
  } catch (_) { /* ignore */ }
}

// Tab visibility and focus monitoring
document.addEventListener('visibilitychange', () => {
  isTabVisible = !document.hidden;
  if (isTabVisible) {
    lastActivityTime = Date.now();
    // Process any queued messages when tab becomes visible
    processQueuedMessages();
    
    // Resume campaign if it was paused for tab inactivity
    if (activeCampaign && activeCampaign.status === 'paused' && activeCampaign.pauseReason === 'tab_inactive') {
      chrome.runtime.sendMessage({ action: 'resumeCampaign' });
    }
  } else {
    // Tab hidden - only pause after extended period to allow desktop switching
    setTimeout(() => {
      if (!isTabVisible && activeCampaign && activeCampaign.status === 'running') {
        pauseCampaignForInactivity();
      }
    }, 60000); // 1 minute delay before pausing
  }
});

window.addEventListener('focus', () => {
  isTabFocused = true;
  lastActivityTime = Date.now();
  processQueuedMessages();
});

window.addEventListener('blur', () => {
  isTabFocused = false;
  // Don't pause for simple focus loss - only pause for visibility change
  // This allows multi-desktop usage without pausing campaigns
});

// Pause campaign when tab is inactive
async function pauseCampaignForInactivity() {
  try {
    console.log('[WA-Content] Pausing campaign due to tab inactivity');
    chrome.runtime.sendMessage({
      action: 'pauseCampaign',
      reason: 'tab_inactive'
    });
  } catch (error) {
    console.error('[WA-Content] Error pausing campaign for inactivity:', error);
  }
}

// Process messages that were queued while tab was inactive
async function processQueuedMessages() {
  if (queuedMessages.length === 0) return;
  
  console.log(`[WA-Content] Processing ${queuedMessages.length} queued messages`);
  
  // Clear the queue to prevent duplicate processing
  const messages = [...queuedMessages];
  queuedMessages = [];
  
  // Process messages with proper delays
  for (const message of messages) {
    try {
      await sendQueuedMessage(message);
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between queued messages
    } catch (error) {
      console.error('[WA-Content] Error processing queued message:', error);
    }
  }
}

// Send a queued message
async function sendQueuedMessage(messageData) {
  const { contact, message, attachment } = messageData;
  
  // Validate message has text content
  if (!message || message.trim() === '') {
    console.error('[WA-Content] Skipping queued message - no text content');
    return;
  }
  
  // Send the message normally
  return await sendMessage(contact, message, attachment);
}

// Check if tab is active before sending messages
function isTabActive() {
  // Only check visibility, not focus - allows multi-desktop usage
  return isTabVisible && (Date.now() - lastActivityTime) < 1800000; // 30 minutes
}

// Enhanced message sending with activity check
async function sendMessageSafely(contact, message, attachment) {
  // Critical: Check if message has text content
  if (!message || message.trim() === '') {
    console.error('[WA-Content] BLOCKED: Attempted to send message without text content');
    throw new Error('Message text is required - cannot send attachment-only messages');
  }
  
  // Check if tab is active
  if (!isTabActive()) {
    console.log('[WA-Content] Tab inactive - queuing message instead of sending');
    queuedMessages.push({ contact, message, attachment });
    
    // Pause campaign until tab becomes active
    pauseCampaignForInactivity();
    return { success: false, queued: true };
  }
  
  // Tab is active - send message normally
  return await sendMessage(contact, message, attachment);
}

// SPA Navigation Manager
class SPANavigationManager {
  constructor() {
    this.isEnabled = false;
    this.originalPushState = null;
    this.originalReplaceState = null;
    this.originalLocationSetter = null;
    this.navigationHistory = [];
    this.isInitialized = false;
  }

  initialize() {
    if (this.isInitialized) return;
    
    try {
      // Store original history methods
      this.originalPushState = history.pushState;
      this.originalReplaceState = history.replaceState;
      
      // Override pushState
      history.pushState = (state, title, url) => {
        if (this.isEnabled) {
          this.navigationHistory.push({ state, title, url });
          this.handleNavigation(url);
        } else {
          this.originalPushState.call(history, state, title, url);
        }
      };

      // Override replaceState
      history.replaceState = (state, title, url) => {
        if (this.isEnabled) {
          const lastEntry = this.navigationHistory[this.navigationHistory.length - 1];
          if (lastEntry) {
            lastEntry.state = state;
            lastEntry.title = title;
            lastEntry.url = url;
          }
          this.handleNavigation(url);
        } else {
          this.originalReplaceState.call(history, state, title, url);
        }
      };

      // ---------------- Window.location override (re-enabled with safety wrapper) ----------------
      try {
        const locDesc = Object.getOwnPropertyDescriptor(window, 'location');
        if (locDesc && locDesc.set && locDesc.configurable) {
          this.originalLocationSetter = locDesc.set;

          Object.defineProperty(window, 'location', {
            configurable: true,
            enumerable: true,
            get: locDesc.get,
            set: (value) => {
              try {
                if (this.isEnabled) {
                  this.handleNavigation(value);
                }
                // Use assign() to avoid "Illegal invocation" when calling original setter
                window.location.assign(value);
              } catch (assignErr) {
                // Fallback to original setter if assign failed (rare)
                try {
                  this.originalLocationSetter.call(window, value);
                } catch (origErr) {
                  console.warn('[WA-Content] Fallback location setter also failed:', origErr);
                }
              }
            }
          });
          console.log('[WA-Content] SPA Navigation location override installed.');
        } else {
          console.log('[WA-Content] SPA Navigation: window.location not configurable – override skipped.');
        }
      } catch (locErr) {
        console.warn('[WA-Content] SPA Navigation: Failed to install location override:', locErr);
      }

      this.isInitialized = true;
      console.log('[WA-Content] SPA Navigation initialized (window.location override disabled).');
    } catch (error) {
      console.error('[WA-Content] Error initializing SPA Navigation:', error);
    }
  }

  enable() {
    if (!this.isInitialized) {
      this.initialize();
    }
    this.isEnabled = true;
    console.log('[WA-Content] SPA Navigation enabled');
  }

  disable() {
    this.isEnabled = false;
    console.log('[WA-Content] SPA Navigation disabled');
  }

  handleNavigation(url) {
    try {
      // Extract phone number from URL if it's a chat URL
      const phoneMatch = url.match(/phone=(\d+)/);
      if (phoneMatch) {
        const phone = phoneMatch[1];
        this.navigateToChat(phone);
          }
        } catch (error) {
      console.error('[WA-Content] Error handling navigation:', error);
    }
  }

  async navigateToChat(phone) {
    try {
      // Helper to locate the search / new-chat textbox – WhatsApp often changes the selector.
      const getSearchInput = () => {
        const selectors = [
          // Older layout (data-test id)
          'div[data-testid="chat-list-search"]',
          // New 2024 layout: wrapper contains a contenteditable textbox
          'header [contenteditable="true"][data-tab]',
          // Desktop app / alternative layout
          'div[role="textbox"][contenteditable="true"]',
          // Generic fallback – the first visible contenteditable textbox in header
          'header div[contenteditable="true"]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return el;
        }
        return null;
      };

      const searchInput = getSearchInput();
      if (!searchInput) {
        // Fallback: navigate via URL scheme
        console.warn('[WA-Content] Search input not found, falling back to URL navigation');
        window.location.href = `https://web.whatsapp.com/send?phone=${phone}`;
        // Wait for chat panel to load
        await this.waitForElement('div[data-testid="conversation-panel-wrapper"]', 15000);
        return;
      }

      // Click search input to focus
      searchInput.click();
      
      // Clear any existing search
      if (searchInput.textContent) {
        searchInput.textContent = '';
      }

      // Type phone number
      await this.typeText(phone);
        
        // Wait for search results – WhatsApp renders each chat row with various attrs
      await this.waitForElement('div[role="option"], div[data-testid="cell-frame-container"]');
      
      // Click on the first result (support both selector styles)
      const firstResult = document.querySelector('div[role="option"], div[data-testid="cell-frame-container"]');
      if (!firstResult) {
        throw new Error('No contact found');
      }
      firstResult.click();
    
    // Wait for chat to load
      await this.waitForElement('div[data-testid="conversation-panel-wrapper"]');
      
      console.log('[WA-Content] Successfully navigated to chat:', phone);
    } catch (error) {
      console.warn('[WA-Content] navigateToChat failed with selectors, falling back to URL navigation', error);
      try {
        window.location.href = `https://web.whatsapp.com/send?phone=${phone}`;
        await this.waitForElement('div[data-testid="conversation-panel-wrapper"]', 15000);
        console.log('[WA-Content] Fallback URL navigation succeeded for', phone);
        return;
      } catch (urlErr) {
        console.error('[WA-Content] Fallback URL navigation also failed:', urlErr);
        throw urlErr;
      }
    }
  }

  async typeText(text) {
    return new Promise((resolve) => {
      const input = window.utils?.queryAny([
        'div[data-testid="conversation-compose-box-input"]',
        'div[role="textbox"][contenteditable="true"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"][data-tab="10"]'
      ]) || null;

      if (!input) {
        console.warn('[WA-Content] SPA.typeText: compose box not found');
        return resolve();
      }

      input.focus();

      try {
        document.execCommand('insertText', false, text);
      } catch {}

      const ev = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      });
      input.textContent = text;
      input.dispatchEvent(ev);

      setTimeout(resolve, 140);
    });
  }

  async waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const checkElement = () => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }
        
        if (Date.now() - startTime > timeout) {
          reject(new Error(`Timeout waiting for element: ${selector}`));
          return;
        }
        
        setTimeout(checkElement, 100);
      };
      
      checkElement();
    });
  }
}

// Create global instance
const spaNavigation = new SPANavigationManager();

// Establish a long-lived connection to the background script
function connectToBackground() {
  try {
    backgroundPort = chrome.runtime.connect({ name: 'content-script' });
    console.log('[WA-Content] Attempting to connect to background script...');

    backgroundPort.onMessage.addListener((message) => {
      if (message.pong) {
        console.log('[WA-Content] Received pong from background.');
        reconnectAttempts = 0; // Reset attempts on successful pong
      }
    });

    backgroundPort.onDisconnect.addListener(() => {
      console.error('[WA-Content] Background port disconnected.');
      if (chrome.runtime.lastError) {
        console.error(`[WA-Content] Disconnect reason: ${chrome.runtime.lastError.message}`);
      }
      backgroundPort = null;
      // Attempt to reconnect after a delay
      setTimeout(connectToBackground, 1000 * Math.pow(2, Math.min(reconnectAttempts++, 4)));
    });

  } catch (error) {
    console.error('[WA-Content] Could not connect to background script:', error);
  }
}

// Initialize content script
function initialize() {
  if (isInitialized) {
    console.log('[WA-Content] Content script already initialized');
    return;
  }

  try {
    // Set up message listeners first - CRITICAL for ping response
    setupMessageListeners();
    
    // Check if WhatsApp is loaded
    checkWhatsAppLoaded();
    
    // Set up connection monitoring
    setupConnectionMonitoring();
    
    // Set up visibility handler
    setupVisibilityHandler();
    
    // Initialize SPA navigation - WRAP IN TRY-CATCH
    try {
    spaNavigation.initialize();
    // Enable SPA navigation hooks (pushState/replaceState & location override)
    try { spaNavigation.enable(); } catch(e){ console.warn('[WA-Content] SPA Navigation enable failed', e);}
    } catch (spaError) {
      console.error('[WA-Content] Error during spaNavigation.initialize():', spaError);
      // Continue initialization even if SPA nav fails, as basic features should still work
    }

    // Inject Store Connector ONLY when internal API usage is enabled
    if (USE_STORE_API) {
      try {
        const connectorScriptPath = chrome.runtime.getURL('js/utils/was_store_connector.js');
        const script = document.createElement('script');
        script.src = connectorScriptPath;
        script.type = 'text/javascript';
        (document.head || document.documentElement).appendChild(script);
        console.log('[WA-Content] Injected was_store_connector.js');
        script.onload = () => console.log('[WA-Content] was_store_connector.js loaded by the page.');
        script.onerror = () => console.error('[WA-Content] FAILED to load was_store_connector.js by the page.');
      } catch (e) {
        console.error('[WA-Content] Error injecting was_store_connector.js:', e);
      }
    }
    
    // ---- File-chooser bypass (external) ----
    // Inject the picker-bypass helper ONLY on Linux builds. On Windows/macOS its hacks can
    // interfere with WhatsApp's normal attachment flow (e.g. images turning into stickers).
    try {
      const isLinuxEnv = navigator.platform?.toLowerCase().includes('linux') || navigator.userAgent.toLowerCase().includes('linux') || (typeof activeCampaign !== 'undefined' && activeCampaign?.turboModeEnabled);
      if (isLinuxEnv || STRICT_SILENT_ATTACHMENT) {
        const pickerBypassPath = chrome.runtime.getURL('js/injected/picker-bypass.js');
        const bypass = document.createElement('script');
        bypass.src = pickerBypassPath;
        bypass.type = 'text/javascript';
        (document.head || document.documentElement).appendChild(bypass);
        bypass.onload = () => console.log('[WA-Content] picker-bypass.js injected (Linux mode).');
        bypass.onerror = (e) => console.error('[WA-Content] Failed to load picker-bypass.js', e);
      } else {
        console.log('[WA-Content] picker-bypass.js skipped (non-Linux platform, strict mode off)');
      }
    } catch (bypassErr) {
      console.error('[WA-Content] Failed injecting picker-bypass.js:', bypassErr);
    }
    
    isInitialized = true;
    console.log('[WA-Content] Content script initialized.');

    // Listen for messages from the injector script
    window.addEventListener('message', (event) => {
      // We only accept messages from ourselves
      if (event.source !== window || !event.data.source || event.data.source !== 'injector-script') {
        return;
      }

      switch (event.data.type) {
        case 'WHATSAPP_NUMBER_FETCHER_RESULT':
          {
            console.log('[WA-Content] Received phone number from injector:', JSON.stringify(event.data, null, 2));
            const { phoneNumber, message } = event.data;
            
            // Cache the phone number for self-send mechanism
            if (phoneNumber) {
              window._lastKnownPhoneNumber = phoneNumber;
            }
            
            const result = {
              action: 'WHATSAPP_NUMBER_RESULT',
              status: phoneNumber ? 'success' : 'error',
              number: phoneNumber,
              message: message || (phoneNumber ? 'Successfully fetched' : 'Could not fetch number')
            };
            if (backgroundPort) {
              backgroundPort.postMessage(result);
            } else {
              console.error('[WA-Content] Cannot send phone number to background, port is not connected.');
            }
            break;
          }
      }
    });

    // Notify background script that content script is ready
    // This message is crucial for the background script to know the content script is alive.
      chrome.runtime.sendMessage({
      action: 'contentScriptReady',
      status: {
        isWhatsAppLoaded,
        isConnected
      }
    }).then(response => {
        console.log('[WA-Content] Successfully sent contentScriptReady to background.');
    }).catch(error => {
      console.error('[WA-Content] Error sending contentScriptReady to background:', error);
      // If this fails, the background script might still not be able to communicate reliably.
    });

    // Inject media helper only if Store API path is enabled
    if (USE_STORE_API) {
      const helperSrc = chrome.runtime.getURL('js/utils/store-media-helper.js');
      const s = document.createElement('script');
      s.src = helperSrc;
      (document.head || document.documentElement).appendChild(s);
    }

    // Initialize UI elements after core initialization and letting background know we are alive
    initializeFloatingUI();
    initializeSidebarIcon();

  } catch (error) {
    console.error('[WA-Content] CRITICAL Error during main initialize():', error);
    // If a critical error happens here, the script might be entirely broken.
  }
}

// Set up visibility change handler
function setupVisibilityHandler() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('[WA-Content] Tab became visible, reconnecting to background script');
      reconnectToBackground();
    }
  });
}

// Reconnect to background script
async function reconnectToBackground() {
  if (!backgroundPort || backgroundPort.name !== 'content-script') {
    console.log('[WA-Content] Background port not connected. Attempting to reconnect...');
    connectToBackground();
    return;
  }

  try {
    // Send a ping through the long-lived port
    console.log('[WA-Content] Pinging background script through long-lived port.');
    backgroundPort.postMessage({ action: 'ping' });
  } catch (error) {
    console.error('[WA-Content] Failed to send ping through background port:', error);
    if (backgroundPort) {
      backgroundPort.disconnect();
    }
    backgroundPort = null;
    // The onDisconnect listener will handle the reconnection attempt.
  }
}

// Check if WhatsApp is loaded
function checkWhatsAppLoaded() {
  const checkInterval = setInterval(() => {
    if (document.querySelector('div[data-testid="chat-list"]')) {
      isWhatsAppLoaded = true;
      clearInterval(checkInterval);
      console.log('[WA-Content] WhatsApp Web is loaded');
      
      // Notify background script
      chrome.runtime.sendMessage({
          action: 'contentScriptReady',
        apiAvailable: true
      }).catch(() => {
        // If message fails, try to reconnect
        reconnectToBackground();
      });
    }
  }, 1000);
}

// Set up message listeners
function setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[WA-Content] Received message:', message.action);
    
    switch (message.action) {
      case 'ping':
        sendResponse({ status: 'ok', timestamp: Date.now() });
        return true;
        
      case 'startSending':
        if (message.campaignSettings) {
          handleCampaignStart(message.campaignSettings)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        } else if (message.campaignId) {
          // Fetch settings from storage (sent as minimal message)
          chrome.storage.local.get(['activeCampaign'], (res) => {
            if (res.activeCampaign && res.activeCampaign.id === message.campaignId) {
              handleCampaignStart(res.activeCampaign)
                .then(result => sendResponse(result))
                .catch(error => sendResponse({ success: false, error: error.message }));
            } else {
              sendResponse({ success: false, error: 'Campaign data not found' });
            }
          });
        } else {
          sendResponse({ success: false, error: 'No campaign data provided' });
        }
        return true;
        
      case 'pauseCampaign':
        handleCampaignPause()
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
        
      case 'resumeCampaign':
        handleCampaignResume()
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
        
      case 'abortCampaign':
        handleCampaignAbort()
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      }
    });
}

// Set up connection monitoring
function setupConnectionMonitoring() {
  // Monitor for connection status changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        // Check for connection status changes
        const disconnectedElement = document.querySelector('div[data-testid="disconnected"]');
        const connectedElement = document.querySelector('div[data-testid="chat-list"]');
        
        const wasConnected = isConnected;
        isConnected = !!connectedElement && !disconnectedElement;
        
        // If connection status changed, notify background script
        if (wasConnected !== isConnected) {
        chrome.runtime.sendMessage({
          action: 'connectionStatusChanged',
            status: isConnected
          }).catch(() => {
            // If message fails, try to reconnect
            reconnectToBackground();
          });
        }
      }
    });
  });
  
  // Start observing the document
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Handle campaign start
async function handleCampaignStart(campaignSettings) {
  try {
    console.log('[WA-Content] Starting campaign:', campaignSettings);
    
    let attachmentFile = null;
    if (campaignSettings.attachment && campaignSettings.attachment.base64String) {
      // Determine a suitable MIME type from the saved `attachment.type` field
      let mimeType = 'application/octet-stream';
      switch (campaignSettings.attachment.type) {
        case 'pdf':
          mimeType = 'application/pdf';
          break;
        case 'image':
          // Try to guess the image subtype from the file extension (fallback to jpeg)
          mimeType = 'image/' + (campaignSettings.attachment.name?.split('.').pop().toLowerCase() || 'jpeg');
          break;
        case 'video':
          mimeType = 'video/' + (campaignSettings.attachment.name?.split('.').pop().toLowerCase() || 'mp4');
          break;
        default:
          // Keep default octet-stream
          break;
      }

      attachmentFile = base64ToFile(
        campaignSettings.attachment.base64String,
        campaignSettings.attachment.name || 'attachment',
        mimeType);
    } else if (campaignSettings.attachment && campaignSettings.attachment.attachmentRef) {
      // Request blob from background script (extension context) because
      // content-scripts run under the page origin and cannot access the
      // extension's IndexedDB directly.
      try {
        const resp = await chrome.runtime.sendMessage({
          action: 'getAttachmentBlob',
          attachmentRef: campaignSettings.attachment.attachmentRef
        });
        if (resp && resp.success && resp.url) {
          const mime = resp.type || 'application/octet-stream';
          const fetched = await fetch(resp.url);
          const blob = await fetched.blob();
          attachmentFile = new File([blob], resp.name || campaignSettings.attachment.name || 'attachment', { type: mime });
          // Revoke URL after use to free memory
          try { URL.revokeObjectURL(resp.url); } catch(_) {}
          console.log('[WA-Content] Attachment blob retrieved from background');
        } else {
          console.warn('[WA-Content] Background did not return blob:', resp?.error);
        }
      } catch (msgErr) {
        console.error('[WA-Content] Error fetching attachment from background:', msgErr);
      }
    }
    
    // De-duplicate contacts (skip empty / malformed numbers) - Enhanced phone detection
    const normalizePhone = (raw) => (raw || '').toString().replace(/\D/g, '');
    const uniqueMap = new Set();
    const dedupedContacts = [];
    (campaignSettings.contacts || []).forEach((c) => {
      // Try multiple phone field variations
      const raw = c?.Phone || c?.phone || c?.PHONE || c?.PhoneNumber || c?.phoneNumber || c?.number || c?.Number;
      const clean = normalizePhone(raw);
      if (!clean || clean.length < 8 || uniqueMap.has(clean)) return; // skip duplicates / invalid / too short
      uniqueMap.add(clean);
      dedupedContacts.push({
        ...c,
        Phone: clean, // Normalize to standard field name
        phone: clean,
        PHONE: clean
      });
    });
    campaignSettings.contacts = dedupedContacts;
    campaignSettings.totalContacts = dedupedContacts.length;
    
    // Store campaign settings
    activeCampaign = {
      ...campaignSettings,
      attachmentFile,
      startTime: new Date().toISOString(),
              lastUpdateTime: new Date().toISOString(),
      currentIndex: 0,
      sentCount: 0,
      failedCount: 0,
      status: 'running',
      useLegacyMethod: campaignSettings.useLegacyMethod || true
    };
    
    // Show floating UI immediately
    ensureFloatingUIVisible();
    updateFloatingUI(activeCampaign);
    
    // Start processing the campaign
    processCampaign().catch(error => {
      console.error('[WA-Content] Error in processCampaign:', error);
    chrome.runtime.sendMessage({
        action: 'updateCampaignProgress',
        campaignId: activeCampaign.id,
        status: {
          error: error.message,
          status: 'failed'
        }
      });
    });
    
    return { success: true };
      } catch (error) {
    console.error('[WA-Content] Error starting campaign:', error);
    return { success: false, error: error.message };
  }
}

// Process campaign
async function processCampaign() {
  try {
    if (!activeCampaign || activeCampaign.status !== 'running') {
      return;
    }
    
    const { contacts } = activeCampaign;
    const baseMessage = activeCampaign.message;
    
    // Build a Set with already processed numbers within this campaign (survives tab reloads because we persist it)
    if (!Array.isArray(activeCampaign.sentNumbers)) {
      activeCampaign.sentNumbers = [];
    }
    const sentSet = new Set(activeCampaign.sentNumbers.map(num => num.toString()));

    // --- Initialise success/failed/skipped collections for downloadable report ---
    if(!Array.isArray(activeCampaign.successNumbers)) activeCampaign.successNumbers = [];
    if(!Array.isArray(activeCampaign.failedNumbers))  activeCampaign.failedNumbers  = [];
    if(!Array.isArray(activeCampaign.skippedNumbers)) activeCampaign.skippedNumbers = [];

    const successSet = new Set(activeCampaign.successNumbers.map(n=>n.toString()));
    const failedSet   = new Set(activeCampaign.failedNumbers.map(n=>n.toString()));
    const skippedSet  = new Set(activeCampaign.skippedNumbers.map(n=>n.toString()));
    
    // Helper to normalise a raw phone value to digits-only string
    const normalizePhone = (raw) => (raw || '').toString().replace(/\D/g, '');
    
    // Process each contact
    for (let i = activeCampaign.currentIndex; i < contacts.length; i++) {
      if (activeCampaign.status !== 'running') {
        console.log('[WA-Content] Campaign not running, exiting process loop');
        return; // exit entirely so we do NOT hit completeCampaign()
      }
              
      // Stop the previous countdown timer but keep the element visible to avoid flicker
      try { stopBatchCountdown(false); } catch(_) {}

      const contact = contacts[i];

      // Determine clean phone; if missing treat as failed and skip - Enhanced detection
      const rawPhone = contact?.Phone || contact?.phone || contact?.PHONE || contact?.PhoneNumber || contact?.phoneNumber || contact?.number || contact?.Number;
      const cleanPhone = normalizePhone(rawPhone);

      if (!cleanPhone || cleanPhone.length < 8) {
        console.warn('[WA-Content] Contact has no valid or too-short phone, skipping index', i);
        skippedSet.add(cleanPhone||'invalid');
        activeCampaign.skippedNumbers = Array.from(skippedSet);
        activeCampaign.failedCount++;
        // Update progress immediately so UI reflects the skip
        chrome.runtime.sendMessage({
          action: 'updateCampaignProgress',
          campaignId: activeCampaign.id,
          status: {
            currentIndex: i,
            sentCount: activeCampaign.sentCount,
            failedCount: activeCampaign.failedCount,
            status: 'running',
            error: 'invalid_number'
          }
        });
        continue;
      }

      // Skip duplicates that have already been successfully/unsuccessfully processed in this campaign
      if (sentSet.has(cleanPhone)) {
        console.log('[WA-Content] Duplicate phone detected, skipping:', cleanPhone);
        skippedSet.add(cleanPhone);
        activeCampaign.skippedNumbers = Array.from(skippedSet);
        activeCampaign.failedCount++;
        // Update progress immediately so UI reflects the skip
        chrome.runtime.sendMessage({
          action: 'updateCampaignProgress',
          campaignId: activeCampaign.id,
          status: {
            currentIndex: i,
            sentCount: activeCampaign.sentCount,
            failedCount: activeCampaign.failedCount,
            status: 'running',
            error: 'invalid_number'
          }
        });
        continue;
      }

      activeCampaign.currentIndex = i;
      // Immediately propagate the phone number to the floating UI so it matches the chat that is about to open
      activeCampaign.currentNumber = cleanPhone;
      chrome.runtime.sendMessage({
        action: 'updateCampaignProgress',
        campaignId: activeCampaign.id,
        status: {
          currentIndex: i,
          sentCount: activeCampaign.sentCount,
          failedCount: activeCampaign.failedCount,
          status: 'sending',
          currentNumber: cleanPhone
        }
      });
      // Update the floating UI locally without waiting for the background relay
      updateFloatingUI(activeCampaign);

      // Prepare message with a unique timestamp for this specific contact
      let message = baseMessage;
      if (activeCampaign.addTimestamp) {
        const now = new Date();
        // Precise timestamp with seconds for better safety/audit trail
        const time = now.toLocaleTimeString('en-US', { hour12: true, hour: 'numeric', minute: '2-digit', second: '2-digit' });
        message += `\n\n[${time}]`;
      }
      
      try {
        // Always use the legacy method which visibly switches to the chat via deeplink,
        // ensuring the user sees the conversation and WhatsApp can show the invalid-number
        // dialog if applicable. This avoids the sidebar search navigation completely.
        const sendStartTime = Date.now();
        
        // First, check if the number is invalid or blocked before attempting to send
        try {
          // Create a message link to trigger the chat load
          await createMessageLink(cleanPhone, '');
          
          // Wait to see if the chat loads or if we get an invalid number dialog
          const chatCheck = await waitForChatOrInvalid(5000, cleanPhone);
          
          if (chatCheck.invalid) {
            console.log(`[WA-Content] Detected invalid/blocked number before sending: ${cleanPhone}`);
            throw new Error('Invalid or blocked number');
          }
          
          // If we got here, the chat loaded successfully, so we can proceed with sending
          console.log(`[WA-Content] Chat loaded successfully for ${cleanPhone}, proceeding with send`);
        } catch (validationError) {
          console.warn(`[WA-Content] Number validation failed for ${cleanPhone}:`, validationError);
          throw new Error('Invalid or blocked number');
        }
        
        // Use the legacy URL method if enabled (default) or fall back to alternative method
        let currentAttemptOk = false;
        let attemptError = 'Send failed'; // Default error message

        if (activeCampaign.useLegacyMethod) {
            console.log(`[WA-Content] Using legacy URL method for ${cleanPhone}`);
            let legacyOk = await legacySendMessage(contact, message, activeCampaign.attachmentFile);
            if (legacyOk) {
                currentAttemptOk = true;
                console.log(`[WA-Content] Legacy method SUCCESS for ${cleanPhone}`);
            } else {
                console.log(`[WA-Content] Legacy method FAILED for ${cleanPhone}, trying fallback`);
                // Legacy failed, try UI-based sendMessage as a final fallback
                await new Promise(r => setTimeout(r, 1000)); // Keep the delay
                const fallbackResult = await sendMessage(cleanPhone, message);
                if (fallbackResult && typeof fallbackResult === 'object' && typeof fallbackResult.success === 'boolean') {
                    currentAttemptOk = fallbackResult.success;
                    console.log(`[WA-Content] Fallback method result for ${cleanPhone}: ${currentAttemptOk ? 'SUCCESS' : 'FAILED'}`);
                    if (!currentAttemptOk && fallbackResult.error) {
                        attemptError = fallbackResult.error;
                    } else if (!currentAttemptOk) {
                        attemptError = 'Fallback UI send failed';
                    }
                } else if (typeof fallbackResult === 'boolean') {
                    currentAttemptOk = fallbackResult;
                    console.log(`[WA-Content] Fallback boolean result for ${cleanPhone}: ${currentAttemptOk ? 'SUCCESS' : 'FAILED'}`);
                    if (!currentAttemptOk) attemptError = 'Fallback UI send returned unexpected boolean false';
                } else {
                    currentAttemptOk = false;
                    console.log(`[WA-Content] Fallback unexpected result for ${cleanPhone}: FAILED`);
                    attemptError = 'Fallback UI send returned unexpected result type';
                }
            }
        } else { // Turbo Mode (non-legacy)
            console.log(`[WA-Content] Using Turbo mode for ${cleanPhone}`);
            const sendAttemptResult = await sendMessage(cleanPhone, message);
            if (sendAttemptResult && typeof sendAttemptResult === 'object' && typeof sendAttemptResult.success === 'boolean') {
                currentAttemptOk = sendAttemptResult.success;
                console.log(`[WA-Content] Turbo mode result for ${cleanPhone}: ${currentAttemptOk ? 'SUCCESS' : 'FAILED'}`);
                if (!currentAttemptOk && sendAttemptResult.error) {
                    attemptError = sendAttemptResult.error;
                } else if (!currentAttemptOk) {
                    attemptError = 'UI send failed (Turbo Mode)';
                }
            } else if (typeof sendAttemptResult === 'boolean') {
                currentAttemptOk = sendAttemptResult;
                console.log(`[WA-Content] Turbo boolean result for ${cleanPhone}: ${currentAttemptOk ? 'SUCCESS' : 'FAILED'}`);
                if (!currentAttemptOk) attemptError = 'UI send (Turbo) returned unexpected boolean false';
            } else {
                currentAttemptOk = false;
                console.log(`[WA-Content] Turbo unexpected result for ${cleanPhone}: FAILED`);
                attemptError = 'UI send (Turbo) returned unexpected result type';
            }
        }

        if (!currentAttemptOk) {
            throw new Error(attemptError); // Throw the specific error
        }
        
        console.log(`[WA-Content] Message sent successfully to ${cleanPhone}`);
        
        // Update progress - SUCCESS
        successSet.add(cleanPhone);
        activeCampaign.successNumbers = Array.from(successSet);

        // Update numeric progress
        activeCampaign.sentCount++;
        activeCampaign.lastUpdateTime = new Date().toISOString();
        // Record processed phone number to avoid duplicate sends within this campaign
        sentSet.add(cleanPhone);
        activeCampaign.sentNumbers = Array.from(sentSet);
        // Persist updated campaign progress for reliable reporting (especially in Turbo mode)
        try { chrome.storage.local.set({ activeCampaign }); } catch {}
        
        // Store for local UI
        activeCampaign.currentNumber = cleanPhone;
        
        // Notify background script
        chrome.runtime.sendMessage({
          action: 'updateCampaignProgress',
          campaignId: activeCampaign.id,
          status: {
            currentIndex: i,
            sentCount: activeCampaign.sentCount,
            failedCount: activeCampaign.failedCount,
            status: 'running',
            currentNumber: cleanPhone
          }
        });
        
        // Update floating UI immediately without waiting for background relay
        updateFloatingUI(activeCampaign);
        
        // ---- New randomised batch splitting logic -------------------------
        if (activeCampaign.splitBatchesEnabled) {
          // Initialise batch control vars once
          if (typeof activeCampaign._batchCounter === 'undefined') {
            const rnd = (min,max)=> Math.floor(Math.random()*(max-min+1))+min;
            activeCampaign.batchSizeMin = parseInt(activeCampaign.batchSizeMin || activeCampaign.batchSize || 1,10);
            activeCampaign.batchSizeMax = parseInt(activeCampaign.batchSizeMax || activeCampaign.batchSize || 1,10);
            activeCampaign.delayBetweenBatchesMin = parseInt(activeCampaign.delayBetweenBatchesMin || activeCampaign.delayBetweenBatches || 1,10);
            activeCampaign.delayBetweenBatchesMax = parseInt(activeCampaign.delayBetweenBatchesMax || activeCampaign.delayBetweenBatches || 1,10);
            activeCampaign._batchCounter = 0;
            activeCampaign._currentBatchSize = rnd(activeCampaign.batchSizeMin, activeCampaign.batchSizeMax);
            activeCampaign._batchNumber = 1;

            const firstWait = rnd(activeCampaign.delayBetweenBatchesMin, activeCampaign.delayBetweenBatchesMax);
            activeCampaign._batchPlan = [{
              batchNumber: 1,
              size: activeCampaign._currentBatchSize,
              waitMin: firstWait,
              status: 'running',
              waitEndsAt: null
            }];
          }

          activeCampaign._batchCounter++;

          const isBatchComplete = activeCampaign._batchCounter >= activeCampaign._currentBatchSize;
          const notLastContact = (i < contacts.length -1);
          if (isBatchComplete && notLastContact) {
            const rnd = (min,max)=> Math.floor(Math.random()*(max-min+1))+min;
            const batchDelayMin = activeCampaign.delayBetweenBatchesMin;
            const batchDelayMax = activeCampaign.delayBetweenBatchesMax;
            const chosenDelayMin = rnd(batchDelayMin,batchDelayMax); // minutes

            // Notify UI & BG of batch delay
            const nextBatchTime = Date.now() + chosenDelayMin*60*1000;
            try { startBatchCountdown(nextBatchTime,'Next batch in:'); } catch(_){}
            chrome.runtime.sendMessage({
              action:'updateCampaignProgress',
              campaignId: activeCampaign.id,
              status:{
                currentIndex:i,
                sentCount:activeCampaign.sentCount,
                failedCount:activeCampaign.failedCount,
                status:'batch_delay',
                nextBatchTime,
                currentBatchSize:activeCampaign._currentBatchSize,
                batchNumber:activeCampaign._batchNumber
              }
            });

            // Wait respecting possible pause/abort
            await waitRespectingCampaign(chosenDelayMin*60*1000);

            if(activeCampaign && activeCampaign.status==='running'){
              activeCampaign.nextBatchTime=null;
              activeCampaign._batchCounter=0;
              activeCampaign._batchNumber++;
              activeCampaign._currentBatchSize = rnd(activeCampaign.batchSizeMin, activeCampaign.batchSizeMax);

              // Set new batch meta to running
              if(activeCampaign._batchPlan){
                // mark previous batch completed
                const prev = activeCampaign._batchPlan.find(b=>b.batchNumber===activeCampaign._batchNumber-1);
                if(prev) prev.status='completed';

                // mark current batch running
                const meta = activeCampaign._batchPlan.find(b=>b.batchNumber===activeCampaign._batchNumber);
                if(meta) meta.status='running';
              }

              // refresh UI
              updateFloatingUI(activeCampaign);
            }

            // ---------- Update batch plan tracking ----------
            if(activeCampaign._batchPlan){
              const currentMeta = activeCampaign._batchPlan.find(b=>b.batchNumber===activeCampaign._batchNumber);
              if(currentMeta){
                currentMeta.status='waiting';
                currentMeta.waitEndsAt = nextBatchTime;
              }

              const nextSize = rnd(activeCampaign.batchSizeMin, activeCampaign.batchSizeMax);
              const nextWait = rnd(activeCampaign.delayBetweenBatchesMin, activeCampaign.delayBetweenBatchesMax);
              const nextBatchNo = activeCampaign._batchNumber + 1;
              if(!activeCampaign._batchPlan.find(b=>b.batchNumber===nextBatchNo)){
                activeCampaign._batchPlan.push({
                  batchNumber: nextBatchNo,
                  size: nextSize,
                  waitMin: nextWait,
                  status: 'queued',
                  waitEndsAt: null
                });
              }
              updateFloatingUI(activeCampaign);
            }
          }
        }

        // ---------------- Accurate inter-message delay ----------------
        const sendEndTime = Date.now();
        const sendDuration = sendEndTime - sendStartTime; // ms consumed by navigation & send (informational)

        // Desired base gap between the START of this send and the next one
        let desiredGap = 2000; // default 2 s

        try {
          if (activeCampaign.randomTimeGapEnabled) {
            const max = Math.max(0, parseInt(activeCampaign.randomTimeGapMax ?? 20, 10)) * 1000;
            const min = Math.max(0, parseInt(activeCampaign.randomTimeGapMin ?? 15, 10)) * 1000;
            desiredGap = max > min ? Math.floor(Math.random() * (max - min + 1)) + min : max;
          } else if (activeCampaign.delayBetweenBatches && !activeCampaign.splitBatchesEnabled) {
            let finalMessage = replaceVariables(activeCampaign.message, contact);
            if (activeCampaign.settings.addTimestamp) {
              finalMessage += ` ⏰ ${getTimestamp()}`;
            }
            const val = parseInt(activeCampaign.delayBetweenBatches, 10);
            desiredGap = (val <= 60 ? val * 1000 : val * 60 * 1000); // ≤60 treated as seconds, else minutes
          }
        } catch (gapErr) {
          console.warn('[WA-Content] Desired-gap parse error – using default 2 s:', gapErr);
        }

        // Turbo Mode – keep the pipeline fast but safe for different message types
        if (activeCampaign.turboModeEnabled && !activeCampaign.randomTimeGapEnabled && !activeCampaign.delayBetweenBatches) {
          if (activeCampaign.attachmentFile && activeCampaign.attachmentFile.type.startsWith('image/')) {
            desiredGap = 1500; // Images need more time to process in turbo mode
          } else if (activeCampaign.attachmentFile) {
            desiredGap = 800; // Other attachments need moderate delay
          } else {
            desiredGap = 200; // Text messages can be very fast
          }
        }

        // Human-pattern extra delay
        if (activeCampaign.humanPatternEnabled) {
          try {
            const intensity = Math.max(0, Math.min(100, parseInt(activeCampaign.humanPatternIntensity, 10) || 0));

            // 1) micro-jitter: add up to 50 % of base gap scaled by intensity
            const jitterMax = desiredGap * 0.5 * (intensity / 100);
            desiredGap += Math.random() * jitterMax;

            // 2) occasional longer break to mimic reading/typing pauses
            const longPauseChance = 0.05 + (intensity / 100) * 0.05; // 5–10 %
            if (Math.random() < longPauseChance) {
              // long pause between 5-15 s additionally
              desiredGap += 5000 + Math.random() * 10000;
            }
          } catch (hpErr) {
            console.warn('[WA-Content] Human-pattern delay calc error:', hpErr);
          }
        }

        // Self-sending mechanism: Send a dot to yourself every 10-15 messages to keep WhatsApp active
        if (!activeCampaign._selfSendInterval) {
          activeCampaign._selfSendInterval = 10 + Math.floor(Math.random() * 6); // 10-15
          activeCampaign._nextSelfSendAt = activeCampaign._selfSendInterval;
          console.log(`[WA-Content] Self-send interval set to ${activeCampaign._selfSendInterval} messages`);
        }
        if (activeCampaign.sentCount > 0 && activeCampaign.sentCount === activeCampaign._nextSelfSendAt) {
          try {
            console.log(`[WA-Content] Triggering self-send mechanism after ${activeCampaign.sentCount} messages (interval: ${activeCampaign._selfSendInterval})`);
            await sendSelfMessage();
            // Set new random interval for next self-send
            const newInterval = 10 + Math.floor(Math.random() * 6);
            activeCampaign._nextSelfSendAt = activeCampaign.sentCount + newInterval;
            console.log(`[WA-Content] Next self-send scheduled at ${activeCampaign._nextSelfSendAt} messages (new interval: ${newInterval})`);
          } catch (selfErr) {
            console.warn('[WA-Content] Self-send failed:', selfErr);
          }
        }

        // If this was the last contact, skip any post-send delay and finish immediately
        const isLastContact = (i >= contacts.length - 1);
        // We want the user-specified random gap to be fully respected *after* a message is sent.
        // Using (desiredGap - sendDuration) often shortens the visible countdown, which confuses users.
        // Instead, honour the full random gap regardless of how long the send itself took.
        let remainingDelay = isLastContact ? 0 : desiredGap;

        if (remainingDelay > 0) {
          // Show floating countdown for any positive delay (>0 ms) so users always see feedback
          const nmTime = Date.now() + remainingDelay;
          activeCampaign.nextMessageTime = nmTime;
          try { startBatchCountdown(nmTime, 'Next message in:'); } catch(_) {}
          await waitRespectingCampaign(remainingDelay);
          if (activeCampaign && activeCampaign.status === 'running') {
            activeCampaign.nextMessageTime = null;
          }
          // Countdown finished – hide it now
          try { stopBatchCountdown(); } catch(_) {}
        }
            } catch (error) {
        console.error(`[WA-Content] Error processing contact ${cleanPhone}:`, error);
        
        // Update progress - FAILURE
        failedSet.add(cleanPhone);
        activeCampaign.failedNumbers = Array.from(failedSet);
        activeCampaign.failedCount++;
        // Record number even if failed so we don't retry it
        sentSet.add(cleanPhone);
        activeCampaign.sentNumbers = Array.from(sentSet);
        // Persist updated campaign progress for reliable reporting (especially in Turbo mode)
        try { chrome.storage.local.set({ activeCampaign }); } catch {}
        
        // Notify background script
        chrome.runtime.sendMessage({
          action: 'updateCampaignProgress',
          campaignId: activeCampaign.id,
          status: {
            currentIndex: i,
            sentCount: activeCampaign.sentCount,
            failedCount: activeCampaign.failedCount,
            status: 'running',
            error: error.message,
            currentNumber: cleanPhone
          }
        });
      }
    }
    
    // Complete campaign
    completeCampaign();
  } catch (error) {
    console.error('[WA-Content] Error processing campaign:', error);
    activeCampaign.status = 'failed';
    activeCampaign.error = error.message;
    
    // Notify background script
    chrome.runtime.sendMessage({
      action: 'updateCampaignProgress',
      campaignId: activeCampaign.id,
      status: {
        currentIndex: activeCampaign.currentIndex,
        sentCount: activeCampaign.sentCount,
        failedCount: activeCampaign.failedCount,
        status: 'failed',
        error: error.message
      }
    });
  }
}

// Send message to a contact
async function sendMessage(phone, message) {
  try {
    // Format phone number
    const formattedPhone = phone.toString().replace(/\D/g, '');
    
    // First check if we're already in the correct chat
    const currentChat = document.querySelector('div[data-testid="conversation-panel-wrapper"]');
    const currentChatPhone = currentChat?.getAttribute('data-phone');
    
    if (currentChatPhone !== formattedPhone) {
      // We need to switch chats
      console.log('[WA-Content] Switching to chat:', formattedPhone);
      
      // Find the search input
      const searchInput = document.querySelector('div[data-testid="chat-list-search"]');
      if (!searchInput) {
        throw new Error('Search input not found');
      }

      // Click search input to focus
      searchInput.click();
      
      // Clear any existing search
      const searchBox = document.querySelector('div[data-testid="search-bar"]');
      if (searchBox) {
        searchBox.textContent = '';
      }

      // Type phone number
      await typeText(formattedPhone);
      
      // Wait for search results
      await waitForElement('div[data-testid="cell-frame-container"]');
      
      // Click on the first result
      const firstResult = document.querySelector('div[data-testid="cell-frame-container"]');
      if (!firstResult) {
        throw new Error('No contact found');
      }
      firstResult.click();
      
      // Wait for chat to load
      await waitForElement('div[data-testid="conversation-panel-wrapper"]');
      
      // Wait a bit for the chat to fully load
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Find message input
    const messageInput = window.utils.queryAny([
      'div[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][role="textbox"]',
      'footer [contenteditable="true"]'
    ]);

    if (!messageInput) {
      window.utils.showModalMessage('WhatsApp UI changed', 'The extension cannot locate the message box in this version of WhatsApp Web. Please update the extension if this issue persists.', 'error');
      throw new Error('Message input not found');
    }
    
    // Click message input
    messageInput.click();
    
    // Type message
    await typeText(message);
    
    // Find and click send button
    let sendButton = window.utils.queryAny([
      'button[data-testid="send"]',
      'span[data-icon="send"]',
      'footer [aria-label="Send"]'
    ]);

    if (sendButton && sendButton.closest && sendButton.closest('button')) {
      sendButton = sendButton.closest('button');
    }

    if (!sendButton) {
      window.utils.showModalMessage('Send button not found', 'Unable to locate WhatsApp\'s send button. The page layout may have changed.', 'error');
      throw new Error('Send button not found');
    }
    sendButton.click();
    
    // Wait for message to be sent
    await waitForMessageSent();
    
    return { success: true };
  } catch (error) {
    console.error('[WA-Content] Error sending message:', error);
    return { success: false, error: error.message };
  }
}

// Helper function to type text
async function typeText(text) {
  return new Promise((resolve) => {
    const input = window.utils?.queryAny([
      'div[data-testid="conversation-compose-box-input"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][data-lexical-editor="true"]',
      'div[contenteditable="true"][data-tab="10"]'
    ]) || null;

    if (!input) {
      console.warn('[WA-Content] typeText: compose box not found');
      return resolve();
    }

    input.focus();

    try {
      document.execCommand('insertText', false, text);
    } catch {}

    const ev = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text
    });
    input.textContent = text;
    input.dispatchEvent(ev);

    setTimeout(resolve, 140);
  });
}

// Helper function to wait for element
async function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkElement = () => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
      return;
    }
    
      if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for element: ${selector}`));
        return;
      }
      
      setTimeout(checkElement, 100);
    };
    
    checkElement();
  });
}

// Helper function to wait for message sent
async function waitForMessageSent(timeout = 8000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const checkMessageStatus = () => {
      // Look for message status indicators - check multiple selectors
      const messageStatus = document.querySelector(
        'span[data-testid="msg-dblcheck"], ' +
        'span[data-testid="msg-check"], ' +
        'span[data-icon="msg-dblcheck"], ' +
        'span[data-icon="msg-check"], ' +
        'span[data-icon="msg-time"]'
      );
      
      // Also check if message appears in chat (alternative confirmation)
      const recentMessage = document.querySelector(
        'div[data-testid="conversation-panel-wrapper"] div[class*="message-out"]:last-child, ' +
        'div.copyable-area div[class*="message-out"]:last-child'
      );
      
      if (messageStatus || recentMessage) {
        resolve(true);
        return;
      }
      
      if (Date.now() - startTime > timeout) {
        // For text messages, assume success if no error dialog appeared
        const errorDialog = document.querySelector('div[role="dialog"], div[role="alertdialog"]');
        resolve(!errorDialog);
        return;
      }
      
      setTimeout(checkMessageStatus, 150);
    };
    
    checkMessageStatus();
  });
}

// Handle campaign pause
async function handleCampaignPause() {
  if (!activeCampaign) {
    throw new Error('No active campaign to pause');
  }
  if (activeCampaign.status !== 'running') {
    return { success: true }; // already paused/stopped
  }
  activeCampaign.status = 'paused';
  activeCampaign.lastUpdateTime = new Date().toISOString();
  // Persist
  try { await chrome.storage.local.set({ activeCampaign }); } catch {}
  // UI
  stopBatchCountdown();
  updateFloatingUI(activeCampaign);
  // Notify background
  chrome.runtime.sendMessage({
    action: 'updateCampaignProgress',
    campaignId: activeCampaign.id,
    status: {
      currentIndex: activeCampaign.currentIndex,
      sentCount: activeCampaign.sentCount,
      failedCount: activeCampaign.failedCount,
      status: 'paused',
      currentNumber: activeCampaign.currentNumber || ''
    }
  });
  // Inform popup/background so direct-sender can respect pause
  try { chrome.runtime.sendMessage({action:'pauseCampaign'}); } catch(_){}
  return { success: true }; 
}

// Handle campaign resume
async function handleCampaignResume() {
  if (!activeCampaign) throw new Error('No active campaign to resume');
  if (activeCampaign.status !== 'paused') throw new Error('Campaign is not paused');
  activeCampaign.status = 'running';
  activeCampaign.lastUpdateTime = new Date().toISOString();
  try { await chrome.storage.local.set({ activeCampaign }); } catch {}
  updateFloatingUI(activeCampaign);
  chrome.runtime.sendMessage({
    action: 'updateCampaignProgress',
    campaignId: activeCampaign.id,
    status: {
      currentIndex: activeCampaign.currentIndex,
      sentCount: activeCampaign.sentCount,
      failedCount: activeCampaign.failedCount,
      status: 'running',
      currentNumber: activeCampaign.currentNumber || ''
    }
  });
  // restart processing after small delay to let UI update
  const resumeProcessing = async ()=>{
    // If we paused during a countdown wait, honour the remaining time first
    let pending=0; let label='';
    if(activeCampaign.nextBatchTime && activeCampaign.nextBatchTime>Date.now()){
        pending = activeCampaign.nextBatchTime - Date.now();
        label = 'Next batch in:';
    } else if(activeCampaign.nextMessageTime && activeCampaign.nextMessageTime>Date.now()){
        pending = activeCampaign.nextMessageTime - Date.now();
        label = 'Next message in:';
    }
    if(pending>1500){
      try{ startBatchCountdown(Date.now()+pending,label);}catch{}
      await waitRespectingCampaign(pending);
      try{ stopBatchCountdown(); }catch{}
    }
    if(activeCampaign && activeCampaign.status==='running') processCampaign();
  };
  setTimeout(resumeProcessing,300);
  // Inform popup/background so direct-sender can respect resume
  try { chrome.runtime.sendMessage({action:'resumeCampaign'}); } catch(_){}
  return { success: true };
}

// Handle campaign abort
async function handleCampaignAbort() {
  if (!activeCampaign) {
    throw new Error('No active campaign to abort');
  }
  // set status
  activeCampaign.status = 'aborted';
  activeCampaign.lastUpdateTime = new Date().toISOString();
  // Clear any timers
  try { const highest=setTimeout(()=>{},0); for(let i=highest;i>=0;i--){clearTimeout(i);} } catch {}
  // Notify background
  chrome.runtime.sendMessage({
    action: 'updateCampaignProgress',
    campaignId: activeCampaign.id,
    status: {
      currentIndex: activeCampaign.currentIndex,
      sentCount: activeCampaign.sentCount,
      failedCount: activeCampaign.failedCount,
      status: 'aborted',
      error: 'Aborted by user'
    }
  });
  // Persist removal
  try { await chrome.storage.local.remove('activeCampaign'); } catch {}
  // UI update
  stopBatchCountdown();
  updateFloatingUI(activeCampaign);
  // Reset variables
  messageQueue=[]; processingQueue=false;
  activeCampaign=null;
  // Inform popup/background so direct-sender can respect abort
  try { chrome.runtime.sendMessage({action:'abortCampaign'}); } catch(_){}
  return { success: true };
}

// Complete campaign
function completeCampaign() {
  try {
    if (!activeCampaign) return;
    
    // Update campaign status
    activeCampaign.status = 'completed';
    activeCampaign.lastUpdateTime = new Date().toISOString();
    
    // Notify background script
    chrome.runtime.sendMessage({
      action: 'updateCampaignProgress',
      campaignId: activeCampaign.id,
      status: {
        currentIndex: activeCampaign.currentIndex,
        sentCount: activeCampaign.sentCount,
        failedCount: activeCampaign.failedCount,
        totalContacts: activeCampaign.totalContacts,
        status: 'completed'
      }
    });

    // Persist results for download in popup
    try {
      chrome.storage.local.set({ lastCampaignResults: {
        timestamp: Date.now(),
        successNumbers: activeCampaign.successNumbers || [],
        failedNumbers:  activeCampaign.failedNumbers  || [],
        skippedNumbers: activeCampaign.skippedNumbers || []
      }});
    } catch(e){ console.warn('[WA-Content] Unable to persist lastCampaignResults',e); }

    // Immediately refresh our floating UI so the user sees the "completed" state without waiting for background relay
    try {
      stopBatchCountdown();
      updateFloatingUI(activeCampaign);
    } catch(_) {}
  } catch (error) {
    console.error('[WA-Content] Error completing campaign:', error);
  }
}

// Create and inject floating UI
function createFloatingUI() {
  injectFloatingUIStyles();
  let floatingUI = document.querySelector('.wa-campaign-floating-ui');
  if (floatingUI) {
    floatingUI.style.display = 'block'; // Ensure it's visible if it already exists
    return floatingUI; // Don't recreate if it already exists
  }

  floatingUI = document.createElement('div');
  floatingUI.className = 'wa-campaign-floating-ui';
  floatingUI.style.cursor = 'default';
  floatingUI.innerHTML = `
    <div class="wa-campaign-floating-ui-header">
      <div class="wa-campaign-floating-ui-title">WA Campaign Sender </div>
      <button class="wa-campaign-floating-ui-close" title="Close">&times;</button>
    </div>
    <div class="wa-campaign-floating-ui-content">
      <button class="wa-campaign-floating-ui-button" id="openExtensionPopupBtn" title="Open Broadcast Settings">
        <i class="ri-settings-3-fill" style="font-size:18px;margin-right:6px;"></i>
        Open Settings
      </button>
      <!-- NEW CONTROL BUTTONS -->
      <div class="wa-campaign-floating-ui-controls" style="display:flex; gap:8px; margin-top:8px;">
        <button class="wa-campaign-floating-ui-button" id="pauseResumeFloatingBtn" title="Pause Campaign">⏸ Pause</button>
        <button class="wa-campaign-floating-ui-button" id="stopFloatingBtn"   title="Stop Campaign">⏹ Stop</button>
      </div>
      <!-- END NEW CONTROL BUTTONS -->
      <div class="wa-campaign-floating-ui-status" id="broadcastStatus">Waiting for campaign...</div>
      <div class="wa-campaign-floating-ui-progress" style="display: none;">
        <div class="wa-campaign-floating-ui-progress-bar" id="broadcastProgress" style="width: 0%;"></div>
      </div>
      <div id="batchCountdownContainer" style="display:none;font-size:15px;font-weight:600;align-items:center;gap:4px;">
        <i class="ri-time-fill batch-clock" style="margin-right:4px;"></i> <span style="font-weight:600;">Next batch in:</span> <span id="batchCountdownValue">--:--</span>
      </div>
      <!-- Batch list (collapsible) -->
      <div class="batch-list-wrapper">
        <div class="batch-list-header" id="batchListHeader">
          Batches Queued
          <button id="toggleBatchList" class="batch-toggle-btn" title="Expand/Collapse"><i class="ri-arrow-right-s-fill"></i></button>
        </div>
        <div id="batchListContainer" style="display:none;">
          <div id="batchList"></div>
        </div>
      </div>

      <div class="wa-broadcast-current-number">
        <div class="current-number-label">Currently sending to:</div>
        <div id="currentPhoneNumber" class="current-number-value">-</div>
      </div>

      <button class="wa-campaign-floating-ui-button" id="downloadResultsFloatingBtn" style="display:none;background:#4caf50;align-self:flex-start;">
        <i class="ri-download-2-line" style="margin-right:6px;"></i> Download Results
      </button>
    </div>
  `;

  document.body.appendChild(floatingUI);

  // Add event listeners
  const closeButton = floatingUI.querySelector('.wa-campaign-floating-ui-close');
  const openPopupButton = floatingUI.querySelector('#openExtensionPopupBtn');

  closeButton.addEventListener('click', () => {
    floatingUI.style.display = 'none';
  });

  openPopupButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openExtensionPopup' });
  });
  
  // Listener for campaign status updates from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'campaignStatusUpdate') {
      const statusElement = document.getElementById('broadcastStatus');
      const progressBarContainer = document.querySelector('.wa-campaign-floating-ui-progress');
      const progressBar = document.getElementById('broadcastProgress');
      if (statusElement && progressBar && progressBarContainer) {
        const campaign = message.status;
        if (typeof window._waCurrentIdx === 'undefined') window._waCurrentIdx = -1;
        if (typeof campaign.currentIndex === 'number' && campaign.currentIndex < window._waCurrentIdx) {
          return true; // Ignore stale update
        }
        if (typeof campaign.currentIndex === 'number') window._waCurrentIdx = campaign.currentIndex;
        if (campaign.status === 'running' || campaign.status === 'paused' || campaign.status === 'sending') {
          floatingUI.style.display = 'block'; // Ensure UI is visible
          statusElement.textContent = `Campaign: ${campaign.status} (${campaign.sentCount}/${campaign.totalContacts} sent, ${campaign.failedCount} failed)`;
          progressBarContainer.style.display = 'block';
          const progressPercent = campaign.totalContacts > 0 ? (campaign.currentIndex / campaign.totalContacts) * 100 : 0;
          progressBar.style.width = `${progressPercent}%`;
          const phoneBox=document.getElementById('currentPhoneNumber');
          if(phoneBox && campaign.currentNumber){
            phoneBox.textContent = campaign.currentNumber;
          }
        } else if (campaign.status === 'batch_delay') {
          startBatchCountdown(campaign.nextBatchTime||Date.now());
          statusElement.textContent = `Waiting next batch… (${campaign.sentCount}/${campaign.totalContacts} sent)`;
          progressBarContainer.style.display = 'block';
          const progressPercent = campaign.totalContacts > 0 ? (campaign.currentIndex / campaign.totalContacts) * 100 : 0;
          progressBar.style.width = `${progressPercent}%`;
          // stopBatchCountdown();
        } else if (campaign.status === 'completed') {
          statusElement.textContent = `Campaign completed: ${campaign.sentCount}/${campaign.totalContacts} sent.`;
          progressBar.style.width = '100%';
           setTimeout(() => { progressBarContainer.style.display = 'none'; }, 5000); // Hide progress after 5s
          // stopBatchCountdown();
        } else if (campaign.status === 'failed' || campaign.status === 'aborted') {
          statusElement.textContent = `Campaign ${campaign.status}: ${campaign.error || 'No details'}`;
          progressBarContainer.style.display = 'none';
          // stopBatchCountdown();
        } else {
            statusElement.textContent = 'Waiting for campaign...';
            progressBarContainer.style.display = 'none';
            // stopBatchCountdown();
        }
      }
    }
    return true; // Keep the message channel open for sendResponse, if needed elsewhere
  });

  const pauseResumeButton = floatingUI.querySelector('#pauseResumeFloatingBtn');
  const stopButton        = floatingUI.querySelector('#stopFloatingBtn');

  pauseResumeButton.addEventListener('click', async () => {
    if (!activeCampaign) return;
    try {
      if (['running','waiting','batch_delay'].includes(activeCampaign.status)) {
        pauseResumeButton.disabled = true;
        await handleCampaignPause();
        pauseResumeButton.disabled = false;
        pauseResumeButton.textContent = '▶ Resume';
        pauseResumeButton.title = 'Resume Campaign';
      } else if (activeCampaign.status === 'paused') {
        pauseResumeButton.disabled = true;
        await handleCampaignResume();
        pauseResumeButton.disabled = false;
        pauseResumeButton.textContent = '⏸ Pause';
        pauseResumeButton.title = 'Pause Campaign';
      }
    } catch(e){ console.error('[WA-Content] pause/resume error',e); pauseResumeButton.disabled=false; }
  });

  stopButton.addEventListener('click', async () => {
    if (!activeCampaign) return;
    if (!confirm('Are you sure you want to stop the campaign?')) return;
    stopButton.disabled = true;
    try {
      await handleCampaignAbort();
      stopButton.textContent = 'Stopped';
      pauseResumeButton.disabled = true;
    } catch(e){ console.error('[WA-Content] stop error',e); stopButton.disabled=false; }
  });

  // Download results button
  const downloadResultsBtn = floatingUI.querySelector('#downloadResultsFloatingBtn');
  if (downloadResultsBtn) {
    downloadResultsBtn.addEventListener('click', exportCampaignResultsCSV);
  }

  // Batch list toggle
  const batchHeader = floatingUI.querySelector('#batchListHeader');
  if(batchHeader){
    const listContainer = floatingUI.querySelector('#batchListContainer');
    const toggleBtn = floatingUI.querySelector('#toggleBatchList');
    batchHeader.addEventListener('click', () => {
      const isOpen = listContainer.style.display === 'block';
      listContainer.style.display = isOpen ? 'none' : 'block';
      if(toggleBtn){ toggleBtn.classList.toggle('rotate', !isOpen); }
    });
  }

  // -------- Make floating UI draggable via its header --------
  (function enableDrag(elem){
    const header = elem.querySelector('.wa-campaign-floating-ui-header');
    if(!header) return;
    let offsetX=0, offsetY=0, dragging=false;
    header.style.cursor='move';
    header.addEventListener('mousedown',(e)=>{
      dragging=true;
      const rect=elem.getBoundingClientRect();
      offsetX=e.clientX-rect.left; offsetY=e.clientY-rect.top;
      document.body.style.userSelect='none';
    });
    document.addEventListener('mousemove',(e)=>{
      if(!dragging) return;
      let x=e.clientX-offsetX; let y=e.clientY-offsetY;
      // keep inside viewport
      x=Math.max(0, Math.min(window.innerWidth-elem.offsetWidth, x));
      y=Math.max(0, Math.min(window.innerHeight-elem.offsetHeight, y));
      elem.style.left=x+'px'; elem.style.top=y+'px';
      elem.style.right='auto'; elem.style.bottom='auto';
    });
    document.addEventListener('mouseup',()=>{dragging=false; document.body.style.userSelect='';});
  })(floatingUI);

  return floatingUI;
}

// Remove the old startBroadcast function from content.js, as it will be handled by the popup
// async function startBroadcast() { ... } // This function is no longer needed here

// Ensure createFloatingUI is called to attach the campaignStatusUpdate listener early
// It will be hidden by default if no campaign is active
// We also need to ensure it's only created once.
let globalFloatingUI = null;
function ensureFloatingUIVisible() {
    if (!globalFloatingUI) {
        globalFloatingUI = createFloatingUI();
    }
    globalFloatingUI.style.display = 'block';
}

// Modify sidebar icon click to use ensureFloatingUIVisible
// ... in injectSidebarIcon() ...
// iconBtn.addEventListener('click', () => {
//   ensureFloatingUIVisible(); 
// });

// Modify initializeFloatingUI - it should still create the UI on load but maybe keep it hidden initially
function initializeFloatingUI() {
  const checkInterval = setInterval(() => {
    if (document.querySelector('#side')) { // WhatsApp Web is loaded
      clearInterval(checkInterval);
      if (!document.querySelector('.wa-campaign-floating-ui')) { // Create only if not exists
          globalFloatingUI = createFloatingUI();
          // Check initial campaign state from storage to show UI if active campaign exists
          chrome.storage.local.get('activeCampaign', (result) => {
              if (result.activeCampaign && (result.activeCampaign.status === 'running' || result.activeCampaign.status === 'paused')) {
                  globalFloatingUI.style.display = 'block';
                  // Trigger an update to populate with current data
                   chrome.runtime.sendMessage({ action: 'requestCampaignStatusUpdate' });
              } else {
                  globalFloatingUI.style.display = 'none'; // Hide by default
              }
          });
      }
    }
  }, 1000);
}

// --- Sidebar Icon Injection ---
function injectSidebarIcon() {
  // Wait for the sidebar to be available
  const sidebarInterval = setInterval(() => {
    // Target the main sidebar container
    const sidebar = document.querySelector('#side');
    // Also check for the standard icons container if #side is found, to place it more accurately
    const iconContainer = sidebar ? sidebar.querySelector('div[role="navigation"] > div') : null; // This selector might need adjustment

    const targetElement = iconContainer || sidebar;

    if (targetElement && !document.getElementById('wa-campaign-sidebar-icon')) {
      clearInterval(sidebarInterval);

      // Create the icon button
      const iconBtn = document.createElement('button');
      iconBtn.id = 'wa-campaign-sidebar-icon';
      iconBtn.title = 'WA Campaign Sender';
      iconBtn.style.background = 'none';
      iconBtn.style.border = 'none';
      iconBtn.style.cursor = 'pointer';
      iconBtn.style.margin = '8px 0'; // Add some vertical margin
      iconBtn.style.padding = '0'; // Remove default button padding
      iconBtn.style.display = 'flex';
      iconBtn.style.alignItems = 'center';
      iconBtn.style.justifyContent = 'center';
      iconBtn.style.width = '48px'; // Standard icon width
      iconBtn.style.height = '48px'; // Standard icon height
      iconBtn.style.borderRadius = '50%';
      iconBtn.style.transition = 'background 0.2s';
      // Add hover effect similar to WhatsApp icons
      iconBtn.onmouseover = () => iconBtn.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
      iconBtn.onmouseout = () => iconBtn.style.backgroundColor = 'transparent';
      iconBtn.style.flexShrink = '0'; // Prevent shrinking

      // SVG icon (simple broadcast icon) - keep the same green color
      iconBtn.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="#25D366" stroke-width="2" fill="none"/>
          <path d="M8 12h8M12 8v8" stroke="#25D366" stroke-width="2" stroke-linecap="round"/>
        </svg>
      `;
      // Click handler: show floating UI
      iconBtn.addEventListener('click', () => {
        ensureFloatingUIVisible();
      });

      // Append to the target element (ideally the icon container, or sidebar as fallback)
      targetElement.appendChild(iconBtn);
       console.log('[WA-Content] Sidebar icon injected.');
    }
  }, 500); // Check more frequently
}

// Call this after WhatsApp Web is loaded and extension is initialized
function initializeSidebarIcon() {
  // Only inject after extension is initialized and WhatsApp is loaded
  if (isInitialized && isWhatsAppLoaded) {
    injectSidebarIcon();
  } else {
    // Wait until both are true
    const waitInterval = setInterval(() => {
      if (isInitialized && isWhatsAppLoaded) {
        clearInterval(waitInterval);
        injectSidebarIcon();
      }
    }, 1000);
  }
}

/**
 * Attempt to send a text message directly through WhatsApp Web internal Store API.
 * Avoids any navigation / UI interaction. Returns true on success, false otherwise.
 */
async function storeSendTextMessage(number, text) {
  if (!USE_STORE_API) return false;
  try {
    // Ensure Store is ready (wait up to 15 s)
    const ready = await waitForStore(15000);
    if (!ready || !window.Store || !window.Store.Chat) {
      return false; // Store not ready
    }

    const chatId = `${number}@c.us`;

    // Attempt to locate existing chat
    let chat = await window.Store.Chat.find(chatId);

    // If chat does not exist yet, try to create/insert it using internal helpers
    if (!chat) {
      try {
        // 1) Use WidFactory (preferred modern API)
        const widFactory = (window.MyWAppStore && window.MyWAppStore.WidFactory) || window.Store.WidFactory;
        if (widFactory && typeof widFactory.createWid === 'function') {
          const wid = widFactory.createWid(chatId);
          chat = await window.Store.Chat.find(wid);
        }
      } catch (_) { /* ignore */ }

      // 2) Fallback: if addAndSendMsgToChat is available, it can both create and send
      if (!chat) {
        const directSender = (window.MyWAppStore && window.MyWAppStore.addAndSendMsgToChat) || window.addAndSendMsgToChat;
        if (directSender && typeof directSender === 'function') {
          await directSender(chatId, text);
          return true; // message sent, no UI interaction
        }
      }

      // If still no chat object we cannot proceed
      if (!chat) return false;
    }

    // At this point we have a chat and SendTextMsgToChat helper
    if (!window.Store.SendTextMsgToChat) {
      // Try to obtain it from MyWAppStore if it was exposed there
      if (window.MyWAppStore && window.MyWAppStore.SendTextMsgToChat) {
        window.Store.SendTextMsgToChat = window.MyWAppStore.SendTextMsgToChat;
      }
    }
    if (!window.Store.SendTextMsgToChat) return false;

    await window.Store.SendTextMsgToChat(chat, text, {});
    return true;
  } catch (err) {
    console.warn('[WA-Content] storeSendTextMessage failed:', err);
    return false;
  }
}

/* ---------- Legacy URL sender helpers (from campign_send_logic) ---------- */
async function legacySendMessage(contact, textTemplate, attach) {
  try {
    // Define a variable to track success at each stage
    let sendAttempted = false;
    let sendSuccess = false;
    
    // Get the phone number for validation - Enhanced detection
    const phoneNumberRaw = contact?.Phone || contact?.phone || contact?.PHONE || contact?.PhoneNumber || contact?.phoneNumber || contact?.number || contact?.Number;
    if (!phoneNumberRaw) {
      throw new Error('Phone number is missing in contact object');
    }
    const phoneNumber = phoneNumberRaw.toString().replace(/\D/g, '');
    
    // First, check if the number is invalid or blocked before attempting to send
    const invalidCheck = await waitForInvalidNumberDialog(2000); // Wait 2 seconds for invalid number dialog
    if (invalidCheck) {
      console.log(`[WA-Content] Detected invalid/blocked number: ${phoneNumber}`);
      throw new Error('Invalid or blocked number');
    }

    // Attempt to use internal Store API first – works even when the tab is backgrounded
    const tryStoreApi = async () => {
      if (!USE_STORE_API) return false;
      try {
        // Ensure Store has had a chance to initialise – particularly important immediately after page/tab becomes backgrounded
        if (!window.Store || !window.Store.Chat) {
          // One-time capability probe – if we previously detected WA Store unavailable skip further waits
          if (window.__waStoreApiUnavailable === true) return false;

          const ready = await waitForStore(3000); // try quickly (3 s) for first contact
          if (!ready || !window.Store || !window.Store.Chat) {
            // Mark as unavailable so future messages skip this path instantly
            window.__waStoreApiUnavailable = true;
            return false;
          }
        }
        const phoneNumberRaw = contact.Phone || contact.phone || contact.PHONE;
        if (!phoneNumberRaw) return false;
        const phoneNumber = phoneNumberRaw.toString().replace(/\D/g, '');

        // If there is an attachment and sendImage helper is ready, use it
        if (attach) {
          if (typeof window.sendImage !== 'function') {
            // Wait for the helper bridge event or until timeout
            await new Promise(res => {
              let resolved = false;
              const to = setTimeout(() => { if (!resolved) res(); }, 7000);
              const handler = () => { if (!resolved) { resolved = true; clearTimeout(to); res(); } };
              document.addEventListener('WASendImageBridgeReady', handler, { once: true });
            });
          }
          if (typeof window.sendImage === 'function') {
            const sanitizedCaption = sanitizeMessageText(textTemplate || '');
            console.log(`[WA-Content] Sending ${attach.type} via Store API to ${phoneNumber} with caption length ${sanitizedCaption.length}`);
            try {
              await window.sendImage(`${phoneNumber}@c.us`, attach, sanitizedCaption, 1);
              console.log('[WA-Content] Store API sendImage succeeded');
              return true;
            } catch (sErr) {
              console.warn('[WA-Content] Store API sendImage failed:', sErr);
              return false;
            }
          }
        }

        // Otherwise, fall back to text-only send via Store
        if (!attach && typeof storeSendTextMessage === 'function') {
          console.log(`[WA-Content] Sending text-only via Store API to ${phoneNumber}`);
          try {
            const ok = await storeSendTextMessage(phoneNumber, sanitizeMessageText(textTemplate || ''));
            console.log('[WA-Content] Store API text send result:', ok);
            return ok;
          } catch (stErr) {
            console.warn('[WA-Content] Store API text send failed:', stErr);
            return false;
          }
        }
      } catch (err) {
        console.warn('[WA-Content] Store-API path failed, will fall back to UI:', err);
      }
      return false;
    };

    // Prefer Store API when the tab is hidden or unfocused (background) – or always try first
    const storeSucceeded = await tryStoreApi();
    if (storeSucceeded) {
      sendAttempted = true;
      sendSuccess = true;
      return true;
    }

    // 1. Personalize the message template using contact data
    let personalizedText = textTemplate;
    try {
      for (const key in contact) {
        if (Object.hasOwnProperty.call(contact, key)) {
          const placeholder = new RegExp(`{{\s*${key}\s*}}`, 'gi');
          personalizedText = personalizedText.replace(placeholder, contact[key] || '');
        }
      }
      personalizedText = personalizedText.replace(/{{\s*[^}]+\s*}}/gi, '');
    } catch (personalizationErr) {
      console.warn('[WA-Content] Template personalization error:', personalizationErr);
      // Continue with whatever we have in personalizedText
    }
    

    
    let plainText = sanitizeMessageText(personalizedText);

    // Use the phone number we already extracted at the start of the function
    if (!phoneNumberRaw) {
      console.error('[WA-Content] Phone number not found in contact object:', contact);
      throw new Error('Phone number missing in contact object');
    }

    // Check if we're on Linux by examining the platform and user agent
    const isLinux = false; // Linux support disabled
    
    // Check if we're on Firefox
    const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
    
    // Ensure any previous media composer is closed before proceeding
    try {
      await waitForMediaComposerClose(4000);
    } catch (e) {
      console.warn('[WA-Content] Media composer close wait error (continuing):', e);
    }

    // Set up retries for navigation
    const maxNavigationAttempts = 2;
    let navigationAttempts = 0;
    let navigated = false;

    // Navigation retry loop
    while (!navigated && navigationAttempts < maxNavigationAttempts) {
      navigationAttempts++;
      
      try {
        if (attach) {
          // EMERGENCY: WhatsApp broke attachment system - send text only with attachment note
          console.warn(`[WA-Content] EMERGENCY: WhatsApp attachment system broken - sending text only to ${phoneNumber}`);
          
          // Add attachment info to message
          const attachmentNote = `\n\n📎 [Attachment: ${attach.name || 'file'} - ${(attach.size/1024/1024).toFixed(1)}MB]\n(Attachment system temporarily unavailable due to WhatsApp changes)`;
          plainText += attachmentNote;
          
          // Send as text message
          await createMessageLink(phoneNumber, plainText);
          const navResult = await waitForChatOrInvalid(12000, phoneNumber);
          if (navResult.invalid) {
            console.warn('[WA-Content] Invalid/blocked number detected – skipping');
            return false;
          }
          
          // Send text message
          const inputSelector = 'div[contenteditable="true"][data-tab]';
          const inputElement = await waitForElement(inputSelector, 10000);
          
          if (!inputElement) {
            throw new Error('Input element not found');
          }
          
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Try send button
          let sent = false;
          sendAttempted = true;
          
          const sendButtonTestId = document.querySelector('button[data-testid="send"]');
          if (sendButtonTestId) {
            sendButtonTestId.click();
            sent = true;
            console.log('[WA-Content] Emergency text message sent');
          }
          
          if (!sent) {
            const sendButtonAriaLabel = document.querySelector('button[aria-label="Send"]');
            if (sendButtonAriaLabel) {
              sendButtonAriaLabel.click();
              sent = true;
            }
          }
          
          sendSuccess = sent;
          navigated = sent;
          if (sent) break;
        } else {
          // For text-only messages
          console.log(`[WA-Content] Sending text-only message to ${phoneNumber} via deeplink.`);
          
          await createMessageLink(phoneNumber, plainText);
          // ---------- EARLY INVALID-NUMBER DIALOG CHECK (imported from Backup build) ----------
          // Some builds surface the "phone number is not on WhatsApp" alert almost instantly
          // after deeplink navigation.  Detect it now so we can skip this contact without
          // waiting for the broader 12-second waitForChatOrInvalid timeout.
          const earlyInvalidDlg = await waitForInvalidNumberDialog(4000);
          if (earlyInvalidDlg) {
            console.warn('[WA-Content] Invalid/blocked number detected immediately after deeplink – skipping');
            return false;
          }
          // Quickly determine whether the chat panel loaded or an invalid/blocked dialog appeared.
          // Using waitForChatOrInvalid lets us proceed as soon as the chat is ready instead of
          // waiting a fixed timeout when the number is valid, which significantly speeds up
          // text-only campaigns.
          const navResult = await waitForChatOrInvalid(12000, phoneNumber);
          if (navResult.invalid) {
            console.warn('[WA-Content] Invalid/blocked number detected after text navigation – skipping');
            return false;
          }
           
           const inputSelector = 'div[contenteditable="true"][data-tab]';
           const inputElement = await waitForElement(inputSelector, 10000);
           
           if (!inputElement) {
             console.warn('[WA-Content] Could not find input element after navigation');
             if (navigationAttempts < maxNavigationAttempts) {
               console.log('[WA-Content] Will retry navigation');
               await new Promise(r => setTimeout(r, 1000));
               continue;
             } else {
               throw new Error('Input element not found after multiple attempts');
             }
           }
           
           // Brief delay before sending – 200 ms is generally enough for the send button to enable
           // after the chat becomes active.  This small reduction improves throughput without
           // compromising reliability.
           await new Promise(resolve => setTimeout(resolve, 200));
           
           // Try multiple send button selectors in sequence
           let sent = false;
           sendAttempted = true;
           
           // Approach 1: data-testid="send"
           const sendButtonTestId = document.querySelector('button[data-testid="send"]');
           if (sendButtonTestId && typeof sendButtonTestId.click === 'function') {
             try {
               sendButtonTestId.click();
               sent = true;
               console.log('[WA-Content] Send attempted with button[data-testid="send"]');
             } catch (e) { console.warn('[WA-Content] Error clicking button[data-testid="send"]', e); }
           }
           
           // Approach 2: aria-label="Send"
           if (!sent) {
             const sendButtonAriaLabel = document.querySelector('button[aria-label="Send"]');
             if (sendButtonAriaLabel && typeof sendButtonAriaLabel.click === 'function') {
               try {
                 sendButtonAriaLabel.click();
                 sent = true;
                 console.log('[WA-Content] Send attempted with button[aria-label="Send"]');
               } catch (e) { console.warn('[WA-Content] Error clicking button[aria-label="Send"]', e); }
             }
           }
           
           // Approach 3: span parent
           if (!sent) {
             const sendIconSpan = document.querySelector('span[data-testid="send"]');
             if (sendIconSpan && sendIconSpan.closest('button') && typeof sendIconSpan.closest('button').click === 'function') {
               try {
                 sendIconSpan.closest('button').click();
                 sent = true;
                 console.log('[WA-Content] Send attempted with span[data-testid="send"] parent button');
               } catch (e) { console.warn("[WA-Content] Error clicking span[data-testid=\"send\"]'s parent button", e); }
             }
           }
           
           // Approach 4: Enter key simulation
           if (!sent) {
             const input = document.querySelector(inputSelector);
             if (input) {
               try {
                 input.focus();
                 input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                 input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                 input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                 console.log('[WA-Content] Send attempted with Enter key');
                 sent = true;
               } catch (e) { console.warn('[WA-Content] Error dispatching Enter key', e); }
             }
           }
           
           if (!sent) {
             console.warn('[WA-Content] All automatic send attempts failed.');
             if (navigationAttempts < maxNavigationAttempts) {
               console.log('[WA-Content] Will retry navigation');
               await new Promise(r => setTimeout(r, 1000));
               continue;
             }
           } else {
             sendSuccess = true;
             navigated = true;
             break;
           }
         }
       } catch (navErr) {
         console.warn(`[WA-Content] Navigation attempt ${navigationAttempts} failed:`, navErr);
         if (navigationAttempts < maxNavigationAttempts) {
           console.log('[WA-Content] Will retry navigation');
           await new Promise(r => setTimeout(r, 1000));
         }
       }
     }

     // Wait for confirmation only for plain-text messages. Attachments upload in background so we continue immediately.
     if (sendSuccess && !attach) {
       try {
         const messageSent = await waitForMessageSent(6000);
         if (!messageSent) {
           console.log('[WA-Content] No message sent confirmation – marking as failed');
           sendSuccess = false;
         } else {
           console.log('[WA-Content] Message sent confirmation received');
         }
       } catch (e) {
         console.warn('[WA-Content] Error waiting for message sent confirmation:', e);
         sendSuccess = false;
       }
     }
     
     // --- Post-send sanity check: WhatsApp sometimes shows the invalid-number dialog a few
     // seconds *after* we tried to send (especially when deeplink forced chat creation).
     //  If that dialog pops up we must treat the attempt as failed so the number ends up in
     // the Failed list & doesn't inflate the success count.
     if (sendSuccess) {
       const lateInvalidDlg = await waitForInvalidNumberDialog(3000);
       if (lateInvalidDlg) {
         console.warn('[WA-Content] Late invalid/blocked dialog appeared – marking number as failed');
         sendSuccess = false;
       }
     }
     
     // Succeed only if WhatsApp confirmed delivery *and* no invalid dialog showed up
     return !!sendSuccess;
   } catch (err) {
     console.error('legacySendMessage error:', err);
     return false;
   }
 }

/**
 * Send an attachment by directly populating WhatsApp Web's hidden <input type="file"> element.
 * This avoids opening any native file-chooser dialog (which would fail without a user gesture)
 * and does not rely on the fragile clipboard trick.  Works for images/videos & generic documents.
 */
async function sendAttachmentViaClipboard(fileObj, caption = '') {
  try {
    console.error('[WA-Content] FILEINPUT: DISABLED - WhatsApp attachment system broken by internal changes');
    console.log('[WA-Content] FILEINPUT: File:', fileObj.name, 'Size:', (fileObj.size/1024/1024).toFixed(1), 'MB');
    
    // Return false to trigger text-only fallback
    return false;
    // Video attachments are now allowed – removed previous early return.

    // DISABLE silent attachment for images completely to prevent sticker conversion
    const isImageFileGlobal = fileObj.type.startsWith('image/');
    const isVideoFileGlobal = fileObj.type.startsWith('video/');
    const turboModeEnabled = (typeof activeCampaign !== 'undefined' && activeCampaign?.turboModeEnabled);
    
    if (isImageFileGlobal) {
      console.log('[WA-Content] FILEINPUT: Skipping ALL silent methods for images to prevent sticker conversion.');
    } else if (isVideoFileGlobal && turboModeEnabled) {
      console.log('[WA-Content] FILEINPUT: Skipping silent methods for videos in Turbo Mode to prevent double injection');
      // Skip silent methods for videos to prevent multiple injections
      // Videos will use the standard attachment menu approach only
    } else if (!isImageFileGlobal) {
      // NEW APPROACH: Try to send silently without opening the attachment popup menu (non-images only)
      try {
        const success = await sendAttachmentSilently(fileObj, caption);
        if (success) {
          console.log('[WA-Content] FILEINPUT: Silent attachment method successful');
          return true;
        }
      } catch (silentErr) {
        console.warn('[WA-Content] FILEINPUT: Silent attachment method failed:', silentErr);
        // Fall back to the regular approach
      }
    }

    // SECOND APPROACH: Try to find hidden file inputs without opening the UI (skip for videos to avoid double-preview)
    try {
      const isLinuxEnv = navigator.platform?.toLowerCase().includes('linux') || navigator.userAgent.toLowerCase().includes('linux');
      const turboFastMode2 = (typeof activeCampaign !== 'undefined' && activeCampaign?.turboModeEnabled);
      const isLinuxEnvTurbo = isLinuxEnv || turboFastMode2;
      const isImage = fileObj.type.startsWith('image/');
      const isVid  = fileObj.type.startsWith('video/');
      if (isVid) {
        // Skip hidden inputs for videos completely to prevent double injection
        console.log('[WA-Content] FILEINPUT: Skipping hidden input for videos to prevent multiple appearances');
        throw 'skipHiddenForVideo';
      }
      // DISABLE hidden input approach for images to prevent sticker conversion
      if (isImage) {
        console.log('[WA-Content] FILEINPUT: Skipping hidden input approach for images to prevent sticker conversion');
        throw 'skipHiddenForImages';
      }
      const hiddenInputs = (!isImage || isLinuxEnvTurbo) ? findHiddenFileInputs() : [];
      if (hiddenInputs.length > 0) {
        console.log(`[WA-Content] FILEINPUT: Found ${hiddenInputs.length} hidden file inputs without opening UI`);
        let targetInput = null;
        
        // Choose the appropriate input based on file type
        if (fileObj.type.startsWith('image/') || fileObj.type.startsWith('video/')) {
          targetInput = hiddenInputs.find(input => 
            input.accept && (input.accept.includes('image/') || input.accept.includes('video/'))
          );
        } else {
          // For documents
          targetInput = hiddenInputs.find(input => 
            !input.accept || input.accept === '*' || input.accept.includes('application/')
          );
        }
        
        if (targetInput) {
          console.log('[WA-Content] FILEINPUT: Found suitable hidden input without opening UI');
          
          try {
            // Reset the input before adding a new file
            try {
              targetInput.value = '';
            } catch (e) {
              // Some browsers don't allow direct value setting on file inputs
            }
            
            // Set the file on the input
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(fileObj);
            targetInput.files = dataTransfer.files;
            
            // Dispatch a change event
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log('[WA-Content] FILEINPUT: File injected into hidden input & change event dispatched');
            
            // Wait longer for videos so the preview can render
            await new Promise(r => setTimeout(r, fileObj.type.startsWith('video/') ? 4000 : 1500));
            
            // Look for indications that it worked
            const mediaPreview = document.querySelector('div[data-testid="media-canvas"], div[data-icon="media-image"], .media-viewer-thumbs');
            if (mediaPreview) {
              console.log('[WA-Content] FILEINPUT: Media preview found after using hidden input');
              
              // Add caption if provided
              if (caption) {
                // Wait up to 6s for caption box to appear (video previews sometimes take longer)
                const captionInput = await new Promise((resolve)=>{
                  const selectors = [
                    'div[contenteditable="true"][data-testid="media-caption-input"]',
                    'div[contenteditable="true"][aria-label*="caption"]',
                    'div[contenteditable="true"][aria-placeholder*="caption"]',
                    'div[role="dialog"] div[contenteditable="true"][data-lexical-editor="true"]',
                    'div[role="dialog"] div[contenteditable="true"]',
                    'div[contenteditable="true"][data-lexical-editor="true"][aria-placeholder*="caption"]'
                  ];
                  const deadline = Date.now()+6000;
                  const poll=()=>{
                    const el = document.querySelector(selectors.join(','));
                    if(el) return resolve(el);
                    if(Date.now()>deadline) return resolve(null);
                    setTimeout(poll,200);
                  };
                  poll();
                });

                if (captionInput) {
                  captionInput.focus();
                  captionInput.innerHTML = '';
                  document.execCommand && document.execCommand('insertText', false, caption);
                  captionInput.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'insertText',
                    data: caption
                  }));
                } else {
                  console.warn('[WA-Content] Caption input not found – will append text after media send');
                  window._pendingMediaCaption = caption;
                }
              }
              
              // Click send – wait until the button is enabled (videos may take a while to finish encoding)
              let sendBtn = document.querySelector('button[data-testid="send"], button[aria-label="Send"], div[aria-label="Send"][role="button"]');
              if (sendBtn) {
                // If the button is disabled (videos still processing) wait until it becomes enabled or timeout 60s
                const startWait = Date.now();
                while ((sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true') && (Date.now() - startWait < 60000)) {
                  await new Promise(r => setTimeout(r, 500));
                  sendBtn = document.querySelector('button[data-testid="send"], button[aria-label="Send"], div[aria-label="Send"][role="button"]');
                  if (!sendBtn) break;
                }
                if (sendBtn && !(sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true')) {
                  sendBtn.click();
                  console.log('[WA-Content] FILEINPUT: Send button clicked');
                  return true;
                } else {
                  console.warn('[WA-Content] FILEINPUT: Send button remained disabled, aborting video send');
                }
              }
            }
          } catch (err) {
            console.warn('[WA-Content] FILEINPUT: Error using hidden input without UI:', err);
          }
        }
      }
    } catch (hiddenInputErr) {
      console.warn('[WA-Content] FILEINPUT: Error finding hidden inputs:', hiddenInputErr);
    }

    // 1) Open the attachment pop-up (plus/clip icon) so WhatsApp renders the <li> items with file inputs.
    const attachmentButton = await findAttachmentButton();
    if (!attachmentButton) {
      console.error('[WA-Content] FILEINPUT: Attachment (clip) button not found.');
      return false;
    }
    attachmentButton.click();

    // 2) Wait for attachment menu or its file inputs to appear (layout differs across builds)
    const menuSelectors = [
      'div[role="application"] ul',   // classic
      'ul[role="menu"]',              // new aria role
      'div[role="dialog"] ul',        // pop-up rendered inside dialog
      'li[role="button"] input[type="file"]' // directly look for file inputs
    ];
    let menuEl = null;
    for (const sel of menuSelectors) {
      menuEl = await waitForElement(sel, 1600).catch(() => null);
      if (menuEl) break;
    }
    if (!menuEl) {
      console.warn('[WA-Content] FILEINPUT: Attachment menu container not detected – will scan document for inputs directly.');
    }

    const liList = (menuEl ? menuEl.querySelectorAll('li[role="button"]') : document.querySelectorAll('li[role="button"]'));

    // Choose the LI corresponding to the file category (photos/videos vs documents)
    let chosenLi = null;
    const isImageFile = fileObj.type.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp)$/i.test(fileObj.name || '');
    const isVideoFile = fileObj.type.startsWith('video/') || /\.(mp4|3gpp|mov|webm)$/i.test(fileObj.name || '');

    // WhatsApp limits the photo/video picker to ~16 MB.  Larger videos must be sent as a "Document".
    // Detect this early so we choose the correct <li> (document) rather than the media one.
    const BYTES_16MB = 16 * 1024 * 1024;
    const treatVideoAsDocument = isVideoFile && fileObj.size > BYTES_16MB;

    // 1) Prefer matching by input.accept attribute (language-agnostic)
    for (const li of liList) {
      const input = li.querySelector('input[type="file"]');
      if (!input) continue;
      const acc = input.getAttribute('accept') || '';
      const textLabel = (li.innerText || '').toLowerCase();

      // Skip obvious sticker option by heuristics
      if (textLabel.includes('sticker')) continue;

      const labelIndicatesMedia = /(photo|image|video|gallery|media)/.test(textLabel);
      if (!treatVideoAsDocument) {
        if (isImageFile && acc.includes('image') && labelIndicatesMedia) { chosenLi = li; break; }
        if (isVideoFile && acc.includes('video') && labelIndicatesMedia) { chosenLi = li; break; }
      }
    }

    // 2) Fallback to text label matching (covers older WA builds)
    if (!chosenLi) {
      for (const li of liList) {
        const text = li.innerText?.toLowerCase() || '';
        if (!treatVideoAsDocument) {
          if ((isImageFile || isVideoFile) && (text.includes('photo') || text.includes('video'))) { chosenLi = li; break; }
        }
        // Fallback to document button for large videos or generic files
        if ((treatVideoAsDocument || (!isImageFile && !isVideoFile)) && (text.includes('document') || text.includes('file'))) { chosenLi = li; }
      }
    }

    if (chosenLi && typeof chosenLi.click === 'function') {
      chosenLi.click();
      await new Promise(r=>setTimeout(r,200));
    }

    // Prefer the input belonging to the chosen <li> (guaranteed correct category)
    if (chosenLi) {
      const liInput = chosenLi.querySelector('input[type="file"]');
      if (liInput) {
        targetInput = liInput;
      }
    }

    // Fallback: search for an input by accept type but exclude any that sit inside a "New sticker" entry
    if (!targetInput) {
      let attrSel = 'input[type="file"]';
      if (isImageFile) {
        attrSel = 'input[accept*="image"]';
      } else if (isVideoFile && !treatVideoAsDocument) {
        // any input that explicitly lists video types
        attrSel = 'input[accept*="video"], input[accept*="mp4"], input[accept*="webm"], input[accept*="ogg"], input[accept*="mov"], input[accept*="avi"], input[accept*="mkv"]';
      } else {
        // generic document picker (accept="*" or undefined)
        attrSel = 'input[accept="*"] , input:not([accept])';
      }

      const candidateInputs = Array.from((menuEl || document).querySelectorAll(attrSel));
      targetInput = candidateInputs.find(inp => {
        const li = inp.closest('li[role="button"]');
        const txt = (li?.innerText || '').toLowerCase();
        return !txt.includes('sticker'); // avoid New sticker button
      }) || candidateInputs[0] || null;
    }

    if (!targetInput) {
      console.error('[WA-Content] FILEINPUT: No suitable file input found.');
      return false;
    }

    // Reset the input before adding a new file (helps on Linux)
    try {
      targetInput.value = '';
    } catch (e) {
      // Some browsers don't allow direct value setting on file inputs
      console.log('[WA-Content] FILEINPUT: Could not reset input value:', e);
    }

    // Generate thumbnail for the image if possible
    if (fileObj.type.startsWith('image/')) {
      const thumbnailDataUrl = await generateThumbnail(fileObj);
      if (thumbnailDataUrl) {
        console.log('[WA-Content] FILEINPUT: Thumbnail generated successfully');
        
        // Create a hidden img element with the thumbnail and add to document temporarily
        // This helps WhatsApp's media manager detect and process the image
        const thumbImg = document.createElement('img');
        thumbImg.src = thumbnailDataUrl;
        thumbImg.style.position = 'absolute';
        thumbImg.style.top = '-9999px';
        thumbImg.style.left = '-9999px';
        document.body.appendChild(thumbImg);
        
        // Give it some time to be processed by the browser
        await new Promise(r => setTimeout(r, 300));
        
        // Remove after a small delay
        setTimeout(() => {
          try {
            if (thumbImg.parentNode) {
              thumbImg.parentNode.removeChild(thumbImg);
            }
          } catch (e) {
            // Ignore cleanup errors
          }
        }, 2000);
      }
    }

    // 4) Programmatically set the file on the input without triggering the picker.
    try {
      // Method 1: Try standard DataTransfer (works in Chrome/Edge on Windows)
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(fileObj);
      targetInput.files = dataTransfer.files;
      console.log('[WA-Content] FILEINPUT: Standard DataTransfer method used');
    } catch (err) {
      console.warn('[WA-Content] FILEINPUT: Standard DataTransfer failed:', err);
      try {
        // Method 2: Try FileList mock (works in some Linux environments)
        const fileList = {
          0: fileObj,
          length: 1,
          item: (idx) => idx === 0 ? fileObj : null
        };
        Object.defineProperty(targetInput, 'files', {
          value: fileList,
          writable: true
        });
        console.log('[WA-Content] FILEINPUT: FileList mock method used');
      } catch (err2) {
        console.error('[WA-Content] FILEINPUT: Alternative file assignment failed too:', err2);
        // Method 3: Try to recreate the input (sometimes helps in Linux)
        try {
          const newInput = document.createElement('input');
          newInput.type = 'file';
          newInput.style.display = 'none';
          if (targetInput.accept) newInput.accept = targetInput.accept;
          if (targetInput.multiple) newInput.multiple = targetInput.multiple;
          
          // Replace the old input with our new one
          targetInput.parentNode.insertBefore(newInput, targetInput);
          targetInput.parentNode.removeChild(targetInput);
          targetInput = newInput;
          
          // Now try setting files again
          const dt = new DataTransfer();
          dt.items.add(fileObj);
          targetInput.files = dt.files;
          console.log('[WA-Content] FILEINPUT: Input recreation method used');
        } catch (err3) {
          console.error('[WA-Content] FILEINPUT: All file assignment methods failed:', err3);
          // Method 4: Last resort for Linux - try clipboard paste simulation
          try {
            console.log('[WA-Content] FILEINPUT: Attempting clipboard simulation as last resort');
            
            // Close the attachment menu by clicking elsewhere
            document.body.click();
            
            // Use the clipboard approach as a final fallback
            if(fileObj.type.startsWith('image/')){
              console.warn('[WA-Content] Skipping clipboard fallback for image to avoid sticker conversion.');
              return false;
            }
            console.log('[WA-Content] Attempting clipboard-based approach as fallback');
            return await clipboardFallbackForLinux(fileObj, caption);
          } catch (err4) {
            console.error('[WA-Content] FILEINPUT: All methods failed, including clipboard fallback:', err4);
            return false;
          }
        }
      }
    }

    // 5) Dispatch a change event so WhatsApp processes the file.
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('[WA-Content] FILEINPUT: File injected into hidden input & change event dispatched.');

    // 5.1) Enhanced file preview processing - we need to directly help WhatsApp display thumbnails
    if (fileObj.type.startsWith('image/')) {
      try {
        // Find the preview container where WhatsApp should render the image thumb
        await new Promise(r => setTimeout(r, 600)); // First wait for initial processing
        
        // Look for preview containers
        const previewSelectors = [
          'div[data-testid="media-canvas"]',
          'div[data-icon="media-image"]',
          'div.img-zoomed-in',
          'div[role="application"] div[data-testid="media-gallery-modal"]',
          'div[role="dialog"] div[data-testid="image-thumb"]',
          '.media-viewer-thumbs',
          '.copyable-area + div img' // Common selector for the image preview
        ];
        
        let foundPreviewContainer = false;
        
        for (const selector of previewSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            console.log(`[WA-Content] FILEINPUT: Found preview container with selector: ${selector}`);
            
            // Force re-layout to trigger image rendering
            element.style.opacity = '0.99';
            await new Promise(r => setTimeout(r, 50));
            element.style.opacity = '';
            
            // Force additional click on the element
            try {
              element.click();
              await new Promise(r => setTimeout(r, 50));
            } catch (clickErr) {
              // Ignore click errors
            }
            
            foundPreviewContainer = true;
            break;
          }
        }
        
        if (!foundPreviewContainer) {
          console.log('[WA-Content] FILEINPUT: No preview container found, attempting fallback methods');
          
          // Try to "kick" the preview rendering by manipulating the DOM
          const mediaElement = document.querySelector('div[class*="media"]');
          if (mediaElement) {
            // Force layout recalculation
            mediaElement.style.display = 'none';
            await new Promise(r => setTimeout(r, 10));
            mediaElement.style.display = '';
          }
        }
      } catch (previewErr) {
        console.error('[WA-Content] FILEINPUT: Error during preview enhancement:', previewErr);
        // Non-critical error, continue with sending
      }
    }

    // 6) Wait for preview composer - Different timing for different file types
    const turboFast = (typeof activeCampaign !== 'undefined' && activeCampaign?.turboModeEnabled);
    let previewDelay;
    if (turboFast) {
      if (fileObj.type.startsWith('image/')) {
        previewDelay = 800; // Images need moderate delay in turbo
      } else if (fileObj.type.startsWith('video/')) {
        previewDelay = 2000; // Videos need more time to process in turbo
      } else {
        previewDelay = 400; // Documents are fast
      }
    } else {
      if (fileObj.type.startsWith('image/')) {
        previewDelay = 2000; // Images in normal mode
      } else if (fileObj.type.startsWith('video/')) {
        previewDelay = 3000; // Videos need extra time in normal mode
      } else {
        previewDelay = 1500; // Documents in normal mode
      }
    }
    await new Promise(res => setTimeout(res, previewDelay));

    // 7) Insert caption if provided - Enhanced for videos
    if (caption) {
      console.log('[WA-Content] FILEINPUT: Setting caption for', fileObj.type);
      
      // Reduced wait time to prevent getting stuck
      if (fileObj.type.startsWith('video/')) {
        await new Promise(r => setTimeout(r, 300));
        console.log('[WA-Content] FILEINPUT: Brief wait for video caption input');
      }
      
      const captionSelectors = [
        'div[contenteditable="true"][data-testid="media-caption-input"]',
        'div[aria-label*="caption"][contenteditable="true"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'div[role="textbox"][contenteditable="true"]'
      ];
      
      let captionInput = null;
      let attempts = 0;
      const maxAttempts = fileObj.type.startsWith('video/') ? 10 : 5;
      
      // Quick retry to prevent getting stuck
      while (!captionInput && attempts < maxAttempts) {
        for (const sel of captionSelectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) { 
            // Validate this is not search box
            const isSearchBox = el.getAttribute('data-tab') === '3' || 
                               (el.getAttribute('aria-label') || '').includes('Search');
            if (!isSearchBox) {
              captionInput = el; 
              break;
            }
          }
        }
        if (!captionInput) {
          await new Promise(r => setTimeout(r, 100)); // Faster retry
          attempts++;
        }
      }
      
      if (captionInput) {
        captionInput.focus();
        await new Promise(r => setTimeout(r, 100)); // Small delay after focus
        captionInput.textContent = caption;
        captionInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: caption }));
        console.log('[WA-Content] FILEINPUT: Caption set successfully for', fileObj.type);
        
        // Extra verification for videos
        if (fileObj.type.startsWith('video/')) {
          await new Promise(r => setTimeout(r, 300));
          if (captionInput.textContent !== caption) {
            console.log('[WA-Content] FILEINPUT: Retrying caption for video');
            captionInput.textContent = caption;
            captionInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: caption }));
          }
        }
      } else {
        console.warn('[WA-Content] FILEINPUT: Caption input not found after', attempts, 'attempts for', fileObj.type);
      }
    }

    // 8) Wait for the send button then click it - Enhanced for videos
    const sendSelectors = [
      'button[data-testid="send"]',
      'span[data-icon="send"]',
      'button[aria-label="Send"]',
      'span[data-testid="send"]',
      'div[aria-label="Send"][role="button"]',
      'div[role="button"] span[data-icon="send"]',
      'footer [aria-label="Send"]'
    ];
    let clicked = false;

    // Reduced timeout to prevent getting stuck - 3s max for images
    const maxWaitMs = fileObj.type.startsWith('video/') ? 8000 : 3000;
    const waitStart = Date.now();
    
    console.log('[WA-Content] FILEINPUT: Waiting for send button for', fileObj.type);
    
    while (!clicked && Date.now() - waitStart < maxWaitMs) {
      for (const sel of sendSelectors) {
        let btn = document.querySelector(sel);
        if (btn && btn.closest) {
          const ancestorBtn = btn.closest('button, div[role="button"]');
          if (ancestorBtn) btn = ancestorBtn;
        }
        
        // Check if button is enabled
        if (btn && typeof btn.click === 'function') {
          const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.classList.contains('disabled');
          
          if (!isDisabled) {
            btn.click();
            clicked = true;
            console.log('[WA-Content] FILEINPUT: Send button clicked using selector', sel, 'for', fileObj.type);
            break;
          }
        }
      }
      
      if (!clicked) {
        await new Promise(r => setTimeout(r, 200)); // Fast polling
      }
    }
    
    if (!clicked) {
      console.error('[WA-Content] FILEINPUT: Send button timeout - attachment send FAILED');
      // Force close any stuck attachment preview
      try {
        const closeBtn = document.querySelector('div[role="dialog"] button[aria-label="Close"], span[data-icon="x"], button[data-testid="x"]');
        if (closeBtn) {
          closeBtn.click();
          console.log('[WA-Content] FILEINPUT: Force closed stuck attachment preview');
        }
      } catch (e) {
        console.warn('[WA-Content] FILEINPUT: Error during force cleanup:', e);
      }
      return false; // Return false to indicate failure
    }

    // 9) Verify attachment was actually sent
    await new Promise(r => setTimeout(r, 1000));
    
    // Check if we're still in attachment preview (indicates failure)
    const stillInPreview = document.querySelector('div[data-testid="media-canvas"], div[role="dialog"] div[data-testid="media-gallery-modal"]');
    if (stillInPreview) {
      console.error('[WA-Content] FILEINPUT: Still in attachment preview - send failed');
      return false;
    }
    
    console.log('[WA-Content] FILEINPUT: Attachment send verified successfully');
    return true;
  } catch (err) {
    console.error('[WA-Content] FILEINPUT: Attachment system disabled due to WhatsApp changes');
    return false;
  }
}

/**
 * Find the attachment button in WhatsApp's UI
 */
async function findAttachmentButton() {
  // Try several possible selectors for the attachment button
  const selectors = [
    'div[data-testid="clip"]',
    'div[data-icon="clip"]',
    'span[data-testid="clip"]',
    'span[data-icon="clip"]',
    'button[aria-label="Attach"]',
    'button[title="Attach"]'
  ];
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      // If it's not a button itself, find the closest clickable parent
      return element.closest('button') || element;
    }
  }
  
  // If no direct match, try to find by SVG path analysis (more fragile)
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    const svg = btn.querySelector('svg');
    if (svg && btn.innerHTML.includes('clip')) {
      return btn;
    }
  }
  
  return null;
}

/**
 * Helper to read file as ArrayBuffer
 */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Creates a WhatsApp message link and clicks it to navigate to the chat
 * Enhanced for better cross-browser and latest WhatsApp Web compatibility
 */
function createMessageLink(number, text) {
  return new Promise((resolve) => {
    const encodedText = encodeURIComponent(text || '');
    // Use in-app navigation URL that WhatsApp Web intercepts without leaving the
    // SPA. Using wa.me sometimes redirects to api.whatsapp.com which causes a
    // full reload. The /send?phone=… form keeps us inside web.whatsapp.com.
    const url = `https://web.whatsapp.com/send?phone=${number}&text=${encodedText}`;
    
    // Track if navigation was successful
    let navigated = false;
    
    // Try multiple approaches in sequence for maximum compatibility
    const tryNavigation = async () => {
      // Approach 1: Use SPA navigation if available
      try {
        if (window.SPA && typeof window.SPA.navigateToChat === 'function') {
          console.log('[WA-Content] Using SPA navigation API');
          await window.SPA.navigateToChat(number, encodedText);
          navigated = true;
          return;
        }
      } catch (e) {
        console.warn('[WA-Content] SPA navigation failed:', e);
      }
      
      // Approach 2: Inject the link inside WhatsApp's app wrapper
      let anchor = document.getElementById('blkwhattsapplink');
      if (anchor) {
        anchor.setAttribute('href', url);
      } else {
        // Try multiple placements in sequence
        
        // 2a: Try to reuse the legacy placement (4th span)
        const spans = document.querySelectorAll('#app .app-wrapper-web span');
        if (spans && spans.length >= 5) {
          spans[4].innerHTML = `<a href="${url}" id="blkwhattsapplink"></a>`;
          anchor = document.getElementById('blkwhattsapplink');
        }

        // 2b: Prepend hidden anchor to #app root
        if (!anchor) {
          const appRoot = document.querySelector('#app');
          if (appRoot) {
            anchor = document.createElement('a');
            anchor.id = 'blkwhattsapplink';
            anchor.style.display = 'none';
            anchor.href = url;
            appRoot.prepend(anchor);
          }
        }

        // 2c: Last resort - append to <body>
        if (!anchor) {
          anchor = document.createElement('a');
          anchor.id = 'blkwhattsapplink';
          anchor.style.display = 'none';
          anchor.href = url;
          document.body.appendChild(anchor);
        }
      }

      // Click the link if found
      if (anchor) {
        try {
          anchor.click();
          navigated = true;
        } catch (e) {
          console.warn('[WA-Content] Anchor click failed:', e);
        }
      }
      
      // Approach 3: Fallback to direct location change if all else fails
      if (!navigated) {
        console.log('[WA-Content] Trying direct location change as last resort');
        try {
          // Use history API when possible to avoid page reload
          window.history.pushState({}, '', url);
          // Dispatch popstate to trigger SPA navigation
          window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
          navigated = true;
        } catch (e) {
          console.warn('[WA-Content] History API navigation failed:', e);
          // Final fallback - direct location change
          window.location.href = url;
          navigated = true;
        }
      }
    };
    
    // Execute navigation attempts and resolve after a delay
    tryNavigation().finally(() => {
      // Allow navigation to continue almost immediately – 200 ms is enough for WA to push history state
      const delay = navigated ? 200 : 400;
      setTimeout(resolve, delay);
    });
  });
}

// Call the main initialize function for the content script.
initialize();
connectToBackground();

function base64ToFile(base64String, fileName, mimeType) {
  try {
    const parts = base64String.split(',');
    if (parts.length < 2) throw new Error('Invalid base64 data');

    // Infer mime type from data URL header if not provided
    let detectedMime = mimeType;
    const headerMatch = parts[0].match(/data:([^;]+);base64/i);
    if (!detectedMime && headerMatch && headerMatch[1]) {
      detectedMime = headerMatch[1].trim();
    }

    // Fallback: guess from file extension
    if (!detectedMime && fileName) {
      const ext = fileName.split('.').pop().toLowerCase();
      const extMap = {
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        bmp: 'image/bmp',
        webp: 'image/webp',
        mp4: 'video/mp4',
        mov: 'video/quicktime',
        webm: 'video/webm'
      };
      if (extMap[ext]) detectedMime = extMap[ext];
    }

    // Final fallback
    if (!detectedMime) detectedMime = 'application/octet-stream';

    const binaryStr = atob(parts[1]);
    const len = binaryStr.length;
    const u8arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      u8arr[i] = binaryStr.charCodeAt(i);
    }
    return new File([u8arr], fileName, { type: detectedMime });
  } catch (err) {
    console.error('[WA-Content] base64ToFile error:', err);
    // Return a fallback File object
    const fallbackBlob = new Blob([], { type: mimeType || 'application/octet-stream' });
    return new File([fallbackBlob], fileName || 'attachment', { type: mimeType || 'application/octet-stream' });
  }
}

/** Wait until window.Store is ready (Chat & SendTextMsgToChat available) */
function waitForStore(maxMs = 10000) {
  if (window.Store && window.Store.Chat && window.Store.SendTextMsgToChat) return Promise.resolve(true);
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      if (window.Store && window.Store.Chat && window.Store.SendTextMsgToChat) return resolve(true);
      if (Date.now() - start > maxMs) return resolve(false);
      setTimeout(check, 200);
    };
    check();
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    } catch (err) { reject(err); }
  });
}

/**
 * Last resort fallback for Linux systems where file input manipulation doesn't work.
 * Uses clipboard paste simulation approach.
 */
async function clipboardFallbackForLinux(fileObj, caption = '') {
  try {
    console.log('[WA-Content] LINUX-FALLBACK: Disabled – returning false');
    return false; // Linux fallback disabled entirely
    
    // Find the compose box
    const inputSelectors = [
      'div[contenteditable="true"][data-tab="10"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][spellcheck="true"]'
    ];
    
    let composeBox = null;
    for (const sel of inputSelectors) {
      composeBox = document.querySelector(sel);
      if (composeBox) break;
    }
    
    if (!composeBox) {
      console.error('[WA-Content] LINUX-FALLBACK: Compose box not found');
      return false;
    }
    
    // Focus the compose box
    composeBox.focus();
    
    // Convert file to arraybuffer
    const arrayBuffer = await readFileAsArrayBuffer(fileObj);
    
    // Create a blob item for the clipboard
    const blob = new Blob([arrayBuffer], { type: fileObj.type });
    const clipboardItem = new ClipboardItem({
      [fileObj.type]: blob
    });
    
    // Write to clipboard
    await navigator.clipboard.write([clipboardItem]);
    console.log('[WA-Content] LINUX-FALLBACK: File copied to clipboard');
    
    // Simulate paste (Ctrl+V)
    composeBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'v',
      code: 'KeyV',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    }));
    
    // Wait for paste to be processed and media to load
    await new Promise(r => setTimeout(r, 2000));
    
    // If caption is provided, set it
    if (caption) {
      composeBox.textContent = caption;
      composeBox.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: caption
      }));
    }
    
    // Hit Enter to send
    composeBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
    
    console.log('[WA-Content] LINUX-FALLBACK: Paste and send simulation complete');
    return true;
    
  } catch (err) {
    console.error('[WA-Content] LINUX-FALLBACK: Error during clipboard fallback:', err);
    return false;
  }
}

/**
 * Attempts to send an attachment without opening any UI dialogs by directly
 * finding or injecting the file input element into the page.
 */
async function sendAttachmentSilently(fileObj, caption = '') {
  try {
    if (STRICT_SILENT_ATTACHMENT && !(typeof activeCampaign !== 'undefined' && activeCampaign?.turboModeEnabled)) {
      console.warn('[WA-Content] SILENT-ATTACH: Strict mode – skipping silent attachment flow (not Turbo).');
      return false;
    }
    console.log('[WA-Content] SILENT-ATTACH: Starting silent attachment');
    // Enhanced video handling for Turbo Mode
    if(fileObj.type.startsWith('video/')){
      const turboMode = (typeof activeCampaign !== 'undefined' && activeCampaign?.turboModeEnabled);
      if (turboMode) {
        console.log('[WA-Content] SILENT-ATTACH: Enhanced video handling for Turbo Mode');
      } else {
        console.log('[WA-Content] SILENT-ATTACH: Standard video handling (non-Turbo)');
      }
    }

    // Special approach for images: use clipboard direct paste method (avoids file-picker UI entirely)
    if (fileObj.type.startsWith('image/')) {
      const success = await silentImageAttachmentViaPaste(fileObj, caption);
      if (success) {
        console.log('[WA-Content] SILENT-ATTACH: Successfully sent via clipboard paste method');
        return true;
      }
      console.log('[WA-Content] SILENT-ATTACH: Clipboard paste method failed, trying alternative approaches');
    }

    // 1. First look for any hidden file inputs that might already exist in the page
    const existingInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    let targetInput = null;
    
    // Try to find an input that would accept our file type
    if (fileObj.type.startsWith('image/') || fileObj.type.startsWith('video/')) {
      targetInput = existingInputs.find(input => 
        input.accept && (input.accept.includes('image/') || input.accept.includes('video/'))
      );
    } else {
      // For documents
      targetInput = existingInputs.find(input => 
        !input.accept || input.accept === '*' || input.accept.includes('application/')
      );
    }

    // If no suitable input found, create one
    if (!targetInput) {
      console.log('[WA-Content] SILENT-ATTACH: No suitable existing input found, creating one');
      targetInput = document.createElement('input');
      targetInput.type = 'file';
      targetInput.style.position = 'absolute';
      targetInput.style.top = '-9999px';
      targetInput.style.left = '-9999px';
      
      if (fileObj.type.startsWith('image/') || fileObj.type.startsWith('video/')) {
        targetInput.accept = 'image/*,video/*';
      } else {
        targetInput.accept = '*';
      }
      
      // Append to body
      document.body.appendChild(targetInput);
    }

    // 2. Programmatically set the file on the input
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(fileObj);
      targetInput.files = dataTransfer.files;
    } catch (e) {
      console.warn('[WA-Content] SILENT-ATTACH: Standard DataTransfer failed:', e);
      
      try {
        // Fallback for some environments
        const fileList = {
          0: fileObj,
          length: 1,
          item: (idx) => idx === 0 ? fileObj : null
        };
        Object.defineProperty(targetInput, 'files', {
          value: fileList,
          writable: true
        });
      } catch (e2) {
        throw new Error('Could not set file on input: ' + e2.message);
      }
    }

    // 3. Dispatch change event on the input
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));
    
    // 4. Find or create a function to handle what happens when file is selected
    // We'll try several approaches:
    
    // 4.1. First approach: Find the compose area and "paste" the file
    const composeBox = document.querySelector('div[contenteditable="true"][data-tab="10"], div[role="textbox"][contenteditable="true"]');
    if (composeBox) {
      // Create an image data transfer item
      try {
        // Create a fake clipboard paste event
        const pasteEvent = new ClipboardEvent('paste', {
          bubbles: true,
          clipboardData: new DataTransfer()
        });
        
        // Unfortunately we can't add files to clipboardData in a constructed event
        // But triggering the event might activate WhatsApp's paste handlers
        composeBox.focus();
        composeBox.dispatchEvent(pasteEvent);
      } catch (pasteErr) {
        console.warn('[WA-Content] SILENT-ATTACH: Paste simulation failed:', pasteErr);
      }
    }
    
    // 4.2. Second approach: Find any existing handler in WhatsApp's code
    // Look for the compose area first
    await new Promise(r => setTimeout(r, 500));
    
    // If there's now a media preview visible, we succeeded
    const mediaPreview = document.querySelector('div[data-testid="media-canvas"], div[data-icon="media-image"], .media-viewer-thumbs');
    if (mediaPreview) {
      console.log('[WA-Content] SILENT-ATTACH: Media preview found, setting caption');
      
      // Set caption if provided
      if (caption) {
        const captionInput = document.querySelector('div[contenteditable="true"][data-testid="media-caption-input"], div[aria-label*="caption"][contenteditable="true"]');
        if (captionInput) {
          captionInput.focus();
          captionInput.textContent = caption;
          captionInput.dispatchEvent(new InputEvent('input', { 
            bubbles: true, 
            cancelable: true, 
            inputType: 'insertText', 
            data: caption 
          }));
        }
      }
      
      // Click send
      await new Promise(r => setTimeout(r, 300));
      const sendBtn = document.querySelector('button[data-testid="send"], button[aria-label="Send"], div[aria-label="Send"][role="button"]');
      if (sendBtn) {
        sendBtn.click();
        console.log('[WA-Content] SILENT-ATTACH: Send button clicked');
        return true;
      }
    }
    
    // 4.3. Third approach: Try to find the file input and then directly look for the chat input
    // to manually "combine" them by coding the behavior ourselves
    
    // If we reach here, the silent approach didn't work as expected
    // Let the calling function fall back to the regular method
    if (targetInput && targetInput.parentNode === document.body) {
      // Clean up our created input if it didn't work
      document.body.removeChild(targetInput);
    }
    
    console.log('[WA-Content] SILENT-ATTACH: No immediate success with silent method, falling back');
    if (STRICT_SILENT_ATTACHMENT && !(typeof activeCampaign !== 'undefined' && activeCampaign?.turboModeEnabled)) {
      console.warn('[WA-Content] SILENT-ATTACH: Strict mode – skipping silent attachment flow (not Turbo).');
      return false;
    }
    console.log('[WA-Content] SILENT-ATTACH: Falling back to attachment menu');
    // execution continues to fallback
    return false;
  } catch (err) {
    console.error('[WA-Content] SILENT-ATTACH: Error during silent attachment:', err);
    return false;
  }
}

/**
 * Attempts to send an image attachment completely silently by using the clipboard API
 * and directly pasting into the message compose area without UI interaction.
 */
async function silentImageAttachmentViaPaste(fileObj, caption = '') {
  try {
    console.log('[WA-Content] CLIPBOARD-IMG: Starting silent image clipboard paste');
    
    // 1. Find the message compose box
    const composeSelectors = [
      'div[contenteditable="true"][data-tab="10"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][spellcheck="true"]',
      'div[data-testid="conversation-compose-box-input"]'
    ];
    
    let composeBox = null;
    for (const selector of composeSelectors) {
      composeBox = document.querySelector(selector);
      if (composeBox) break;
    }
    
    if (!composeBox) {
      console.error('[WA-Content] CLIPBOARD-IMG: Could not find compose box');
      return false;
    }
    
    // 2. Convert the file to a Blob in the clipboard
    try {
      // Read file content as array buffer
      const arrayBuffer = await readFileAsArrayBuffer(fileObj);
      const blob = new Blob([arrayBuffer], { type: fileObj.type });
      
      // Create a ClipboardItem with the blob
      const clipboardItem = new ClipboardItem({
        [fileObj.type]: blob
      });
      
      // Write to clipboard
      await navigator.clipboard.write([clipboardItem]);
      console.log('[WA-Content] CLIPBOARD-IMG: Image copied to clipboard');
      
      // 3. Focus the compose box
      composeBox.focus();
      
      // 4. Simulate paste (Ctrl+V)
      composeBox.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'v',
        code: 'KeyV',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      }));
      
      // 5. Wait for the image to be processed and added to the compose area
      const turboFast = (typeof activeCampaign !== 'undefined' && activeCampaign?.turboModeEnabled);
      await new Promise(r => setTimeout(r, turboFast ? 600 : 1000)); // Increased turbo delay for stability
      
      // 6. Look for indicators that the image was successfully added
      const mediaContainer = document.querySelector(
        'div[data-testid="media-canvas"], ' +
        'div[data-icon="media-image"], ' +
        '.media-viewer-thumbs, ' +
        'div[data-testid="image-thumb"]'
      );
      
      if (!mediaContainer) {
        console.warn('[WA-Content] CLIPBOARD-IMG: Could not find media container after paste');
        return false;
      }
      
      // 7. Add caption if provided
      if (caption) {
        // Look for caption input
        const captionInput = document.querySelector(
          [
            'div[aria-label="Add a caption"][contenteditable="true"]',
            'div[aria-placeholder="Add a caption"][contenteditable="true"]',
            'div[contenteditable="true"][data-testid="media-caption-input"]',
            'div[contenteditable="true"][aria-label*="caption"]:not([data-tab="3"]):not([aria-label*="Search"])',
            'div[contenteditable="true"][aria-placeholder*="caption"]:not([data-tab="3"])',
            'div[role="dialog"] div[contenteditable="true"][data-lexical-editor="true"]',
            'div[contenteditable="true"][data-lexical-editor="true"][aria-placeholder*="caption"]:not([data-tab="3"])'
          ].join(', ')
        );
        
        if (captionInput) {
          // Validate this is actually the caption input, not search or main composer
          const isSearchBox = captionInput.getAttribute('data-tab') === '3' || 
                             (captionInput.getAttribute('aria-label') || '').includes('Search');
          
          if (isSearchBox) {
            console.error('[WA-Content] BLOCKED: Caption targeting search box - skipping injection');
            return false;
          }
          
          captionInput.focus();
          // Clear placeholder line break if any
          captionInput.innerHTML = '';
          // Insert text node
          document.execCommand && document.execCommand('insertText', false, caption);
          // Fallback manual InputEvent
          captionInput.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: caption
          }));
          console.log('[WA-Content] CLIPBOARD-IMG: Caption added');
        } else {
          console.warn('[WA-Content] CLIPBOARD-IMG: Caption input not found');
        }
      }
      
      // 8. Send the message
      await new Promise(r => setTimeout(r, 300));
      const sendSelectors = [
        'button[data-testid="send"]',
        'span[data-icon="send"]',
        'button[aria-label="Send"]',
        'span[data-testid="send"]',
        'div[aria-label="Send"][role="button"]',
        'div[role="button"] span[data-icon="send"]',
        'footer [aria-label="Send"]'
      ];
      
      let sendButton = null;
      const sendWaitStart = Date.now();
      outer: while (!sendButton && Date.now() - sendWaitStart < 8000) {
        for (const selector of sendSelectors) {
          sendButton = document.querySelector(selector);
          if (sendButton) {
            if (sendButton.closest) {
              const ancestor = sendButton.closest('button, div[role="button"]');
              if (ancestor) sendButton = ancestor;
            }
            break outer;
          }
        }
        if (!sendButton) {
          const turboFastPoll = (typeof activeCampaign !== 'undefined' && activeCampaign?.turboModeEnabled) ? 120 : 250;
          await new Promise(r=>setTimeout(r,turboFastPoll));
        }
      }
      
      if (sendButton) {
        sendButton.click();
        console.log('[WA-Content] CLIPBOARD-IMG: Message sent via send button');
        return true;
      } else {
        // Try Enter key as fallback
        composeBox.dispatchEvent(new KeyboardEvent('keydown', { 
          key: 'Enter', 
          code: 'Enter', 
          keyCode: 13, 
          which: 13,
          bubbles: true, 
          cancelable: true 
        }));
        console.log('[WA-Content] CLIPBOARD-IMG: Message sent via Enter key');
        await waitForMediaComposerClose();
        return true;
      }
    } catch (clipErr) {
      console.error('[WA-Content] CLIPBOARD-IMG: Clipboard operation failed:', clipErr);
      return false;
    }
  } catch (err) {
    console.error('[WA-Content] CLIPBOARD-IMG: Error during silent paste:', err);
    return false;
  }
}

/**
 * Attempts to find WhatsApp's hidden file input elements without opening the UI
 * by looking at various DOM patterns and attributes.
 */
function findHiddenFileInputs() {
  try {
    const allInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    
    // Filter for inputs that are likely part of WhatsApp's attachment mechanism
    const hiddenInputs = allInputs.filter(input => {
      // Check if input is visually hidden
      const style = window.getComputedStyle(input);
      const isVisuallyHidden = style.display === 'none' || 
                              style.visibility === 'hidden' || 
                              style.opacity === '0' || 
                              input.offsetParent === null;
      
      // Check if input has typical WhatsApp attributes
      const hasWAAttributes = input.accept || 
                             input.hasAttribute('multiple') || 
                             input.getAttribute('accept') === 'image/*,video/mp4,video/3gpp,video/quicktime' ||
                             input.getAttribute('accept') === '*';
      
      // Check for nearby WhatsApp class patterns
      let parentElem = input.parentElement;
      let depth = 0;
      let hasWAClass = false;
      
      while (parentElem && depth < 5) {
        const classList = parentElem.className || '';
        if (typeof classList === 'string' && (
          classList.includes('menu') || 
          classList.includes('drawer') || 
          classList.includes('conversation') ||
          classList.includes('app')
        )) {
          hasWAClass = true;
          break;
        }
        parentElem = parentElem.parentElement;
        depth++;
      }
      
      return isVisuallyHidden && (hasWAAttributes || hasWAClass);
    });
    
    return hiddenInputs;
  } catch (err) {
    console.error('[WA-Content] Error finding hidden file inputs:', err);
    return [];
  }
}

/** Detects WhatsApp invalid / blocked number alert dialog in the DOM */
function isInvalidNumberDialogPresent() {
  try {
    const dlg = document.querySelector('div[role="dialog"], div[role="alertdialog"]');
    if (!dlg) return false;
    const txt = dlg.textContent || '';
    return /(invalid|not\s+on\s+whatsapp|doesn'?t\s+exist)/i.test(txt);
  } catch { return false; }
}

/** Wait for WhatsApp invalid / blocked number dialog to appear during the given timeout (ms).
 *  Returns true if the dialog showed up (and attempts to dismiss it), otherwise false. */
function waitForInvalidNumberDialog(timeout = 4000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (isInvalidNumberDialogPresent()) {
        try {
          // Try to click the primary/OK button to dismiss the dialog so UI is clean
          const okBtn = document.querySelector('div[role="dialog"] div[role="button"], div[role="alertdialog"] div[role="button"], button span');
          if (okBtn && typeof okBtn.click === 'function') {
            okBtn.click();
          }
        } catch { /* Ignore errors while closing */ }
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - start > timeout) {
        clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}

/** Wait until either a valid chat panel loads or WhatsApp shows the invalid/blocked dialog.
 * Returns an object { invalid: boolean }, where invalid=true means the dialog appeared. */
function waitForChatOrInvalid(maxMs = 8000, expectedPhone = null) {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = setInterval(() => {
      if (isInvalidNumberDialogPresent()) {
        clearInterval(poll);
        resolve({ invalid: true });
        return;
      }
      // Detect chat panel using multiple fall-back selectors because Linux Chromium build uses a new DOM structure
      const chatPanel = window.utils?.queryAny?.([
        'div[data-testid="conversation-panel-wrapper"]',                            // classic selector
        'main[role="main"] div[data-testid="conversation-panel-wrapper"]',        // scoped classic
        'div.copyable-area',                                                         // new Linux (lexical) container
        'div[contenteditable="true"][data-lexical-editor="true"]',               // lexical compose editor present only when chat loaded
        'div[role="main"] div[aria-label="Message list"]'                        // generic message list container
      ]) || document.querySelector('div.copyable-area');

      if (chatPanel) {
        if (expectedPhone) {
          const chatPhoneRaw = chatPanel.getAttribute('data-phone');
          if (chatPhoneRaw) {
            const chatPhone = chatPhoneRaw.replace(/\D/g, '');
            if (chatPhone === expectedPhone) {
              clearInterval(poll);
              resolve({ invalid: false });
              return;
            }
            // If mismatch, continue polling – maybe still old chat
          } else {
            // Attribute not present in new UI – assume correct chat once panel exists
            clearInterval(poll);
            resolve({ invalid: false });
            return;
          }
        } else {
          clearInterval(poll);
          resolve({ invalid: false });
          return;
        }
      }
      if (Date.now() - start > maxMs) {
        clearInterval(poll);
        resolve({ invalid: true }); // treat timeout as failure to open chat
      }
    }, 150);
  });
}

// Utility: convert basic HTML markup to plain text while preserving line breaks & spacing
function sanitizeMessageText(raw) {
  try {
    if (typeof raw !== 'string') return '';

    let txt = raw;

    // 1) Normalise common line-break style tags to \n so WhatsApp keeps them
    txt = txt.replace(/<\s*br\s*\/?\s*>/gi, '\n');
    txt = txt.replace(/<\s*\/\s*(p|div|li)\s*>/gi, '\n'); // closing block tags end with a new line
    txt = txt.replace(/<\s*(p|div)\b[^>]*>/gi, '');          // opening tags – just strip
    txt = txt.replace(/<\s*li\b[^>]*>/gi, '• ');             // bullet for list items

    // 2) Strip any remaining HTML tags (safety)
    txt = txt.replace(/<[^>]+>/g, '');

    // 3) Decode basic HTML entities
    const ta = document.createElement('textarea');
    ta.innerHTML = txt.replace(/&nbsp;/gi, ' ');
    txt = ta.value;

    // 4) Preserve multiple consecutive spaces by replacing with non-breaking + space pattern
    //    WhatsApp respects consecutive NBSP & normal spaces, so we keep them.
    txt = txt.replace(/ {2,}/g, (m) => '\u00A0'.repeat(m.length - 1) + ' ');

    return txt;
  } catch (err) {
    console.warn('[WA-Content] sanitizeMessageText failed – returning raw string.', err);
    return raw;
  }
}

/**
 * Generate a small JPEG thumbnail (Data URL) from an image File for internal preview helpers.
 * Size is limited to ~240×240 px preserving aspect-ratio. Returns null on failure.
 */
async function generateThumbnail(fileObj, maxEdge = 240) {
  try {
    if (!fileObj || !fileObj.type || !fileObj.type.startsWith('image/')) return null;

    const dataURL = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = () => rej(reader.error);
      reader.readAsDataURL(fileObj);
    });

    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('image load fail'));
      i.src = dataURL;
    });

    const ratio = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.75);
  } catch (err) {
    console.warn('[WA-Content] generateThumbnail failed:', err);
    return null;
  }
}

// Inject floating UI styles once
function injectFloatingUIStyles() {
  if (document.getElementById('wa-broadcast-floating-style')) return;
  const style = document.createElement('style');
  style.id = 'wa-broadcast-floating-style';
  style.textContent = `
    .wa-campaign-floating-ui{position:fixed;right:20px;top:20px;width:310px;background:#fff;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.15);z-index:2147483647;font-family:Arial,Helvetica,sans-serif;color:#333;overflow:hidden;}
    .wa-campaign-floating-ui-header{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:linear-gradient(135deg,#05c964 0%,#0f944a 100%);color:#fff;}
    .wa-campaign-floating-ui-title{font-weight:600;font-size:15px;display:flex;align-items:center;gap:6px;}
    .wa-campaign-floating-ui-close{background:#ff5c5c;border:none;color:#fff;width:24px;height:24px;border-radius:50%;cursor:pointer;font-size:16px;line-height:24px;padding:0;}
    .wa-campaign-floating-ui-content{padding:12px;display:flex;flex-direction:column;gap:10px;}
    .wa-campaign-floating-ui-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 12px;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;color:#fff;}
    #openExtensionPopupBtn{background:#00c853;width:100%;}
    #pauseResumeFloatingBtn{background:#009688;flex:1;}
    #stopFloatingBtn{background:#d32f2f;flex:1;}
    .wa-campaign-floating-ui-status{font-size:14px;margin-top:4px;}
    .wa-campaign-floating-ui-progress{height:6px;background:#e0e0e0;border-radius:3px;overflow:hidden;}
    .wa-campaign-floating-ui-progress-bar{height:100%;background:#05c964;width:0%;transition:width .3s ease;}
    .wa-broadcast-current-number{display:flex;flex-direction:column;background:#e8f9f0;border-left:4px solid #0f944a;padding:6px 8px;border-radius:6px;font-size:13px;}
    .current-number-label{font-weight:600;font-size:12px;color:#555;}
    .current-number-value{font-size:18px;font-weight:600;color:#333;}
    #batchCountdownContainer{display:none;font-size:15px;font-weight:600;align-items:center;gap:4px;}
    #batchCountdownValue{font-variant-tabular-nums:tabular-nums;}
    /* --- Batch list styles --- */
    .batch-list-wrapper{margin-top:8px;}
    .batch-list-header{display:flex;align-items:center;gap:6px;font-weight:600;font-size:14px;color:#555;cursor:pointer;user-select:none;}
    .batch-toggle-btn{background:transparent;border:none;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;color:#25D366;font-size:18px;transition:transform .25s ease;}
    .batch-toggle-btn.rotate{transform:rotate(90deg);} /* arrow pointing down */
    #batchList{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;}
    .batch-pill{padding:6px 8px;border-radius:4px;font-weight:700;font-size:13px;line-height:1.15;display:flex;flex-direction:column;align-items:center;min-width:72px;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,.15);}
    .batch-pill.completed{background:#4caf50;color:#fff;}
    .batch-pill.running{background:#2196f3;color:#fff;}
    .batch-pill.waiting{background:#00bcd4;color:#fff;}
    .batch-pill.queued{background:#fbc02d;color:#000;}
    /* ===== Silent-send: hide WhatsApp media composer & clip menu completely ===== */
    div[role="dialog"][data-testid="media-editor"]{opacity:0!important;pointer-events:none!important;transform:translateX(-9999px)!important;}
    div[role="dialog"] [data-testid="media-preview-container"],
    div[role="dialog"] div[contenteditable][data-testid="media-caption-input"],
    div[role="dialog"] div[aria-label*="caption"],
    ul[role="menu"] li input[type="file"]{opacity:0!important;pointer-events:none!important;transform:translateX(-9999px)!important;}
    span[data-icon="clip"]{visibility:hidden!important;}
  `;
  document.head.appendChild(style);
}

// ... existing code within initialize() near the top, after setupVisibilityHandler() call ...
// Inject RemixIcon CSS (used for icons)
try {
  const iconCssUrl = chrome.runtime.getURL('libs/remixicon/remixicon.css');
  const linkEl = document.createElement('link');
  linkEl.rel = 'stylesheet';
  linkEl.href = iconCssUrl;
  document.head.appendChild(linkEl);
  console.log('[WA-Content] RemixIcon CSS injected');
} catch(e){console.error('[WA-Content] Failed to inject RemixIcon CSS',e);} 

// ... ensure injectFloatingUIStyles called in createFloatingUI ...
function createFloatingUI() {
  injectFloatingUIStyles();
  let floatingUI = document.querySelector('.wa-campaign-floating-ui');
  if (floatingUI) {
    floatingUI.style.display = 'block'; // Ensure it's visible if it already exists
    return floatingUI; // Don't recreate if it already exists
  }

  floatingUI = document.createElement('div');
  floatingUI.className = 'wa-campaign-floating-ui';
  floatingUI.style.cursor = 'default';
  floatingUI.innerHTML = `
    <div class="wa-campaign-floating-ui-header">
      <div class="wa-campaign-floating-ui-title">WA Campaign Sender </div>
      <button class="wa-campaign-floating-ui-close" title="Close">&times;</button>
    </div>
    <div class="wa-campaign-floating-ui-content">
      <button class="wa-campaign-floating-ui-button" id="openExtensionPopupBtn" title="Open Broadcast Settings">
        <i class="ri-settings-3-fill" style="font-size:18px;margin-right:6px;"></i>
        Open Settings
      </button>
      <!-- NEW CONTROL BUTTONS -->
      <div class="wa-campaign-floating-ui-controls" style="display:flex; gap:8px; margin-top:8px;">
        <button class="wa-campaign-floating-ui-button" id="pauseResumeFloatingBtn" title="Pause Campaign">⏸ Pause</button>
        <button class="wa-campaign-floating-ui-button" id="stopFloatingBtn"   title="Stop Campaign">⏹ Stop</button>
      </div>
      <!-- END NEW CONTROL BUTTONS -->
      <div class="wa-campaign-floating-ui-status" id="broadcastStatus">Waiting for campaign...</div>
      <div class="wa-campaign-floating-ui-progress" style="display: none;">
        <div class="wa-campaign-floating-ui-progress-bar" id="broadcastProgress" style="width: 0%;"></div>
      </div>
      <div id="batchCountdownContainer" style="display:none;font-size:15px;font-weight:600;align-items:center;gap:4px;">
        <i class="ri-time-fill batch-clock" style="margin-right:4px;"></i> <span style="font-weight:600;">Next batch in:</span> <span id="batchCountdownValue">--:--</span>
      </div>
      <!-- Batch list (collapsible) -->
      <div class="batch-list-wrapper">
        <div class="batch-list-header" id="batchListHeader">
          Batches Queued
          <button id="toggleBatchList" class="batch-toggle-btn" title="Expand/Collapse"><i class="ri-arrow-right-s-fill"></i></button>
        </div>
        <div id="batchListContainer" style="display:none;">
          <div id="batchList"></div>
        </div>
      </div>

      <div class="wa-broadcast-current-number">
        <div class="current-number-label">Currently sending to:</div>
        <div id="currentPhoneNumber" class="current-number-value">-</div>
      </div>

      <button class="wa-campaign-floating-ui-button" id="downloadResultsFloatingBtn" style="display:none;background:#4caf50;align-self:flex-start;">
        <i class="ri-download-2-line" style="margin-right:6px;"></i> Download Results
      </button>
    </div>
  `;

  document.body.appendChild(floatingUI);

  // Add event listeners
  const closeButton = floatingUI.querySelector('.wa-campaign-floating-ui-close');
  const openPopupButton = floatingUI.querySelector('#openExtensionPopupBtn');

  closeButton.addEventListener('click', () => {
    floatingUI.style.display = 'none';
  });

  openPopupButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openExtensionPopup' });
  });
  
  // Listener for campaign status updates from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'campaignStatusUpdate') {
      const statusElement = document.getElementById('broadcastStatus');
      const progressBarContainer = document.querySelector('.wa-campaign-floating-ui-progress');
      const progressBar = document.getElementById('broadcastProgress');
      if (statusElement && progressBar && progressBarContainer) {
        const campaign = message.status;
        if (typeof window._waCurrentIdx === 'undefined') window._waCurrentIdx = -1;
        if (typeof campaign.currentIndex === 'number' && campaign.currentIndex < window._waCurrentIdx) {
          return true; // Ignore stale update
        }
        if (typeof campaign.currentIndex === 'number') window._waCurrentIdx = campaign.currentIndex;
        if (campaign.status === 'running' || campaign.status === 'paused' || campaign.status === 'sending') {
          floatingUI.style.display = 'block'; // Ensure UI is visible
          statusElement.textContent = `Campaign: ${campaign.status} (${campaign.sentCount}/${campaign.totalContacts} sent, ${campaign.failedCount} failed)`;
          progressBarContainer.style.display = 'block';
          const progressPercent = campaign.totalContacts > 0 ? (campaign.currentIndex / campaign.totalContacts) * 100 : 0;
          progressBar.style.width = `${progressPercent}%`;
          const phoneBox=document.getElementById('currentPhoneNumber');
          if(phoneBox && campaign.currentNumber){
            phoneBox.textContent = campaign.currentNumber;
          }
        } else if (campaign.status === 'batch_delay') {
          startBatchCountdown(campaign.nextBatchTime||Date.now());
          statusElement.textContent = `Waiting next batch… (${campaign.sentCount}/${campaign.totalContacts} sent)`;
          progressBarContainer.style.display = 'block';
          const progressPercent = campaign.totalContacts > 0 ? (campaign.currentIndex / campaign.totalContacts) * 100 : 0;
          progressBar.style.width = `${progressPercent}%`;
          // stopBatchCountdown();
        } else if (campaign.status === 'completed') {
          statusElement.textContent = `Campaign completed: ${campaign.sentCount}/${campaign.totalContacts} sent.`;
          progressBar.style.width = '100%';
           setTimeout(() => { progressBarContainer.style.display = 'none'; }, 5000); // Hide progress after 5s
          // stopBatchCountdown();
        } else if (campaign.status === 'failed' || campaign.status === 'aborted') {
          statusElement.textContent = `Campaign ${campaign.status}: ${campaign.error || 'No details'}`;
          progressBarContainer.style.display = 'none';
          // stopBatchCountdown();
        } else {
            statusElement.textContent = 'Waiting for campaign...';
            progressBarContainer.style.display = 'none';
            // stopBatchCountdown();
        }
      }
    }
    return true; // Keep the message channel open for sendResponse, if needed elsewhere
  });

  const pauseResumeButton = floatingUI.querySelector('#pauseResumeFloatingBtn');
  const stopButton        = floatingUI.querySelector('#stopFloatingBtn');

  pauseResumeButton.addEventListener('click', async () => {
    if (!activeCampaign) return;
    try {
      if (['running','waiting','batch_delay'].includes(activeCampaign.status)) {
        pauseResumeButton.disabled = true;
        await handleCampaignPause();
        pauseResumeButton.disabled = false;
        pauseResumeButton.textContent = '▶ Resume';
        pauseResumeButton.title = 'Resume Campaign';
      } else if (activeCampaign.status === 'paused') {
        pauseResumeButton.disabled = true;
        await handleCampaignResume();
        pauseResumeButton.disabled = false;
        pauseResumeButton.textContent = '⏸ Pause';
        pauseResumeButton.title = 'Pause Campaign';
      }
    } catch(e){ console.error('[WA-Content] pause/resume error',e); pauseResumeButton.disabled=false; }
  });

  stopButton.addEventListener('click', async () => {
    if (!activeCampaign) return;
    if (!confirm('Are you sure you want to stop the campaign?')) return;
    stopButton.disabled = true;
    try {
      await handleCampaignAbort();
      stopButton.textContent = 'Stopped';
      pauseResumeButton.disabled = true;
    } catch(e){ console.error('[WA-Content] stop error',e); stopButton.disabled=false; }
  });

  // Download results button
  const downloadResultsBtn = floatingUI.querySelector('#downloadResultsFloatingBtn');
  if (downloadResultsBtn) {
    downloadResultsBtn.addEventListener('click', exportCampaignResultsCSV);
  }

  // Batch list toggle
  const batchHeader = floatingUI.querySelector('#batchListHeader');
  if(batchHeader){
    const listContainer = floatingUI.querySelector('#batchListContainer');
    const toggleBtn = floatingUI.querySelector('#toggleBatchList');
    batchHeader.addEventListener('click', () => {
      const isOpen = listContainer.style.display === 'block';
      listContainer.style.display = isOpen ? 'none' : 'block';
      if(toggleBtn){ toggleBtn.classList.toggle('rotate', !isOpen); }
    });
  }

  // -------- Make floating UI draggable via its header --------
  (function enableDrag(elem){
    const header = elem.querySelector('.wa-campaign-floating-ui-header');
    if(!header) return;
    let offsetX=0, offsetY=0, dragging=false;
    header.style.cursor='move';
    header.addEventListener('mousedown',(e)=>{
      dragging=true;
      const rect=elem.getBoundingClientRect();
      offsetX=e.clientX-rect.left; offsetY=e.clientY-rect.top;
      document.body.style.userSelect='none';
    });
    document.addEventListener('mousemove',(e)=>{
      if(!dragging) return;
      let x=e.clientX-offsetX; let y=e.clientY-offsetY;
      // keep inside viewport
      x=Math.max(0, Math.min(window.innerWidth-elem.offsetWidth, x));
      y=Math.max(0, Math.min(window.innerHeight-elem.offsetHeight, y));
      elem.style.left=x+'px'; elem.style.top=y+'px';
      elem.style.right='auto'; elem.style.bottom='auto';
    });
    document.addEventListener('mouseup',()=>{dragging=false; document.body.style.userSelect='';});
  })(floatingUI);

  return floatingUI;
}

/**
 * Update floating UI elements based on current campaign state
 */
function updateFloatingUI(campaign){
  if(!campaign) return;
  const floating=document.querySelector('.wa-campaign-floating-ui');
  if(!floating) return;
  // ensure visible when campaign active
  floating.style.display='block';
  const statusEl=document.getElementById('broadcastStatus');
  const progressEl=document.getElementById('broadcastProgress');
  const progressWrap=document.querySelector('.wa-campaign-floating-ui-progress');
  const pauseBtn=document.getElementById('pauseResumeFloatingBtn');
  const stopBtn=document.getElementById('stopFloatingBtn');
  if(statusEl){
    const sent=campaign.sentCount||0;
    const failed=campaign.failedCount||0;
    const total=campaign.totalContacts||campaign.contacts?.length||0;
    if(campaign.status==='aborted'){
      statusEl.textContent=`Campaign aborted (${sent}/${total} sent, ${failed} failed)`;
      statusEl.style.color='#d32f2f';
    }else if(campaign.status==='failed'){
      statusEl.textContent=`Campaign failed (${sent}/${total} sent, ${failed} failed)`;
      statusEl.style.color='#d32f2f';
    }else{
      statusEl.textContent=`Campaign: ${campaign.status} (${sent}/${total} sent, ${failed} failed)`;
      statusEl.style.color='';
    }
  }
  if(progressEl&&progressWrap){
    const total=campaign.totalContacts||campaign.contacts?.length||0;
    if(total>0){
      progressWrap.style.display='block';
      let pct = Math.min(100,(campaign.currentIndex||0)/total*100);
      if(campaign.status==='completed') pct = 100;
      progressEl.style.width=`${pct}%`;
    }
  }
  if(pauseBtn){
    if(campaign.status==='running'){
      pauseBtn.textContent='⏸ Pause';
      pauseBtn.disabled=false;
    }else if(campaign.status==='paused'){
      pauseBtn.textContent='▶ Resume';
      pauseBtn.disabled=false;
    }else{
      pauseBtn.disabled=true;
    }
  }
  if(stopBtn){
    const stoppableStates=['running','paused','batch_delay','waiting','sending'];
    stopBtn.disabled = !stoppableStates.includes(campaign.status);
  }
  const phoneEl=document.getElementById('currentPhoneNumber');
  if(phoneEl && campaign.currentNumber){
    phoneEl.textContent=campaign.currentNumber;
  }
  if(campaign.status==='batch_delay' && campaign.nextBatchTime){
    startBatchCountdown(campaign.nextBatchTime);
  }
  const dlBtn = document.getElementById('downloadResultsFloatingBtn');
  if (dlBtn) {
    dlBtn.style.display = campaign.status === 'completed' ? 'block' : 'none';
  }

  // Render batch plan list
  renderBatchList(campaign);
}

/** Wait until WhatsApp's media composer overlay closes (i.e. the image preview modal disappears).
 *  Returns true if closed within timeout (ms). */
function waitForMediaComposerClose(timeout = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      const composerOpen = document.querySelector(
        'div[role="dialog"] div[data-testid="media-gallery-modal"], ' +
        'div[data-testid="media-canvas"], ' +
        'div[data-icon="media-image"], ' +
        '.media-viewer-thumbs'
      );
      if (!composerOpen) {
        return resolve(true);
      }
      if (Date.now() - start > timeout) return resolve(false);
      setTimeout(poll, 150);
    };
    poll();
  });
}

// ---- Batch countdown helpers ----
let batchCountdownTimer = null;
function startBatchCountdown(ts, labelText = 'Next batch in:'){
  const container=document.getElementById('batchCountdownContainer');
  const labelSpan=container?.querySelector('span:nth-child(2)') || null;
  const valueEl=document.getElementById('batchCountdownValue');
  if(!container||!valueEl) return;
  if(labelSpan){ labelSpan.textContent = labelText; }
  const update=()=>{
    const diff=Math.max(0, ts-Date.now());
    const min=Math.floor(diff/60000);
    const sec=Math.floor((diff%60000)/1000);
    valueEl.textContent=`${min.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
    if(diff<=0){stopBatchCountdown();}
  };
  stopBatchCountdown();
  container.style.display='flex';
  update();
  batchCountdownTimer=setInterval(update,1000);
}
function stopBatchCountdown(hide = true){
  if(batchCountdownTimer){clearInterval(batchCountdownTimer);batchCountdownTimer=null;}
  if(hide){
    const container=document.getElementById('batchCountdownContainer');
    if(container) container.style.display='none';
  }
}

// Add helper near other helpers (after waitForMediaComposerClose)
/** Wait for a given milliseconds but exit early if campaign is paused/aborted */
async function waitRespectingCampaign(ms){
  const step=1000;
  let remaining=ms;
  while(remaining>0){
    if(!activeCampaign || activeCampaign.status!=='running') break;
    await new Promise(r=>setTimeout(r, Math.min(step,remaining)));
    remaining-=step;
  }
}

// ------------------------------------------------------------------
//  IndexedDB helper to fetch blobs saved by attachmentManager in popup
// ------------------------------------------------------------------
const ATTACHMENT_DB_NAME = 'wa_sender_attachments';
const ATTACHMENT_STORE = 'attachments';
function openAttachmentDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ATTACHMENT_DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        db.createObjectStore(ATTACHMENT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}
function getBlobFromIndexedDB(id) {
  return new Promise(async (res, rej) => {
    try {
      const db = await openAttachmentDB();
      const tx = db.transaction(ATTACHMENT_STORE, 'readonly');
      const req = tx.objectStore(ATTACHMENT_STORE).get(id);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    } catch(e) { rej(e); }
  });
}

// Add helper to export campaign results as CSV (no external libs needed)
function exportCampaignResultsCSV() {
  try {
    chrome.storage.local.get(['lastCampaignResults', 'activeCampaign'], (res) => {
      let data = res.lastCampaignResults || {};
      if ((!data.successNumbers || data.successNumbers.length === 0) && res.activeCampaign) {
        data = {
          successNumbers: res.activeCampaign.successNumbers || [],
          failedNumbers:  res.activeCampaign.failedNumbers  || [],
          skippedNumbers: res.activeCampaign.skippedNumbers || []
        };
      }
      const success = data.successNumbers || [];
      const failed  = data.failedNumbers  || [];
      const skipped = data.skippedNumbers || [];

      if (success.length === 0 && failed.length === 0 && skipped.length === 0) {
        try { window.utils?.toast?.('No results to export yet', 'warning'); } catch(_) {}
        console.warn('[WA-Content] No campaign results to export');
        return;
      }

      const rows = [['Phone', 'Status']];
      success.forEach(p => rows.push([p, 'Success']));
      failed.forEach(p  => rows.push([p, 'Failed']));
      skipped.forEach(p => rows.push([p, 'Skipped']));

      const csvContent = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
      const a = document.createElement('a');
      a.href = url;
      a.download = `campaign-results-${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 0);
    });
  } catch (err) {
    console.error('[WA-Content] CSV export failed:', err);
    try { window.utils?.toast?.('Failed to export results: ' + err.message, 'error'); } catch(_) {}
  }
}

// -------- Batch list renderer --------
function renderBatchList(campaign){
  try {
    const list = document.getElementById('batchList');
    if(!list) return;
    list.innerHTML='';
    if(!campaign || !campaign._batchPlan) return;
    campaign._batchPlan.forEach((b)=>{
      const div=document.createElement('div');
      div.className='batch-pill '+(b.status||'queued');

      const line1=document.createElement('div');
      line1.textContent=`${b.size} Msgs`;

      const line2=document.createElement('div');
      if(b.status==='running'){
        line2.textContent='sending…';
      } else if(b.status==='waiting'){
        if(b.waitEndsAt){
          const diff=Math.max(0,b.waitEndsAt-Date.now());
          if(diff>60000){
            const mins=Math.ceil(diff/60000);
            line2.textContent=`${mins} m left`;
          } else {
            const m=Math.floor(diff/60000);
            const s=Math.floor((diff%60000)/1000).toString().padStart(2,'0');
            line2.textContent=`${m}:${s} left`;
          }
        } else {
          line2.textContent=`${b.waitMin} m left`;
        }
      } else if(b.status==='queued'){
        line2.textContent=`≈${b.waitMin} m wait`;
      } else if(b.status==='completed'){
        line2.textContent='done';
      }

      div.appendChild(line1);
      div.appendChild(line2);
      list.appendChild(div);
    });
  } catch(e){ console.warn('[WA-Content] renderBatchList error',e); }
}

// Helper functions
function getTimestamp() {
  const now = new Date();
  return now.toLocaleString();
}

function replaceVariables(template, contact) {
  let result = template;
  for (const key in contact) {
    if (Object.hasOwnProperty.call(contact, key)) {
      const placeholder = new RegExp(`{{\s*${key}\s*}}`, 'gi');
      result = result.replace(placeholder, contact[key] || '');
    }
  }
  return result.replace(/{{\s*[^}]+\s*}}/gi, '');
}

// Self-sending mechanism to keep WhatsApp Web active
async function sendSelfMessage() {
  try {
    // Prevent multiple simultaneous self-sends
    if (window._selfSendInProgress) {
      console.log('[WA-Content] Self-send already in progress, skipping');
      return;
    }
    window._selfSendInProgress = true;
    
    // Get current user's phone number from the last known result
    let myNumber = window._lastKnownPhoneNumber;
    
    // Try to get phone number from Store if not cached
    if (!myNumber && window.Store && window.Store.Conn) {
      try {
        myNumber = window.Store.Conn.wid?.user;
        if (myNumber) window._lastKnownPhoneNumber = myNumber;
      } catch (e) {
        console.warn('[WA-Content] Could not get phone number from Store:', e);
      }
    }
    
    if (!myNumber) {
      console.warn('[WA-Content] Could not determine own phone number for self-send');
      return;
    }
    
    console.log(`[WA-Content] Sending self-message to ${myNumber}`);
    
    // Send a simple dot message to yourself
    const selfMessage = '.';
    
    // Try Store API first (faster and more reliable)
    if (USE_STORE_API && window.Store && window.Store.Chat) {
      try {
        const success = await storeSendTextMessage(myNumber, selfMessage);
        if (success) {
          console.log('[WA-Content] Self-message sent via Store API');
          return;
        }
      } catch (e) {
        console.warn('[WA-Content] Store API self-send failed:', e);
      }
    }
    
    console.log('[WA-Content] Self-message completed');
    
  } catch (error) {
    console.error('[WA-Content] Self-send mechanism error:', error);
  } finally {
    // Always clear the progress flag
    setTimeout(() => {
      window._selfSendInProgress = false;
    }, 2000);
  }
}
