/**
 * Campaign Safety Manager - Fixed with Turbo Mode and blocked user handling
 */

// Safety state management
let messageSendCounter = 0;
let lastSafetyMessageTime = null;
let nextSafetyMessageAt = null;
let isSendingSafety = false;

/**
 * Initializes the campaign safety manager
 */
export function initCampaignSafetyManager() {
  messageSendCounter = 0;
  lastSafetyMessageTime = null;
  nextSafetyMessageAt = Math.floor(Math.random() * 20) + 1;
  isSendingSafety = false;
}

/**
 * Increments message counter and checks for safety message
 */
export async function incrementAndCheckSafety() {
  messageSendCounter++;
  
  // Check license expiry every 50 messages during campaign
  if (messageSendCounter % 50 === 0) {
    const licenseValid = await checkLicenseExpiry();
    if (!licenseValid) {
      // License expired during campaign - pause campaign
      chrome.runtime.sendMessage({ action: 'pauseCampaign', reason: 'license_expired' });
      return false;
    }
  }
  
  if (messageSendCounter === nextSafetyMessageAt && !isSendingSafety) {
    isSendingSafety = true;
    const result = await sendSafetyMessage();
    if (result) {
      nextSafetyMessageAt = messageSendCounter + Math.floor(Math.random() * 20) + 1;
    }
    isSendingSafety = false;
    return result;
  }
  return false;
}

// Check if license is still valid during campaign
async function checkLicenseExpiry() {
  try {
    const result = await chrome.storage.local.get('waUserPhoneNumberResult');
    const phoneEntry = result.waUserPhoneNumberResult;
    
    if (!phoneEntry || !phoneEntry.number) return false;
    
    const response = await fetch('https://www.wacampaignsender.com/api/verify-license/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_number: phoneEntry.number })
    });
    
    if (!response.ok) return true; // If backend offline, continue campaign
    
    const licenseData = await response.json();
    return licenseData.is_active;
  } catch (error) {
    console.log('[SafetyManager] License check failed, continuing campaign:', error);
    return true; // Continue campaign if check fails
  }
}

/**
 * Sends safety message with Turbo Mode and blocked user handling
 */
async function sendSafetyMessage() {
  try {
    const settings = await chrome.storage.local.get(['safetyModeEnabled', 'turboModeEnabled']);
    if (settings.safetyModeEnabled === false) return true;
    
    const result = await chrome.storage.local.get('waUserPhoneNumberResult');
    const phoneEntry = result.waUserPhoneNumberResult;
    
    if (!phoneEntry || phoneEntry.status !== 'success' || !phoneEntry.number) {
      return true; // Don't block campaign
    }
    
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length === 0) return true; // Don't block campaign
    
    // Check if Turbo Mode is enabled - skip safety message in Turbo Mode
    if (settings.turboModeEnabled) {
      console.log('[SafetyManager] Turbo Mode enabled - skipping safety message');
      return true; // Return true to avoid blocking campaign
    }
    
    // Send safety message with improved targeting and blocked user detection
    const response = await chrome.tabs.sendMessage(tabs[0].id, {
      action: 'sendSafetyMessageFixed',
      number: phoneEntry.number,
      message: '.'
    });
    
    // Handle blocked user response
    if (response && response.blocked) {
      console.log('[SafetyManager] Own number is blocked - skipping safety message');
      return true; // Don't block campaign for blocked safety messages
    }
    
    lastSafetyMessageTime = Date.now();
    return true; // Always return true - never block campaign
  } catch (error) {
    console.error('[SafetyManager] Error sending safety message:', error);
    return true; // Don't block campaign on safety message errors
  }
}

export function resetMessageCounter() {
  messageSendCounter = 0;
  lastSafetyMessageTime = null;
  nextSafetyMessageAt = Math.floor(Math.random() * 20) + 1;
  isSendingSafety = false;
}

export function getMessageCounter() {
  return messageSendCounter;
}