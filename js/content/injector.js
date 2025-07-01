// injector.js
(function() {
    console.log('WA Campaign Sender: injector.js (contacts extractor) loaded.');

    // --- Store Accessor ---
    function getStore() {
        if (window.Store && window.Store.Contact && window.Store.Chat && window.Store.Msg && window.Store.GroupMetadata) {
            return window.Store;
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
                        if (cand && cand.Contact && cand.Chat && cand.Msg && cand.GroupMetadata) {
                            window.Store = cand;
                            return cand;
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
                        if (cand && cand.Contact && cand.Chat && cand.Msg && cand.GroupMetadata) {
                            window.Store = cand;
                            return cand;
                        }
                    }
                }
            }
        }
        return null;
    }

    // --- Webpack Module Finder ---
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
                        modules.push(o(idx));
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
                        modules.push(o(idx));
                    }
                }
            ]);
        }
        return modules;
    }

    // --- Helpers ---
    function post(type, payload = {}) {
        console.log(`[Injector] Posting message: ${type}`, payload);
        window.postMessage({ type, source: 'injector-script', ...payload }, '*');
    }

    // --- Fetch own phone number ---
    function getOwnPhoneNumber(retry = 4) {
        try {
            // Try the original method first
            const mod = window.require?.('WAWebUserPrefsMeUser');
            const me = mod?.getMaybeMeUser?.();
            if (me?.user) {
                post('WHATSAPP_NUMBER_FETCHER_RESULT', { phoneNumber: me.user });
                return;
            }
        } catch(_) { /* ignore */ }

        // New attempt: Try to get from window.Store.Me or window.Store.User
        try {
            const S = window.Store || window.MyWAppStore?.Store;
            if (S) {
                let userPhoneNumber = null;
                // Attempt 1: From Store.Me
                if (S.Me && S.Me.getMeUser && S.Me.getMeUser().id && S.Me.getMeUser().id.user) {
                    userPhoneNumber = S.Me.getMeUser().id.user;
                }
                // Attempt 2: From Store.User (if Store.Me is not available or doesn't work)
                else if (S.User && S.User.getMeUser && S.User.getMeUser().id && S.User.getMeUser().id.user) {
                    userPhoneNumber = S.User.getMeUser().id.user;
                }
                // Attempt 3: Direct access to Store.Contact.getMeUser()
                else if (S.Contact && S.Contact.getMeUser && S.Contact.getMeUser().id && S.Contact.getMeUser().id.user) {
                    userPhoneNumber = S.Contact.getMeUser().id.user;
                }

                if (userPhoneNumber) {
                    post('WHATSAPP_NUMBER_FETCHER_RESULT', { phoneNumber: userPhoneNumber });
                    return;
                }
            }
        } catch(e) {
            console.error('[Injector] Error getting own phone number from Store:', e);
        }

        if (retry > 0) setTimeout(() => getOwnPhoneNumber(retry-1), 1000);
        else post('WHATSAPP_NUMBER_FETCHER_RESULT', { phoneNumber: null, message: 'Could not retrieve own phone number.' });
    }

    // --- DOM-based Message Sending (Most Reliable) ---
    async function sendViaDOMManipulation(message) {
        try {
            console.log('[Injector] Attempting DOM-based message send');
            
            // Check if we're in a chat - look for chat indicators
            const chatIndicators = [
                '[data-testid="conversation-compose-box-input"]',
                '[data-testid="compose-box-input"]',
                'div[contenteditable="true"][role="textbox"]',
                '[contenteditable="true"][data-tab="10"]'
            ];
            
            let messageBox = null;
            for (const selector of chatIndicators) {
                messageBox = document.querySelector(selector);
                if (messageBox) break;
            }
            
            if (!messageBox) {
                console.warn('[Injector] Message input box not found - may not be in a chat');
                return false;
            }
            
            // Check if the input is actually visible and enabled
            const rect = messageBox.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) {
                console.warn('[Injector] Message input box is not visible');
                return false;
            }
            
            // Store current content
            const originalContent = messageBox.innerHTML;
            const originalText = messageBox.textContent;
            
            try {
                // Focus the input first
                messageBox.focus();
                await new Promise(resolve => setTimeout(resolve, 100));
                
                // Clear existing content
                messageBox.innerHTML = '';
                messageBox.textContent = '';
                
                // Set the message using multiple methods
                messageBox.innerHTML = message;
                messageBox.textContent = message;
                messageBox.innerText = message;
                
                // Trigger comprehensive input events
                const events = [
                    new Event('focus', { bubbles: true }),
                    new Event('input', { bubbles: true }),
                    new Event('change', { bubbles: true }),
                    new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
                    new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' })
                ];
                
                for (const event of events) {
                    messageBox.dispatchEvent(event);
                }
                
                // Wait for WhatsApp to process the input
                await new Promise(resolve => setTimeout(resolve, 300));
                
                // Find send button with multiple selectors
                const sendSelectors = [
                    '[data-testid="compose-btn-send"]',
                    '[data-testid="send"]',
                    'button[data-testid="send"]',
                    'span[data-testid="send"]',
                    'button[aria-label*="Send"]',
                    'button[title*="Send"]'
                ];
                
                let sendButton = null;
                for (const selector of sendSelectors) {
                    const element = document.querySelector(selector);
                    if (element) {
                        sendButton = element.tagName === 'BUTTON' ? element : element.closest('button');
                        if (sendButton) break;
                    }
                }
                
                if (sendButton && !sendButton.disabled && !sendButton.hasAttribute('disabled')) {
                    console.log('[Injector] Found send button, clicking...');
                    
                    // Click the send button
                    sendButton.click();
                    
                    // Also try triggering click event
                    sendButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                    
                    // Wait for message to be sent
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Check if the message was actually sent by seeing if input is cleared
                    const currentContent = messageBox.textContent || messageBox.innerHTML;
                    if (!currentContent || currentContent.trim() === '') {
                        console.log('[Injector] Message sent successfully via DOM manipulation');
                        return true;
                    } else {
                        console.warn('[Injector] Message may not have been sent - input still contains text');
                        // Restore original content
                        messageBox.innerHTML = originalContent;
                        messageBox.textContent = originalText;
                        return false;
                    }
                } else {
                    console.warn('[Injector] Send button not found or disabled');
                    // Restore original content
                    messageBox.innerHTML = originalContent;
                    messageBox.textContent = originalText;
                    return false;
                }
            } catch (innerError) {
                console.error('[Injector] Error during DOM manipulation:', innerError);
                // Restore original content
                try {
                    messageBox.innerHTML = originalContent;
                    messageBox.textContent = originalText;
                } catch (restoreError) {
                    console.warn('[Injector] Could not restore original content:', restoreError);
                }
                return false;
            }
        } catch (error) {
            console.error('[Injector] DOM-based send failed:', error);
            return false;
        }
    }
    
    // --- Silent Message Sending ---
    async function sendSilentMessage(number, message) {
        try {
            console.log('[Injector] Attempting to send safety message to:', number);
            
            // Clean the number (remove any non-digits)
            const cleanNumber = number.toString().replace(/\D/g, '');
            
            // First try DOM manipulation (most reliable)
            const domSuccess = await sendViaDOMManipulation(message || '.');
            if (domSuccess) {
                console.log('[Injector] Message sent successfully via DOM');
                return true;
            }
            
            // Get WhatsApp Store
            const Store = getStore();
            if (!Store) {
                console.warn('[Injector] WhatsApp Store not found, DOM method also failed');
                return false;
            }
            
            // Special handling for self-chats - WhatsApp may handle them differently
            const isSelfChat = true; // We're always sending to self in safety messages
            
            // For self-chats, try both standard format and self format
            const chatId = { 
                server: 'c.us',
                user: cleanNumber,
                _serialized: `${cleanNumber}@c.us`
            };
            
            // Also create a self-chat ID format as WhatsApp sometimes uses special handling for self-chats
            const selfChatId = {
                server: 'c.us',
                user: cleanNumber,
                _serialized: `${cleanNumber}@c.us`,
                selfChat: true
            };

            console.log('[Injector] Using chat ID:', chatId._serialized);
            
            // Method 1: Try to find an existing chat with this contact
            let chat;
            try {
                // Try to get existing chat
                chat = Store.Chat.get(chatId._serialized);
                console.log('[Injector] Found existing chat:', !!chat);
            } catch (err) {
                console.log('[Injector] Error finding chat with standard ID:', err);
                
                // Try with self chat ID if standard ID fails
                try {
                    chat = Store.Chat.get(selfChatId._serialized);
                    console.log('[Injector] Found existing self chat:', !!chat);
                } catch (selfErr) {
                    console.log('[Injector] Error finding chat with self ID:', selfErr);

                // Extra attempt: use WidFactory to locate or create chat (handles WA updates where Chat.get may fail)
                if (!chat && Store.WidFactory && Store.WidFactory.createWid) {
                    try {
                        const wid = Store.WidFactory.createWid(`${cleanNumber}@c.us`);
                        // Try to get chat via Wid
                        chat = Store.Chat.get(wid);
                        if (!chat && Store.Chat.find) {
                            try {
                                chat = await Store.Chat.find(wid);
                            } catch (_) {}
                        }
                        // Skip ChatFactory.createChat as it sometimes triggers a full WhatsApp reload.
                        if (!chat && Store.Cmd && Store.Cmd.openChatAt) {
                            try {
                                await Store.Cmd.openChatAt(wid);
                                await new Promise(r => setTimeout(r, 200));
                                chat = Store.Chat.get(wid) || (Store.Chat.find ? await Store.Chat.find(wid) : null);
                            } catch (_) {}
                        }
                        console.log('[Injector] WidFactory lookup chat:', !!chat);
                    } catch (widErr) {
                        console.log('[Injector] WidFactory chat lookup failed:', widErr);
                    }
                }
                }
            }
            
            // Method 2: If no chat exists, try to open it quickly without causing a full reload
            if (!chat && Store.Cmd && Store.Cmd.openChatAt) {
                try {
                    console.log('[Injector] Opening chat via Store.Cmd.openChatAt');
                    await Store.Cmd.openChatAt(chatId);
                    // Poll until the chat object is fully initialised (max 1.5 s)
                    const pollStart = Date.now();
                    while (!chat && Date.now() - pollStart < 1500) {
                        await new Promise(r => setTimeout(r, 100));
                        chat = Store.Chat.get(chatId) || (Store.Chat.find ? await Store.Chat.find(chatId) : null);
                    }
                } catch (openErr) {
                    console.warn('[Injector] openChatAt failed:', openErr);
                }
            }
            
            // Method 3: If we have a chat, try to send a message using various methods
            if (chat) {
                console.log('[Injector] Got chat object, attempting to send message');
                
                // Try multiple methods in sequence
                const sendMethods = [
                    // Method 3.0: Store.SendMessage.addAndSendMsgToChat (preferred silent send)
                    async () => {
                        if (Store.SendMessage && Store.SendMessage.addAndSendMsgToChat && Store.MsgKey) {
                            console.log('[Injector] Trying addAndSendMsgToChat');
                            try {
                                const meWid = (Store.Conn && Store.Conn.wid) ? Store.Conn.wid : (Store.User && Store.User.getMaybeMeUser ? Store.User.getMaybeMeUser() : null);
                                const newId = Store.MsgKey.newId ? await Store.MsgKey.newId() : Date.now().toString();
                                const msgKey = new Store.MsgKey({
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
                                await Store.SendMessage.addAndSendMsgToChat(chat, silentMsg);
                                return true;
                            } catch (e) {
                                console.warn('[Injector] addAndSendMsgToChat failed:', e);
                            }
                        }
                        return false;
                    },
                    // Method 3.1: Store.SendTextMsgToChat
                    async () => {
                        if (Store.SendTextMsgToChat) {
                            console.log('[Injector] Trying SendTextMsgToChat');
                            await Store.SendTextMsgToChat(chat, message);
                            return true;
                        }
                        return false;
                    },
                    // Method 3.2: chat.sendMessage
                    async () => {
                        if (chat.sendMessage) {
                            console.log('[Injector] Trying chat.sendMessage');
                            await chat.sendMessage(message);
                            return true;
                        }
                        return false;
                    },
                    // Method 3.3: Store.SendMessage
                    async () => {
                        if (Store.SendMessage) {
                            console.log('[Injector] Trying Store.SendMessage');
                            await Store.SendMessage(chat, message);
                            return true;
                        }
                        return false;
                    },
                    // Method 3.4: Store.Msg.sendTextMsgToChat
                    async () => {
                        if (Store.Msg && Store.Msg.sendTextMsgToChat) {
                            console.log('[Injector] Trying Store.Msg.sendTextMsgToChat');
                            await Store.Msg.sendTextMsgToChat(chat, message);
                            return true;
                        }
                        return false;
                    },
                    // Method 3.5: Store.Msg.add
                    async () => {
                        if (Store.Msg && Store.Msg.add) {
                            console.log('[Injector] Trying Store.Msg.add');
                            const msgOptions = {
                                body: message,
                                from: Store.Me.wid,
                                to: chatId._serialized,
                                self: true,
                                ack: 0,
                                id: new Date().getTime().toString()
                            };
                            await Store.Msg.add(msgOptions);
                            return true;
                        }
                        return false;
                    }
                ];
                
                // Try each method in sequence until one works
                for (const method of sendMethods) {
                    try {
                        const success = await method();
                        if (success) {
                            console.log('[Injector] Message sent successfully');
                            return true;
                        }
                    } catch (err) {
                        console.log('[Injector] Method failed:', err);
                        // Continue to next method
                    }
                }
            }
            
            // Method 4: Fallback to using the compose feature programmatically
            try {
                console.log('[Injector] Trying to compose message programmatically');
                
                // Try to find the compose methods
                if (Store.Composer && Store.Composer.setText) {
                    // Set the text in the composer
                    Store.Composer.setText(message);
                    
                    // Find and click the send button
                    const sendButton = document.querySelector('button[data-testid="compose-btn-send"]');
                    if (sendButton) {
                        console.log('[Injector] Found send button, clicking...');
                        sendButton.click();
                        console.log('[Injector] Message sent successfully via composer');
                        return true;
                    }
                }
            } catch (err) {
                console.log('[Injector] Composer approach failed:', err.message);
            }
            
            // Method 5 DISABLED: hidden iframe approach removed to prevent reload
            return false; // skip iframe fallback
            /*
            try {
                console.log('[Injector] Trying hidden iframe approach');
                
                // Create a hidden iframe
                const iframe = document.createElement('iframe');
                iframe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0.01;';
                document.body.appendChild(iframe);
                
                // Navigate the iframe to the WhatsApp chat
                // For self-chats, try using the special self-chat URL format
                // WhatsApp has a special URL format for messaging yourself
                const iframeUrl = `https://web.whatsapp.com/send?phone=${cleanNumber}&text=${encodeURIComponent(message)}&type=phone_number&app_absent=0`;
                iframe.src = iframeUrl;
                
                // Set up a timeout to avoid hanging
                const iframePromise = new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        document.body.removeChild(iframe);
                        reject(new Error('Iframe approach timed out'));
                    }, 8000);
                    
                    // Check periodically if the iframe has loaded
                    const checkInterval = setInterval(() => {
                        try {
                            if (!iframe.contentWindow || !iframe.contentWindow.document) return;
                            
                            const sendButton = iframe.contentWindow.document.querySelector('button[data-testid="compose-btn-send"]');
                            if (sendButton) {
                                clearInterval(checkInterval);
                                clearTimeout(timeout);
                                
                                // Click the send button
                                sendButton.click();
                                
                                // Clean up
                                setTimeout(() => {
                                    document.body.removeChild(iframe);
                                    resolve(true);
                                }, 1000);
                            }
                        } catch (err) {
                            // Ignore cross-origin errors
                        }
                    }, 500);
                });
                
                // Wait for the message to be sent or timeout
                await iframePromise;
                console.log('[Injector] Message sent successfully via iframe');
                return true;
            } catch (err) {
                console.log('[Injector] Iframe approach failed:', err);
            }
            
            */
            // If we got here, all methods failed
            console.warn('[Injector] All message sending methods failed');
            return false;
        } catch (error) {
            console.error('[Injector] Error sending silent message:', error);
            return false;
        }
    }

    // Try to send a message silently using webpack modules
    async function trySendSilently(number, message) {
        try {
            console.log('[Injector] Attempting to send silently to:', number);
            
            // Ensure chatId is properly formatted
            let chatId = number;
            if (!chatId.includes('@')) {
                chatId = `${chatId.replace(/\D/g, '')}@c.us`;
            }
            
            // First try using the Store if available
            const Store = getStore();
            if (Store) {
                console.log('[Injector] Using Store for silent send');
                
                // Try to find or create the chat
                let chat = null;
                try {
                    chat = Store.Chat.get(chatId);
                } catch (e) {
                    try {
                        if (Store.Chat.find) {
                            chat = await Store.Chat.find(chatId);
                        }
                    } catch (e2) {
                        console.log('[Injector] Chat not found, trying to create');
                    }
                }
                
                // If no chat found, try to open it
                if (!chat && Store.Cmd && Store.Cmd.openChatAt) {
                    try {
                        const wid = Store.WidFactory ? Store.WidFactory.createWid(chatId) : chatId;
                        await Store.Cmd.openChatAt(wid);
                        await new Promise(r => setTimeout(r, 500)); // Wait for chat to load
                        chat = Store.Chat.get(wid) || (Store.Chat.find ? await Store.Chat.find(wid) : null);
                    } catch (e) {
                        console.log('[Injector] Failed to open chat:', e);
                    }
                }
                
                // If we have a chat, try to send the message
                if (chat) {
                    const sendMethods = [
                        // Method 1: Store.SendTextMsgToChat
                        async () => {
                            if (Store.SendTextMsgToChat) {
                                await Store.SendTextMsgToChat(chat, message);
                                return true;
                            }
                            return false;
                        },
                        
                        // Method 2: chat.sendMessage
                        async () => {
                            if (chat.sendMessage) {
                                await chat.sendMessage(typeof message === 'string' ? { body: message } : message);
                                return true;
                            }
                            return false;
                        },
                        
                        // Method 3: Store.Msg.sendTextMsgToChat
                        async () => {
                            if (Store.Msg && Store.Msg.sendTextMsgToChat) {
                                await Store.Msg.sendTextMsgToChat(chat, message);
                                return true;
                            }
                            return false;
                        },
                        
                        // Method 4: Store.SendMessage.addAndSendMsgToChat
                        async () => {
                            if (Store.SendMessage && Store.SendMessage.addAndSendMsgToChat && Store.MsgKey) {
                                const meWid = Store.Conn?.wid || (Store.User?.getMaybeMeUser ? Store.User.getMaybeMeUser() : null);
                                const newId = Store.MsgKey.newId ? await Store.MsgKey.newId() : Date.now().toString();
                                const msgKey = new Store.MsgKey({
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
                                await Store.SendMessage.addAndSendMsgToChat(chat, silentMsg);
                                return true;
                            }
                            return false;
                        }
                    ];
                    
                    // Try each method
                    for (const method of sendMethods) {
                        try {
                            const success = await method();
                            if (success) {
                                console.log('[Injector] Message sent successfully via Store');
                                return true;
                            }
                        } catch (err) {
                            console.log('[Injector] Store method failed:', err);
                        }
                    }
                }
            }
            
            // Fallback: Try to find and use webpack modules
            console.log('[Injector] Falling back to webpack modules');
            const modules = getAllModules();
            if (!modules) {
                console.error('[Injector] Could not find webpack modules');
                return false;
            }
            
            // Try to find a module that can send messages
            for (const mod of modules) {
                if (!mod) continue;
                
                // Try different message sending functions
                if (mod.sendTextMsgToChat) {
                    try {
                        if (Store && Store.Chat) {
                            const chat = await Store.Chat.find(chatId);
                            if (chat) {
                                await mod.sendTextMsgToChat(chat, message);
                                console.log('[Injector] Message sent via webpack sendTextMsgToChat');
                                return true;
                            }
                        }
                    } catch (error) {
                        console.warn('[Injector] Webpack sendTextMsgToChat failed:', error);
                    }
                }
                
                if (mod.sendMessage) {
                    try {
                        await mod.sendMessage(chatId, message);
                        console.log('[Injector] Message sent via webpack sendMessage');
                        return true;
                    } catch (error) {
                        console.warn('[Injector] Webpack sendMessage failed:', error);
                    }
                }
            }
            
            console.error('[Injector] All silent sending attempts failed');
            return false;
        } catch (error) {
            console.error('[Injector] Error in trySendSilently:', error);
            return false;
        }
    }

    // --- Converters ---
    const toContactObj = (contact, extra = {}) => ({
        name: contact?.name || contact?.formattedName || contact?.pushname || contact?.shortName || 'N/A',
        phoneNumber: contact?.id?.user,
        ...extra
    });

    // Saved contacts
    function fetchSavedContacts() {
        const S = getStore();
        if (!S?.Contact) return post('INJECTOR_SAVED_CONTACTS_RESULT', { status: 'error', error: 'Store.Contact not found.' });
        try {
            // Filter only real address-book contacts that have a regular phone JID (server === 'c.us')
            const validContacts = S.Contact
                .filter(c => (c.isMyContact || c.isAddressBookContact) && c.id?.server === 'c.us')
                .map(c => toContactObj(c))
                // Keep only numeric phone numbers between 7-13 digits (skip internal 14-15 digit IDs)
                .filter(c => /^\d{7,13}$/.test(c.phoneNumber));

            // Deduplicate by phone number to avoid duplicate rows for the same contact
            const uniqueMap = new Map();
            validContacts.forEach(c => {
                if (!uniqueMap.has(c.phoneNumber)) {
                    uniqueMap.set(c.phoneNumber, c);
                }
            });
            const contacts = Array.from(uniqueMap.values());

            post('INJECTOR_SAVED_CONTACTS_RESULT', { status: 'success', contacts });
        } catch(e) {
            post('INJECTOR_SAVED_CONTACTS_RESULT', { status: 'error', error: e.message });
        }
    }

    // Group contacts (all groups)
    function fetchGroupContacts() {
        const S = getStore();
        if (!S?.Chat || !S?.Contact) return post('INJECTOR_GROUP_CONTACTS_RESULT', { status: 'error', error: 'Store.Chat/Contact not found.' });
        try {
            const list = [];
            S.Chat.filter(ch => ch.isGroup && ch.groupMetadata?.participants).forEach(gr => {
                const gName = gr.name || gr.formattedTitle || 'N/A';
                gr.groupMetadata.participants.forEach(p => {
                    const c = S.Contact.get(p.id);
                    list.push(toContactObj(c, { groupName: gName, contactName: toContactObj(c).name }));
                });
            });
            post('INJECTOR_GROUP_CONTACTS_RESULT', { status: 'success', contacts: list });
        } catch(e) {
            post('INJECTOR_GROUP_CONTACTS_RESULT', { status: 'error', error: e.message });
        }
    }

    // Individual chat contacts
    function fetchChatContacts() {
        const S = getStore();
        if (!S?.Chat || !S?.Contact) {
            return post('INJECTOR_CHAT_CONTACTS_RESULT', { status: 'error', error: 'Store.Chat/Contact not found.' });
        }
        try {
            const chats = S.Chat
                .filter(ch => !ch.isGroup && ch.id?.server === 'c.us')
                .map(ch => {
                    const contact = S.Contact.get(ch.id);
                    if (contact) {
                        // Use the name from the contact record (already handled by toContactObj)
                        return toContactObj(contact);
                    }
                    // Fallback to chat title if contact record missing
                    return {
                        name: ch.name || ch.formattedTitle || 'N/A',
                        phoneNumber: ch.id.user
                    };
                });
            post('INJECTOR_CHAT_CONTACTS_RESULT', { status: 'success', contacts: chats });
        } catch (e) {
            post('INJECTOR_CHAT_CONTACTS_RESULT', { status: 'error', error: e.message });
        }
    }

    // Group list
    function fetchGroupList() {
        const S = getStore();
        if (!S?.GroupMetadata) return post('INJECTOR_GROUP_LIST_RESULT', { status: 'error', error: 'Store.GroupMetadata not found.' });
        try {
            const groups = S.GroupMetadata.toArray().map(g => ({ id: g.id._serialized, name: g.name || g.subject || 'Unnamed Group' }));
            post('INJECTOR_GROUP_LIST_RESULT', { status: 'success', groups });
        } catch(e) {
            post('INJECTOR_GROUP_LIST_RESULT', { status: 'error', error: e.message });
        }
    }

    // Contacts from selected groups
    function fetchSelectedGroupContacts(selectedGroups) {
        const S = getStore();
        if (!S?.GroupMetadata || !S?.Contact) return post('INJECTOR_SELECTED_GROUP_CONTACTS_RESULT', { status: 'error', error: 'Store.GroupMetadata/Contact not found.' });
        try {
            let collected = [];
            selectedGroups.forEach(g => {
                const grp = S.GroupMetadata.get(g.id);
                if (!grp?.participants) return;
                grp.participants.forEach(p => {
                    const c = S.Contact.get(p.id);
                    collected.push(toContactObj(c, { groupName: g.name || grp.name || grp.subject || 'Group', contactName: toContactObj(c).name }));
                });
            });
            post('INJECTOR_SELECTED_GROUP_CONTACTS_RESULT', { status: 'success', contacts: collected });
        } catch(e) {
            post('INJECTOR_SELECTED_GROUP_CONTACTS_RESULT', { status: 'error', error: e.message });
        }
    }

    // Listener from content-script
    window.addEventListener('message', async (event) => {
        if (event.source !== window) return;
        if (!event.data || !event.data.type) return;
        if (event.data.source === 'injector') return; // Ignore our own messages
        
        const { type, source } = event.data;
        
        // Process messages from content-script or fl-js
        if (source !== 'content-script' && source !== 'fl-js') return;
        
        // Handle different message types
        switch (type) {
            case 'GET_SAVED_CONTACTS': fetchSavedContacts(); break;
            case 'GET_GROUP_CONTACTS': fetchGroupContacts(); break;
            case 'GET_CHAT_CONTACTS': fetchChatContacts(); break;
            case 'GET_GROUP_LIST': fetchGroupList(); break;
            case 'GET_SELECTED_GROUP_CONTACTS': fetchSelectedGroupContacts(event.data.selectedGroups || []); break;
            case 'SEND_SAFETY_MESSAGE':
                console.log(`[Injector] Received SEND_SAFETY_MESSAGE request from ${source}`);
                try {
                    const { number, message, msgId } = event.data;
                    console.log('[Injector] Received safety message request for number:', number, 'msgId:', msgId);
                    
                    // Format the number to WhatsApp format
                    const formattedNumber = number.replace(/\D/g, '');
                    const safetyMessage = message || '.';
                    
                    // SINGLE DOT sending - prevent duplicates by msgId
                    if (safetyMessage === '.') {
                        // Check if this msgId was already processed
                        if (!window.processedMsgIds) window.processedMsgIds = new Set();
                        
                        if (window.processedMsgIds.has(msgId)) {
                            console.log('[Injector] Duplicate msgId detected, skipping:', msgId);
                            post('SAFETY_MESSAGE_RESULT', { 
                                source: 'injector-script', 
                                success: true,
                                method: 'duplicate-skipped',
                                msgId: msgId,
                                number: formattedNumber,
                                actuallyDelivered: false
                            });
                            return;
                        }
                        
                        // Mark this msgId as processed
                        window.processedMsgIds.add(msgId);
                        console.log('[Injector] Processing DOT send for msgId:', msgId);
                        
                        try {
                            await new Promise(r => setTimeout(r, 2000));
                            
                            const input = document.querySelector('div[data-lexical-editor="true"][data-tab="10"]');
                            
                            if (input) {
                                console.log('[Injector] Typing DOT once for msgId:', msgId);
                                input.focus();
                                input.textContent = '.';
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                
                                await new Promise(r => setTimeout(r, 300));
                                
                                const send = document.querySelector('[data-testid="compose-btn-send"]');
                                
                                if (send && !send.disabled) {
                                    console.log('[Injector] Clicking send button for msgId:', msgId);
                                    send.click();
                                    
                                    post('SAFETY_MESSAGE_RESULT', { 
                                        source: 'injector-script', 
                                        success: true,
                                        method: 'single-dot',
                                        msgId: msgId,
                                        number: formattedNumber,
                                        actuallyDelivered: true
                                    });
                                    return;
                                }
                            }
                        } catch (e) {
                            console.error('[Injector] DOT send failed for msgId:', msgId, e);
                        }
                    }
                    
                    // Regular complex method for non-DOT messages
                    (async () => {
                        try {
                            let delivered = false;
                            let method = 'unknown';
                            
                            // Skip complex methods for DOT messages
                            if (safetyMessage === '.') {
                                console.log('[Injector] Skipping complex methods for DOT');
                                delivered = false; // Will report failure but prevent loops
                                method = 'dot-skipped';
                            } else {
                                // Wait for complex methods
                                await new Promise(r => setTimeout(r, 800));
                            }
                            
                            // Method 1: Try DOM manipulation if simple method failed
                            if (!delivered) {
                                try {
                                    delivered = await sendViaDOMManipulation(safetyMessage);
                                    if (delivered) {
                                        method = 'dom-manipulation';
                                        console.log('[Injector] Message sent via DOM manipulation');
                                    }
                                } catch (e) {
                                    console.warn('[Injector] DOM manipulation failed:', e);
                                }
                            }
                            
                            // Method 2: Try Store methods if DOM failed
                            if (!delivered) {
                                try {
                                    delivered = await trySendSilently(formattedNumber, safetyMessage);
                                    if (delivered) {
                                        method = 'store-silent';
                                        console.log('[Injector] Message sent via Store methods');
                                    }
                                } catch (e) {
                                    console.warn('[Injector] Store methods failed:', e);
                                }
                            }
                            
                            // Method 3: Try legacy sendSilentMessage if others failed
                            if (!delivered) {
                                try {
                                    delivered = await sendSilentMessage(formattedNumber, safetyMessage);
                                    if (delivered) {
                                        method = 'legacy-silent';
                                        console.log('[Injector] Message sent via legacy method');
                                    }
                                } catch (e) {
                                    console.warn('[Injector] Legacy method failed:', e);
                                }
                            }
                            
                            // For DOT messages, wait longer before reporting success
                            if (safetyMessage === '.' && delivered) {
                                console.log('[Injector] DOT sent, waiting before continuing campaign...');
                                await new Promise(r => setTimeout(r, 2000)); // Block campaign for 2 seconds
                            }
                            
                            // Report the result - always report success to prevent infinite retries
                            post('SAFETY_MESSAGE_RESULT', { 
                                source: 'injector-script', 
                                success: true, // Always report success to prevent retry loops
                                method: delivered ? method : 'acknowledged-failure',
                                msgId: msgId || ('inj_' + Date.now()),
                                number: formattedNumber,
                                actuallyDelivered: delivered
                            });
                            
                            if (delivered) {
                                console.log(`[Injector] Safety message sent successfully via ${method}`);
                            } else {
                                console.warn('[Injector] All sending methods failed, but reporting success to prevent retry loop');
                            }
                        } catch (err) {
                            console.error('[Injector] Error in safety message sending:', err);
                            // Report success even on error to prevent infinite retry loops
                            post('SAFETY_MESSAGE_RESULT', { 
                                source: 'injector-script', 
                                success: true, // Prevent retry loops
                                method: 'error-acknowledged',
                                error: err.message,
                                msgId: msgId || ('inj_err_' + Date.now()),
                                number: formattedNumber
                            });
                        }
                    })();
                } catch (error) {
                    console.error('[Injector] Error handling safety message:', error);
                    // Report success even on error to prevent infinite retry loops
                    post('SAFETY_MESSAGE_RESULT', { 
                        source: 'injector-script', 
                        success: true, // Prevent retry loops
                        method: 'error-acknowledged',
                        error: error.message,
                        msgId: event.data.msgId || ('inj_err_' + Date.now()),
                        number: event.data.number
                    });
                }
                break;
        }
    });
    // WhatsApp reload detection and recovery
    let lastKnownState = null;
    let reloadDetectionInterval = null;
    
    function setupReloadDetection() {
        // Clear any existing interval
        if (reloadDetectionInterval) {
            clearInterval(reloadDetectionInterval);
        }
        
        // Set up reload detection
        reloadDetectionInterval = setInterval(() => {
            // Check if WhatsApp shell exists
            const shellExists = document.querySelector('#app, #pane-side, [data-asset-chat-background-dark]');
            
            // If shell doesn't exist but previously did, WhatsApp likely reloaded
            if (!shellExists && lastKnownState === 'loaded') {
                console.log('[Injector] WhatsApp reload detected!');
                post('WHATSAPP_RELOAD_DETECTED', { timestamp: Date.now() });
                lastKnownState = 'reloading';
            }
            // If shell exists but previously didn't, WhatsApp has finished loading
            else if (shellExists && (lastKnownState === 'reloading' || lastKnownState === null)) {
                console.log('[Injector] WhatsApp loaded, initializing...');
                post('WHATSAPP_LOADED', { timestamp: Date.now() });
                lastKnownState = 'loaded';
                
                // Re-initialize after reload
                setTimeout(() => {
                    getOwnPhoneNumber();
                }, 1500);
            }
        }, 2000);
    }
    
    // Kick-off own number fetch and setup reload detection
    if (window.self === window.top && window.location.hostname.includes('whatsapp.com')) {
        setTimeout(() => {
            getOwnPhoneNumber();
            setupReloadDetection();
        }, 500);
    }
})();
