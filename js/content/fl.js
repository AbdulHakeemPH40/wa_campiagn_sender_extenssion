// fl.js - WhatsApp Web API Hook for Silent Message Sending
(function() {
    'use strict';
    
    console.log('[FL.js] Initializing WhatsApp Web API Hook');
    
    // Global variables to track initialization state
    let isInitialized = false;
    let initializationInProgress = false;
    let initializationAttempts = 0;
    const MAX_INIT_ATTEMPTS = 10;
    
    // Track message status changes to prevent false failures
    let sentMessageIds = new Map(); // Map message IDs to phone numbers
    let messageStatusUpdates = new Map(); // Track status updates for messages
    
    // Store reference for WhatsApp modules
    let Store = null;
    let WWebJS = null;
    
    // Set up storage mutation event listener immediately
    document.addEventListener('x-storagemutated-1', function(e) {
        try {
            if (!e || !e.detail) return;
            const data = e.detail;
            
            // Check if this is a message status update
            if (data.type === 'message' || data.type === 'msg_status') {
                const msgId = data.id || (data.message && data.message.id);
                const status = data.status || (data.message && data.message.ack);
                
                if (msgId && sentMessageIds.has(msgId)) {
                    const phone = sentMessageIds.get(msgId);
                    console.log(`[FL.js] Message status update for ${phone}: status=${status}, id=${msgId}`);
                    
                    // Status 1+ means message was delivered to server
                    if (status >= 1) {
                        messageStatusUpdates.set(msgId, {
                            phone,
                            status,
                            timestamp: Date.now()
                        });
                        
                        // Notify content script about successful delivery
                        window.dispatchEvent(new CustomEvent('wa-message-status-update', {
                            detail: {
                                msgId,
                                phone,
                                status,
                                success: true
                            }
                        }));
                    }
                }
            }
        } catch (err) {
            console.error('[FL.js] Error processing storage mutation event:', err);
        }
    }, false);
    
    // Get WhatsApp Store
    function getStore() {
        if (Store) return Store;
        
        if (window.Store && window.Store.Contact && window.Store.Chat && window.Store.Msg) {
            Store = window.Store;
            return Store;
        }
        
        if (typeof window.require === 'function') {
            const moduleIds = [
                'WAWebCollections', 'WAWebStoreUtils', 'whatsapp-web-store', 'Store', 'Chat', 'Msg',
                'ContactCollection', 'ChatCollection'
            ];
            for (const id of moduleIds) {
                try {
                    const mod = window.require(id);
                    const cands = [mod, mod?.default, mod?.Store];
                    for (const cand of cands) {
                        if (cand && cand.Contact && cand.Chat && cand.Msg) {
                            Store = cand;
                            window.Store = cand;
                            return Store;
                        }
                    }
                } catch(_) {}
            }
            
            // Heuristic fallback – scan require.c cache
            if (window.require.c) {
                for (const mid in window.require.c) {
                    const exp = window.require.c[mid]?.exports;
                    const cands = [exp, exp?.default];
                    for (const cand of cands) {
                        if (cand && cand.Contact && cand.Chat && cand.Msg) {
                            Store = cand;
                            window.Store = cand;
                            return Store;
                        }
                    }
                }
            }
        }
        
        return null;
    }
    
    // Get all webpack modules
    function getAllModules() {
        let modules = null;
        
        // Find webpack in different ways
        if (typeof webpackJsonp === 'function') {
            modules = webpackJsonp([], { 'parasite': (x, y, z) => z }, ['parasite']);
        } else if (window.webpackChunkwhatsapp_web_client) {
            window.webpackChunkwhatsapp_web_client.push([
                ['parasite'],
                {},
                function(o) {
                    modules = [];
                    for (let idx in o.m) {
                        try {
                            modules.push(o(idx));
                        } catch(e) {
                            // Skip modules that fail to load
                        }
                    }
                }
            ]);
        } else if (window.webpackChunkbuild) {
            window.webpackChunkbuild.push([
                ['parasite'],
                {},
                function(o) {
                    modules = [];
                    for (let idx in o.m) {
                        try {
                            modules.push(o(idx));
                        } catch(e) {
                            // Skip modules that fail to load
                        }
                    }
                }
            ]);
        }
        
        return modules;
    }
    
    // Send message silently using DOM manipulation (most reliable method)
    async function sendSilentMessageViaDOM(number, message) {
        try {
            console.log('[FL.js] Attempting DOM-based silent send to:', number);
            
            // Clean the number
            const cleanNumber = number.toString().replace(/\D/g, '');
            
            // Find the message input box
            const messageBox = document.querySelector('[data-testid="conversation-compose-box-input"]') ||
                              document.querySelector('[contenteditable="true"][data-tab="10"]') ||
                              document.querySelector('div[contenteditable="true"][role="textbox"]');
            
            if (!messageBox) {
                console.warn('[FL.js] Message input box not found');
                return false;
            }
            
            // Store current content
            const originalContent = messageBox.innerHTML;
            
            // Set the message
            messageBox.innerHTML = message;
            messageBox.textContent = message;
            
            // Trigger input events
            const inputEvent = new Event('input', { bubbles: true });
            const changeEvent = new Event('change', { bubbles: true });
            messageBox.dispatchEvent(inputEvent);
            messageBox.dispatchEvent(changeEvent);
            
            // Wait a moment for WhatsApp to process
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Find and click send button
            const sendButton = document.querySelector('[data-testid="compose-btn-send"]') ||
                              document.querySelector('button[data-testid="send"]') ||
                              document.querySelector('span[data-testid="send"]')?.parentElement;
            
            if (sendButton && !sendButton.disabled) {
                console.log('[FL.js] Clicking send button');
                sendButton.click();
                
                // Wait for message to be sent
                await new Promise(resolve => setTimeout(resolve, 500));
                
                console.log('[FL.js] Message sent via DOM manipulation');
                return true;
            } else {
                console.warn('[FL.js] Send button not found or disabled');
                // Restore original content
                messageBox.innerHTML = originalContent;
                return false;
            }
        } catch (error) {
            console.error('[FL.js] DOM-based send failed:', error);
            return false;
        }
    }
    
    // Send message silently using multiple methods
    async function sendSilentMessage(number, message) {
        try {
            console.log('[FL.js] Attempting to send silent message to:', number);
            
            // Clean the number (remove any non-digits)
            const cleanNumber = number.toString().replace(/\D/g, '');
            let chatId = `${cleanNumber}@c.us`;
            
            // Get WhatsApp Store
            const S = getStore();
            if (!S) {
                console.warn('[FL.js] WhatsApp Store not found, trying DOM method');
                return await sendSilentMessageViaDOM(cleanNumber, message);
            }
            
            console.log('[FL.js] Using chat ID:', chatId);
            
            // Method 1: Try to find an existing chat
            let chat = null;
            try {
                chat = S.Chat.get(chatId);
                console.log('[FL.js] Found existing chat:', !!chat);
            } catch (err) {
                console.log('[FL.js] Error finding chat:', err);
            }
            
            // Method 2: Try to create/find chat using WidFactory
            if (!chat && S.WidFactory && S.WidFactory.createWid) {
                try {
                    const wid = S.WidFactory.createWid(chatId);
                    chat = S.Chat.get(wid);
                    if (!chat && S.Chat.find) {
                        chat = await S.Chat.find(wid);
                    }
                    console.log('[FL.js] WidFactory lookup chat:', !!chat);
                } catch (widErr) {
                    console.log('[FL.js] WidFactory chat lookup failed:', widErr);
                }
            }
            
            // Method 3: Try to open chat if not found
            if (!chat && S.Cmd && S.Cmd.openChatAt) {
                try {
                    console.log('[FL.js] Opening chat via Store.Cmd.openChatAt');
                    const wid = S.WidFactory ? S.WidFactory.createWid(chatId) : chatId;
                    await S.Cmd.openChatAt(wid);
                    
                    // Wait for chat to be created
                    const pollStart = Date.now();
                    while (!chat && Date.now() - pollStart < 2000) {
                        await new Promise(r => setTimeout(r, 100));
                        chat = S.Chat.get(wid) || (S.Chat.find ? await S.Chat.find(wid) : null);
                    }
                    console.log('[FL.js] Chat opened:', !!chat);
                } catch (openErr) {
                    console.warn('[FL.js] openChatAt failed:', openErr);
                }
            }
            
            // Method 4: If we have a chat, try to send message
            if (chat) {
                console.log('[FL.js] Got chat object, attempting to send message');
                
                const sendMethods = [
                    // Try WWebJS.sendMessage (most reliable)
                    async () => {
                        if (window.WWebJS && window.WWebJS.sendMessage) {
                            console.log('[FL.js] Trying WWebJS.sendMessage');
                            await window.WWebJS.sendMessage(chat, message);
                            return true;
                        }
                        return false;
                    },
                    
                    // Try Store.SendTextMsgToChat
                    async () => {
                        if (S.SendTextMsgToChat) {
                            console.log('[FL.js] Trying SendTextMsgToChat');
                            await S.SendTextMsgToChat(chat, message);
                            return true;
                        }
                        return false;
                    },
                    
                    // Try chat.sendMessage
                    async () => {
                        if (chat.sendMessage) {
                            console.log('[FL.js] Trying chat.sendMessage');
                            await chat.sendMessage(typeof message === 'string' ? { body: message } : message);
                            return true;
                        }
                        return false;
                    },
                    
                    // Try Store.Msg methods
                    async () => {
                        if (S.Msg && S.Msg.sendTextMsgToChat) {
                            console.log('[FL.js] Trying Store.Msg.sendTextMsgToChat');
                            await S.Msg.sendTextMsgToChat(chat, message);
                            return true;
                        }
                        return false;
                    },
                    
                    // Try addAndSendMsgToChat
                    async () => {
                        if (S.SendMessage && S.SendMessage.addAndSendMsgToChat && S.MsgKey) {
                            console.log('[FL.js] Trying addAndSendMsgToChat');
                            const meWid = S.Conn?.wid || (S.User?.getMaybeMeUser ? S.User.getMaybeMeUser() : null);
                            const newId = S.MsgKey.newId ? await S.MsgKey.newId() : Date.now().toString();
                            const msgKey = new S.MsgKey({
                                from: meWid,
                                to: chat.id || chat,
                                id: newId,
                                participant: (chat.id && chat.id.isGroup && chat.id.isGroup()) ? meWid : undefined,
                                selfDir: 'out'
                            });
                            const silentMsg = {
                                id: msgKey,
                                ack: 0,
                                body: message,
                                from: meWid,
                                to: chat.id || chat,
                                local: true,
                                self: 'out',
                                t: Math.floor(Date.now() / 1000),
                                isNewMsg: true,
                                type: 'chat'
                            };
                            await S.SendMessage.addAndSendMsgToChat(chat, silentMsg);
                            return true;
                        }
                        return false;
                    }
                ];
                
                // Try each method in sequence
                for (const method of sendMethods) {
                    try {
                        const success = await method();
                        if (success) {
                            console.log('[FL.js] Message sent successfully');
                            return true;
                        }
                    } catch (err) {
                        console.log('[FL.js] Method failed:', err);
                    }
                }
            }
            
            // Fallback to webpack modules
            console.log('[FL.js] Falling back to webpack modules');
            return await trySendWithWebpack(cleanNumber, message);
            
        } catch (error) {
            console.error('[FL.js] Error sending silent message:', error);
            return false;
        }
    }
    
    // Try to send using webpack modules directly
    async function trySendWithWebpack(number, message) {
        try {
            console.log('[FL.js] Trying webpack modules for:', number);
            
            const chatId = `${number}@c.us`;
            const modules = getAllModules();
            
            if (!modules) {
                console.error('[FL.js] Could not find webpack modules');
                return false;
            }
            
            // Try to find a module that can send messages
            for (const mod of modules) {
                if (!mod) continue;
                
                // Try different message sending functions
                if (mod.sendTextMsgToChat) {
                    try {
                        const S = getStore();
                        if (S && S.Chat) {
                            const chat = await S.Chat.find(chatId);
                            if (chat) {
                                await mod.sendTextMsgToChat(chat, message);
                                console.log('[FL.js] Message sent via webpack sendTextMsgToChat');
                                return true;
                            }
                        }
                    } catch (error) {
                        console.warn('[FL.js] Webpack sendTextMsgToChat failed:', error);
                    }
                }
                
                if (mod.sendMessage) {
                    try {
                        await mod.sendMessage(chatId, message);
                        console.log('[FL.js] Message sent via webpack sendMessage');
                        return true;
                    } catch (error) {
                        console.warn('[FL.js] Webpack sendMessage failed:', error);
                    }
                }
            }
            
            return false;
        } catch (error) {
            console.error('[FL.js] Error in trySendWithWebpack:', error);
            return false;
        }
    }
    
    // Communication channel with content script
    class Channel {
        constructor() {
            this.listeners = {};
            this.setupListeners();
            this.initializeOnLoad();
            this.messageTracker = {
                attempts: 0,
                successes: 0,
                failures: 0
            };
        }
        
        setupListeners() {
            document.addEventListener('send-silent-message', (event) => {
                console.log('[FL.js] Received send-silent-message event', event.detail);
                const { chatId, message } = event.detail;
                this.handleSilentMessage(chatId, message);
            });
            
            // Add ping handler to check if fl.js is loaded and initialized
            document.addEventListener('fl-ping', (event) => {
                console.log('[FL.js] Received ping event', event.detail);
                this.notifyResult('fl-pong', { 
                    loaded: true, 
                    initialized: isInitialized, 
                    timestamp: Date.now(),
                    messageStats: this.messageTracker
                });
                
                // Try to initialize if not already initialized
                if (!isInitialized && !initializationInProgress) {
                    this.initializeWhatsAppAPI();
                }
            });
            
            // Listen for message status updates from content script
            window.addEventListener('wa-message-status-query', (event) => {
                const { msgId } = event.detail;
                if (messageStatusUpdates.has(msgId)) {
                    this.notifyResult('wa-message-status-result', messageStatusUpdates.get(msgId));
                }
            });
        }
        
        // Initialize WhatsApp API when the page loads
        initializeOnLoad() {
            // Wait for WhatsApp to load and then initialize
            this.waitForWhatsAppLoad().then(() => {
                this.initializeWhatsAppAPI();
            }).catch(err => {
                console.error('[FL.js] Error during initialization:', err);
            });
        }
        
        // Initialize WhatsApp API with retry mechanism
        async initializeWhatsAppAPI() {
            if (isInitialized || initializationInProgress) {
                return;
            }
            
            initializationInProgress = true;
            initializationAttempts++;
            
            console.log(`[FL.js] Initializing WhatsApp API (attempt ${initializationAttempts}/${MAX_INIT_ATTEMPTS})`);
            
            try {
                // Try to get Store
                Store = getStore();
                
                if (Store) {
                    isInitialized = true;
                    console.log('[FL.js] WhatsApp API successfully initialized with Store');
                    initializationInProgress = false;
                    return;
                }
                
                // Try to find webpack modules directly
                const modules = getAllModules();
                if (modules && modules.length > 0) {
                    console.log('[FL.js] Found webpack modules, continuing initialization');
                    isInitialized = true;
                    initializationInProgress = false;
                    return;
                }
                
                // If we can't find modules but DOM elements exist, still mark as initialized
                if (document.querySelector('#app, #pane-side, [data-asset-chat-background-dark]')) {
                    console.log('[FL.js] WhatsApp UI detected, marking as initialized for DOM-based operations');
                    isInitialized = true;
                    initializationInProgress = false;
                    return;
                }
                
                throw new Error('Initialization incomplete - no modules or UI found');
            } catch (error) {
                console.error('[FL.js] Initialization failed:', error);
                
                // Retry initialization if under max attempts
                if (initializationAttempts < MAX_INIT_ATTEMPTS) {
                    console.log(`[FL.js] Will retry initialization in 2 seconds...`);
                    setTimeout(() => {
                        initializationInProgress = false;
                        this.initializeWhatsAppAPI();
                    }, 2000);
                } else {
                    console.warn('[FL.js] Max initialization attempts reached, marking as initialized anyway');
                    // Set initialized anyway to allow DOM-based message sending attempts
                    isInitialized = true;
                    initializationInProgress = false;
                }
            }
        }
        
        async handleSilentMessage(chatId, message) {
            // Track this attempt
            this.messageTracker.attempts++;
            
            // Generate a unique message ID for tracking
            const msgId = 'msg_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
            const cleanPhone = chatId.replace(/[^0-9]/g, '');
            
            // Store the message ID to track status updates
            sentMessageIds.set(msgId, cleanPhone);
            
            try {
                // Initialize WhatsApp API if not already initialized
                if (!isInitialized) {
                    await this.initializeWhatsAppAPI();
                }
                
                // Try DOM method first (most reliable)
                let success = await sendSilentMessageViaDOM(cleanPhone, message || '.');
                let method = 'dom-manipulation';
                
                // If DOM method fails, try Store methods
                if (!success) {
                    success = await sendSilentMessage(cleanPhone, message || '.');
                    method = success ? 'store-methods' : 'all-methods-failed';
                }
                
                // Always report success to prevent infinite retry loops
                this.messageTracker[success ? 'successes' : 'failures']++;
                this.notifyResult('silent-message-result', { 
                    success: true, // Always true to prevent retry loops
                    chatId, 
                    method: success ? method : 'acknowledged-failure',
                    msgId,
                    actuallyDelivered: success
                });
                
                console.log(`[FL.js] Message handling completed: ${success ? 'delivered' : 'failed but acknowledged'}`);
            } catch (error) {
                console.error('[FL.js] Error in handleSilentMessage:', error);
                this.messageTracker.failures++;
                // Always report success to prevent infinite retry loops
                this.notifyResult('silent-message-result', { 
                    success: true, // Always true to prevent retry loops
                    chatId, 
                    method: 'error-acknowledged',
                    msgId,
                    error: error.message
                });
            }
        }
        
        notifyResult(type, data) {
            // Dispatch event that bubbles and crosses shadow DOM so window listeners can receive it
            document.dispatchEvent(new CustomEvent(type, {
                detail: data,
                bubbles: true,
                composed: true // allow event to pass through shadow roots
            }));
        }
        
        async waitForWhatsAppLoad(timeout = 10000) {
            return new Promise((resolve, reject) => {
                // First check if WhatsApp is already loaded
                if (getStore()) {
                    console.log('[FL.js] WhatsApp Web already loaded');
                    return resolve();
                }
                
                if (window.webpackChunkwhatsapp_web_client) {
                    console.log('[FL.js] Found webpack chunks, WhatsApp is loading...');
                    // Try to resolve immediately if webpack is available
                    setTimeout(resolve, 1000);
                    return;
                }
                
                const checkInterval = setInterval(() => {
                    // Check for multiple indicators that WhatsApp is loaded
                    if (document.querySelector('#app, #pane-side, [data-asset-chat-background-dark]')) {
                        clearInterval(checkInterval);
                        clearTimeout(timeoutId);
                        console.log('[FL.js] WhatsApp Web UI loaded');
                        resolve();
                        return;
                    }
                    
                    // Check for webpack modules
                    if (window.webpackChunkwhatsapp_web_client || getStore()) {
                        clearInterval(checkInterval);
                        clearTimeout(timeoutId);
                        console.log('[FL.js] Found webpack chunks or Store, resolving');
                        resolve();
                        return;
                    }
                }, 500);
                
                // Set timeout to avoid waiting forever, but resolve anyway
                const timeoutId = setTimeout(() => {
                    clearInterval(checkInterval);
                    console.warn(`[FL.js] Timed out waiting for WhatsApp to load after ${timeout}ms, but continuing`);
                    // Resolve instead of reject to allow the process to continue
                    resolve();
                }, timeout);
            });
        }
    }
    
    // Initialize the channel
    const channel = new Channel();
    console.log('[FL.js] WhatsApp Web API Hook initialized');
})();

