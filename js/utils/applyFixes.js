/**
 * Apply Fixes
 * 
 * This utility script applies all the fixes for the WhatsApp Campaign Sender Extension.
 * It should be imported in the main script files to ensure all fixes are applied.
 */

import { initCampaignProgressFix } from './campaignProgressFix.js';
import { interceptMessageStatus } from '../content/messageStatusHandler.js';

/**
 * Applies all fixes for the extension
 */
export function applyAllFixes() {
  console.log('[ApplyFixes] Applying all fixes...');
  
  // Fix campaign progress UI
  initCampaignProgressFix();
  
  // Patch message status tracking
  patchMessageStatusTracking();
  
  console.log('[ApplyFixes] All fixes applied successfully');
}

/**
 * Patches the message status tracking system
 */
function patchMessageStatusTracking() {
  // Override the original message status update handler
  const originalUpdateMessageStatus = chrome.runtime.sendMessage;
  
  chrome.runtime.sendMessage = function(message, responseCallback) {
    // Intercept message status updates
    if (message && message.action === 'updateCampaignProgress') {
      // Ensure the message is marked as sent if it's not explicitly failed
      if (message.sent !== false) {
        message.sent = true;
      }
    }
    
    // Call the original function
    return originalUpdateMessageStatus.apply(this, arguments);
  };
  
  // Listen for message status updates from the content script
  document.addEventListener('wa-message-sent', (event) => {
    try {
      const { phoneNumber, success, method, msgId, error } = event.detail;
      
      // Intercept the message status
      interceptMessageStatus({
        phoneNumber,
        success: success !== false, // Default to true if not explicitly false
        method,
        msgId,
        error
      });
    } catch (error) {
      console.error('[ApplyFixes] Error handling message sent event:', error);
    }
  });
  
  console.log('[ApplyFixes] Message status tracking patched');
}

// Apply all fixes when this script is imported
applyAllFixes();