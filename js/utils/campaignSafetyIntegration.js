/**
 * Campaign Safety Integration
 * 
 * This module integrates the safety message mechanism with the campaign sending process.
 * It ensures that safety messages are sent periodically during campaigns to reduce
 * the risk of being flagged by WhatsApp's automated systems.
 */

import { incrementAndCheckSafety, resetMessageCounter } from './safetyMessageHelper.js';

// Campaign state tracking
let activeCampaignId = null;
let isCampaignRunning = false;
let messagesSentInCampaign = 0;

/**
 * Initializes the safety integration for a new campaign
 * @param {string} campaignId The ID of the campaign
 */
export function initCampaignSafety(campaignId) {
  activeCampaignId = campaignId;
  isCampaignRunning = true;
  messagesSentInCampaign = 0;
  resetMessageCounter();
  console.log(`[CampaignSafety] Initialized safety integration for campaign ${campaignId}`);
}

/**
 * Handles a message being sent during a campaign
 * @param {string} phoneNumber The phone number the message was sent to
 * @param {boolean} success Whether the message was sent successfully
 * @returns {Promise<{safetyMessageSent: boolean}>} Whether a safety message was sent
 */
export async function handleMessageSent(phoneNumber, success) {
  if (!isCampaignRunning || !success) {
    return { safetyMessageSent: false };
  }
  
  messagesSentInCampaign++;
  
  // Check if we should send a safety message
  const safetyMessageSent = await incrementAndCheckSafety();
  
  return { safetyMessageSent };
}

/**
 * Ends the campaign safety integration
 */
export function endCampaignSafety() {
  console.log(`[CampaignSafety] Ending safety integration for campaign ${activeCampaignId}. Messages sent: ${messagesSentInCampaign}`);
  activeCampaignId = null;
  isCampaignRunning = false;
  resetMessageCounter();
}

/**
 * Gets the current campaign safety status
 * @returns {Object} The current campaign safety status
 */
export function getCampaignSafetyStatus() {
  return {
    activeCampaignId,
    isCampaignRunning,
    messagesSentInCampaign
  };
}

/**
 * Ensures a safety message is sent at the beginning of a campaign
 * This helps verify that the safety mechanism is working properly
 * @returns {Promise<boolean>} Whether the safety message was sent successfully
 */
export async function ensureInitialSafetyMessage() {
  try {
    // Import the safety message helper directly to avoid circular dependencies
    const { sendSafetyMessage } = await import('./safetyMessageHelper.js');
    
    // Send an initial safety message
    const result = await sendSafetyMessage('Campaign started');
    
    if (result.success) {
      console.log('[CampaignSafety] Initial safety message sent successfully');
      return true;
    } else {
      console.error('[CampaignSafety] Failed to send initial safety message:', result.error);
      return false;
    }
  } catch (error) {
    console.error('[CampaignSafety] Error sending initial safety message:', error);
    return false;
  }
}