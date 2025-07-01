// js/campaign-progress.js - Handle campaign progress display and controls
import { toast, ensureLibraryLoaded } from './utils.js';
import { checkWhatsAppConnection, setConnectionStatus, updateWhatsAppStatusIndicator, setupConnectionMonitoring } from './utils/shared-components.js';

// Constants for URLs
const WHATSAPP_URL = 'https://web.whatsapp.com/';
const HELP_URL = 'https://support.wabroadcastsender.com';
const FEEDBACK_URL = 'https://feedback.wabroadcastsender.com';

// DOM Elements
const whatsappStatus = document.getElementById('whatsappStatus');
const currentOperation = document.getElementById('currentOperation');
const progressBar = document.getElementById('progressBar');
const progressCount = document.getElementById('progressCount');
const progressPercentage = document.getElementById('progressPercentage');
const contactCount = document.getElementById('contactCount');
const successCount = document.getElementById('successCount');
const failureCount = document.getElementById('failureCount');
const averageTimeValue = document.getElementById('averageTimeValue');
const timeRemainingValue = document.getElementById('timeRemainingValue');
const errorsSection = document.getElementById('errorsSection');
const errorList = document.getElementById('errorList');
const backBtn = document.getElementById('backBtn');

// Campaign state
let campaignPort = null;
let campaignId = null;
let isPaused = false;
let lastUpdateTime = Date.now();
let startTime = Date.now();
let campaignStatus = {
  totalContacts: 0,
  processed: 0,
  success: 0,
  failure: 0,
  errors: [],
  status: 'initializing'
};

// Remove all port connection logic
// Implement polling for campaign status
let pollingInterval = null;
let lastCampaignId = null;
let completionWatchTimer = null;
let globalCompletionTimer = null; // Global timer for forcing completion

// Added reference
let downloadBtn = null;

function startCampaignPolling(campaignId) {
  if (pollingInterval) clearInterval(pollingInterval);
  lastCampaignId = campaignId;
  pollingInterval = setInterval(() => {
    chrome.runtime.sendMessage({ action: 'getCampaignStatus', campaignId }, (response) => {
      if (response && response.campaignStatus) {
        handleCampaignUpdate(response.campaignStatus);
      } else {
        handleCampaignLost();
      }
    });
  }, 2000); // poll every 2 seconds
}

function handleCampaignUpdate(status) {
  if (!status) return;

  // Update numeric/stat cards & current operation
  updateCampaignStatus(status);
  updateProgressUI(status);

  // If campaign finished, stop polling
  if (['completed', 'aborted', 'failed'].includes(status.status)) {
    if (pollingInterval) clearInterval(pollingInterval);
    if (globalCompletionTimer) clearTimeout(globalCompletionTimer);
  } else {
    // Reset/set global completion timer if near the end
    const total = status.totalContacts || 0;
    const sent = status.sentCount || 0;
    const failed = status.failedCount || 0;
    const processed = sent + failed;
    
    // If we're processing the last or second-to-last message, set a completion timer
    if (total > 0 && processed >= total - 2) {
      if (globalCompletionTimer) clearTimeout(globalCompletionTimer);
      globalCompletionTimer = setTimeout(() => {
        // Force campaign completion if no further updates after 10 seconds
        const updatedStatus = {...status, status: 'completed'};
        updateCampaignStatus(updatedStatus);
        updateProgressUI(updatedStatus);
        if (pollingInterval) clearInterval(pollingInterval);
      }, 10000); // Force completion after 10 seconds of inactivity at end of campaign
    }
  }
}

function handleCampaignLost() {
  // Show lost connection message in the UI
  // ... (your UI error logic here)
}

// Function to create and insert the header
function initializeHeader() {
    const headerContainer = document.querySelector('.popup-container'); 
    if (!headerContainer) {
        console.error("Header container (.popup-container) not found in campaign-progress.html");
        return;
    }

    // Check if header already exists to prevent duplicates if script runs multiple times
    if (headerContainer.querySelector('.header')) {
        return; 
    }

    const headerHTML = `
        <header class="header">
            <div class="logo">
                <div class="logo-icon">
                    <img src="${chrome.runtime.getURL('images/Logo.png')}" alt="WA Campaign Sender Logo">
                </div>
                <h1 class="logo-text">WA Campaign Sender-Plugin</h1>
            </div>
            <div class="connection-status">
                <div class="status-indicator" id="connectionIndicator"></div>
                <span id="connectionStatus">Disconnected</span>
            </div>
        </header>
    `;
    // Insert the header at the beginning of the .popup-container
    headerContainer.insertAdjacentHTML('afterbegin', headerHTML);

    // Now that the header is added, setup connection monitoring for it
    // This function (from shared-components.js) should find the new elements by ID
    setupConnectionMonitoring(); 
}

// Initialize campaign progress
async function initCampaignProgress() {
  try {
    // Initialize toast container first
    initToastContainer();
    
    // Add the header dynamically
    initializeHeader(); // Call this early to ensure header is present

    // Initialize footer and back button functionality
    setupUIEventListeners(); // This should NOT re-initialize header elements
    
    // Get campaign ID from URL or storage
    const urlParams = new URLSearchParams(window.location.search);
    campaignId = urlParams.get('id');
    
    if (!campaignId) {
      // Try to get from storage
      const result = await chrome.storage.local.get(['activeCampaign']);
      if (result.activeCampaign && result.activeCampaign.id) {
        campaignId = result.activeCampaign.id;
      } else {
        showNoCampaignError();
        return;
      }
    }
    
    // Get initial campaign status
    const result = await chrome.storage.local.get(['campaignStatus', 'campaignProgress', 'activeCampaign']);
    if (result.campaignStatus) {
      campaignStatus = { ...campaignStatus, ...result.campaignStatus };
      updateCampaignStatus(campaignStatus);
    } else if (result.activeCampaign) {
      campaignStatus = { ...campaignStatus, ...result.activeCampaign };
      updateCampaignStatus(campaignStatus);
    }
    
    if (result.campaignProgress) {
      updateProgressUI(result.campaignProgress);
    } else if (result.activeCampaign) {
      updateProgressUI(result.activeCampaign);
    }
    
    // Check WhatsApp connection (will be updated by setupConnectionMonitoring)
    // checkWhatsAppConnection(); // Can be removed if setupConnectionMonitoring handles initial check
    
    // Pause/Stop controls handled by floating UI; no buttons here

    // Begin polling for campaign updates
    if (campaignId) {
      startCampaignPolling(campaignId);
    }

    // Ensure download button is present from the start
    ensureDownloadResultsButton();
  } catch (error) {
    console.error('Error initializing campaign progress:', error);
    showError('Failed to initialize campaign. Please try again.');
  }
}

// Set up UI event listeners for header, footer, and back button
function setupUIEventListeners() {
  // Back button - navigate to the main popup
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      // Navigate to sender.html which is loaded into popup.html's content-area
      // This requires popup.html to be the main interface
      // For a standalone campaign-progress.html, this might need to go to popup.html first
      window.location.href = chrome.runtime.getURL('popup.html?feature=sender'); 
    });
  }

  // Open WhatsApp Web button
  const openWhatsAppBtn = document.getElementById('openWhatsAppBtn');
  if (openWhatsAppBtn) {
    openWhatsAppBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: WHATSAPP_URL });
    });
  }
  
  // Setup WhatsApp status section toggle
  const whatsappStatusEl = document.getElementById('whatsappStatus');
  if (whatsappStatusEl) {
    whatsappStatusEl.addEventListener('click', () => {
      whatsappStatusEl.classList.toggle('expanded');
    });
  }

  // Help link
  const helpLink = document.getElementById('helpLink');
  if (helpLink) {
    helpLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: HELP_URL });
    });
  }

  // Feedback link
  const feedbackLink = document.getElementById('feedbackLink');
  if (feedbackLink) {
    feedbackLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: FEEDBACK_URL });
    });
  }
  
  // DO NOT call setupConnectionMonitoring here again if initializeHeader calls it.
  // setupConnectionMonitoring(); 
  
  // Setup message listener for campaign-specific messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'campaignStatusUpdate') {
      updateCampaignStatus(message.status);
    } else if (message.action === 'campaignStopped') {
      showCampaignComplete(message);
    }
  });
}

// Handle messages from the background script
function handlePortMessage(message) {
  console.log("Campaign progress message:", message);
  
  try {
    if (message.action === "campaignUpdate") {
      if (message.status) {
        campaignStatus = { ...campaignStatus, ...message.status };
        updateCampaignStatus(campaignStatus);
      }
      if (message.progress) {
        updateProgressUI(message.progress);
      }
    } else if (message.action === "whatsappStatus") {
      updateWhatsAppStatus(message.connected);
    } else if (message.action === "campaignComplete") {
      showCampaignComplete(message);
    } else if (message.action === "campaignError") {
      showError(message.error);
      addErrorToList(message.error);
    } else if (message.action === "campaignPaused") {
      showCampaignPaused(message.reason);
    } else if (message.action === "campaignResumed") {
      showCampaignResumed();
    }
  } catch (error) {
    console.error('Error handling port message:', error);
    showError('Error processing campaign update');
  }
}

// Get campaign status directly when port connection fails
function getFallbackCampaignStatus() {
  chrome.runtime.sendMessage({ action: 'getCampaignStatus' })
    .then(response => {
      if (response && response.success && response.campaignStatus) {
        // Update with the latest status
        handleCampaignUpdate(response.campaignStatus);
        
        // Try to recreate port connection
        if (!campaignPort) {
          setupCampaignConnection();
        }
      }
    })
    .catch(err => {
      console.error('Error getting campaign status:', err);
    });
}

// Set up connection to background script
function setupCampaignConnection() {
  // Don't create multiple connections
  if (campaignPort) {
    try {
      // Test if port is still valid
      campaignPort.postMessage({ action: "ping" });
      return; // Port is working, no need to reconnect
    } catch (e) {
      console.log("Existing port is invalid, creating new connection");
      campaignPort = null;
    }
  }

  // Create messaging port with error handling
  try {
    campaignPort = chrome.runtime.connect({ name: "campaign-monitor-" + Date.now() });
    console.log("Campaign port connected:", campaignPort.name);
    
    // Listen for campaign updates
    campaignPort.onMessage.addListener(handlePortMessage);
    
    // Handle disconnection
    campaignPort.onDisconnect.addListener(() => {
      console.log("Port disconnected. Reconnecting in 5 seconds...");
      
      // Check for runtime error
      const reconnectDelay = chrome.runtime.lastError ? 5000 : 1000;
      if (chrome.runtime.lastError) {
        console.error("Connection to campaign lost:", chrome.runtime.lastError.message);
        toast("Connection to campaign lost. Attempting to reconnect...", "warning");
      }
      
      // Clear the port reference
      campaignPort = null;
      
      // Get status using direct message while we wait for reconnection
      getFallbackCampaignStatus();
      
      // Try to reconnect after a delay
      setTimeout(() => {
        if (!campaignPort) {
          console.log("Attempting to reconnect port...");
          setupCampaignConnection();
        }
      }, reconnectDelay);
    });
    
    // Register as a monitor for this campaign
    try {
      campaignPort.postMessage({
        action: "monitorCampaign",
        campaignId: campaignId
      });
      console.log("Monitoring request sent for campaign:", campaignId);
    } catch (error) {
      console.error("Error sending monitor request:", error);
      // Invalid port, retry connection
      campaignPort = null;
      
      // Use fallback while waiting for reconnection
      getFallbackCampaignStatus();
      
      setTimeout(() => setupCampaignConnection(), 2000);
    }
  } catch (connectionError) {
    console.error("Error creating port connection:", connectionError);
    toast("Error connecting to campaign monitor. Will use direct communication instead.", "warning");
    
    // Use fallback while waiting for reconnection
    getFallbackCampaignStatus();
    
    // Try to reconnect
    setTimeout(() => setupCampaignConnection(), 5000);
    
    // Set up interval to check status directly if port connection keeps failing
    setInterval(() => {
      if (!campaignPort) {
        getFallbackCampaignStatus();
      }
    }, 5000);
  }
}

// Update campaign status
function updateCampaignStatus(status) {
  try {
    if (!status) return;
    
    // Update campaign status
    campaignStatus = { ...campaignStatus, ...status };
    
    // Update UI elements
    if (contactCount) contactCount.textContent = status.totalContacts || 0;
    if (successCount) successCount.textContent = status.sentCount || 0;
    if (failureCount) failureCount.textContent = status.failedCount || 0;
    
    // Update progress bar
    const total = status.totalContacts || 0;
    let sent = status.sentCount || 0;
    let failed = status.failedCount || 0;
    let adjProcessed = sent + failed;
    let percentage = total ? Math.round((adjProcessed / total) * 100) : 0;
    
    // Force completion when on the last message or processing the last contact
    const isOnLastMessage = status.currentIndex >= total - 1;
    const isProcessingLastContact = currentOperation && currentOperation.textContent && 
                                   currentOperation.textContent.includes(`Sending message ${total} of ${total}`);
    
    if(status.status === 'completed' || isOnLastMessage || isProcessingLastContact){
      // Ensure final counts equal total
      adjProcessed = total;
      percentage = 100; // Explicitly set to 100% when completed
      status.status = 'completed'; // Force status to completed for UI
      if(sent + failed < total){
        sent = total - failed;
      }
      
      // Update operation text to reflect completion
      if(currentOperation) {
        currentOperation.textContent = 'Campaign completed';
      }
    }
    
    if (progressBar) {
      progressBar.style.width = `${percentage}%`;
      // Update state classes for animation
      progressBar.classList.toggle('paused-pulse', status.status === 'paused');
      progressBar.classList.toggle('completed', status.status === 'completed');
      if (status.status !== 'paused' && status.status !== 'completed') {
        progressBar.classList.remove('paused-pulse', 'completed');
      }
    }
    if (progressCount) progressCount.textContent = `${adjProcessed}/${total}`;
    if (progressPercentage) progressPercentage.textContent = `${percentage}%`;
    
    // Update current operation
    const nextNum = adjProcessed + 1;
    if (status.status === 'running') {
      currentOperation.textContent = `Sending message ${nextNum} of ${total}`;
    } else if (status.status === 'paused') {
      currentOperation.textContent = 'Campaign paused';
    } else if (status.status === 'completed') {
      currentOperation.textContent = 'Campaign completed';
    } else if (status.status === 'failed') {
      currentOperation.textContent = 'Campaign failed';
    }
    
    // Show errors if any
    if (status.errors && status.errors.length > 0) {
      showErrors(status.errors);
    }

    // --- Fallback: if we are stuck one short for over 15 s, mark as completed ---
    if(status.status==='running' && total>0 && adjProcessed===total-1){
      if(completionWatchTimer) clearTimeout(completionWatchTimer);
      completionWatchTimer = setTimeout(()=>{
        if(progressCount && progressCount.textContent===`${total-1}/${total}`){
          // Force UI to show completion
          if(progressBar) progressBar.style.width='100%';
          if(progressCount) progressCount.textContent=`${total}/${total}`;
          if(progressPercentage) progressPercentage.textContent='100%';
          if(successCount) successCount.textContent = sent+1;
          currentOperation.textContent='Campaign completed (awaiting final confirmation)';
        }
      },15000);
    } else {
      if(completionWatchTimer){ clearTimeout(completionWatchTimer); completionWatchTimer=null; }
    }

    // Ensure download button is present and up-to-date
    ensureDownloadResultsButton();

    // --- New completion inference ---
    const processedEqualTotal = total > 0 && adjProcessed >= total;
    const inferredCompleted = processedEqualTotal && status.status !== 'completed';
    if (inferredCompleted) {
      status.status = 'completed'; // mutate local copy for UI purposes
    }

    // Re-calculate counts when completed but sent count looks short (edge-case)
    if (status.status === 'completed' && (sent + failed) < total) {
      sent = total - failed; // assume remaining delivered successfully
      adjProcessed = total;
    }

    // --- reconcile counts ---
    let missing = total - (sent + failed);
    if(missing > 0){
      // assume missing treated as failed (invalid/blocked or skipped)
      failed += missing;
      adjProcessed += missing;
    }
  } catch (error) {
    console.error('Error updating campaign status:', error);
  }
}

// Update progress UI
function updateProgressUI(progress) {
  try {
    if (!progress) return;
    
    // Update progress bar
    const total = progress.totalContacts || 0;
    let sent = progress.sentCount || 0;
    let failed = progress.failedCount || 0;
    let processed = sent + failed;
    let percentage = total ? Math.round((processed / total) * 100) : 0;
    
    // Force completion when on the last message or processing the last contact
    const isOnLastMessage = progress.currentIndex >= total - 1;
    const isProcessingLastContact = currentOperation && currentOperation.textContent && 
                                   currentOperation.textContent.includes(`Sending message ${total} of ${total}`);
    
    if(progress.status === 'completed' || isOnLastMessage || isProcessingLastContact){
      processed = total;
      percentage = 100; // Explicitly set to 100% when completed
      progress.status = 'completed'; // Force status to completed for UI
      if(sent + failed < total){
        sent = total - failed;
      }
      
      // Update operation text to reflect completion
      if(currentOperation) {
        currentOperation.textContent = 'Campaign completed';
      }
    }
    
    if (progressBar) {
      progressBar.style.width = `${percentage}%`;
      progressBar.classList.toggle('paused-pulse', progress.status === 'paused');
      progressBar.classList.toggle('completed', progress.status === 'completed');
      if (progress.status !== 'paused' && progress.status !== 'completed') {
        progressBar.classList.remove('paused-pulse', 'completed');
      }
    }
    if (progressCount) progressCount.textContent = `${processed}/${total}`;
    if (progressPercentage) progressPercentage.textContent = `${percentage}%`;
    
    // Update stats
    if (successCount) successCount.textContent = sent;
    if (failureCount) failureCount.textContent = failed;
    
    // Update time estimates
    updateTimeEstimates(progress);

    // --- Completion inference identical to updateCampaignStatus ---
    const processedEqualTotal = total > 0 && processed >= total;
    const inferredCompleted = processedEqualTotal && progress.status !== 'completed';
    if (inferredCompleted) {
      progress.status = 'completed';
    }
    if (progress.status === 'completed' && (sent + failed) < total) {
      sent = total - failed;
      processed = total;
    }

    // --- reconcile counts ---
    let missing = total - (sent + failed);
    if(missing > 0){
      // assume missing treated as failed (invalid/blocked or skipped)
      failed += missing;
      processed += missing;
    }
  } catch (error) {
    console.error('Error updating progress UI:', error);
  }
}

// Update time estimates
function updateTimeEstimates(progress) {
  try {
    if (!progress) return;
    
    const total = progress.totalContacts || 0;
    const processed = (progress.sentCount||0) + (progress.failedCount||0);
    const sent = progress.sentCount || 0;
    const remaining = total - processed;
    const campaignCompleted = progress.status === 'completed' || processed >= total;
    
    // Get current elapsed time
    const elapsedTime = (Date.now() - startTime) / 1000;
    
    // If campaign is completed, show total time taken
    if (campaignCompleted) {
      if (averageTimeValue) {
        averageTimeValue.textContent = `${(elapsedTime / Math.max(1, sent)).toFixed(1)}s`;
      }
      
      if (timeRemainingValue) {
        // Show total time taken
        timeRemainingValue.textContent = formatTime(elapsedTime);
        
        // Update the label if it exists
        const timeRemainingLabel = timeRemainingValue.parentElement?.querySelector('.stat-label');
        if (timeRemainingLabel) {
          timeRemainingLabel.textContent = 'Total Campaign Time';
        }
        
        // Update the tooltip if it exists
        const timeTooltip = timeRemainingValue.parentElement?.querySelector('.time-tooltip');
        if (timeTooltip) {
          timeTooltip.textContent = 'Total time from start to completion';
        }
      }
      return;
    }
    
    if (sent > 0) {
      // Get batch settings from campaign configuration
      chrome.storage.local.get(['activeCampaign'], (result) => {
        const campaign = result.activeCampaign || {};
        const batchSettings = campaign.batchSettings || {};
        
        // Default values if no batch settings exist
        const batchSize = batchSettings.batchSize || 0;
        const batchDelay = batchSettings.batchDelay || 0;
        
        // Calculate average time per message
        let avgTime = elapsedTime / sent;
        let avgTimeDisplay = avgTime.toFixed(1);
        let estimatedTime = 0;
        
        if (batchSize > 0 && batchDelay > 0) {
          // Calculate completed batches
          const completedFullBatches = Math.floor(processed / batchSize);
          
          // Include batch delays in average calculation if we've had any
          if (completedFullBatches > 0) {
            // Calculate "pure" sending time (excluding batch delays)
            const totalBatchDelayTime = completedFullBatches * batchDelay;
            const pureSendingTime = Math.max(0, elapsedTime - totalBatchDelayTime);
            
            // Calculate two average times:
            // 1. Pure sending time per message (without batch delays)
            const pureSendingAvg = pureSendingTime / sent;
            
            // 2. Real-world time per message (including batch delay distribution)
            // This is what we'll display for better user understanding
            avgTime = elapsedTime / sent;
            avgTimeDisplay = avgTime.toFixed(1);
            
            // Calculate remaining full batches
            const remainingFullBatches = Math.floor(remaining / batchSize);
            // Calculate remaining messages in the last partial batch
            const remainingInLastBatch = remaining % batchSize;
            
            // Estimate time for remaining messages
            // Use pure sending time for message sending
            const messageSendingTime = remaining * pureSendingAvg;
            // Add batch delays for full batches
            const batchDelayTime = remainingFullBatches * batchDelay;
            
            // Total estimated time
            estimatedTime = messageSendingTime + batchDelayTime;
          } else {
            // No complete batches yet, use simple calculation
            estimatedTime = remaining * avgTime;
          }
        } else {
          // No batch settings, just use average time
          estimatedTime = remaining * avgTime;
        }
        
        // Update UI with calculated values
        if (averageTimeValue) {
          averageTimeValue.textContent = `${avgTimeDisplay}s`;
        }
        
        if (timeRemainingValue) {
          timeRemainingValue.textContent = formatTimeRemaining(estimatedTime);
          
          // Ensure label is correct for in-progress campaign
          const timeRemainingLabel = timeRemainingValue.parentElement?.querySelector('.stat-label');
          if (timeRemainingLabel && timeRemainingLabel.textContent !== 'Est. Time Left') {
            timeRemainingLabel.textContent = 'Est. Time Left';
          }
          
          // Update tooltip for in-progress campaign
          const timeTooltip = timeRemainingValue.parentElement?.querySelector('.time-tooltip');
          if (timeTooltip) {
            timeTooltip.textContent = 'Estimated based on current processing speed';
          }
        }
      });
    } else {
      // No messages sent yet, can't calculate
      if (averageTimeValue) {
        averageTimeValue.textContent = '0.0s';
      }
      if (timeRemainingValue) {
        timeRemainingValue.textContent = '--:--';
      }
    }
  } catch (error) {
    console.error('Error updating time estimates:', error);
    // Fallback to basic calculation
    if (timeRemainingValue && averageTimeValue) {
      const avgStr = averageTimeValue.textContent || '0s';
      const avgTime = parseFloat(avgStr) || 0;
      timeRemainingValue.textContent = formatTimeRemaining(remaining * avgTime);
    }
  }
}

/**
 * Check WhatsApp connection through port (used for campaign-specific connection handling)
 */
function checkWhatsAppConnectionThroughPort() {
  // Always use local storage as a fallback
  chrome.storage.local.get(['whatsAppConnectionStatus'], (result) => {
    if (result.whatsAppConnectionStatus !== undefined) {
      updateWhatsAppStatusIndicator(result.whatsAppConnectionStatus);
    }
  });
  
  // Then try port if available
  if (campaignPort) {
    try {
      campaignPort.postMessage({
        action: "checkWhatsAppConnection"
      });
    } catch (err) {
      console.error("Error checking connection through port:", err);
      // If port is broken, recreate it
      if (!campaignPort || err.message.includes('port closed')) {
        campaignPort = null;
        setTimeout(() => setupCampaignConnection(), 2000);
      }
    }
  } else {
    // If port is not available, use direct message
    chrome.runtime.sendMessage({ action: "checkWhatsAppConnection" })
      .then(response => {
        if (response && response.connected) {
          updateWhatsAppStatusIndicator(true);
        } else {
          updateWhatsAppStatusIndicator(false);
        }
      })
      .catch(err => {
        console.error("Error checking connection:", err);
        updateWhatsAppStatusIndicator(false, "Error checking WhatsApp status");
      });
  }
  
  // Check connection periodically
  setTimeout(() => {
    checkWhatsAppConnectionThroughPort();
  }, 10000); // Check every 10 seconds
}

// Show campaign paused
function showCampaignPaused(reason) {
  isPaused = true;
  currentOperation.innerHTML = `<p>Campaign paused${reason ? ': ' + reason : ''}</p>`;
  currentOperation.classList.remove('pulse');
}

// Show campaign resumed
function showCampaignResumed() {
  isPaused = false;
  currentOperation.classList.add('pulse');
}

// Show campaign complete
function showCampaignComplete(data) {
  currentOperation.innerHTML = '<p>Campaign completed</p>';
  currentOperation.classList.remove('pulse');
  
  const { success, failure, total } = data;
  
  // Calculate total campaign time
  const totalTime = (Date.now() - startTime) / 1000;
  const formattedTotalTime = formatTime(totalTime);
  
  // Update time remaining to show total time
  if (timeRemainingValue) {
    timeRemainingValue.textContent = formattedTotalTime;
    
    // Update the label
    const timeRemainingLabel = timeRemainingValue.parentElement?.querySelector('.stat-label');
    if (timeRemainingLabel) {
      timeRemainingLabel.textContent = 'Total Campaign Time';
    }
    
    // Update the tooltip
    const timeTooltip = timeRemainingValue.parentElement?.querySelector('.time-tooltip');
    if (timeTooltip) {
      timeTooltip.textContent = 'Total time from start to completion';
    }
  }
  
  toast(`Campaign completed: ${success} sent, ${failure} failed out of ${total} total`, "success");
  addDownloadResultsButton();
}

// Show campaign summary
function showCampaignSummary() {
  // This could be expanded to show a detailed summary view
  alert(`Campaign Summary:\n\nTotal contacts: ${campaignStatus.totalContacts}\nMessages sent: ${campaignStatus.success}\nFailed: ${campaignStatus.failure}\nCompletion: ${progressPercentage.textContent}`);
}

// Add campaign summary section
function addCampaignSummary(container) {
  const campaignSummary = document.createElement('div');
  campaignSummary.className = 'campaign-summary';
  campaignSummary.innerHTML = `
    <div class="campaign-details">
      <h2>Campaign Details</h2>
      <p>Sending messages to <span id="contactCount">0</span> contacts</p>
    </div>
  `;
  
  // Insert after header but before whatsapp status
  const whatsappStatus = document.getElementById('whatsappStatus');
  if (whatsappStatus) {
    container.insertBefore(campaignSummary, whatsappStatus);
  } else {
    container.appendChild(campaignSummary);
  }
}

// Show errors
function showErrors(errors) {
  if (!errors || errors.length === 0) {
    errorsSection.style.display = 'none';
    return;
  }
  
  errorsSection.style.display = 'block';
  errorList.innerHTML = '';
  
  errors.forEach(error => {
    addErrorToList(error);
  });
}

// Add error to list
function addErrorToList(error) {
  const errorItem = document.createElement('div');
  errorItem.className = 'error-item';
  errorItem.textContent = typeof error === 'string' ? error : JSON.stringify(error);
  errorList.appendChild(errorItem);
  
  // Auto-scroll to bottom
  errorList.scrollTop = errorList.scrollHeight;
  
  // Show errors section
  errorsSection.style.display = 'block';
}

// Show error
function showError(message) {
  toast(message, "error");
  addErrorToList(message);
}

// Show no campaign error
function showNoCampaignError() {
  toast("No active campaign found", "error");
  currentOperation.innerHTML = '<p>No active campaign found. Please start a new campaign.</p>';
  currentOperation.classList.remove('pulse');
}

// Create toast container if it doesn't exist
function initToastContainer() {
  if (!document.getElementById('toastContainer')) {
    const toastContainer = document.createElement('div');
    toastContainer.id = 'toastContainer';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
    console.log('Toast container created');
  }
}

// Format time (seconds to human readable)
function formatTime(seconds) {
  if (seconds === Infinity) return '∞';
  
  seconds = Math.max(0, seconds);
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  let result = [];
  if (hours > 0) result.push(hours + 'h');
  if (minutes > 0) result.push(minutes + 'm');
  result.push(secs + 's');
  
  return result.join(' ');
}

// Format remaining time
function formatTimeRemaining(seconds) {
  seconds = Math.max(0, seconds);
  
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  
  let result = [];
  if (minutes > 0) result.push(minutes + 'm');
  result.push(secs + 's');
    return result.join(' ');
}

// helper to create button once
function ensureDownloadResultsButton(){
  if(downloadBtn) return;
  const container=document.querySelector('.campaign-progress-container');
  if(!container) return;
  downloadBtn=document.createElement('button');
  downloadBtn.id='downloadResultsBtn';
  downloadBtn.className='btn btn-primary';
  downloadBtn.style.marginTop='14px';
  downloadBtn.innerHTML='<i class="ri-download-2-line"></i> Download Results';
  downloadBtn.addEventListener('click', handleDownloadResults);
  container.appendChild(downloadBtn);
}

async function handleDownloadResults(){
  try {
    // Load SheetJS if not already present
    await ensureLibraryLoaded('XLSX','libs/xlsx.full.min.js',8000);

    chrome.storage.local.get(['lastCampaignResults','activeCampaign'], (res)=>{
      let data=res.lastCampaignResults||{};
      // If campaign still running use activeCampaign arrays
      if((!data.successNumbers || data.successNumbers.length===0) && res.activeCampaign){
        data={
          successNumbers: res.activeCampaign.successNumbers||[],
          failedNumbers:  res.activeCampaign.failedNumbers||[],
          skippedNumbers: res.activeCampaign.skippedNumbers||[]
        };
      }
      const success=data.successNumbers||[];
      const failed =data.failedNumbers||[];
      const skipped=data.skippedNumbers||[];

      if(success.length===0 && failed.length===0 && skipped.length===0){
        toast('No results to export yet','warning');
        return;
      }

      const wb=XLSX.utils.book_new();
      const rows=[['Phone','Status']];
      success.forEach(p=>rows.push([p,'Success']));
      failed.forEach(p=>rows.push([p,'Failed']));
      skipped.forEach(p=>rows.push([p,'Skipped']));
      const ws=XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, 'Results');

      const ts=new Date().toISOString().replace(/[:T]/g,'-').split('.')[0];
      const filename=`campaign-results-${ts}.xlsx`;
      XLSX.writeFile(wb, filename);
    });
  } catch(err){
    console.error('Download results error',err);
    toast('Failed to generate XLSX: '+err.message,'error');
  }
}

// Initial setup
initCampaignProgress();
