// Adaptive Selectors - Handles WhatsApp/Meta UI changes automatically
(function() {
  'use strict';
  
  // Selector patterns that adapt to WhatsApp changes
  const SELECTOR_PATTERNS = {
    messageInput: [
      // Current selectors
      '[data-testid="conversation-compose-box-input"]',
      '[contenteditable="true"][data-tab="10"]',
      'div[contenteditable="true"][role="textbox"]',
      
      // Fallback patterns
      'div[contenteditable="true"]:not([aria-label*="Search"])',
      '[data-tab="10"][contenteditable="true"]',
      '.lexical-rich-text-input div[contenteditable="true"]',
      
      // Generic patterns
      'div[contenteditable="true"][spellcheck="true"]',
      '[role="textbox"][contenteditable="true"]'
    ],
    
    sendButton: [
      // Current selectors
      '[data-testid="compose-btn-send"]',
      'button[data-tab="11"]',
      'span[data-icon="send"]',
      
      // Fallback patterns
      'button[aria-label*="Send"]',
      'button[title*="Send"]',
      '[data-testid*="send"]',
      
      // Generic patterns
      'button:has(span[data-icon*="send"])',
      'button:last-child:has(svg)'
    ],
    
    chatHeader: [
      '[data-testid="conversation-header"]',
      '[data-testid="chat-header"]',
      'header[data-testid*="conversation"]',
      'div[role="banner"]'
    ],
    
    searchInput: [
      '[aria-label*="Search"]',
      '[placeholder*="Search"]',
      'input[type="text"][data-tab="3"]',
      '.x1hx0egp.x6ikm8r.x1odjw0f'
    ],
    
    blockedIndicators: [
      '[data-testid*="block"]',
      '[aria-label*="blocked"]',
      'span[title*="blocked"]',
      'div[title*="blocked"]',
      'button:has-text("Block")',
      'button:has-text("Unblock")'
    ]
  };
  
  // Cache for found selectors
  const selectorCache = new Map();
  const cacheTimeout = 30000; // 30 seconds
  
  // Find element using adaptive selectors
  window.findElementAdaptive = function(type, options = {}) {
    const cacheKey = `${type}_${JSON.stringify(options)}`;
    const cached = selectorCache.get(cacheKey);
    
    // Return cached result if still valid
    if (cached && Date.now() - cached.timestamp < cacheTimeout) {
      const element = document.querySelector(cached.selector);
      if (element) return element;
    }
    
    const selectors = SELECTOR_PATTERNS[type] || [];
    
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element && validateElement(element, type, options)) {
          // Cache successful selector
          selectorCache.set(cacheKey, {
            selector,
            timestamp: Date.now()
          });
          return element;
        }
      } catch (e) {
        // Skip invalid selectors
        continue;
      }
    }
    
    return null;
  };
  
  // Validate element based on type and context
  function validateElement(element, type, options) {
    switch (type) {
      case 'messageInput':
        // Ensure it's not in search area
        if (element.closest('[aria-label*="Search"]')) return false;
        if (element.closest('.x9f619.x78zum5.x6s0dn4.x4wrhlh')) return false; // Search container
        
        // Ensure it's in chat area
        const chatParent = element.closest('[data-testid*="conversation"]') || 
                          element.closest('[data-testid*="chat"]');
        return !!chatParent;
        
      case 'sendButton':
        // Must be enabled and visible
        return !element.disabled && element.offsetParent !== null;
        
      case 'chatHeader':
        // Must contain chat info
        return element.textContent.length > 0;
        
      default:
        return true;
    }
  }
  
  // Wait for element with adaptive retry
  window.waitForElementAdaptive = async function(type, options = {}, timeout = 10000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const element = window.findElementAdaptive(type, options);
      if (element) return element;
      
      await new Promise(r => setTimeout(r, 200));
    }
    
    return null;
  };
  
  // Detect if user is blocked using adaptive selectors
  window.detectBlockedAdaptive = function() {
    const blockedSelectors = SELECTOR_PATTERNS.blockedIndicators;
    
    for (const selector of blockedSelectors) {
      try {
        if (document.querySelector(selector)) {
          return true;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Check for disabled message input
    const messageInput = window.findElementAdaptive('messageInput');
    if (messageInput && (messageInput.disabled || messageInput.getAttribute('aria-disabled') === 'true')) {
      return true;
    }
    
    // Check for missing send button when input exists
    const sendButton = window.findElementAdaptive('sendButton');
    if (messageInput && !sendButton) {
      return true;
    }
    
    return false;
  };
  
  // Clear cache when page changes
  const observer = new MutationObserver(() => {
    selectorCache.clear();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true
  });
  
  console.log('[AdaptiveSelectors] Initialized with', Object.keys(SELECTOR_PATTERNS).length, 'selector types');
})();