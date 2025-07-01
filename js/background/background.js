// background.js - Enhanced Background Service for WhatsApp Broadcast Sender

/**
 * Features:
 * - Robust campaign state management
 * - Auto-recovery for stuck campaigns
 * - Heartbeat monitoring for active campaigns
 * - Improved error handling and reporting
 */

// Global variables for state management
let whatsAppConnectionStatus = false;
let activeCampaign = null;
let campaignStatus = null;
let isInitialized = false;
let isConnected = false;
let whatsAppTabIds = [];
let contentScriptInjected = new Map();

// WhatsApp reload tracking
let whatsAppReloadState = {
  isReloading: false,
  reloadCount: 0,
  lastReloadTime: null,
  campaignWasRunning: false,
  campaignPausedForReload: false,
  recoveryAttempts: 0
};

// Safety mode tracking
let messageSendCounter = 0;
let lastSafetyMessageTime = null;
let campaignSafetyManager = null;

async function initSafetyManager() {
  try {
    const module = await import('./utils/campaignSafetyManager.js');
    campaignSafetyManager = module;
    campaignSafetyManager.initCampaignSafetyManager();
  } catch (error) {
    logBackground('Failed to initialize safety manager: ' + error.message);
  }
}

// ===== Logging Control =====
// Set WA_DEBUG to true to enable detailed logging from the background service.
const WA_DEBUG = false;

if (!WA_DEBUG && typeof self !== 'undefined' && self.console) {
  ['log','info','debug','warn','error'].forEach(m => { if (console[m]) console[m] = () => {}; });
  self.addEventListener('unhandledrejection', e => { e.preventDefault(); });
}

// Log function for debugging
function logBackground(message) {
  if (WA_DEBUG) {
    console.log(`[WA-Background] ${message}`);
  }
}

// Initialize background service
async function initializeBackground() {
  try {
    // Clear cached license data on extension reload
    await chrome.storage.local.remove(['userLicense', 'licenseVerified', 'licenseTimestamp']);
    logBackground('Cleared cached license data on extension reload');
    
    // Check for existing WhatsApp tabs
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    whatsAppTabIds = tabs.map(tab => tab.id);
    
    if (whatsAppTabIds.length > 0) {
      isConnected = true;
      whatsAppConnectionStatus = true;
      
      // Ensure content script is injected in existing tabs
      for (const tabId of whatsAppTabIds) {
        await ensureContentScriptInjected(tabId);
      }
    }
    
    // Check for interrupted campaign after browser restart
    await recoverInterruptedCampaign();
    
    // Set up message listeners
    setupMessageListeners();
    setupConnectionListeners();
    
    // Set up tab monitoring
    setupTabMonitoring();
    
    isInitialized = true;
    logBackground('Background service initialized');
  } catch (error) {
    logBackground('Error initializing background service: ' + error.message);
  }
}

// Auto-open WhatsApp Web when extension is installed or updated
chrome.runtime.onInstalled.addListener(async () => {
  try {
    // Check if WhatsApp Web is already open
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length === 0) {
      // Open WhatsApp Web if not already open
      await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
    }
  } catch (error) {
    logBackground('Error auto-opening WhatsApp Web: ' + error.message);
  }
});

// Simplify ensureContentScriptInjected to only check for presence via ping
async function ensureContentScriptInjected(tabId) {
  // If we already know it's injected and verified for this tab, return true.
  if (contentScriptInjected.get(tabId)) {
    return true;
  }

  // Try to ping the content script. If it responds, it means it was injected by the manifest.
  try {
    logBackground(`Pinging content script in tab ${tabId}`);
    // Add a timeout to the ping, as sendMessage can hang indefinitely if the other side doesn't exist
    const response = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Ping to content script timed out'));
      }, 2000); // 2-second timeout

      chrome.tabs.sendMessage(tabId, { action: 'ping' })
        .then(res => {
          clearTimeout(timeoutId);
          resolve(res);
        })
        .catch(err => {
          clearTimeout(timeoutId);
          reject(err);
        });
    });

    if (response && (response.success || response.status === 'ok')) { // Check for different possible ping responses
      contentScriptInjected.set(tabId, true);
      logBackground(`Content script is active in tab ${tabId}`);
      return true;
    } else {
      logBackground(`Content script in tab ${tabId} did not respond as expected to ping.`);
      contentScriptInjected.delete(tabId); // Ensure we don't mistakenly think it's there
      return false;
    }
  } catch (error) {
    logBackground(`Content script not found or ping failed in tab ${tabId}: ${error.message}`);
    contentScriptInjected.delete(tabId);
    return false;
  }
}

// Set up long-lived connection listeners
function setupConnectionListeners() {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'content-script') {
      logBackground(`Ignoring connection from port: ${port.name}`);
      return;
    }

    logBackground(`Content script connected from tab ${port.sender.tab.id}`);

    const messageHandler = (message) => {
      switch (message.action) {
        case 'ping':
          port.postMessage({ pong: true });
          break;
        case 'WHATSAPP_NUMBER_RESULT':
          {
            const entry = {
              status: message.status,
              number: message.number,
              message: message.message,
              timestamp: Date.now()
            };
            chrome.storage.local.set({ waUserPhoneNumberResult: entry })
              .then(() => {
                logBackground(`WhatsApp number result stored via port: ${JSON.stringify(entry)}`);
                // No sendResponse needed for port messages unless a reply is expected
              })
              .catch(error => {
                logBackground(`Error storing WhatsApp number result via port: ${error.message}`);
              });
            break;
          }
      }
      // Note: More complex message handling could be routed here
    };

    port.onMessage.addListener(messageHandler);

    port.onDisconnect.addListener(() => {
      logBackground(`Content script disconnected from tab ${port.sender.tab.id}`);
      port.onMessage.removeListener(messageHandler);
      if (chrome.runtime.lastError) {
        logBackground(`Disconnect reason: ${chrome.runtime.lastError.message}`);
      }
    });
  });
}

// Set up message listeners
function setupMessageListeners() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      // Handle message status updates from content script
      if (message.action === 'updateMessageStatus') {
        handleMessageStatusUpdate(message);
        sendResponse({ success: true });
        return true;
      }
      if (!message || !message.action) return false;
      
      const { action } = message;
      
      switch (action) {
      case 'whatsappReloadDetected':
        // Handle WhatsApp reload detection
        handleWhatsAppReload(message);
        sendResponse({ success: true });
        return true;
        
      case 'whatsappRecovered':
        // Handle WhatsApp recovery
        handleWhatsAppRecovery(message);
        sendResponse({ success: true });
        return true;
        
      case 'contentScriptReady':
        if (sender.tab) {
          contentScriptInjected.set(sender.tab.id, true);
          logBackground(`Content script ready in tab ${sender.tab.id}`);
          
          // If a campaign is already marked as running but the content script
          // has (re)loaded, ensure it actually starts.
          if (activeCampaign && activeCampaign.status === 'running' && activeCampaign.tabId === sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              action: 'startSending',
              campaignId: activeCampaign.id
            }).then(() => {
              logBackground('Resent startSending after contentScriptReady');
            }).catch(err => {
              logBackground('Failed to resend startSending: ' + err.message);
            });
          }
        }
        sendResponse({ success: true });
        return true;
        
      case 'checkWhatsAppConnection':
        handleConnectionCheck()
          .then(result => sendResponse(result))
          .catch(() => sendResponse({ connected: false }));
        return true;
        
      case 'startCampaignDirectly':
        handleCampaignStart(message.campaignSettings)
          .then(result => sendResponse(result))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
        
      case 'resetCampaignState':
        cleanupCampaignState();
        sendResponse({ success: true });
        return true;
        
      case 'updateCampaignProgress':
        if (activeCampaign && message.campaignId === activeCampaign.id) {
          // Check if a message was successfully sent
          const previousSentCount = activeCampaign.sentCount || 0;
          
          // Update activeCampaign with new progress
          activeCampaign = {
            ...activeCampaign,
            ...message.status, // message.status contains { currentIndex, sentCount, failedCount, status, error? }
            lastUpdateTime: new Date().toISOString()
          };
          
          // Increment safety counter if a message was successfully sent
          if (message.status.sentCount > previousSentCount) {
            // Use campaign safety manager if available
            if (campaignSafetyManager) {
              (async () => {
                try {
                  const safetySent = await campaignSafetyManager.incrementAndCheckSafety();
                  if (safetySent) {
                    logBackground('[SafetyManager] Safety message sent via manager');
                  }
                } catch (error) {
                  logBackground(`[SafetyManager] Error: ${error.message}`);
                }
              })();
            } else {
              // Fallback to old method
              messageSendCounter++;
              
              // Check if it's time to send a safety message
              (async () => {
                try {
                  await checkAndSendSafetyMessage();
                } catch (error) {
                  logBackground(`Safety message error: ${error.message}`);
                }
              })();
            }
          }

          // Asynchronously save and broadcast
          (async () => {
            try {
              // Persist a light copy (omit large base64 payload) to stay within storage quotas.
              const storageCopy = JSON.parse(JSON.stringify(activeCampaign));
              if (storageCopy.attachment && storageCopy.attachment.base64String) {
                // Remove if larger than ~100 KB (well below the 5 MB per-item limit)
                if (storageCopy.attachment.base64String.length > 100000) {
                  delete storageCopy.attachment.base64String;
                }
              }
              await chrome.storage.local.set({ activeCampaign: storageCopy });
              logBackground(`Campaign ${activeCampaign.id} progress updated: ${activeCampaign.sentCount}/${activeCampaign.totalContacts} sent. Status: ${activeCampaign.status}`);
              broadcastCampaignStatus(activeCampaign); // Broadcast the full, updated activeCampaign

              // Auto-cleanup campaign once it reaches a terminal state so the next one can start seamlessly
              if (['completed', 'failed', 'aborted'].includes(activeCampaign.status)) {
                logBackground(`Campaign ${activeCampaign.id} reached terminal state (${activeCampaign.status}). Cleaning up state.`);
                await cleanupCampaignState();
              }

              sendResponse({ success: true });
            } catch (e) {
              logBackground(`Error saving/broadcasting campaign progress: ${e.message}`);
              sendResponse({ success: false, error: e.message });
            }
          })();
          return true; // Crucial for async sendResponse
        } else {
          logBackground('updateCampaignProgress: No active campaign or ID mismatch.');
          sendResponse({ success: false, error: 'Campaign not found or ID mismatch' });
          // No return true here, sendResponse is synchronous if this path is taken immediately.
        }
        break;
      case 'openExtensionPopup':
        chrome.action.openPopup().then(() => {
          sendResponse({ success: true });
        }).catch(error => {
          logBackground('Error opening popup: ' + error.message);
          sendResponse({ success: false, error: error.message });
        });
        return true;

      case 'requestCampaignStatusUpdate':
        if (activeCampaign) {
            broadcastCampaignStatus(activeCampaign);
        }
        sendResponse({ success: true });
        return true;
      case 'getCampaignStatus':
        if (activeCampaign) {
          sendResponse({ success: true, campaignStatus: activeCampaign });
        } else {
          sendResponse({ success: false, error: 'No active campaign' });
        }
        return true;
      case 'getAttachmentBlob':
        (async () => {
          try {
            const { attachmentRef } = message;
            if (!attachmentRef) {
              sendResponse({ success: false, error: 'No attachmentRef provided' });
              return;
            }
            const rec = await getBlobFromIndexedDB(attachmentRef);
            if (!rec || !rec.blob) {
              sendResponse({ success: false, error: 'not_found' });
              return;
            }
            // Create an object URL for the blob so the content script can fetch it
            const blobUrl = URL.createObjectURL(rec.blob);
            // Store URL in a temporary Set so we can revoke later if needed
            if (!globalThis._attachmentUrls) globalThis._attachmentUrls = new Set();
            globalThis._attachmentUrls.add(blobUrl);
            sendResponse({
              success: true,
              url: blobUrl,
              type: rec.blob.type || 'application/octet-stream',
              name: (rec.meta && rec.meta.name) || 'attachment'
            });
          } catch (err) {
            logBackground('getAttachmentBlob error: ' + err.message);
            sendResponse({ success: false, error: err.message });
          }
        })();
        return true; // Keep the message channel open for async response
      case 'pauseCampaign':
        (async()=>{
          const resp = await handleCampaignPause(message.reason);
          
          // Show appropriate message based on reason
          if (message.reason === 'tab_inactive') {
            broadcastCampaignStatus({
              ...activeCampaign,
              status: 'paused',
              message: 'Campaign paused: WhatsApp tab is not active. Please focus the tab to continue.'
            });
          }
          
          sendResponse(resp);
        })();
        return true;
      case 'resumeCampaign':
        (async()=>{
          const resp = await handleCampaignResume();
          sendResponse(resp);
        })();
        return true;
      case 'abortCampaign':
        (async()=>{
          const resp = await handleCampaignAbort();
          sendResponse(resp);
        })();
        return true;
        
      case 'sendDirectSafetyMessage':
        (async()=>{
          try {
            const { number, message: messageText } = message;
            logBackground(`Attempting direct safety message send to ${number}`);
            
            // Find WhatsApp tab
            const tab = await findWhatsAppTab();
            if (!tab) {
              sendResponse({ success: false, error: 'WhatsApp tab not found' });
              return;
            }
            
            // Send the message via the tab
            await chrome.tabs.sendMessage(tab.id, {
              action: 'sendSafetyMessage',
              number,
              message: messageText || '.'
            });
            
            // Always respond with success to avoid blocking
            sendResponse({ success: true, method: 'background-direct' });
          } catch (error) {
            logBackground('Error in direct safety message: ' + error.message);
            sendResponse({ success: false, error: error.message });
          }
        })();
        return true;
      }
      return false;
    } catch (error) {
      logBackground('Error handling message: ' + error.message);
      sendResponse({ success: false, error: error.message });
      return false;
    }
  });
}

async function cleanupCampaignState() {
  activeCampaign = null;
  await chrome.storage.local.remove('activeCampaign');
  messageSendCounter = 0;
  
  if (campaignSafetyManager) {
    campaignSafetyManager.resetMessageCounter();
  }
  
  logBackground('Campaign state cleaned up');
}

// Removed - functionality moved to campaignSafetyManager.js

// Send a message to the user's own number
async function sendSafetyMessage(targetNumber, customMessage, msgId) {
  try {
    // Get user's own phone number if not provided
    let selfNumber = targetNumber;
    if (!selfNumber) {
      const result = await chrome.storage.local.get('waUserPhoneNumberResult');
      const phoneEntry = result.waUserPhoneNumberResult;
      
      if (!phoneEntry || phoneEntry.status !== 'success' || !phoneEntry.number) {
        logBackground('[SafetyMode] Cannot send safety message: Own phone number not found');
        return { success: false, error: 'Own phone number not found' };
      }
      
      selfNumber = phoneEntry.number;
    }
    
    // Generate message ID if not provided
    const messageId = msgId || 'safety_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    
    logBackground(`[SafetyMode] Sending safety message to ${selfNumber} with ID ${messageId}`);
    
    // Pause the campaign briefly if it's running
    const originalStatus = activeCampaign?.status;
    if (activeCampaign && originalStatus === 'running') {
      activeCampaign.status = 'safety_pause';
      broadcastCampaignStatus(activeCampaign);
    }
    
    // Find WhatsApp tab
    const tab = await findWhatsAppTab();
    if (!tab) {
      logBackground('[SafetyMode] Cannot send safety message: No WhatsApp tab found');
      return { success: false, error: 'No WhatsApp tab found' };
    }
    
    // Send message to content script
    await chrome.tabs.sendMessage(tab.id, {
      action: 'sendSafetyMessage',
      number: selfNumber,
      message: customMessage || '.', // Minimal dot message if not specified
      msgId: messageId
    });
    
    // Resume campaign after a longer delay to ensure safety message completes
    // The injector script needs at least 4-6 seconds to complete the safety message
    setTimeout(() => {
      if (activeCampaign && activeCampaign.status === 'safety_pause') {
        logBackground('[SafetyMode] Resuming campaign after safety message pause');
        activeCampaign.status = originalStatus;
        broadcastCampaignStatus(activeCampaign);
      }
    }, 7000); // Increased from 1500ms to 7000ms (7 seconds)
    
    logBackground('[SafetyMode] Safety message sent successfully');
    return { success: true, msgId: messageId };
  } catch (error) {
    logBackground(`[SafetyMode] Error sending safety message: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Set up tab monitoring
function setupTabMonitoring() {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.includes('web.whatsapp.com')) {
      if (!whatsAppTabIds.includes(tabId)) {
        whatsAppTabIds.push(tabId);
      }
      isConnected = true;
      whatsAppConnectionStatus = true;
      
      // Ensure content script is injected
      await ensureContentScriptInjected(tabId);
      
      // Notify about connection
      broadcastConnectionStatus(true);
    }
  });
  
  chrome.tabs.onRemoved.addListener((tabId) => {
    const index = whatsAppTabIds.indexOf(tabId);
    if (index > -1) {
      whatsAppTabIds.splice(index, 1);
    }
    contentScriptInjected.delete(tabId);
    
    if (whatsAppTabIds.length === 0) {
      isConnected = false;
      whatsAppConnectionStatus = false;
      broadcastConnectionStatus(false);
    }
  });
}

// Handle connection check
async function handleConnectionCheck() {
  try {
    // Simply check if we have any WhatsApp tabs
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    const connected = tabs.length > 0;
    
    // Update global state
    whatsAppConnectionStatus = connected;
    isConnected = connected;
    
    return { connected };
  } catch (error) {
    logBackground('Error checking connection: ' + error.message);
    return { connected: false };
  }
}

// Handle campaign start
async function handleCampaignStart(campaignSettings) {
  try {
    // If campaignSettings is placeholder, load from storage
    if (campaignSettings.idPlaceholder) {
      const stored = await chrome.storage.local.get('pendingCampaignSettings');
      if (!stored.pendingCampaignSettings) {
        throw new Error('No campaign settings found');
      }
      campaignSettings = stored.pendingCampaignSettings;
      await chrome.storage.local.remove('pendingCampaignSettings');
    }
    
    // Check if WhatsApp is connected
    if (!whatsAppConnectionStatus) {
      throw new Error('WhatsApp is not connected. Please open WhatsApp Web and log in.');
    }
    
    // Check if a campaign is already running
    if (activeCampaign) {
      throw new Error('A campaign is already running. Please wait for it to finish.');
    }
    
    // Store campaign settings
    activeCampaign = {
      ...campaignSettings,
      id: 'campaign-' + Date.now(),
      startTime: new Date().toISOString(),
      lastUpdateTime: new Date().toISOString(),
      currentIndex: 0,
      sentCount: 0,
      failedCount: 0,
      status: 'initializing',
      totalContacts: campaignSettings.contacts.length
    };
    
    // Save to storage
    await chrome.storage.local.set({ activeCampaign });
    logBackground('Campaign settings saved to storage');
    
    // Find WhatsApp tab
    const tab = await findWhatsAppTab();
    if (!tab) {
        await cleanupCampaignState();
      throw new Error('No WhatsApp Web tab found. Please open WhatsApp Web before starting a campaign.');
    }
    
    // Update campaign with tab ID
    activeCampaign.tabId = tab.id;
    await chrome.storage.local.set({ activeCampaign });
    
      // Ensure content script is injected and ready
      const isInjected = await ensureContentScriptInjected(tab.id);
      if (!isInjected) {
        try {
          // Attempt to inject the content script programmatically
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['js/content.js']
          });
          // Give the script a moment to initialize and then ping again
          await new Promise(r => setTimeout(r, 500));
          const injectedNow = await ensureContentScriptInjected(tab.id);
          if (!injectedNow) {
            await cleanupCampaignState();
            throw new Error('Failed to initialize content script');
          }
        } catch (injectErr) {
          await cleanupCampaignState();
          throw new Error('Failed to inject content script: ' + injectErr.message);
        }
      }
      
      // Update campaign status to running
    activeCampaign.status = 'running';
    await chrome.storage.local.set({ activeCampaign });
    
      // Send full settings so the content script does not need to pull a potentially large
      // attachment from chrome.storage (where it may exceed QUOTA_BYTES_PER_ITEM limits).
      // The ID is still included for progress tracking.
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'startSending',
          campaignId: activeCampaign.id,
          campaignSettings: activeCampaign  // includes contacts, message, attachment (base64)
        });

        return {
          success: true,
          campaignId: activeCampaign.id,
          status: 'running'
        };
      } catch (error) {
        await cleanupCampaignState();
        throw new Error('Failed to start campaign: ' + error.message);
      }
    } catch (error) {
      logBackground('Error starting campaign: ' + error.message);
      await cleanupCampaignState();
      return { success: false, error: error.message };
    }
}

// Handle campaign pause
async function handleCampaignPause(reason) {
  try {
    if (!activeCampaign) {
      throw new Error('No active campaign to pause');
    }
    
    activeCampaign.status = 'paused';
    if (reason) {
      activeCampaign.pauseReason = reason;
    }
    await chrome.storage.local.set({ activeCampaign });
    
    // Show appropriate message based on reason
    if (reason === 'license_expired') {
      broadcastCampaignStatus({
        ...activeCampaign,
        message: 'Campaign paused: License expired during campaign'
      });
    }
    
    return { success: true, reason };
  } catch (error) {
    logBackground('Error pausing campaign: ' + error.message);
    return { success: false, error: error.message };
  }
}



// Handle campaign abort
async function handleCampaignAbort() {
  try {
    if (!activeCampaign) {
      throw new Error('No active campaign to abort');
    }
    
    activeCampaign.status = 'aborted';
    await chrome.storage.local.set({ activeCampaign });
    
    // Clear campaign data
    activeCampaign = null;
    await chrome.storage.local.remove(['activeCampaign']);
    
    return { success: true };
          } catch (error) {
    logBackground('Error aborting campaign: ' + error.message);
            return { success: false, error: error.message };
          }
        }

// Find WhatsApp tab
async function findWhatsAppTab() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  return tabs[0] || null;
}

// Start campaign watchdog
function startCampaignWatchdog() {
  if (campaignWatchdog) {
    clearInterval(campaignWatchdog);
  }
  
  campaignWatchdog = setInterval(async () => {
    if (!activeCampaign) {
      clearInterval(campaignWatchdog);
    return;
  }
  
  try {
      // Check if campaign is still running
      if (activeCampaign.status === 'running') {
        // Check if WhatsApp is still connected
        const connectionStatus = await handleConnectionCheck();
        if (!connectionStatus.connected) {
          activeCampaign.status = 'paused';
          activeCampaign.pauseReason = 'connection_lost';
          await chrome.storage.local.set({ activeCampaign });
          
          // Notify about pause
          broadcastCampaignStatus({
            status: 'paused',
            reason: 'connection_lost',
            message: 'Campaign paused due to WhatsApp connection loss'
          });
        }
    }
  } catch (error) {
      logBackground('Error in campaign watchdog: ' + error.message);
    }
  }, 5000);
}

// Broadcast connection status
function broadcastConnectionStatus(connected) {
  chrome.runtime.sendMessage({
    action: 'whatsappConnectionStatus',
    connected: connected
  });
}

// Handle message status updates from content script
function handleMessageStatusUpdate(message) {
  try {
    logBackground(`Message status update received: phone=${message.phone}, status=${message.status}, method=${message.method}`);
    
    // If we have an active campaign, update its progress
    if (activeCampaign && campaignStatus) {
      // Find the message in the failed messages list if it exists
      const failedIndex = campaignStatus.failedMessages.findIndex(item => 
        item.phone === message.phone || item.phone === message.phone.replace(/[^0-9]/g, ''));
      
      // If the message was previously marked as failed but is now successful
      if (failedIndex !== -1) {
        logBackground(`Correcting status for message to ${message.phone} - moving from failed to success`);
        
        // Move the message from failed to sent
        const correctedMessage = campaignStatus.failedMessages.splice(failedIndex, 1)[0];
        campaignStatus.sentMessages.push({
          ...correctedMessage,
          status: 'success',
          method: message.method,
          timestamp: message.timestamp || Date.now()
        });
        
        // Update campaign progress counts
        campaignStatus.progress.failed--;
        campaignStatus.progress.sent++;
        
        // Save updated campaign status
        chrome.storage.local.set({ campaignStatus });
        
        // Broadcast updated status to all tabs
        broadcastCampaignStatus(campaignStatus);
      }
    }
  } catch (error) {
    logBackground(`Error handling message status update: ${error.message}`);
  }
}

// Handle campaign status update
async function handleCampaignStatusUpdate(progressUpdate) {
  try {
    if (!activeCampaign) {
      console.warn('Received campaign progress update but no active campaign found.');
      return { success: false, error: 'No active campaign found' };
    }

    // Check if this update is for an individual send attempt
    if (typeof progressUpdate.sent === 'boolean') {
      if (progressUpdate.sent) {
        activeCampaign.sentCount = (activeCampaign.sentCount || 0) + 1;
      } else {
        activeCampaign.failedCount = (activeCampaign.failedCount || 0) + 1;
        // Optionally, log or store more detailed error information
        if (progressUpdate.phoneNumber && progressUpdate.error) {
          console.log(`Campaign ${activeCampaign.id}: Number ${progressUpdate.phoneNumber} failed. Reason: ${progressUpdate.error}`);
          // You could add this to an errors array in activeCampaign if needed for detailed reporting
          // if (!activeCampaign.errors) activeCampaign.errors = [];
          // activeCampaign.errors.push({ phone: progressUpdate.phoneNumber, error: progressUpdate.error });
        }
      }
      // Update currentIndex if provided by the content script for individual updates
      if (typeof progressUpdate.currentIndex === 'number') {
        activeCampaign.currentIndex = progressUpdate.currentIndex;
      }
    } else {
      // Fallback for general progress object merging (existing behavior)
      activeCampaign = {
        ...activeCampaign,
        ...progressUpdate,
      };
    }

    activeCampaign.lastUpdateTime = new Date().toISOString();

    // Sanity checks for counts
    if (activeCampaign.sentCount > activeCampaign.totalContacts) {
        activeCampaign.sentCount = activeCampaign.totalContacts;
    }
    if (activeCampaign.failedCount > activeCampaign.totalContacts) {
        activeCampaign.failedCount = activeCampaign.totalContacts;
    }
    // Ensure sum of sent and failed does not exceed total, prioritizing sent
    if (activeCampaign.sentCount + activeCampaign.failedCount > activeCampaign.totalContacts) {
        activeCampaign.failedCount = activeCampaign.totalContacts - activeCampaign.sentCount;
        if (activeCampaign.failedCount < 0) activeCampaign.failedCount = 0; 
    }

    // Check for campaign completion
    if ((activeCampaign.sentCount + activeCampaign.failedCount) >= activeCampaign.totalContacts && activeCampaign.status === 'running') {
        activeCampaign.status = 'completed';
        activeCampaign.completionTime = new Date().toISOString();
        logBackground(`Campaign ${activeCampaign.id} completed. Sent: ${activeCampaign.sentCount}, Failed: ${activeCampaign.failedCount}`);
    }

    await chrome.storage.local.set({ activeCampaign });
    broadcastCampaignStatus(activeCampaign);

    return { success: true };
  } catch (error) {
    logBackground('Error updating campaign status: ' + error.message);
    return { success: false, error: error.message };
  }
}

// Broadcast campaign status
function broadcastCampaignStatus(status) {
  const campaignTabId = activeCampaign && activeCampaign.tabId ? activeCampaign.tabId : null;

  if (campaignTabId) {
    chrome.tabs.sendMessage(campaignTabId, {
        action: 'campaignStatusUpdate',
        status: status
    }).catch(error => {
        logBackground(`Error sending status to specific tab ${campaignTabId}: ${error.message} - trying all tabs.`);
        // Fallback to all tabs if specific tab fails
        broadcastToAllTabs(status);
    });
  } else {
    broadcastToAllTabs(status);
  }
}

function broadcastToAllTabs(status) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      // Try to send to tabs that might have the content script
      if (tab.url && tab.url.includes('web.whatsapp.com')) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'campaignStatusUpdate',
          status: status
        }).catch(error => {
          // logBackground(`Silent error sending to tab ${tab.id}: ${error.message}`);
          // Ignore errors for tabs that don't have our content script or are not WhatsApp Web
        });
      }
    });
  });
}

// Handle WhatsApp reload detection
async function handleWhatsAppReload(data) {
  try {
    logBackground(`WhatsApp reload detected! Count: ${data.reloadCount} at ${new Date(data.timestamp).toLocaleTimeString()}`);
    
    // Update reload state
    whatsAppReloadState.isReloading = true;
    whatsAppReloadState.reloadCount = data.reloadCount;
    whatsAppReloadState.lastReloadTime = data.timestamp;
    
    // If campaign was running, pause it
    if (activeCampaign && activeCampaign.status === 'running') {
      logBackground('Pausing campaign due to WhatsApp reload');
      whatsAppReloadState.campaignWasRunning = true;
      whatsAppReloadState.campaignPausedForReload = true;
      
      // Pause the campaign
      activeCampaign.status = 'paused';
      activeCampaign.pauseReason = 'whatsapp_reload';
      await chrome.storage.local.set({ activeCampaign });
      broadcastCampaignStatus(activeCampaign);
    }
  } catch (error) {
    logBackground('Error handling WhatsApp reload: ' + error.message);
  }
}

// Handle WhatsApp recovery after reload
async function handleWhatsAppRecovery(data) {
  try {
    logBackground(`WhatsApp recovery attempt #${data.recoveryAttempt} at ${new Date(data.timestamp).toLocaleTimeString()}`);
    
    // Update reload state
    whatsAppReloadState.isReloading = false;
    whatsAppReloadState.recoveryAttempts = data.recoveryAttempt;
    
    // Wait a bit before resuming campaign to ensure WhatsApp is fully loaded
    setTimeout(async () => {
      // If campaign was paused due to reload, resume it
      if (whatsAppReloadState.campaignPausedForReload && activeCampaign && activeCampaign.status === 'paused' && activeCampaign.pauseReason === 'whatsapp_reload') {
        logBackground('Resuming campaign after WhatsApp recovery');
        
        // Resume the campaign
        activeCampaign.status = 'running';
        delete activeCampaign.pauseReason;
        await chrome.storage.local.set({ activeCampaign });
        broadcastCampaignStatus(activeCampaign);
        
        // Reset state
        whatsAppReloadState.campaignWasRunning = false;
        whatsAppReloadState.campaignPausedForReload = false;
      }
    }, 8000); // Wait 8 seconds before resuming
  } catch (error) {
    logBackground('Error handling WhatsApp recovery: ' + error.message);
  }
}

// Handle campaign recovery
async function handleCampaignRecovery() {
  try {
    if (!activeCampaign) return;
    
    logBackground('Starting campaign recovery process');
    
    // Check WhatsApp connection
    const connectionStatus = await handleConnectionCheck();
    if (!connectionStatus.connected) {
      activeCampaign.status = 'paused';
      activeCampaign.pauseReason = 'connection_lost';
      await chrome.storage.local.set({ activeCampaign });
          return;
        }
        
    // Find WhatsApp tab
    const tab = await findWhatsAppTab();
    if (!tab) {
      activeCampaign.status = 'paused';
      activeCampaign.pauseReason = 'tab_not_found';
      await chrome.storage.local.set({ activeCampaign });
          return;
        }
        
    // Update campaign with new tab ID
    activeCampaign.tabId = tab.id;
    activeCampaign.status = 'running';
    await chrome.storage.local.set({ activeCampaign });
    
    // Restart campaign watchdog
    startCampaignWatchdog();
    
    logBackground('Campaign recovery completed');
  } catch (error) {
    logBackground('Error in campaign recovery: ' + error.message);
  }
}

// ------------------------------
// Attachment DB helpers (shared with popup & content script)
// ------------------------------
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

async function getBlobFromIndexedDB(id) {
  const db = await openAttachmentDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(ATTACHMENT_STORE, 'readonly');
    const req = tx.objectStore(ATTACHMENT_STORE).get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}

// Recover interrupted campaign after browser restart
async function recoverInterruptedCampaign() {
  try {
    const stored = await chrome.storage.local.get('activeCampaign');
    if (!stored.activeCampaign) return;
    
    const campaign = stored.activeCampaign;
    
    // Only recover if campaign was running or paused (not completed/failed/aborted)
    if (['running', 'paused'].includes(campaign.status)) {
      logBackground(`Found interrupted campaign: ${campaign.id} (${campaign.status})`);
      
      // Restore campaign to memory
      activeCampaign = campaign;
      
      // If it was running, pause it until user manually resumes
      if (campaign.status === 'running') {
        activeCampaign.status = 'paused';
        activeCampaign.pauseReason = 'browser_restart';
        await chrome.storage.local.set({ activeCampaign });
        
        logBackground('Campaign paused due to browser restart - user can resume manually');
      }
      
      // Broadcast status to notify UI
      setTimeout(() => {
        broadcastCampaignStatus({
          ...activeCampaign,
          message: campaign.status === 'running' ? 
            'Campaign paused after browser restart - click Resume to continue' :
            'Campaign recovered after browser restart'
        });
      }, 2000);
    }
  } catch (error) {
    logBackground('Error recovering interrupted campaign: ' + error.message);
  }
}

// Enhanced campaign resume with recovery
async function handleCampaignResume() {
  try {
    if (!activeCampaign) {
      throw new Error('No active campaign to resume');
    }
    
    if (!['paused'].includes(activeCampaign.status)) {
      throw new Error('Campaign is not paused');
    }
    
    // Find WhatsApp tab
    const tab = await findWhatsAppTab();
    if (!tab) {
      throw new Error('WhatsApp Web tab not found. Please open WhatsApp Web first.');
    }
    
    // Update campaign with new tab ID (in case tab changed after restart)
    activeCampaign.tabId = tab.id;
    activeCampaign.status = 'running';
    delete activeCampaign.pauseReason;
    await chrome.storage.local.set({ activeCampaign });
    
    // Ensure content script is ready
    const isInjected = await ensureContentScriptInjected(tab.id);
    if (!isInjected) {
      throw new Error('Content script not ready. Please refresh WhatsApp Web.');
    }
    
    // Resume campaign from where it stopped
    await chrome.tabs.sendMessage(tab.id, {
      action: 'resumeCampaign',
      campaignId: activeCampaign.id,
      campaignSettings: activeCampaign,
      resumeFromIndex: activeCampaign.currentIndex || 0
    });
    
    logBackground(`Campaign ${activeCampaign.id} resumed from index ${activeCampaign.currentIndex}`);
    
    return { success: true };
  } catch (error) {
    logBackground('Error resuming campaign: ' + error.message);
    return { success: false, error: error.message };
  }
}

// Initialize when the background script loads
initializeBackground().then(() => {
  // Initialize safety manager after background is ready
  initSafetyManager();
});
