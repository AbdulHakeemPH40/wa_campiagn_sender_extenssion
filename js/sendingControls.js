// js/sendingControls.js
import { toast } from './utils.js';

// Singleton instance
let sendingControlsInstance = null;

/**
 * Manages message sending controls including delay settings, batch processing
 * and real-time campaign metrics
 */
class SendingControls {
  constructor() {
    // Implement singleton pattern
    if (sendingControlsInstance) {
      return sendingControlsInstance;
    }
    
    sendingControlsInstance = this;
    
    this.initElements();
    this.initEventListeners();
    this.updateCampaignSummary = this.updateCampaignSummary.bind(this);
    
    // Delay options
    this.randomTimeGapEnabled = true;
    this.randomTimeGapMin = 5;
    this.randomTimeGapMax = 10;
    
    // Batch options
    this.splitBatchesEnabled = false;
    this.batchSize = 79;
    this.batchSizeMax = 100;
    this.delayBetweenBatches = 20;
    this.delayBetweenBatchesMax = 30;
    
    // Human pattern options
    this.humanPatternEnabled = false;
    this.humanPatternIntensity = 70; // Default to 70% intensity
    
    // Initialize with default values
    this.updateUIVisibility();
    
    // Add last notification timestamp to prevent duplicate notifications
    this.lastToastTimestamp = 0;
  }

  initElements() {
    // Toggle switches
    this.randomTimeGapToggle = document.getElementById('randomTimeGapToggle');
    this.splitBatchesToggle = document.getElementById('splitBatchesToggle');
    this.skipInvalidNumbersToggle = document.getElementById('skipInvalidNumbers');
    this.delayPatternToggle = document.getElementById('delayPatternToggle');
    this.legacyMethodToggle = document.getElementById('legacyMethodToggle');
    this.turboModeToggle = document.getElementById('turboModeToggle');
    
    // Inputs
    this.randomTimeGapMin = document.getElementById('randomTimeGapMin');
    this.randomTimeGapMax = document.getElementById('randomTimeGapMax');
    this.batchSize = document.getElementById('batchSize');
    this.batchSizeMax = document.getElementById('batchSizeMax');
    this.delayBetweenBatches = document.getElementById('delayBetweenBatches');
    this.delayBetweenBatchesMax = document.getElementById('delayBetweenBatchesMax');
    this.humanPatternIntensitySlider = document.getElementById('humanPatternIntensity');
    this.humanPatternIntensityValue = document.getElementById('humanPatternIntensityValue');
    
    // Sections
    this.randomTimeGapSection = document.getElementById('randomTimeGapSection');
    this.batchSettings = document.getElementById('batchSettings');
    this.humanPatternSection = document.getElementById('humanPatternSection');
    
    // Warning messages
    this.delayWarningMessage = document.getElementById('delayWarningMessage');
    this.batchWarningMessage = document.getElementById('batchWarningMessage');
    this.turboWarningMessage = document.getElementById('turboWarningMessage');
    
    // Campaign summary elements
    this.totalContactsElement = document.getElementById('totalContacts');
    this.selectedContactsElement = document.getElementById('selectedContacts');
    this.estDurationElement = document.getElementById('estDuration');
    this.batchesElement = document.getElementById('batches');
    
    // Pattern info tooltip
    this.patternInfoIcon = document.getElementById('patternInfoIcon');
    this.patternTooltip = document.getElementById('patternTooltip');
  }

  initEventListeners() {
    // Toggle switch event listeners
    if (this.randomTimeGapToggle) {
      this.randomTimeGapToggle.addEventListener('change', () => {
        this.updateUIVisibility();
        this.updateCampaignSummary();
      });
    }
    
    if (this.splitBatchesToggle) {
      this.splitBatchesToggle.addEventListener('change', () => {
        this.updateUIVisibility();
        this.updateCampaignSummary();
      });
    }
    
    if (this.delayPatternToggle) {
      this.delayPatternToggle.addEventListener('change', () => {
        this.humanPatternEnabled = this.delayPatternToggle.checked;
        this.updateUIVisibility();
        this.updateCampaignSummary();
        
        // Show toast notification when enabling patterns, but prevent duplicates
        if (this.humanPatternEnabled) {
          const currentTime = Date.now();
          // Only show toast if at least 2 seconds have passed since the last one
          if (currentTime - this.lastToastTimestamp > 2000) {
            toast("Human-like delay patterns enabled", "info");
            this.lastToastTimestamp = currentTime;
          }
        }
      });
    }
    
    // Input change event listeners
    if (this.randomTimeGapMin) {
      this.randomTimeGapMin.addEventListener('change', () => {
        if (parseInt(this.randomTimeGapMin.value) > parseInt(this.randomTimeGapMax.value)) {
          this.randomTimeGapMax.value = parseInt(this.randomTimeGapMin.value) + 1;
        }
        this.updateCampaignSummary();
      });
    }
    
    if (this.randomTimeGapMax) {
      this.randomTimeGapMax.addEventListener('change', () => {
        if (parseInt(this.randomTimeGapMax.value) < parseInt(this.randomTimeGapMin.value)) {
          this.randomTimeGapMin.value = parseInt(this.randomTimeGapMax.value) - 1;
        }
        this.updateCampaignSummary();
      });
    }
    
    const batchChangeInputs = [this.batchSize, this.batchSizeMax, this.delayBetweenBatches, this.delayBetweenBatchesMax];
    batchChangeInputs.forEach(inp => {
      if (inp) inp.addEventListener('change', this.updateCampaignSummary);
    });
    
    // Human pattern intensity slider
    if (this.humanPatternIntensitySlider) {
      this.humanPatternIntensitySlider.addEventListener('input', () => {
        this.humanPatternIntensity = parseInt(this.humanPatternIntensitySlider.value);
        
        // Update the displayed value
        if (this.humanPatternIntensityValue) {
          this.humanPatternIntensityValue.textContent = this.humanPatternIntensity + '%';
        }
        
        this.updateCampaignSummary();
      });
    }
    
    // Pattern info tooltip hover
    if (this.patternInfoIcon && this.patternTooltip) {
      this.patternInfoIcon.addEventListener('mouseenter', () => {
        this.patternTooltip.style.display = 'block';
      });
      
      this.patternInfoIcon.addEventListener('mouseleave', () => {
        this.patternTooltip.style.display = 'none';
      });
    }
    
    // Legacy method toggle
    if (this.legacyMethodToggle) {
      this.legacyMethodToggle.addEventListener('change', () => {
        // Show warning if legacy method is disabled
        const warningEl = document.getElementById('legacyMethodWarningMessage');
        if (warningEl) {
          warningEl.style.display = this.legacyMethodToggle.checked ? 'none' : 'block';
        }
      });
    }

    // Turbo mode toggle
    if (this.turboModeToggle) {
      this.turboModeToggle.addEventListener('change', () => {
        this.updateUIVisibility();
        this.updateCampaignSummary();
        if (this.turboModeToggle.checked) {
          toast('Turbo Mode enabled – sending without delays', 'warning');
        }
      });
    }
  }

  updateUIVisibility() {
    // Show/hide sections based on toggle states
    if (this.randomTimeGapSection && this.randomTimeGapToggle) {
      this.randomTimeGapSection.style.display = this.randomTimeGapToggle.checked ? 'block' : 'none';
    }
    
    if (this.batchSettings && this.splitBatchesToggle) {
      this.batchSettings.style.display = this.splitBatchesToggle.checked ? 'block' : 'none';
    }
    
    if (this.humanPatternSection && this.delayPatternToggle) {
      this.humanPatternSection.style.display = this.delayPatternToggle.checked ? 'block' : 'none';
    }
    
    // Show/hide warning messages
    if (this.delayWarningMessage && this.randomTimeGapToggle) {
      this.delayWarningMessage.style.display = !this.randomTimeGapToggle.checked ? 'flex' : 'none';
    }
    
    if (this.batchWarningMessage && this.splitBatchesToggle) {
      this.batchWarningMessage.style.display = !this.splitBatchesToggle.checked ? 'flex' : 'none';
    }
    
    // Turbo warning visibility
    if (this.turboWarningMessage && this.turboModeToggle) {
      this.turboWarningMessage.style.display = this.turboModeToggle.checked ? 'flex' : 'none';
    }
    
    // Pattern toggle no longer disabled – user can enable even with fixed gaps
    if (this.delayPatternToggle) {
      if (!this.delayPatternToggle.checked) {
        this.humanPatternSection.style.display = 'none';
      }
    }

    // Legacy method warning visibility
    if (this.legacyMethodToggle) {
      const legacyWarningMessage = document.getElementById('legacyMethodWarningMessage');
      if (legacyWarningMessage) {
        legacyWarningMessage.style.display = this.legacyMethodToggle.checked ? 'none' : 'block';
      }
    }
  }

  /**
   * Calculates a randomized delay time based on current settings
   * @returns {number} Delay time in milliseconds
   */
  calculateDelay() {
    if (!this.randomTimeGapToggle || !this.randomTimeGapToggle.checked) {
      return 0; // No delay if disabled
    }
    
    const minDelay = parseInt(this.randomTimeGapMin.value) * 1000; // Convert to ms
    const maxDelay = parseInt(this.randomTimeGapMax.value) * 1000; // Convert to ms
    
    if (this.humanPatternEnabled) {
      return this.calculateHumanLikeDelay(minDelay, maxDelay);
    } else {
      // Basic random delay between min and max
      return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
    }
  }
  
  /**
   * Calculates a human-like delay with more natural patterns
   * @param {number} minDelay Minimum delay in milliseconds
   * @param {number} maxDelay Maximum delay in milliseconds
   * @returns {number} Humanized delay time in milliseconds
   */
  calculateHumanLikeDelay(minDelay, maxDelay) {
    // Helper to generate Gaussian-ish noise via Box-Muller
    const randomNormal = () => {
      let u = 0, v = 0;
      while (u === 0) u = Math.random(); // Converting [0,1) to (0,1)
      while (v === 0) v = Math.random();
      return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    };

    // 1. pick a base delay uniformly between min & max
    let delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

    // 2. intensity buckets
    const intensity = this.humanPatternIntensity; // 0-100
    const subtle = intensity <= 33;
    const balanced = intensity > 33 && intensity <= 66;
    // obvious := >66

    // 3. jitter around the base delay (Gaussian noise)
    const sigmaPct = subtle ? 0.07 : balanced ? 0.15 : 0.25; // 7 % · 15 % · 25 %
    const gaussianFactor = 1 + randomNormal() * sigmaPct;
    delay = Math.floor(delay * gaussianFactor);

    // 4. occasional behavioural patterns
    const roll = Math.random();
    if (roll < (subtle ? 0.05 : balanced ? 0.12 : 0.25)) {
      // Quick reply burst → 40 % faster
      delay = Math.floor(delay * 0.6);
    } else if (roll < (subtle ? 0.10 : balanced ? 0.22 : 0.40)) {
      // Short distraction pause → 80-150 % slower
      const factor = subtle ? 1.4 : balanced ? 1.8 : 2.5;
      delay = Math.floor(delay * factor);
    }

    // 5. small acceleration trend for sequential messages
    if (Math.random() < (subtle ? 0.05 : balanced ? 0.12 : 0.20)) {
      if (!this.recentDelays) this.recentDelays = [];
      if (this.recentDelays.length >= 3) {
        delay = Math.floor(delay * 0.85);
        if (this.recentDelays.length >= 6) this.recentDelays = [];
      }
      this.recentDelays.push(delay);
    }

    // 6. Time-of-day adjustment (night slower, business hours faster)
    const hour = new Date().getHours();
    if (hour >= 22 || hour <= 6) delay *= 1.15;
    else if (hour >= 9 && hour <= 16) delay *= 0.9;

    // 7. clamp and return (≥1 s)
    return Math.max(Math.floor(delay), 1000);
  }

  /**
   * Updates the campaign summary with real-time metrics
   * @param {number} totalContacts - Total number of contacts
   * @param {number} selectedContacts - Number of selected contacts
   */
  updateCampaignSummary(totalContacts = null, selectedContacts = null) {
    // Fallback to previously stored counts if parameters not provided
    if (totalContacts === null || typeof totalContacts !== 'number') {
      totalContacts = this.totalContacts || 0;
    }
    if (selectedContacts === null || typeof selectedContacts !== 'number') {
      selectedContacts = this.selectedContacts || totalContacts;
    }

    // Store the values for reference
    this.totalContacts = totalContacts;
    this.selectedContacts = selectedContacts;
    
    // Update UI elements if they exist
    if (this.totalContactsElement) {
      this.totalContactsElement.textContent = totalContacts;
    }
    
    if (this.selectedContactsElement) {
      this.selectedContactsElement.textContent = selectedContacts;
    }
    
    // Calculate estimated duration
    const estDuration = this.calculateEstimatedDuration(selectedContacts);
    
    if (this.estDurationElement) {
      this.estDurationElement.textContent = this.formatDuration(estDuration);
    }
    
    // Calculate number of batches
    const batches = this.calculateBatches(selectedContacts);
    
    if (this.batchesElement) {
      this.batchesElement.textContent = batches;
    }
    
    // Apply animation
    this.resetAnimation();
  }

  /**
   * Calculates the estimated duration of the campaign
   * @param {number} contacts - Number of contacts
   * @returns {number} - Estimated duration in minutes
   */
  calculateEstimatedDuration(contacts) {
    let totalSeconds = 0;
    
    // ---------------------------------------------
    // 1. Per-message delay calculation
    // ---------------------------------------------
    // Even if the random-delay toggle is OFF, a realistic estimate should
    // still assume a minimal gap between consecutive sends (network / UI
    // latency etc.). We'll therefore fall back to a "baseDelay" of 3 seconds
    // per message when the toggle is disabled.
    const turboEnabled = this.turboModeToggle && this.turboModeToggle.checked;
    const baseDelaySec = turboEnabled ? 0.3 : 3; // turbo ~0.3s per msg

    if (this.randomTimeGapToggle && this.randomTimeGapToggle.checked) {
      const minDelay = parseInt(this.randomTimeGapMin.value);
      const maxDelay = parseInt(this.randomTimeGapMax.value);
      const avgDelay = (minDelay + maxDelay) / 2;
      
      // Add additional time for human-like patterns if enabled.
      let patternMultiplier = 1;
      if (this.humanPatternEnabled) {
        const intensityFactor = this.humanPatternIntensity / 100; // 0-1
        patternMultiplier = 1 + intensityFactor * 0.4; // up to +40 %

        // Slightly slower at night/weekends
        const hour = new Date().getHours();
        if (hour >= 22 || hour <= 6) patternMultiplier *= 1.05;
        const day = new Date().getDay();
        if (day === 0 || day === 6) patternMultiplier *= 1.03;
      }
      
      totalSeconds = contacts * avgDelay * patternMultiplier;
    } else {
      // Delay toggle OFF – use baseDelaySec per message for estimation
      totalSeconds = contacts * baseDelaySec;
    }
    
    // Add batch delay time
    if (this.splitBatchesToggle && this.splitBatchesToggle.checked) {
      // Use average of min/max for estimation
      const minBatch = parseInt(this.batchSize.value);
      const maxBatch = parseInt(this.batchSizeMax?.value || minBatch);
      const batchSize = Math.round((minBatch + maxBatch) / 2);

      const minDelay = parseInt(this.delayBetweenBatches.value);
      const maxDelay = parseInt(this.delayBetweenBatchesMax?.value || minDelay);
      const batchDelay = Math.round((minDelay + maxDelay) / 2) * 60; // seconds
      const numberOfBatches = Math.ceil(contacts / batchSize) - 1; // -1 because no wait after last batch
      
      if (numberOfBatches > 0) {
        totalSeconds += numberOfBatches * batchDelay;
      }
    }
    
    return totalSeconds / 60; // Convert to minutes
  }

  /**
   * Calculates the number of batches based on the current settings
   * @param {number} contacts - Number of contacts
   * @returns {number} - Number of batches
   */
  calculateBatches(contacts) {
    if (contacts === 0) return 0;
    
    if (this.splitBatchesToggle && this.splitBatchesToggle.checked) {
      const minBatch = parseInt(this.batchSize.value);
      const maxBatch = parseInt(this.batchSizeMax?.value || minBatch);
      const batchSize = Math.round((minBatch + maxBatch) / 2);
      return Math.ceil(contacts / batchSize);
    }
    
    return 1; // If batches are disabled, there's just one batch
  }

  /**
   * Formats the duration in hours and minutes
   * @param {number} minutes - Duration in minutes
   * @returns {string} - Formatted duration string (e.g., "2h 30m")
   */
  formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    return `${hours}h ${mins}m`;
  }

  /**
   * Applies animation to highlight the updated fields
   */
  resetAnimation() {
    const elements = [
      this.totalContactsElement,
      this.selectedContactsElement,
      this.estDurationElement,
      this.batchesElement,
      document.querySelector('.campaign-summary')
    ].filter(el => el); // Filter out null/undefined elements
    
    elements.forEach(el => {
      el.classList.remove('reset-animation');
      void el.offsetWidth; // Trigger reflow
      el.classList.add('reset-animation');
    });
  }

  /**
   * Get the current configuration as an object
   * @returns {object} Configuration object
   */
  getConfig() {
    return {
      delay: {
        randomTime: this.randomTimeGapToggle?.checked === true,
        minTime: parseInt(this.randomTimeGapMin?.value || 1),
        maxTime: parseInt(this.randomTimeGapMax?.value || 5)
      },
      batch: {
        useBatches: this.splitBatchesToggle?.checked === true,
        sizeMin: parseInt(this.batchSize?.value || 79),
        sizeMax: parseInt(this.batchSizeMax?.value || 100),
        delayMin: parseInt(this.delayBetweenBatches?.value || 20),
        delayMax: parseInt(this.delayBetweenBatchesMax?.value || 50),
        size: parseInt(this.batchSize?.value || 1),
        delay: parseInt(this.delayBetweenBatches?.value || 1)
      },
      human: {
        usePattern: this.delayPatternToggle?.checked === true,
        intensity: parseInt(this.humanPatternIntensitySlider?.value || 70)
      },
      skipInvalidNumbers: this.skipInvalidNumbersToggle ? this.skipInvalidNumbersToggle.checked === true : true,
      // Back-compat alias for older saved configs
      skipInvalid: this.skipInvalidNumbersToggle ? this.skipInvalidNumbersToggle.checked === true : true,
      // The Legacy URL method is critical for reliable operation, especially for attachments
      // Make sure it defaults to true unless explicitly turned off
      useLegacyMethod: this.legacyMethodToggle ? this.legacyMethodToggle.checked !== false : true,
      turboMode: this.turboModeToggle ? this.turboModeToggle.checked === true : false
    };
  }

  /**
   * Restores the sending configuration from saved settings
   * @param {object} config - Sending configuration object
   */
  restoreConfig(config) {
    if (!config) return;
    
    // Restore delay settings
    if (config.delay) {
      if (this.randomTimeGapToggle) {
        this.randomTimeGapToggle.checked = config.delay.randomTime;
      }
      if (this.randomTimeGapMin) {
        this.randomTimeGapMin.value = config.delay.minTime;
      }
      if (this.randomTimeGapMax) {
        this.randomTimeGapMax.value = config.delay.maxTime;
      }
    }
    
    // Restore batch settings
    if (config.batch) {
      if (this.splitBatchesToggle) {
        this.splitBatchesToggle.checked = config.batch.useBatches;
      }
      if (this.batchSize && config.batch.sizeMin !== undefined) {
        this.batchSize.value = Math.min(Math.max(parseInt(config.batch.sizeMin), 1), 100);
      }
      if (this.batchSizeMax && config.batch.sizeMax !== undefined) {
        this.batchSizeMax.value = Math.min(Math.max(parseInt(config.batch.sizeMax), 1), 100);
      }
      if (this.delayBetweenBatches && config.batch.delayMin !== undefined) {
        this.delayBetweenBatches.value = Math.min(Math.max(parseInt(config.batch.delayMin), 1), 60);
      }
      if (this.delayBetweenBatchesMax && config.batch.delayMax !== undefined) {
        this.delayBetweenBatchesMax.value = Math.min(Math.max(parseInt(config.batch.delayMax), 1), 60);
      }
    }
    
    // Restore human pattern settings
    if (config.human) {
      if (this.delayPatternToggle) {
        this.delayPatternToggle.checked = config.human.usePattern;
        this.humanPatternEnabled = config.human.usePattern;
      }
      if (this.humanPatternIntensitySlider) {
        this.humanPatternIntensitySlider.value = config.human.intensity;
        this.humanPatternIntensity = config.human.intensity;
        
        if (this.humanPatternIntensityValue) {
          this.humanPatternIntensityValue.textContent = config.human.intensity + '%';
        }
      }
    }
    
    // Restore skip invalid numbers
    if (this.skipInvalidNumbersToggle) {
      if (config.hasOwnProperty('skipInvalidNumbers')) {
        this.skipInvalidNumbersToggle.checked = config.skipInvalidNumbers;
      } else if (config.hasOwnProperty('skipInvalid')) {
        this.skipInvalidNumbersToggle.checked = config.skipInvalid; // legacy
      }
    }

    // Restore legacy method setting - default to true if not specified
    // This is a critical feature for reliability, especially with attachments
    if (this.legacyMethodToggle) {
      // Explicitly set to true if value is missing or undefined
      const useLegacy = config.hasOwnProperty('useLegacyMethod')
        ? (config.useLegacyMethod !== false) // interpret anything that's not explicitly false as true
        : true;
      
      this.legacyMethodToggle.checked = useLegacy;
      
      // Make sure the tooltip reflects current best practice
      const infoIcon = document.querySelector('label[for="legacyMethodToggle"] i, label.control-label i[title*="Uses WhatsApp"]');
      if (infoIcon) {
        infoIcon.title = "Uses WhatsApp's direct URL scheme to reliably open each chat. Recommended for all browsers, but especially critical for sending attachments correctly and handling unsaved numbers. Keep enabled for maximum reliability.";
      }
    }
    
    // Restore turbo mode
    if (this.turboModeToggle && config.hasOwnProperty('turboMode')) {
      this.turboModeToggle.checked = config.turboMode;
    }
    
    // Update UI visibility based on restored config
    this.updateUIVisibility();
    
    // Update campaign summary
    this.updateCampaignSummary();
  }
}

// Export a function to toggle UI sections
export function toggleSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  
  const content = section.querySelector('.section-content');
  const icon = section.querySelector('.section-header i');
  
  if (content && icon) {
    if (content.style.display === 'none') {
      content.style.display = 'block';
      icon.className = 'ri-arrow-down-s-line';
    } else {
      content.style.display = 'none';
      icon.className = 'ri-arrow-right-s-line';
    }
    
    // Save the state in local storage
    chrome.storage.local.set({ [`${sectionId}Collapsed`]: content.style.display === 'none' });
  }
}

// Function to save current settings to storage
export function saveSettings() {
  const controls = new SendingControls();
  const config = controls.getConfig();
  
  chrome.storage.local.set({ sendingControls: config }, () => {
    console.log('Sending controls saved:', config);
  });
  
  return config;
}

// Function to update summary (for external use)
export function updateSummary(parsedData, inputEls, toggleEls, summaryEls) {
  const controls = new SendingControls();
  
  // Replace DOM elements with those passed from parameters
  if (inputEls) {
    controls.randomTimeGapMin = document.getElementById('randomTimeGapMin');
    controls.randomTimeGapMax = inputEls.randomTimeGapMax;
    controls.batchSize = inputEls.batchSize;
    controls.delayBetweenBatches = inputEls.delayBetweenBatches;
  }
  
  if (toggleEls) {
    controls.randomTimeGapToggle = toggleEls.randomTimeGap;
    controls.splitBatchesToggle = toggleEls.splitBatches;
    controls.humanPatternEnabled = toggleEls.delayPattern?.checked || false;
  }
  
  if (summaryEls) {
    controls.totalContactsElement = summaryEls.totalContacts;
    controls.selectedContactsElement = summaryEls.selectedContacts;
    controls.estDurationElement = summaryEls.estDuration;
    controls.batchesElement = summaryEls.batches;
  }
  
  // Now update the summary with the total number of contacts
  if (Array.isArray(parsedData)) {
    controls.updateCampaignSummary(parsedData.length, parsedData.length);
  } else {
    console.warn('Invalid parsedData passed to updateSummary:', parsedData);
    controls.updateCampaignSummary(0, 0);
  }
}

// Function to reset a stuck campaign
export function resetStuckCampaign() {
  // First, set a timestamp for when the reset happened
  const resetTimestamp = Date.now();
  chrome.storage.local.set({ campaignResetTimestamp: resetTimestamp });
  
  // Send a message to the background script to reset the campaign state
  chrome.runtime.sendMessage({ action: 'resetCampaignState' }, (response) => {
    try {
      // Clean up content script state if available
      if (window.WABroadcastSender) {
        window.WABroadcastSender.isConnected = false;
        window.WABroadcastSender.initialized = false;
        window.WABroadcastSender.sendingInProgress = false;
        window.WABroadcastSender.activeCampaign = null;
        window.WABroadcastSender.currentContact = 0;
        window.WABroadcastSender.currentBatch = 0;
        window.WABroadcastSender.batchInProgress = false;
        
        // Clear any timeouts or intervals
        if (window.WABroadcastSender.batchTimeout) {
          clearTimeout(window.WABroadcastSender.batchTimeout);
          window.WABroadcastSender.batchTimeout = null;
        }
        if (window.WABroadcastSender.messageTimeout) {
          clearTimeout(window.WABroadcastSender.messageTimeout);
          window.WABroadcastSender.messageTimeout = null;
        }
      }
      
      // Also clear all campaign-related storage items
      chrome.storage.local.remove([
        'activeCampaign',
        'campaignProgress',
        'campaignStatus',
        'campaignQueue',
        'campaignBatchStatus',
        'lastSendOperation',
        'campaignPaused',
        'campaignPauseReason',
        'messageQueue'
      ], () => {
        toast('Campaign state has been reset', 'success');
        console.log('Stuck campaign has been reset');
        
        // Reload the page to ensure all UI elements are reset
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      });
    } catch (error) {
      // If there was an error during cleanup
      console.error('Error during campaign reset:', error);
      toast(`Error during reset operation: ${error.message}`, 'error');
      
      // Still try to reload the page to reset UI
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    }
  });
}

// Create a single instance of SendingControls
const sendingControls = new SendingControls();

// Export the SendingControls class as default export
export default SendingControls;