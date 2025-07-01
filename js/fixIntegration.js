/**
 * Fix Integration
 * 
 * This script integrates all the fixes for the WhatsApp Campaign Sender Extension.
 * Import this script in the main entry points to apply all fixes.
 */

import { applyMessageStatusFix } from './utils/messageStatusFix.js';
import { sendSilentSafetyMessage } from './utils/silentSafetyMessenger.js';

// Counter for sent messages
let messageSendCounter = 0;
let lastSafetyMessageTime = null;

/**
 * Apply all fixes
 */
export function applyAllFixes() {
  // Fix message status reporting
  applyMessageStatusFix();
  
  // Set up safety message counter
  setupSafetyMessageCounter();
  
  console.log('[FixIntegration] All fixes applied');
}

/**
 * Set up safety message counter to track sent messages
 */
function setupSafetyMessageCounter() {
  // Listen for message sent events
  document.addEventListener('wa-message-sent', (event) => {
    messageSendCounter++;
    checkAndSendSafetyMessage();
  });
  
  // Also intercept campaign progress updates
  const originalSendMessage = chrome.runtime.sendMessage;
  chrome.runtime.sendMessage = function(message, responseCallback) {
    // Intercept campaign progress updates
    if (message && message.action === 'updateCampaignProgress' && message.sent) {
      messageSendCounter++;
      checkAndSendSafetyMessage();
    }
    
    // Call the original function
    return originalSendMessage.apply(this, arguments);
  };
}

/**
 * Check if it's time to send a safety message and send if needed
 */
async function checkAndSendSafetyMessage() {
  try {
    // Get safety mode settings
    const settings = await chrome.storage.local.get({
      safetyModeEnabled: true,
      safetyMessageInterval: 10,
      safetyRandomization: true
    });
    
    // Skip if safety mode is disabled
    if (!settings.safetyModeEnabled) {
      return;
    }
    
    // Calculate if we should send now
    const interval = settings.safetyMessageInterval || 10;
    let shouldSend = false;
    
    if (settings.safetyRandomization) {
      // Add randomness to the interval (±20%)
      const randomFactor = Math.random() * 0.4 + 0.8; // 0.8 to 1.2
      const adjustedInterval = Math.round(interval * randomFactor);
      shouldSend = messageSendCounter % adjustedInterval === 0;
    } else {
      shouldSend = messageSendCounter % interval === 0;
    }
    
    // Minimum time between safety messages (3 minutes)
    const minTimeBetween = 3 * 60 * 1000;
    const now = Date.now();
    if (lastSafetyMessageTime && (now - lastSafetyMessageTime < minTimeBetween)) {
      shouldSend = false;
    }
    
    if (shouldSend) {
      // Get user's own number
      const result = await chrome.storage.local.get('waUserPhoneNumberResult');
      const phoneEntry = result.waUserPhoneNumberResult;
      
      if (!phoneEntry || phoneEntry.status !== 'success' || !phoneEntry.number) {
        console.warn('[FixIntegration] Cannot send safety message: Own phone number not found');
        return;
      }
      
      const selfNumber = phoneEntry.number;
      
      // Send the safety message silently
      const sendResult = await sendSilentSafetyMessage(selfNumber, '.');
      
      if (sendResult.success) {
        lastSafetyMessageTime = now;
        console.log(`[FixIntegration] Safety message sent successfully via ${sendResult.method || 'unknown'}`);
      } else {
        console.warn(`[FixIntegration] Failed to send safety message: ${sendResult.error}`);
      }
    }
  } catch (error) {
    console.error(`[FixIntegration] Error in checkAndSendSafetyMessage: ${error.message}`);
  }
}

// Apply all fixes immediately
applyAllFixes();