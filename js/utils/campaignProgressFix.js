/**
 * Campaign Progress Fix
 * 
 * This utility script provides functions to fix the campaign progress UI.
 * It ensures that text-only messages are properly counted as sent rather than failed.
 */

/**
 * Fixes the campaign progress UI by ensuring text-only messages are properly counted
 * This function should be called when the campaign progress UI is updated
 * @param {Object} campaignStatus The campaign status object
 * @returns {Object} The fixed campaign status object
 */
export function fixCampaignProgress(campaignStatus) {
  if (!campaignStatus) return campaignStatus;
  
  // Create a copy of the campaign status to avoid modifying the original
  const fixedStatus = { ...campaignStatus };
  
  // Check if we have message status data in storage
  chrome.storage.local.get('messageStatusMap', (result) => {
    if (!result.messageStatusMap) return;
    
    const messageStatusMap = result.messageStatusMap;
    
    // Count successful messages
    let successCount = 0;
    for (const [phone, status] of Object.entries(messageStatusMap)) {
      if (status.status === 'success') {
        successCount++;
      }
    }
    
    // If we have more successful messages than the campaign status shows,
    // update the campaign status
    if (successCount > fixedStatus.sentCount) {
      console.log(`[ProgressFix] Fixing campaign progress: ${fixedStatus.sentCount} -> ${successCount} sent`);
      
      // Calculate the difference
      const diff = successCount - fixedStatus.sentCount;
      
      // Update the sent count
      fixedStatus.sentCount = successCount;
      
      // If we have failed messages, reduce the failed count by the difference
      if (fixedStatus.failedCount > 0) {
        fixedStatus.failedCount = Math.max(0, fixedStatus.failedCount - diff);
      }
      
      // Update the campaign status in storage
      chrome.storage.local.set({ activeCampaign: fixedStatus });
      
      // Broadcast the updated campaign status
      chrome.runtime.sendMessage({
        action: 'campaignStatusUpdate',
        status: fixedStatus
      });
    }
  });
  
  return fixedStatus;
}

/**
 * Monitors the campaign progress and fixes it if needed
 * This function should be called periodically during a campaign
 */
export function monitorCampaignProgress() {
  // Check the campaign status every 5 seconds
  setInterval(() => {
    chrome.storage.local.get('activeCampaign', (result) => {
      if (!result.activeCampaign) return;
      
      // Fix the campaign progress
      fixCampaignProgress(result.activeCampaign);
    });
  }, 5000);
}

/**
 * Initializes the campaign progress fix
 * This function should be called when the campaign starts
 */
export function initCampaignProgressFix() {
  // Start monitoring the campaign progress
  monitorCampaignProgress();
  
  // Listen for campaign status updates
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'campaignStatusUpdate') {
      // Fix the campaign progress
      fixCampaignProgress(message.status);
    }
  });
  
  console.log('[ProgressFix] Campaign progress fix initialized');
}