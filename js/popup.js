// js/popup.js
// popup.js – refactored for MV3 & local resources (2025-04-23)
// ------------------------------------------------------------------
// • Loads feature pages & their scripts only once per session
// • Cleans up previous scripts when navigating back
// • Works with Manifest V3 CSP (all scripts are local, so 'self')
// • Uses style.css for toast notifications and styled stop campaign modal
// ------------------------------------------------------------------

import { setupConnectionMonitoring } from './utils/shared-components.js';

// ===== Logging Control =====
// Toggle WA_DEBUG to true to re-enable console output inside the popup.
const WA_DEBUG = false;
if (!WA_DEBUG && typeof window !== 'undefined') {
  ['log','info','debug','warn','error'].forEach(m => { if (console[m]) console[m] = () => {}; });
  window.addEventListener('unhandledrejection', e => { e.preventDefault(); });
  window.addEventListener('error', e => { e.preventDefault(); });
}

// Constants for URLs
const WHATSAPP_URL = 'https://web.whatsapp.com/';
const HELP_URL = 'https://support.wabroadcastsender.com';
const FEEDBACK_URL = 'https://feedback.wabroadcastsender.com';

// WhatsApp Number Fetcher Elements & Key
let waUserPhoneNumberEl;
let waUserNumberStatusEl;
let profileInfoDiv; // The div holding the number and status, for click listener
const whatsAppNumberStorageKey = 'waUserPhoneNumberResult';

// Feature modules mapping
const FEATURES = {
    sender: { html: 'html/sender.html', js: 'js/sender.js', css: 'css/style.css' },
    extractor: { html: 'html/extractor.html', js: 'js/extractor.js', css: 'css/extractor.css' },
    campaignProgress: { html: 'html/campaign-progress.html', js: 'js/campaign-progress.js', css: 'css/campaign.css' }
};

/* ─────────── Helper Functions ─────────── */
const $ = id => document.getElementById(id);

/* ─────────── Feature Loading ─────────── */
async function loadFeature(featureKey) {
    console.log('Loading feature:', featureKey);
    try {
        const feature = FEATURES[featureKey];
        if (!feature) throw new Error(`Feature ${featureKey} not found`);

        const contentArea = $('content-area');
        if (!contentArea) throw new Error('Content area not found');

        // Store current content for back navigation if not already stored
        if (!window.initialMarkup) {
            window.initialMarkup = contentArea.innerHTML;
        }

        // Hide campaign status container while inside a feature view
        const campaignStatusEl = document.getElementById('campaignStatusContainer');
        if (campaignStatusEl) {
            campaignStatusEl.dataset.prevDisplay = campaignStatusEl.style.display || 'block';
            campaignStatusEl.style.display = 'none';
        }

        // Load the feature's HTML
        const htmlUrl = chrome.runtime.getURL(feature.html);
        const response = await fetch(htmlUrl);
        const html = await response.text();
        
        // Create a temporary container to parse the HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        contentArea.innerHTML = '';
        if(featureKey !== 'campaignProgress'){
            const backBtn = document.createElement('button');
            backBtn.id = 'backBtn';
            backBtn.className = 'back-btn';
            backBtn.innerHTML = '<i class="ri-arrow-left-line"></i> Back to Menu';
            backBtn.addEventListener('click', handleBackNavigation);
            contentArea.appendChild(backBtn);
        }
        contentArea.insertAdjacentHTML('beforeend', doc.body.innerHTML);
        
        // Dynamically load the feature-specific CSS if it exists
        if (feature.css) {
            const existingStyle = document.querySelector(`link[href="${chrome.runtime.getURL(feature.css)}"]`);
            if (!existingStyle) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = chrome.runtime.getURL(feature.css);
                document.head.appendChild(link);
                console.log(`Loaded CSS for ${featureKey}: ${feature.css}`);
            }
        }
        
        // Load and initialize the feature's JavaScript module - SIMPLIFIED APPROACH
        try {
            // Import the module directly (don't create script tags)
            console.log(`Importing module: ${feature.js}`);
            const module = await import(chrome.runtime.getURL(feature.js));
            
            // Call the appropriate init function based on feature type
            if (featureKey === 'sender' && typeof module.initSender === 'function') {
                console.log('Calling initSender()');
                module.initSender();
            } else if (featureKey === 'extractor' && typeof module.initExtractor === 'function') {
                console.log('Calling initExtractor()');
                module.initExtractor();
            } else if (featureKey === 'campaignProgress' && typeof module.initCampaignProgress === 'function') {
                console.log('Calling initCampaignProgress()');
                module.initCampaignProgress();
            } else if (typeof module.init === 'function') {
                console.log('Calling generic init()');
                module.init();
            } else {
                console.warn(`No initialization function found in ${feature.js}`);
            }
            
            // Dispatch a custom event to notify that the feature is loaded
            const event = new CustomEvent('featureLoaded', { detail: { feature: featureKey } });
            document.dispatchEvent(event);
        } catch (error) {
            console.error('Error initializing feature module:', error);
            showToast(`Error initializing ${featureKey}. Please try again.`, 'error');
        }
    } catch (error) {
        console.error('Error loading feature:', error);
        showToast('Error loading feature. Please try again.', 'error');
    }
}

async function handleBackNavigation() {
    console.log('Handling back navigation');
    try {
        const contentArea = $('content-area');
        if (!contentArea) throw new Error('Content area not found');

        // Clean up any existing event listeners from feature modules
        if (window.currentFeatureCleanup && typeof window.currentFeatureCleanup === 'function') {
            window.currentFeatureCleanup();
            window.currentFeatureCleanup = null;
        }

        // Remove any existing feature scripts to prevent conflicts
        const featureScripts = document.querySelectorAll('script[type="module"]');
        featureScripts.forEach(script => {
            if (script.src.includes('/js/')) {
                script.remove();
            }
        });

        // Remove dynamically added CSS for features
        const featureStyles = document.querySelectorAll('link[rel="stylesheet"][href*="/css/"]');
        featureStyles.forEach(style => {
            if (style.href.includes('/css/') && !style.href.includes('style.css')) {
                style.remove();
            }
        });

        if (window.initialMarkup) {
            // Restore the original content
            contentArea.innerHTML = window.initialMarkup;
            
            // Restore campaign status container visibility
            const campaignStatusEl = document.getElementById('campaignStatusContainer');
            if (campaignStatusEl) {
                const prev = campaignStatusEl.dataset.prevDisplay || 'block';
                campaignStatusEl.style.display = prev;
            }
            
            // Reinitialize the main menu
            initializeButtons();
            initializeCampaignControls();
            
            // Check for active campaign
            checkActiveCampaign();
        } else {
            // Fallback: Load popup.html content
            const response = await fetch(chrome.runtime.getURL('popup.html'));
            const html = await response.text();
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const newContentArea = doc.querySelector('#content-area');
            
            if (newContentArea) {
                contentArea.innerHTML = newContentArea.innerHTML;
                const campaignStatusEl = document.getElementById('campaignStatusContainer');
                if (campaignStatusEl) {
                    const prev = campaignStatusEl.dataset.prevDisplay || 'block';
                    campaignStatusEl.style.display = prev;
                }
                initializeButtons();
                initializeCampaignControls();
                checkActiveCampaign();
            } else {
                throw new Error('Content area not found in popup.html');
            }
        }
    } catch (error) {
        console.error('Error handling back navigation:', error);
        showToast('Error returning to main menu', 'error');
    }
}

/* ─────────── Campaign Handling ─────────── */
function checkActiveCampaign() {
    chrome.storage.local.get('activeCampaign', res => {
        const camp = res.activeCampaign;
        if (camp && !['completed','canceled','failed','aborted'].includes(camp.status)) {
            // There is an active (running or paused) campaign
            const msg=$('noCampaignMessage');
            const btn=$('activeCampaignBtn');
            if(msg) msg.style.display='none';
            if(btn) btn.style.display='block';
        } else {
            showNoCampaign();
        }
    });
}

function updateCampaignStatus(status, campaign) {
    if (!status) return;
    
    const noCampaign = $('noCampaignMessage');
    const activeCampaign = $('activeCampaignDetails');
    
    if (noCampaign) noCampaign.style.display = 'none';
    if (activeCampaign) activeCampaign.style.display = 'block';
    
    if (campaign) {
        paintCampaign(status, campaign);
    } else {
        chrome.storage.local.get('activeCampaign', r => {
            if (r.activeCampaign) paintCampaign(status, r.activeCampaign);
        });
    }
}

function paintCampaign(status, campaign) {
    const campaignStatusContainer = $('campaignStatusContainer');
    const noCampaignMessage = $('noCampaignMessage');
    if (!campaignStatusContainer || !noCampaignMessage) return;

    // Simply ensure "Active Campaign" button is visible and hide the no-campaign text
    campaignStatusContainer.style.display = 'block';
    noCampaignMessage.style.display = 'none';
    const btn=$('activeCampaignBtn');
    if(btn) btn.style.display='block';
    return; // skip detailed painting – handled in campaign-progress page
    
    // Make sure the campaign status container is visible
    campaignStatusContainer.style.display = 'block';
    noCampaignMessage.style.display = 'none';
    activeCampaignDetails.style.display = 'block';
    
    // Update the text of the Start New Campaign button to View Active Campaign
    const activeCampaignBtn = $('activeCampaignBtn');
    if (activeCampaignBtn) {
        activeCampaignBtn.textContent = 'Active Campaign';
        activeCampaignBtn.style.display = 'none'; // Hide it from the no-campaign area when active details shown
    }
    
    // Make sure View Active Campaign button is visible
    const activeCampaignBtnShown = $('activeCampaignBtn');
    if (activeCampaignBtnShown) {
        activeCampaignBtnShown.style.display = 'block';
    }
    
    const elements = {
        name: $('campaignName'),
        progress: $('campaignProgress'),
        progressText: $('progressText'),
        progressPercentage: $('progressPercentage'),
        sentCount: $('sentCount'),
        failedCount: $('failedCount'),
        remainingCount: $('remainingCount')
    };
    
    // Check if campaign is in error state
    if (status.status === 'failed' || status.status === 'error') {
        if (elements.name) elements.name.textContent = 'Campaign Error';
        if (elements.progressText) elements.progressText.textContent = 'Error';
        if (elements.progress) {
            elements.progress.style.width = '100%';
            elements.progress.style.backgroundColor = '#dc3545'; // Red color for error
        }
        
        // Update count elements to show error message
        if (elements.sentCount) elements.sentCount.textContent = status.sentCount || 0;
        if (elements.failedCount) elements.failedCount.textContent = status.failedCount || 0;
        if (elements.remainingCount) elements.remainingCount.innerHTML = '<span style="color: #dc3545;">Failed</span>';
        
        // Add error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'campaign-error';
        errorDiv.innerHTML = `<i class="ri-error-warning-line"></i> ${status.error || 'An error occurred with this campaign.'}`;
        
        if (!$('campaign-error')) {
            activeCampaignDetails.appendChild(errorDiv);
        }
        
        return;
    }
    
    // Normal campaign status
    if (elements.name) elements.name.textContent = campaign.name || 'Active Campaign';
    
    const total = status.totalContacts || 0;
    const current = status.currentIndex || 0;
    const percentage = total ? Math.round((current / total) * 100) : 0;
    
    if (elements.progress) {
        elements.progress.style.width = `${percentage}%`;
        elements.progress.style.backgroundColor = ''; // Reset to default color
    }
    if (elements.progressText) elements.progressText.textContent = `${current}/${total}`;
    if (elements.progressPercentage) elements.progressPercentage.textContent = `${percentage}%`;
    if (elements.sentCount) elements.sentCount.textContent = status.sentCount || 0;
    if (elements.failedCount) elements.failedCount.textContent = status.failedCount || 0;
    if (elements.remainingCount) elements.remainingCount.textContent = total - current;
}

function showNoCampaign() {
    const msg=$('noCampaignMessage');
    const btn=$('activeCampaignBtn');
    if(msg) msg.style.display='block';
    if(btn) btn.style.display='none';
}

/* ─────────── Toast Notifications ─────────── */
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    
    const container = document.querySelector('.toast-container');
    if (container) {
        // Prevent stacking identical warnings
        const existing = [...container.children].find(el => el.textContent === message);
        if (existing) return;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
}

/* ─────────── Initialization ─────────── */
function initializeButtons() {
    console.log('Initializing buttons');
    
    // Quick Action buttons
    const buttons = {
        openSenderBtn: 'sender',
        openExtractorBtn: 'extractor'
    };

    // Attach listeners to all Quick Action buttons
    Object.entries(buttons).forEach(([btnId, featureKey]) => {
        const btn = $(btnId);
        if (btn) {
            const handler = () => {
                // Store the current cleanup function before loading new feature
                if (window.currentFeatureCleanup && typeof window.currentFeatureCleanup === 'function') {
                    window.currentFeatureCleanup();
                    window.currentFeatureCleanup = null;
                }
                
                // Load the new feature
                loadFeature(featureKey);
            };
            
            // Remove existing listener before adding new one
            btn.removeEventListener('click', handler);
            btn.addEventListener('click', handler);
            console.log(`Attached click listener to ${btnId}`);
        }
    });

    // Handle WhatsApp Web button
    const openWhatsAppBtn = $('openWhatsAppBtn');
    if (openWhatsAppBtn) {
        const handleWhatsApp = () => {
            chrome.tabs.create({ url: WHATSAPP_URL });
        };
        openWhatsAppBtn.removeEventListener('click', handleWhatsApp);
        openWhatsAppBtn.addEventListener('click', handleWhatsApp);
    }

    // Handle Active Campaign button
    const activeCampaignBtn = $('activeCampaignBtn');
    if (activeCampaignBtn) {
        activeCampaignBtn.removeEventListener('click', handleActiveCampaignClick);
        activeCampaignBtn.addEventListener('click', handleActiveCampaignClick);
    }

    // Handle Help and Feedback links
    const helpLink = $('helpLink');
    if (helpLink) {
        const handleHelp = (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: HELP_URL });
        };
        helpLink.removeEventListener('click', handleHelp);
        helpLink.addEventListener('click', handleHelp);
    }

    const feedbackLink = $('feedbackLink');
    if (feedbackLink) {
        const handleFeedback = (e) => {
            e.preventDefault();
            chrome.tabs.create({ url: FEEDBACK_URL });
        };
        feedbackLink.removeEventListener('click', handleFeedback);
        feedbackLink.addEventListener('click', handleFeedback);
    }

    // Add Linux upload notice button handler
    const openInTabBtn = document.getElementById('openInTabBtn');
    if (openInTabBtn) {
        openInTabBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('html/sender.html') });
        });
    }
}

/* ─────────── Campaign Controls ─────────── */
function initializeCampaignControls() {
    const pauseResumeBtn = $('pauseResumeBtn');
    const stopCampaignBtn = $('stopCampaignBtn');
    
    if (pauseResumeBtn) {
        pauseResumeBtn.addEventListener('click', async () => {
            try {
                const response = await chrome.runtime.sendMessage({ action: 'getCampaignStatus' });
                if (response && response.campaign) {
                    const action = response.campaign.status === 'paused' ? 'resumeCampaign' : 'pauseCampaign';
                    const result = await chrome.runtime.sendMessage({ action });
                    if (result && result.success) {
                        showToast(`Campaign ${action === 'pauseCampaign' ? 'paused' : 'resumed'}`, 'info');
                    } else {
                        showToast(result?.error || 'Failed to update campaign status', 'error');
                    }
                }
            } catch (error) {
                showToast('Error updating campaign status', 'error');
            }
        });
    }
    
    if (stopCampaignBtn) {
        stopCampaignBtn.addEventListener('click', async () => {
            try {
                const result = await chrome.runtime.sendMessage({ action: 'abortCampaign' });
                if (result && result.success) {
                    showToast('Campaign stopped', 'info');
                    showNoCampaign();
                } else {
                    showToast(result?.error || 'Failed to stop campaign', 'error');
                }
            } catch (error) {
                showToast('Error stopping campaign', 'error');
            }
        });
    }
}

// Show 'Open in Tab for Upload' only on Linux, and style it
function showLinuxUploadNotice() {
    const notice = document.getElementById('linuxUploadNotice');
    if (notice) {
        notice.style.display = 'block';
    }
}

// ─────────── WhatsApp Number Display Functions ───────────
function updateWhatsAppUserNumberDisplay(data) {
    if (!waUserPhoneNumberEl || !waUserNumberStatusEl) {
        // console.log("WA Campaign Sender: WhatsApp number display elements not ready in popup.");
        return;
    }

    if (!data || !data.status) {
        waUserPhoneNumberEl.textContent = '';
        waUserNumberStatusEl.textContent = 'Click to fetch'; // Initial prompt
        waUserNumberStatusEl.style.display = 'inline';
        if(profileInfoDiv) profileInfoDiv.title = 'Click to fetch your WhatsApp number';
        return;
    }

    switch (data.status) {
        case 'success_injector':
            waUserPhoneNumberEl.textContent = data.number || 'Unknown Number';
            waUserNumberStatusEl.textContent = ''; // Or a success icon like '✓'
            waUserNumberStatusEl.style.display = 'none';
            if(profileInfoDiv) profileInfoDiv.title = `Your number: ${data.number}. Click to refresh.`;
            break;
        case 'pending_injector': {
            // If no number is currently displayed, show pending state to the user.
            if (!waUserPhoneNumberEl.textContent || waUserPhoneNumberEl.textContent.trim() === '') {
                waUserPhoneNumberEl.textContent = '';
                waUserNumberStatusEl.textContent = data.message || 'Fetching...';
                waUserNumberStatusEl.style.display = 'inline';
                if(profileInfoDiv) profileInfoDiv.title = 'Attempting to fetch your WhatsApp number...';
            }
            break;
        }
        case 'error':
            waUserPhoneNumberEl.textContent = '';
            waUserNumberStatusEl.textContent = data.message || 'Error fetching';
            waUserNumberStatusEl.style.display = 'inline';
            if(profileInfoDiv) profileInfoDiv.title = `Error: ${data.message}. Click to retry.`;
            break;
        default:
            waUserPhoneNumberEl.textContent = '';
            waUserNumberStatusEl.textContent = 'Status unknown';
            waUserNumberStatusEl.style.display = 'inline';
            if(profileInfoDiv) profileInfoDiv.title = 'Click to fetch your WhatsApp number';
    }
}

async function requestWhatsAppUserNumberFetch() {
    // If no number is currently displayed, show pending state to the user.
    if (!waUserPhoneNumberEl.textContent || waUserPhoneNumberEl.textContent.trim() === '') {
        updateWhatsAppUserNumberDisplay({ status: 'pending_injector', message: 'Fetching...' });
    }

    try {
        const tabs = await chrome.tabs.query({ url: "*://web.whatsapp.com/*" });
        if (tabs.length > 0) {
            // Send to the first active WhatsApp tab found.
            // The content script on that page will handle the request.
            chrome.tabs.sendMessage(tabs[0].id, { type: "FETCH_WA_USER_NUMBER_AGAIN" }, response => {
                if (chrome.runtime.lastError) {
                    // console.error("WA Campaign Sender: Error sending FETCH_WA_USER_NUMBER_AGAIN:", chrome.runtime.lastError.message);
                    // Error is usually because the content script isn't ready or page isn't fully loaded.
                    // The timeout in content_script.js should eventually set a pending/error status.
                    // updateWhatsAppUserNumberDisplay({ status: 'error', message: 'Cannot contact WhatsApp page.' });
                } else {
                    // console.log("WA Campaign Sender: FETCH_WA_USER_NUMBER_AGAIN sent, response:", response);
                }
            });
        } else {
            // console.log("WA Campaign Sender: No active WhatsApp tab found to fetch number from.");
            updateWhatsAppUserNumberDisplay({ status: 'error', message: 'Open WhatsApp Web.' });
        }
    } catch (e) {
        // console.error("WA Campaign Sender: Error querying tabs for WhatsApp:", e);
        updateWhatsAppUserNumberDisplay({ status: 'error', message: 'Tab query error.' });
    }
}

function loadWhatsAppUserNumber() {
    chrome.storage.local.get([whatsAppNumberStorageKey], (result) => {
        const storedData = result[whatsAppNumberStorageKey];
        // Check if data exists, is relatively fresh (e.g., within 24 hours), and was successful
        if (storedData && storedData.timestamp && (Date.now() - storedData.timestamp < 86400000) && storedData.status === 'success_injector') {
            // console.log("WA Campaign Sender: Loaded WhatsApp user number from storage:", storedData);
            updateWhatsAppUserNumberDisplay(storedData);
        } else {
            // console.log("WA Campaign Sender: No valid/fresh number in storage, initiating fetch.");
            requestWhatsAppUserNumberFetch(); // Attempt to fetch if no good data
        }
    });
}

/* ─────────── Popup Initialization ─────────── */
async function initPopup() {
    console.log('Initializing popup');
    setupConnectionMonitoring();

    // Assign WhatsApp Number display elements and set up listeners
    waUserPhoneNumberEl = $('waUserPhoneNumber');
    waUserNumberStatusEl = $('waUserNumberStatus');
    profileInfoDiv = document.querySelector('.profile-info'); // The div containing the number and status

    if (waUserPhoneNumberEl && waUserNumberStatusEl && profileInfoDiv) {
        loadWhatsAppUserNumber(); // Load or fetch number on popup open
        profileInfoDiv.addEventListener('click', () => {
            // console.log("WA Campaign Sender: Profile info clicked, requesting number fetch.");
            requestWhatsAppUserNumberFetch();
        });
        profileInfoDiv.style.cursor = 'pointer'; // Indicate it's clickable
        profileInfoDiv.title = 'Click to fetch/refresh your WhatsApp number'; // Initial tooltip
    } else {
        // console.error("WA Campaign Sender: Could not find WhatsApp number display elements (waUserPhoneNumber, waUserNumberStatus, or .profile-info) in popup.html");
    }
    
    // Initialize main menu buttons and event listeners
    initializeButtons();
    
    // Initialize campaign controls if they exist
    initializeCampaignControls();
    
    // Initialize advanced settings
    initializeAdvancedSettings();
    
    // Check for active campaign
    checkActiveCampaign();
    
    // Check if running on Linux and show upload notice
    if (navigator.platform.toLowerCase().includes('linux')) {
        showLinuxUploadNotice();
    }
}

/* ─────────── Advanced Settings ─────────── */
function initializeAdvancedSettings() {
    console.log('Initializing advanced settings');
    
    // Advanced settings initialization can be placed here
    // SPA Navigation has been removed
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopup);
} else {
    initPopup();
}

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Initial connection check
    checkConnectionStatus();
    
    // Set up tab monitoring
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url?.includes('web.whatsapp.com')) {
        checkConnectionStatus();
      }
    });
    
    chrome.tabs.onRemoved.addListener(async () => {
      checkConnectionStatus();
    });
    
  } catch (error) {
    console.error('Error initializing popup:', error);
  }
});

// Check connection status
async function checkConnectionStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'checkWhatsAppConnection' });
    updateConnectionStatus(response.connected);
  } catch (error) {
    console.error('Error checking connection:', error);
    updateConnectionStatus(false);
  }
}

// Update connection status display
function updateConnectionStatus(isConnected) {
  const connectionIndicator = document.getElementById('connectionIndicator');
  const connectionStatus = document.getElementById('connectionStatus');
  
  if (isConnected) {
    connectionIndicator.className = 'status-indicator connected';
    connectionStatus.textContent = 'Connected';
  } else {
    connectionIndicator.className = 'status-indicator disconnected';
    connectionStatus.textContent = 'Disconnected';
    // Clear cached number display when disconnected to avoid showing stale data
    updateWhatsAppUserNumberDisplay(null);
  }
}

// Keep a single reference to avoid duplicate listeners
function handleActiveCampaignClick() {
  chrome.storage.local.get('activeCampaign', result => {
    if (result.activeCampaign && !['completed','canceled','failed','aborted'].includes(result.activeCampaign.status)) {
      loadFeature('campaignProgress');
    } else {
      showToast('No active campaign found', 'warning');
    }
  });
}

// Export necessary functions
// Listen for WhatsApp Number updates from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "WHATSAPP_NUMBER_RESULT") {
        // console.log("WA Campaign Sender: Popup received WHATSAPP_NUMBER_RESULT:", message);
        updateWhatsAppUserNumberDisplay(message);
        // No sendResponse needed as this is a broadcast from content script to popup
        return; // Explicitly return if not sending a response to avoid console errors
    }
    // IMPORTANT: If other listeners expect a response, ensure this doesn't interfere.
    // For now, assuming WHATSAPP_NUMBER_RESULT doesn't require a response to the sender.
});

export { loadFeature, showToast, initPopup };