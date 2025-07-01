// Blocked User Detector - Detects blocked users and skips them
(function() {
  'use strict';
  
  // Blocked user detection function
  window.detectBlockedUser = function() {
    const blockedIndicators = [
      // Block/Unblock buttons
      '[data-testid="block-contact-confirm-btn"]',
      '[data-testid="unblock-contact-confirm-btn"]',
      
      // Block related text
      'span[title*="blocked"]',
      'span[title*="Block"]',
      'div[title*="blocked"]',
      
      // Chat blocked banner
      'div[data-testid="chat-blocked-banner"]',
      'div[aria-label*="blocked"]',
      
      // Block menu items
      '[data-testid="block-contact"]',
      '[data-testid="unblock-contact"]',
      
      // Text indicators
      'span:contains("You blocked this contact")',
      'span:contains("This contact blocked you")',
      'div:contains("blocked")',
      
      // Message composition disabled
      '[data-testid="compose-box-blocked"]'
    ];
    
    for (const selector of blockedIndicators) {
      const element = document.querySelector(selector);
      if (element) {
        console.log('[BlockDetector] Blocked user detected via:', selector);
        return true;
      }
    }
    
    // Check for disabled message input
    const messageInput = document.querySelector('[data-testid="conversation-compose-box-input"]');
    if (messageInput && (messageInput.disabled || messageInput.getAttribute('aria-disabled') === 'true')) {
      console.log('[BlockDetector] Message input is disabled - likely blocked');
      return true;
    }
    
    // Check for missing send button (another blocked indicator)
    const sendButton = document.querySelector('[data-testid="compose-btn-send"]');
    if (!sendButton && messageInput) {
      console.log('[BlockDetector] Send button missing - likely blocked');
      return true;
    }
    
    return false;
  };
  
  // Enhanced chat loading detector with blocked user check
  window.waitForChatOrBlocked = async function(maxAttempts = 30) {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      // Check for blocked user first
      if (window.detectBlockedUser()) {
        return { loaded: false, blocked: true };
      }
      
      // Check if chat is loaded
      const chatHeader = document.querySelector('[data-testid="conversation-header"]');
      const messageInput = document.querySelector('[data-testid="conversation-compose-box-input"]');
      
      if (chatHeader && messageInput) {
        // Verify we're not in search
        const searchParent = messageInput.closest('[aria-label*="Search"]');
        if (!searchParent) {
          return { loaded: true, blocked: false };
        }
      }
      
      await new Promise(r => setTimeout(r, 200));
      attempts++;
    }
    
    return { loaded: false, blocked: false };
  };
  
  // Skip to next user function
  window.skipToNextUser = function() {
    console.log('[BlockDetector] Skipping blocked user');
    
    // Dispatch event to notify campaign manager
    window.dispatchEvent(new CustomEvent('userBlocked', {
      detail: { 
        blocked: true, 
        timestamp: Date.now(),
        url: window.location.href
      }
    }));
    
    return true;
  };
  
  console.log('[BlockDetector] Blocked user detector initialized');
})();