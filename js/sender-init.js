// Only import what we need, nothing more
import { initializeTabs } from './tabs.js';
import { initSender, updateUIWithContactData } from './sender.js';

// Campaign status UI removed from sender page – related functions deleted.

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM content loaded, initializing sender page...');
  
  // Force toggles on
  const forceTogglesOn = () => {
    const delayToggle = document.getElementById('randomTimeGapToggle');
    const batchToggle = document.getElementById('splitBatchesToggle');
    if (delayToggle) {
      delayToggle.checked = true;
      if (window.chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ randomTimeGapEnabled: true });
      }
    }
    if (batchToggle) {
      batchToggle.checked = true;
      if (window.chrome && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ splitBatchesEnabled: true });
      }
    }
  };
  
  // Initialize tabs first, then sender module
  try {
    initializeTabs();
    forceTogglesOn();
    initSender();
    
    // Make sure Campaign Summary is updated with stored contact data
    // This ensures manual contacts show properly in the Summary
    // Use a longer timeout to ensure UI has been fully rendered
    setTimeout(() => {
      console.log('Updating Campaign Summary with stored contact data...');
      updateUIWithContactData();
      
      // Add a second update call with a longer delay to catch any race conditions
      setTimeout(() => {
        console.log('Performing final Campaign Summary update check...');
        
        // Check if totalContacts is still 0 - if so, try one more update
        const totalContacts = document.getElementById('totalContacts');
        if (totalContacts && totalContacts.textContent === '0') {
          console.log('Summary values still zero, performing final update...');
          updateUIWithContactData();
        }
      }, 1500);
    }, 800);
    
    console.log('Sender page initialization complete');
  } catch (error) {
    console.error('Error initializing sender:', error);
    // Show error toast
    const toast = document.createElement('div');
    toast.className = "toast toast-error";
    toast.textContent = "Failed to initialize sender: " + error.message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }
});