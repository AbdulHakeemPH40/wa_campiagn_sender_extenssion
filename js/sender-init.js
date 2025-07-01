// js/sender-init.js

/**
 * This file initializes the sender module and sets up the safety message mechanism.
 * It serves as the entry point for the sender.html page.
 */

import { initSender, updateUIWithContactData } from './sender.js';
import { initializeSafetyMode, logOwnWhatsAppNumberStatus } from './safetyMode.js';
import { testSafetyMessage } from './utils/testSafetyMessage.js';
import { initSafetyModeUI } from './utils/safetyModeUI.js';

// Initialize the sender module when the DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  console.log('Initializing sender module...');
  
  // Add safety mode CSS
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '../css/safety-mode.css';
  document.head.appendChild(link);
  
  // Initialize the sender module
  initSender();
  
  // Initialize safety mode
  initializeSafetyMode();
  
  // Initialize safety mode UI
  initSafetyModeUI();
  
  // Log the status of the user's own WhatsApp number
  logOwnWhatsAppNumberStatus();
  
  // Update UI with contact data
  updateUIWithContactData();
  
  // Test safety message mechanism after a short delay
  setTimeout(() => {
    testSafetyMessageOnStartup();
  }, 2000);
});

// Function to test the safety message mechanism on startup
async function testSafetyMessageOnStartup() {
  try {
    // Check if safety mode is enabled
    const settings = await chrome.storage.local.get('safetyModeEnabled');
    if (settings.safetyModeEnabled !== false) { // Default to true
      console.log('[Sender-Init] Safety mode is enabled, testing safety message mechanism...');
      
      // Test the safety message mechanism
      const result = await testSafetyMessage();
      if (result.success) {
        console.log('[Sender-Init] Safety message test successful');
      } else {
        console.warn('[Sender-Init] Safety message test failed:', result.error);
        
        // Show a warning to the user if the test failed
        const safetyModeStatus = document.getElementById('safety-mode-status');
        if (safetyModeStatus) {
          const warningElement = document.createElement('div');
          warningElement.className = 'safety-warning';
          warningElement.innerHTML = '<i class="ri-alert-line"></i> Safety message test failed. Self-messaging may not work properly.';
          safetyModeStatus.appendChild(warningElement);
        }
      }
    } else {
      console.log('[Sender-Init] Safety mode is disabled, skipping safety message test');
    }
  } catch (error) {
    console.error('[Sender-Init] Error testing safety message:', error);
  }
}