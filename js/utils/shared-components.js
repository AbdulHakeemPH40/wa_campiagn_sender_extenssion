// js/utils/shared-components.js - Shared UI components for the extension
// This file provides consistent header, footer, and navigation elements across pages

/**
 * Creates and inserts the standard header component
 * @param {HTMLElement} container - The container element to insert the header into
 * @param {string} title - The title to display in the header
 * @param {boolean} showConnectionStatus - Whether to show the connection status indicator
 */
export function createHeader(container, title, showConnectionStatus = true) {
  // Create header element
  const header = document.createElement('header');
  header.className = 'header';
  
  // Create logo section
  const logo = document.createElement('div');
  logo.className = 'logo';
  
  const logoIcon = document.createElement('div');
  logoIcon.className = 'logo-icon';
  
  const logoImg = document.createElement('img');
  logoImg.src = chrome.runtime.getURL('images/Logo.png');
  logoImg.alt = 'WA Campaign Sender Logo';
  
  const logoText = document.createElement('h1');
  logoText.className = 'logo-text';
  logoText.textContent = title || 'WA Campaign Sender';
  
  logoIcon.appendChild(logoImg);
  logo.appendChild(logoIcon);
  logo.appendChild(logoText);
  header.appendChild(logo);
  
  // Create connection status section if needed
  if (showConnectionStatus) {
    const connectionStatus = document.createElement('div');
    connectionStatus.className = 'connection-status';
    
    const statusIndicator = document.createElement('div');
    statusIndicator.className = 'status-indicator';
    statusIndicator.id = 'connectionIndicator';
    
    const statusText = document.createElement('span');
    statusText.id = 'connectionStatus';
    statusText.textContent = 'Checking...';
    
    connectionStatus.appendChild(statusIndicator);
    connectionStatus.appendChild(statusText);
    header.appendChild(connectionStatus);
    
    // Initialize connection status check
    setTimeout(() => checkWhatsAppConnection(), 1000);
  }
  
  // Insert the header at the beginning of the container
  if (container.firstChild) {
    container.insertBefore(header, container.firstChild);
  } else {
    container.appendChild(header);
  }
  
  return header;
}

/**
 * Creates a back button with proper styling and navigation
 * @param {HTMLElement} container - The container element to insert the button into
 * @param {string} destination - The destination URL to navigate to
 * @param {string} buttonText - The text to display on the button
 */
export function createBackButton(container, destination, buttonText = 'Back to Menu') {
  const backBtn = document.createElement('button');
  backBtn.id = 'backBtn';
  backBtn.className = 'back-btn';
  backBtn.innerHTML = `<i class="ri-arrow-left-line"></i> ${buttonText}`;
  
  backBtn.addEventListener('click', () => {
    // If destination is a function, call it instead of navigating
    if (typeof destination === 'function') {
      destination();
    } else {
      window.location.href = destination;
    }
  });
  
  // Insert the back button at the beginning of the container
  if (container.firstChild) {
    container.insertBefore(backBtn, container.firstChild);
  } else {
    container.appendChild(backBtn);
  }
  
  return backBtn;
}

/**
 * Creates a footer element with specified content
 * @param {HTMLElement} container - The container element to insert the footer into
 */
export function createFooter(container) {
  const footer = document.createElement('footer');
  footer.className = 'footer';
  
  const copyright = document.createElement('div');
  copyright.className = 'copyright';
  copyright.textContent = `© ${new Date().getFullYear()} WA Campaign Sender`;
  
  footer.appendChild(copyright);
  container.appendChild(footer);
  
  return footer;
}

/**
 * Checks WhatsApp connection status
 * Updates the connection indicator UI if it exists
 */
export function checkWhatsAppConnection() {
  const connectionIndicator = document.getElementById('connectionIndicator');
  const connectionStatus = document.getElementById('connectionStatus');
  
  if (!connectionIndicator || !connectionStatus) return;
  
  // Set to checking state first
  connectionIndicator.classList.remove('status-checking', 'status-connected', 'status-disconnected');
  connectionStatus.classList.remove('status-checking', 'status-connected', 'status-disconnected');
  connectionIndicator.classList.add('status-checking');
  connectionStatus.classList.add('status-checking');
  connectionStatus.textContent = 'Checking...';
  
  // First try to get status from storage
  chrome.storage.local.get(['whatsAppConnectionStatus'], (result) => {
    // Show cached status immediately for better UX
    if (result.whatsAppConnectionStatus !== undefined) {
      setConnectionStatus(result.whatsAppConnectionStatus);
    }
    
    // Then check actual status
    const checkPromise = new Promise((resolve) => {
      // First try direct message - cleaner approach than using ports
      chrome.runtime.sendMessage({ 
        action: "checkWhatsAppConnection" 
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.log("Error in connection check:", chrome.runtime.lastError.message);
          resolve({ connected: false, error: chrome.runtime.lastError.message });
        } else if (response) {
          resolve(response);
        } else {
          resolve({ connected: false, error: "No response" });
        }
      });
    });
    
    // Add a timeout
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ connected: false, error: "Timeout" });
      }, 3000);
    });
    
    // Race the connection check against timeout
    Promise.race([checkPromise, timeoutPromise])
      .then(response => {
        // If we got a valid response with connection state
        if (response && 'connected' in response) {
          setConnectionStatus(response.connected);
          chrome.storage.local.set({ whatsAppConnectionStatus: response.connected });
        } 
        // If error or no valid response, use last known state or default to false
        else {
          if (result.whatsAppConnectionStatus !== undefined) {
            // Keep using cached status if check failed
            setConnectionStatus(result.whatsAppConnectionStatus);
          } else {
            // Default to disconnected if no cached status and check failed
            setConnectionStatus(false);
            chrome.storage.local.set({ whatsAppConnectionStatus: false });
          }
        }
      })
      .catch(err => {
        console.error("Error in connection check:", err);
        
        // Use cached status on error
        if (result.whatsAppConnectionStatus !== undefined) {
          setConnectionStatus(result.whatsAppConnectionStatus);
        } else {
          setConnectionStatus(false);
        }
      });
  });
  
  // Queue next check
  setTimeout(() => {
    checkWhatsAppConnection();
  }, 10000);
}

/**
 * Updates the WhatsApp status indicator specific to campaign progress page
 * @param {boolean} isConnected - Whether WhatsApp is connected
 * @param {string} message - Optional status message to display
 */
export function updateWhatsAppStatusIndicator(isConnected, message) {
  const whatsappStatus = document.getElementById('whatsappStatus');
  if (!whatsappStatus) return;
  
  if (isConnected) {
    whatsappStatus.className = 'whatsapp-status connected';
    whatsappStatus.innerHTML = '<i class="ri-check-line"></i><span>' + (message || 'Connected to WhatsApp') + '</span>';
  } else {
    whatsappStatus.className = 'whatsapp-status disconnected';
    whatsappStatus.innerHTML = '<i class="ri-error-warning-line"></i><span>' + (message || 'Not connected to WhatsApp') + '</span>';
  }
}

/**
 * Updates the connection status indicators
 * @param {boolean} isConnected - Whether WhatsApp is connected
 * @param {string} statusText - Optional text to display
 */
export function setConnectionStatus(isConnected) {
  const connectionIndicator = document.getElementById('connectionIndicator');
  const connectionStatus = document.getElementById('connectionStatus');
  
  if (!connectionIndicator || !connectionStatus) return;
  
  // Remove all existing status classes
  connectionIndicator.classList.remove('status-checking', 'status-connected', 'status-disconnected');
  connectionStatus.classList.remove('status-checking', 'status-connected', 'status-disconnected');
  
  if (isConnected === true) {
    // Connected state
    connectionIndicator.classList.add('status-connected');
    connectionStatus.classList.add('status-connected');
    connectionStatus.textContent = 'Connected';
    
    // Also update the WhatsApp status indicator if it exists
    updateWhatsAppStatusIndicator(true);
  } else if (isConnected === false) {
    // Disconnected state
    connectionIndicator.classList.add('status-disconnected');
    connectionStatus.classList.add('status-disconnected');
    connectionStatus.textContent = 'Disconnected';
    
    // Also update the WhatsApp status indicator if it exists
    updateWhatsAppStatusIndicator(false);
  } else {
    // Checking state (when isConnected is null)
    connectionIndicator.classList.add('status-checking');
    connectionStatus.classList.add('status-checking');
    connectionStatus.textContent = 'Checking...';
  }
}

/**
 * Sets up periodic WhatsApp connection status monitoring.
 * This should be called once when the page loads.
 */
export function setupConnectionMonitoring() {
  // Do initial check
  checkWhatsAppConnection();
  
  // Set up listener for connection status changes
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'connectionStatusChanged') {
      // Store the connection status in local storage for future reference
      chrome.storage.local.set({ whatsAppConnectionStatus: message.status });
      setConnectionStatus(message.status);
    }
  });
}
