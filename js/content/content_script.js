// js/content/content_script.js  – enhanced for contact extraction and silent messaging
console.log("WA Campaign Sender: Content script (contacts extractor) loaded.");

const storageKey = 'waUserPhoneNumberResult';

// Inject all required scripts
injectScript(chrome.runtime.getURL('js/content/injector.js'));
injectScript(chrome.runtime.getURL('js/content/fl.js'));
injectScript(chrome.runtime.getURL('js/utils/adaptiveSelectors.js'));
injectScript(chrome.runtime.getURL('js/content/safetyMessageInitializer.js'));
injectScript(chrome.runtime.getURL('js/content/blockedUserDetector.js'));

function injectScript(filePath){
  const scriptId = 'wa-bs-injector-' + filePath.split('/').pop().replace('.js', '');
  const prev = document.getElementById(scriptId);
  if(prev) prev.remove();
  const sc = document.createElement('script');
  sc.id = scriptId;
  sc.type = 'text/javascript';
  sc.src = filePath;
  (document.head||document.documentElement).appendChild(sc);
  sc.onerror = (e)=>{
    console.error('Injector load error',e);
    chrome.runtime.sendMessage({type:'WHATSAPP_NUMBER_RESULT',status:'error',message:`Failed to inject script: ${filePath}`});
  };
}

// --------------------------------------------------
// Track WhatsApp state
let whatsappState = {
  isLoaded: false,
  reloadCount: 0,
  lastReloadTime: null,
  recoveryAttempts: 0
};

// Track message status for campaign progress
let messageStatusMap = new Map(); // Maps phone numbers to message status

// Function to handle WhatsApp reload/crash
function handleWhatsAppReload() {
  whatsappState.reloadCount++;
  whatsappState.lastReloadTime = Date.now();
  console.log(`[Content] WhatsApp reload detected! Count: ${whatsappState.reloadCount}`);
  
  // Notify background script about reload
  chrome.runtime.sendMessage({
    action: 'whatsappReloadDetected',
    reloadCount: whatsappState.reloadCount,
    timestamp: whatsappState.lastReloadTime
  });
  
  // If we're in the middle of a campaign, try to recover
  attemptRecovery();
}

// Function to attempt recovery after WhatsApp reload
async function attemptRecovery() {
  whatsappState.recoveryAttempts++;
  console.log(`[Content] Attempting recovery #${whatsappState.recoveryAttempts}`);
  
  // Wait for WhatsApp to fully load
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Re-inject the scripts
  injectScript(chrome.runtime.getURL('js/content/injector.js'));
  injectScript(chrome.runtime.getURL('js/content/fl.js'));
  injectScript(chrome.runtime.getURL('js/content/safetyMessageInitializer.js'));
  injectScript(chrome.runtime.getURL('js/content/blockedUserDetector.js'));
  
  // Notify background that we're ready again
  chrome.runtime.sendMessage({
    action: 'whatsappRecovered',
    recoveryAttempt: whatsappState.recoveryAttempts,
    timestamp: Date.now()
  });
}

// Listen for message status updates from fl.js
window.addEventListener('wa-message-status-update', (event) => {
  try {
    const { msgId, phone, status, success } = event.detail;
    console.log(`[Content] Message status update received: phone=${phone}, status=${status}, success=${success}`);
    
    if (success && phone) {
      // Store the successful status
      messageStatusMap.set(phone, { status, success, timestamp: Date.now() });
      
      // Notify background script about the successful message
      chrome.runtime.sendMessage({
        action: 'updateMessageStatus',
        phone: phone,
        status: 'success',
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error('[Content] Error handling message status update:', error);
  }
});

// Handle messages FROM the injector (window.postMessage)
window.addEventListener('message',(ev)=>{
  if(ev.source!==window || !ev.data || ev.data.source!=='injector-script') return;
  const d=ev.data;
  switch(d.type){
    case 'WHATSAPP_RELOAD_DETECTED':
      console.log('[Content] Received reload detection from injector');
      handleWhatsAppReload();
      break;
    case 'WHATSAPP_LOADED':
      console.log('[Content] Received WhatsApp loaded event from injector');
      whatsappState.isLoaded = true;
      // Re-fetch the phone number when WhatsApp is loaded
      attemptFetchingNumber();
      break;
    case 'WHATSAPP_NUMBER_FETCHER_RESULT':
      chrome.runtime.sendMessage({type:'WHATSAPP_NUMBER_RESULT',status:d.phoneNumber?'success_injector':'error',number:d.phoneNumber, message:d.message});
      break;
    case 'OWN_WHATSAPP_NUMBER_RESULT':
      // Handle result from safetyMessageInitializer.js
      if (d.status === 'success' && d.number) {
        console.log('[Content] Received own WhatsApp number from safetyMessageInitializer:', d.number);
        chrome.storage.local.set({
          waUserPhoneNumberResult: {
            status: 'success',
            number: d.number,
            timestamp: Date.now()
          }
        });
        chrome.runtime.sendMessage({
          type: 'WHATSAPP_NUMBER_RESULT',
          status: 'success',
          number: d.number
        });
      }
      break;
    case 'INJECTOR_SAVED_CONTACTS_RESULT':
      chrome.runtime.sendMessage({type:'SAVED_CONTACTS_RESULT',status:d.status,contacts:d.contacts,error:d.error});
      break;
    case 'INJECTOR_GROUP_CONTACTS_RESULT':
      chrome.runtime.sendMessage({type:'GROUP_CONTACTS_RESULT',status:d.status,contacts:d.contacts,error:d.error});
      break;
    case 'INJECTOR_CHAT_CONTACTS_RESULT':
      chrome.runtime.sendMessage({type:'CHAT_CONTACTS_RESULT',status:d.status,contacts:d.contacts,error:d.error});
      break;
    case 'INJECTOR_GROUP_LIST_RESULT':
      chrome.runtime.sendMessage({type:'GROUP_LIST_RESULT',status:d.status,groups:d.groups,error:d.error});
      break;
    case 'INJECTOR_SELECTED_GROUP_CONTACTS_RESULT':
      chrome.runtime.sendMessage({type:'SELECTED_GROUP_CONTACTS_RESULT',status:d.status,contacts:d.contacts,error:d.error});
      break;
    case 'SAFETY_MESSAGE_RESULT':
      // Handle result from safety message sending (from injector or fl.js)
      console.log('[Content] Received safety message result:', d);
      if (d.success && d.number) {
        // Update message status map
        messageStatusMap.set(d.number, { 
          status: 'success', 
          method: d.method || d.source || 'injector',
          msgId: d.msgId,
          timestamp: Date.now() 
        });
        
        // Notify background script about successful message
        chrome.runtime.sendMessage({
          action: 'updateMessageStatus',
          phone: d.number,
          status: 'success',
          method: d.method || d.source || 'injector',
          timestamp: Date.now()
        });
      }
      break;
  }
},false);

// --------------------------------------------------
let pendingMessageTimeoutId=null;
function attemptFetchingNumber(){
  if(!window.location.hostname.includes('web.whatsapp.com')) return;
  if(pendingMessageTimeoutId){clearTimeout(pendingMessageTimeoutId);pendingMessageTimeoutId=null;}
  injectScript(chrome.runtime.getURL('js/content/injector.js'));
  injectScript(chrome.runtime.getURL('js/content/safetyMessageInitializer.js'));
  pendingMessageTimeoutId=setTimeout(()=>{
    pendingMessageTimeoutId=null;
    chrome.storage.local.get([storageKey],res=>{
      const last=res[storageKey];
      if(!last|| (last.status!=='success_injector'&&last.status!=='error')){
        chrome.runtime.sendMessage({type:'WHATSAPP_NUMBER_RESULT',status:'pending_injector',message:'Attempting to fetch number. Please wait...'});
      }
    });
  },3500);
}
attemptFetchingNumber();

// Function to send safety message via injected script
async function sendSafetyMessageToSelf(number, message) {
  console.log(`[Content] Starting safety message send to ${number}`);
  
  // Try the simple reliable method first
  try {
    const { sendReliableSafetyMessage } = await import(chrome.runtime.getURL('js/utils/simpleSafetyMessage.js'));
    const success = await sendReliableSafetyMessage(number, message || '.');
    
    if (success) {
      console.log('[Content] Safety message sent successfully via simple method');
      
      // Update message status map
      messageStatusMap.set(number, { 
        status: 'success', 
        method: 'simple-reliable',
        timestamp: Date.now() 
      });
      
      // Notify background script
      chrome.runtime.sendMessage({
        action: 'updateMessageStatus',
        phone: number,
        status: 'success',
        method: 'simple-reliable',
        timestamp: Date.now()
      });
      
      return { success: true, method: 'simple-reliable' };
    }
  } catch (error) {
    console.warn('[Content] Simple method failed, trying fallback methods:', error);
  }
  
  // Fallback to original complex method
  const formattedNumber = number.replace(/\D/g, '');
  const chatId = `${formattedNumber}@c.us`;
  message = message || '.';
  
  // Track sending attempts for debugging
  const attempts = [];
  function trackAttempt(method, result) {
    attempts.push({ method, result, timestamp: Date.now() });
    console.log(`[Content] Safety message attempt via ${method}: ${result}`);
    
    // Add to messageStatusMap for campaign progress tracking
    if (typeof result === 'string' && result.includes('success')) {
      messageStatusMap.set(number, { status: 'success', method, timestamp: Date.now() });
    } else if (result && result.success) {
      messageStatusMap.set(number, { status: 'success', method, timestamp: Date.now() });
    }
  }
  
  try {
    // Generate a message ID for tracking
    const msgId = 'safety_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    
    // Try to send via fl.js first (silent)
    console.log('[Content] Attempting to send safety message via fl.js...');
    try {
      sendSilentMessage(formattedNumber, message)
        .then(result => {
          trackAttempt('fl.js', 'success');
          console.log('[Content] Safety message sent successfully via fl.js:', result);
          
          // Store the message ID for status tracking
          if (result && result.msgId) {
            messageStatusMap.set(formattedNumber, { 
              status: 'success', 
              method: 'fl.js',
              msgId: result.msgId,
              timestamp: Date.now() 
            });
            
            // Notify background script about successful message
            chrome.runtime.sendMessage({
              action: 'updateMessageStatus',
              phone: formattedNumber,
              status: 'success',
              method: 'fl.js',
              timestamp: Date.now()
            });
          }
        })
        .catch(error => {
          trackAttempt('fl.js', `failed: ${error.message}`);
          console.warn('[Content] Failed to send via fl.js, trying injector...', error);
          
          // Fallback to injector method
          window.postMessage({
            type: 'SEND_SAFETY_MESSAGE',
            source: 'content-script',
            number: formattedNumber,
            message,
            msgId
          }, '*');
          trackAttempt('injector', 'attempted');
          
          // Listen for result from injector
          const resultHandler = function(event) {
            if (event.source !== window || !event.data || event.data.source !== 'injector-script' || event.data.type !== 'SAFETY_MESSAGE_RESULT') {
              return;
            }
            
            window.removeEventListener('message', resultHandler);
            clearTimeout(timeoutId);
            const result = event.data;
            
            if (result.success) {
              trackAttempt('injector-result', 'success');
              console.log('[Content] Safety message sent successfully via injector');
              
              // Update message status map
              messageStatusMap.set(formattedNumber, { 
                status: 'success', 
                method: 'injector',
                msgId: result.msgId || msgId,
                timestamp: Date.now() 
              });
              
              // Notify background script about successful message
              chrome.runtime.sendMessage({
                action: 'updateMessageStatus',
                phone: formattedNumber,
                status: 'success',
                method: 'injector',
                timestamp: Date.now()
              });
            } else {
              trackAttempt('injector-result', `failed: ${result.error || 'unknown error'}`);
              console.warn('[Content] Failed to send via injector, trying background script...', result.error);
              
              // Final fallback to background script
              chrome.runtime.sendMessage({
                action: 'sendDirectSafetyMessage',
                number: formattedNumber,
                message,
                msgId: msgId
              }, response => {
                if (response && response.success) {
                  trackAttempt('background', 'success');
                  console.log('[Content] Safety message sent successfully via background script');
                  
                  // Update message status map
                  messageStatusMap.set(formattedNumber, { 
                    status: 'success', 
                    method: 'background',
                    timestamp: Date.now() 
                  });
                  
                  // Notify background script about successful message
                  chrome.runtime.sendMessage({
                    action: 'updateMessageStatus',
                    phone: formattedNumber,
                    status: 'success',
                    method: 'background',
                    timestamp: Date.now()
                  });
                } else {
                  trackAttempt('background', `failed: ${(response && response.error) || 'unknown error'}`);
                  console.error('[Content] All safety message methods failed');
                }
              });
            }
          };
          
          // Set timeout to clean up listener
          const timeoutId = setTimeout(() => {
            window.removeEventListener('message', resultHandler);
            trackAttempt('injector', { success: false, error: 'Timeout waiting for result' });
            
            // Try background script as final fallback
            chrome.runtime.sendMessage({
              action: 'sendDirectSafetyMessage',
              number: formattedNumber,
              message,
              msgId: msgId
            }, response => {
              if (response && response.success) {
                trackAttempt('background-timeout', 'success');
                console.log('[Content] Safety message sent successfully via background script after timeout');
                
                // Update message status map
                messageStatusMap.set(formattedNumber, { 
                  status: 'success', 
                  method: 'background-timeout',
                  timestamp: Date.now() 
                });
                
                // Notify background script about successful message
                chrome.runtime.sendMessage({
                  action: 'updateMessageStatus',
                  phone: formattedNumber,
                  status: 'success',
                  method: 'background-timeout',
                  timestamp: Date.now()
                });
              } else {
                trackAttempt('background-timeout', `failed: ${(response && response.error) || 'unknown error'}`);
                console.error('[Content] All safety message methods failed after timeout');
              }
            });
          }, 5000);
          
          window.addEventListener('message', resultHandler);
        });
    } catch (flError) {
      trackAttempt('fl.js', `error: ${flError.message}`);
      console.warn('[Content] Error using fl.js:', flError);
      
      // Fallback to injector method
      window.postMessage({
        type: 'SEND_SAFETY_MESSAGE',
        source: 'content-script',
        number: formattedNumber,
        message,
        msgId
      }, '*');
      trackAttempt('injector', 'attempted after fl.js error');
    }
    
    // After 10 seconds, log all attempts for debugging
    setTimeout(() => {
      console.log('[Content] Safety message sending attempts summary:', attempts);
    }, 10000);
  } catch (error) {
    console.error('[Content] Error in safety message sending:', error);
    // Don't throw, we're already resolving with quickPromise
  }
  
  // Return success to avoid blocking the campaign
  return { success: true, method: 'fallback-attempted' };
}

// Function to send a silent message using fl.js
async function sendSilentMessage(number, message) {
  return new Promise((resolve, reject) => {
    const msgId = 'fl_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const cleanNumber = number.replace(/\D/g, '');
    
    console.log('[Content] Sending safety message via fl.js to:', cleanNumber);
    
    // Set up timeout
    const timeout = setTimeout(() => {
      window.removeEventListener('message', resultHandler);
      console.warn('[Content] Timeout waiting for fl.js result');
      reject(new Error('Timeout waiting for fl.js result'));
    }, 10000);
    
    // Set up result handler
    const resultHandler = (event) => {
      if (event.source !== window || !event.data || event.data.source !== 'fl-js' || event.data.type !== 'SAFETY_MESSAGE_RESULT') {
        return;
      }
      
      const result = event.data;
      if (result.msgId === msgId || result.number === cleanNumber) {
        clearTimeout(timeout);
        window.removeEventListener('message', resultHandler);
        
        if (result.success) {
          console.log('[Content] fl.js sent message successfully:', result);
          resolve(result);
        } else {
          console.warn('[Content] fl.js failed to send message:', result);
          reject(new Error(result.error || 'fl.js failed to send message'));
        }
      }
    };
    
    // Listen for result
    window.addEventListener('message', resultHandler);
    
    // Send message to fl.js
    window.postMessage({
      type: 'SEND_SAFETY_MESSAGE',
      source: 'content-script',
      number: cleanNumber,
      message: message || '.',
      msgId: msgId
    }, '*');
  });
}

// --------------------------------------------------
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  // Handle action-based messages from background script
  if (msg.action === 'sendSafetyMessage') {
    sendSafetyMessageToSelf(msg.number, msg.message)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Async response
  }
  
  if (msg.action === 'sendSafetyMessageFixed') {
    // Use the fixed safety message method from injected script
    if (window.sendSafetyMessageFixed) {
      window.sendSafetyMessageFixed(msg.number, msg.message)
        .then(result => sendResponse({ success: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
    } else {
      // Fallback to old method
      sendSafetyMessageToSelf(msg.number, msg.message)
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
    }
    return true;
  }
  
  if (msg.action === 'getOwnWhatsAppNumber') {
    // Request the user's own WhatsApp number from the page
    window.postMessage({
      type: 'GET_OWN_WHATSAPP_NUMBER',
      source: 'content-script'
    }, '*');
    sendResponse({ status: 'request_sent' });
    return true;
  }
  
  switch(msg.type){
    case 'FETCH_WHATSAPP_NUMBER_AGAIN':
    case 'FETCH_WA_USER_NUMBER_AGAIN':
      attemptFetchingNumber();
      sendResponse({status:'fetch_number_attempt_triggered'});
      return true;
    case 'WHATSAPP_NUMBER_RESULT':{
      const entry={ status:msg.status, number:msg.number, message:msg.message, timestamp:Date.now() };
      chrome.storage.local.set({ [storageKey]:entry, lastNumberResult:entry });
      break; }
    case 'FETCH_SAVED_CONTACTS_CSV':
      window.postMessage({type:'GET_SAVED_CONTACTS',source:'content-script'},'*');
      sendResponse({status:'request_relayed_to_injector'});return true;
    case 'FETCH_GROUP_CONTACTS_CSV':
      window.postMessage({type:'GET_GROUP_CONTACTS',source:'content-script'},'*');
      sendResponse({status:'request_relayed_to_injector'});return true;
    case 'FETCH_CHAT_CONTACTS_CSV':
      window.postMessage({type:'GET_CHAT_CONTACTS',source:'content-script'},'*');
      sendResponse({status:'request_relayed_to_injector'});return true;
    case 'FETCH_GROUP_LIST':
      window.postMessage({type:'GET_GROUP_LIST',source:'content-script'},'*');
      sendResponse({status:'request_group_list_relayed_to_injector'});return true;
    case 'DOWNLOAD_SELECTED_GROUP_CONTACTS':
      window.postMessage({type:'GET_SELECTED_GROUP_CONTACTS',source:'content-script',selectedGroups:msg.selectedGroups},'*');
      sendResponse({status:'request_selected_groups_relayed_to_injector'});return true;
  }
});

// Ping the background script to let it know the content script is ready
chrome.runtime.sendMessage({ action: 'contentScriptReady' });

console.log("WA Campaign Sender: Number Fetcher Content Script Initialized.");