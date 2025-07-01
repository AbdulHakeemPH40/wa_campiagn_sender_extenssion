// js/sender.js
import { handleFile, parseFile, updateContactUI, downloadSampleCsv, MAX_MANUAL_CONTACTS } from './contactManager.js';
import { insertTextIntoEditor, validateVariables, htmlToWhatsAppMarkdown, whatsappMarkdownToHtml, initToolbar, findNearestMarkdownNode } from './messageComposer.js';
import { handleAttachment, renderAttachment } from './attachmentManager.js';
import { saveSettings, updateSummary, toggleSection, resetStuckCampaign } from './sendingControls.js';
import { toast } from './utils.js';
import { initializeTabs } from './tabs.js';
import { initializeSafetyMode } from './safetyMode.js';
import { showLicenseRequiredModal, showLicenseVerificationFailedModal } from './modals.js';
// Import the direct sender - we'll load this dynamically to ensure compatibility
let directSender = null;

// Store event listener references for cleanup
let eventListeners = new Map();

// Campaign state
let campaignPort = null;

// DOM elements cache
let messageEditor;
let contactsList;
let startCampaignBtn;
let cancelCampaignBtn;
let campaignStatusDiv;
let contactFilePicker;
let headerRow;
let variableMenu;
let savedMessageSelect;

// Campaign progress UI elements
let progressSection = document.getElementById('campaignProgress');
let progressBar = document.getElementById('progressBar');
let progressPercentage = document.getElementById('progressPercentage');
let progressCount = document.getElementById('progressCount');
let sendingStatus = document.getElementById('sendingStatus');
let campaignStats = document.getElementById('campaignStats');
let campaignErrors = document.getElementById('campaignErrors');

// Add event listener with cleanup tracking
function addEventListenerWithCleanup(element, eventType, handler) {
  if (!element) return;
  
  // Remove any existing handler for this element/event
  const existingListeners = eventListeners.get(element);
  if (existingListeners) {
    const existingHandler = existingListeners.get(eventType);
    if (existingHandler) {
      element.removeEventListener(eventType, existingHandler);
    }
  }
  
  // Add the new handler
  element.addEventListener(eventType, handler);
  
  // Track for cleanup
  if (!eventListeners.has(element)) {
    eventListeners.set(element, new Map());
  }
  eventListeners.get(element).set(eventType, handler);
}

// Cleanup all tracked event listeners
function cleanupEventListeners() {
  eventListeners.forEach((listeners, element) => {
    listeners.forEach((handler, eventType) => {
      element.removeEventListener(eventType, handler);
    });
  });
  eventListeners.clear();
}

// Helper function for phone number validation - moved outside initSender for global access
function validatePhoneInput(input) {
  const phoneInput = (input || '').trim();
  if (!phoneInput) return false;

  // Normalise by converting any leading 00 to +
  let normalised = phoneInput.startsWith('00') ? ('+' + phoneInput.slice(2)) : phoneInput;

  const e164Regex = /^\+[1-9]\d{7,14}$/;     // + followed by 8–15 digits
  const digitsOnlyRegex = /^[1-9]\d{7,14}$/; // 8–15 digits without plus

  return e164Regex.test(normalised) || digitsOnlyRegex.test(normalised);
}

function updateInputFieldsBasedOnToggles(randomTimeGapToggle, splitBatchesToggle, inputs) {
  const { randomTimeGapMax, batchSize, delayBetweenBatches } = inputs;
  
  if (randomTimeGapMax && randomTimeGapToggle) {
    randomTimeGapMax.disabled = !randomTimeGapToggle.checked;
    if (randomTimeGapToggle.checked) {
      randomTimeGapMax.classList.remove('disabled');
    } else {
      randomTimeGapMax.classList.add('disabled');
    }
  }
  
  if (batchSize && splitBatchesToggle) {
    batchSize.disabled = !splitBatchesToggle.checked;
    if (splitBatchesToggle.checked) {
      batchSize.classList.remove('disabled');
    } else {
      batchSize.classList.add('disabled');
    }
  }
  
  if (delayBetweenBatches && splitBatchesToggle) {
    delayBetweenBatches.disabled = !splitBatchesToggle.checked;
    if (splitBatchesToggle.checked) {
      delayBetweenBatches.classList.remove('disabled');
    } else {
      delayBetweenBatches.classList.add('disabled');
    }
  }
  
  console.log('Input fields updated based on toggle states:', {
    randomTimeGapEnabled: randomTimeGapToggle?.checked,
    splitBatchesEnabled: splitBatchesToggle?.checked
  });
}

// Handle conflicts between manual numbers and CSV uploads
function handleContactSourceConflict(currentSource, newSource, callback) {
  const conflictDiv = document.getElementById('contactSourceConflict');
  const messageDiv = conflictDiv.querySelector('.conflict-message');
  const switchBtn = conflictDiv.querySelector('.conflict-action-switch');
  const cancelBtn = conflictDiv.querySelector('.conflict-action-cancel');
  
  // Set appropriate message based on conflict type
  if (currentSource === 'manual' && newSource === 'file') {
    messageDiv.innerHTML = '<strong>Contact source conflict:</strong> You already have manually entered numbers. Uploading a CSV file will replace these numbers. What would you like to do?';
    switchBtn.textContent = 'Upload CSV (remove manual numbers)';
    cancelBtn.textContent = 'Keep manual numbers';
  } else if (currentSource === 'file' && newSource === 'manual') {
    messageDiv.innerHTML = '<strong>Contact source conflict:</strong> You already have a contact file loaded. Adding manual numbers will remove this file. What would you like to do?';
    switchBtn.textContent = 'Use manual numbers (remove CSV)';
    cancelBtn.textContent = 'Keep CSV file';
  }
  
  // Show the conflict notification
  conflictDiv.style.display = 'block';
  
  // Add event listeners for action buttons
  function handleSwitch() {
    // User wants to switch to the new method
    conflictDiv.style.display = 'none';
    
    // Remove event listeners to prevent memory leaks
    switchBtn.removeEventListener('click', handleSwitch);
    cancelBtn.removeEventListener('click', handleCancel);
    
    // Call the callback with true to indicate switch
    callback(true);
  }
  
  function handleCancel() {
    // User wants to cancel the operation
    conflictDiv.style.display = 'none';
    
    // Remove event listeners to prevent memory leaks
    switchBtn.removeEventListener('click', handleSwitch);
    cancelBtn.removeEventListener('click', handleCancel);
    
    // Call the callback with false to indicate cancel
    callback(false);
  }
  
  // Add click handlers
  switchBtn.addEventListener('click', handleSwitch);
  cancelBtn.addEventListener('click', handleCancel);
}

// Check if there's a conflict between contact sources
function checkContactSourceConflict(currentInputSource, newInputSource, callback) {
  // If both sources are the same or one is 'none', no conflict
  if (currentInputSource === newInputSource || 
      currentInputSource === 'none' || 
      newInputSource === 'none') {
    callback(true); // Changed from false to true to allow the action to proceed
    return;
  }
  
  // Get the current state of contacts
  chrome.storage.local.get(['parsedData', 'manualNumbers', 'contactFile'], (result) => {
    let hasConflict = false;
    
    // Check for manual -> file conflict
    if (currentInputSource === 'manual' && newInputSource === 'file') {
      // Only consider it a conflict if there are actual manual numbers entered
      hasConflict = result.manualNumbers && result.manualNumbers.trim() !== '';
    } 
    // Check for file -> manual conflict
    else if (currentInputSource === 'file' && newSource === 'manual') {
      hasConflict = !!result.contactFile;
    }
    
    if (hasConflict) {
      handleContactSourceConflict(currentInputSource, newInputSource, callback);
    } else {
      // Changed from false to true to allow the action to proceed when no conflict
      callback(true);
    }
  });
}

// Clear contact data for the specified source
function clearContactSource(source) {
  return new Promise((resolve) => {
    if (source === 'manual') {
      // Clear manual numbers
      const numbersArea = document.getElementById('numbersArea');
      if (numbersArea) numbersArea.value = '';
      
      // Remove from storage
      chrome.storage.local.remove(['manualNumbers'], () => {
        console.log('Manual numbers cleared due to source switch');
        resolve();
      });
    } else if (source === 'file') {
      // Clear file display
      const fileNameSpan = document.getElementById('fileName');
      const fileDisplay = document.getElementById('fileDisplay');
      const fileInput = document.getElementById('importContactsInput');
      
      if (fileNameSpan) fileNameSpan.textContent = '';
      if (fileDisplay) fileDisplay.style.display = 'none';
      if (fileInput) fileInput.value = '';
      
      // Remove from storage - important to remove ALL file-related data
      chrome.storage.local.remove(['contactFile', 'contactFileBase64'], () => {
        console.log('Contact file cleared due to source switch');
        resolve();
      });
    }
    
    // Always clear parsed data when switching sources to avoid conflicts
    chrome.storage.local.remove(['parsedData'], () => {
      console.log('Parsed data cleared due to source switch');
    });
  });
}

export function initSender(currentSource, newSource, callback) {
  console.log('Initializing sender module');
  
  // Clean up any existing event listeners first
  cleanupEventListeners();

  const $ = id => document.getElementById(id);
  
  // Get DOM elements
  const dropArea = $("dropArea");
  const fileInput = $("importContactsInput");
  const fileDisplay = $("fileDisplay");
  const fileNameSpan = $("fileName");
  const removeFileIcon = $("removeFile");
  const sampleDownloadBtn = $("sampleDownloadBtn");
  const numbersArea = $("numbersArea");
  const numbersTab = $("numbersTab");
  const uploadTab = $("uploadTab");
  const numberTabBtn = document.querySelector('.tab-btn[data-target="numbersTab"]');
  const uploadTabBtn = document.querySelector('.tab-btn[data-target="uploadTab"]');
  const editor = $("editor");
  const toolbar = $("toolbar");
  const variableToggle = $("variableToggle");
  const variableMenu = $("variableMenu");
  const insertNameVariable = $("insertNameVariable");
  const variableError = $("variableError");
  const imageInput = $("imageInput");
  const videoInput = $("videoInput");
  const pdfInput = $("pdfInput");
  const attachmentPreview = $("attachmentPreview");
  const attachmentError = $("attachmentError");
  const attachmentModal = $("attachmentModal");
  const modalContent = $("modalContent");
  const modalClose = $("modalClose");
  const batchSizeInput = $("batchSize");
  const batchSizeMaxInput = $("batchSizeMax");
  const delayBetweenBatchesInput = $("delayBetweenBatches");
  const delayBetweenBatchesMaxInput = $("delayBetweenBatchesMax");
  const randomTimeGapMinInput = $("randomTimeGapMin");
  const randomTimeGapMaxInput = $("randomTimeGapMax");
  const randomTimeGapToggle = $("randomTimeGapToggle");
  const splitBatchesToggle = $("splitBatchesToggle");
  const batchSettings = $("batchSettings");
  const skipInvalidNumbersToggle = $("skipInvalidNumbers");
  const startCampaignBtn = $("startCampaignBtn");
  const totalContacts = $("totalContacts");
  const selectedContacts = $("selectedContacts");
  const estDuration = $("estDuration");
  const batchesLabel = $("batches");
  const randomTimeGapSection = $("randomTimeGapSection");
  const resetCampaignBtn = $("resetCampaignBtn");
  const turboModeToggle = $("turboModeToggle");
  const safetyModeToggle = $("safetyModeToggle");
  const safetyModeWarning = $("safetyModeWarning");
  const testSafetyBtn = $("testSafetyBtn");

  // Initialize Safety Mode functionality
  initializeSafetyMode();

  // --- Reset Stuck Campaign Button ---
  if (resetCampaignBtn) {
    addEventListenerWithCleanup(resetCampaignBtn, 'click', resetStuckCampaign);
  }
  
  // Test Safety Button removed - test code eliminated

  // Track data state
  let uploadedFile = null;
  let parsedData = [];
  let attachment = null;
  let currentFileUrl = null;
  let isVariableMenuOpen = false;
  let activeInputSource = 'none';
  let hasEditorInteraction = false;
  let lastInsertedVariable = null;

  // Initialize tabs
  initializeTabs();
  
  // Initialize Contact Management section
  const contactManagementSection = $("contactManagement");
  const contactManagementHeader = contactManagementSection?.querySelector('.section-header');
  if (contactManagementHeader) {
    addEventListenerWithCleanup(contactManagementHeader, "click", (e) => {
      e.stopPropagation();
      toggleSection("contactManagement");
    });
  }
  
  // Initialize Message Composer section
  const messageComposerSection = $("messageComposer");
  const messageComposerHeader = messageComposerSection?.querySelector('.section-header');
  if (messageComposerHeader) {
    addEventListenerWithCleanup(messageComposerHeader, "click", (e) => {
      e.stopPropagation();
      toggleSection("messageComposer");
    });
  }
  
  // Initialize Sending Controls section
  const sendingControlsSection = $("sendingControls");
  const sendingControlsHeader = sendingControlsSection?.querySelector('.section-header');
  if (sendingControlsHeader) {
    addEventListenerWithCleanup(sendingControlsHeader, "click", (e) => {
      e.stopPropagation();
      toggleSection("sendingControls");
    });
  }
  
  // Initialize toolbar and editor
  if (editor && toolbar) {
    // Initialize toolbar with editor
    initToolbar(editor, toolbar);
    
    // Make editor contenteditable
    editor.setAttribute("contenteditable", "true");
    console.log("Editor initialized with contenteditable=true");
    
    // Load saved content using the messageComposer.js loadEditorContent function
    // This prevents double restoration of content when extension is reopened
    if (typeof loadEditorContent === 'function') {
      loadEditorContent(editor);
      console.log('Loading editor content via messageComposer.js loadEditorContent');
    } else {
      // Fallback in case loadEditorContent is not available
      import('./messageComposer.js').then(module => {
        if (module.loadEditorContent) {
          module.loadEditorContent(editor);
          console.log('Loading editor content via dynamic import');
        }
      }).catch(err => console.error('Failed to import messageComposer.js:', err));
    }
    
    // Save content on input
    addEventListenerWithCleanup(editor, 'input', () => {
      const htmlContent = editor.innerHTML;
      const markdownContent = htmlToWhatsAppMarkdown(htmlContent);
      chrome.storage.local.set({ 
        composerMessageContent: htmlContent,
        editorContent: markdownContent
      });
    });
    
    // Track editor interactions
    addEventListenerWithCleanup(editor, "keydown", () => {
      hasEditorInteraction = true;
    });
    
    addEventListenerWithCleanup(editor, "click", () => {
      hasEditorInteraction = true;
    });
  } else {
    console.error("Editor or toolbar element not found");
  }
  
  // Set up variable menu toggle
  if (variableToggle && variableMenu) {
    // Initialize variable menu
    updateVariableMenu([]);
    
    // Toggle variable menu
    addEventListenerWithCleanup(variableToggle, "click", (e) => {
      e.stopPropagation();
      
      // Get latest parsed data
      chrome.storage.local.get(["parsedData"], (result) => {
        if (result.parsedData && result.parsedData.length > 0) {
          parsedData = result.parsedData;
          updateVariableMenu(parsedData);
        }
        
        // Toggle menu
        isVariableMenuOpen = !isVariableMenuOpen;
        variableMenu.style.display = isVariableMenuOpen ? "block" : "none";
      });
    });
    
    // Close menu when clicking outside
    addEventListenerWithCleanup(document, "click", (e) => {
      if (isVariableMenuOpen && !variableToggle.contains(e.target) && !variableMenu.contains(e.target)) {
        isVariableMenuOpen = false;
        variableMenu.style.display = "none";
      }
    });
  }
  
  // Contact Management - Drag and Drop
  if (dropArea) {
    addEventListenerWithCleanup(dropArea, "dragover", (e) => {
      e.preventDefault();
      dropArea.classList.add("dragover");
    });
    
    addEventListenerWithCleanup(dropArea, "dragleave", () => {
      dropArea.classList.remove("dragover");
    });
    
    addEventListenerWithCleanup(dropArea, "drop", (e) => {
      e.preventDefault();
      dropArea.classList.remove("dragover");
      
      // Warn if there are existing manual numbers
      if (activeInputSource === 'manual' && numbersArea && numbersArea.value.trim() !== '') {
        if (!confirm("You currently have manually entered phone numbers. Uploading a file will replace these numbers. Would you like to continue with the file upload?")) {
          return;
        }
        numbersArea.value = '';
      }
      
      // Process the dropped file
      uploadedFile = e.dataTransfer.files[0];
      activeInputSource = 'file';
      handleFile(uploadedFile, toast, 
        (contactFile) => updateContactUI(contactFile, fileNameSpan, fileDisplay, fileInput), 
        async (file, toastFn) => {
          const data = await parseFile(file, toastFn);
          updateVariableMenu(data);
          return data;
        });
    });
  }
  
  // File input change handler - when a file is selected
  if (fileInput) {
    addEventListenerWithCleanup(fileInput, "change", (e) => {
      // Prevent processing if no file selected
      if (!e.target.files || !e.target.files[0]) {
        return;
      }
      
      // Check for conflicts with manual numbers
      checkContactSourceConflict('manual', 'file', (shouldSwitch) => {
        if (!shouldSwitch) {
          // User canceled, clear the file input and return
          e.target.value = '';
          
          // Check if there are actually any manual numbers before showing this message
          const numbersArea = document.getElementById('numbersArea');
          if (numbersArea && numbersArea.value.trim()) {
            toast("CSV import canceled. Your manual numbers are kept.", "info");
          } else {
            toast("CSV import canceled.", "info");
          }
          return;
        }
        
        // User confirmed switch, clear manual numbers first
        clearContactSource('manual').then(() => {
          // Now proceed with file upload
          uploadedFile = e.target.files[0];
          activeInputSource = 'file';
          
          // Store that we're using file as source
          chrome.storage.local.set({ activeInputSource: 'file' });
          
          // Only show this notification if there were actual manual numbers to clear
          const numbersArea = document.getElementById('numbersArea');
          if (numbersArea && numbersArea.value.trim()) {
            toast("Manual numbers have been cleared to use CSV file instead", "warning");
          } else {
            toast("CSV file uploaded successfully", "success");
          }
          
          handleFile(uploadedFile, toast, 
            (contactFile) => {
              updateContactUI(contactFile, fileNameSpan, fileDisplay, fileInput);
              // Switch to the upload tab to show the uploaded file
              if (uploadTabBtn) uploadTabBtn.click();
            }, 
            async (file, toastFn) => {
              const data = await parseFile(file, toastFn);
              updateVariableMenu(data);
              // Make sure the campaign summary is updated with the file data
              updateSummary(data, 
                { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput }, 
                { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle }, 
                { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
              );
              return data;
            });
        });
      });
    });
  }
  
  // File display and manipulation
  if (fileNameSpan) {
    addEventListenerWithCleanup(fileNameSpan, "click", () => {
      // Get contact file directly from storage instead of relying on uploadedFile variable
      chrome.storage.local.get(["contactFile", "parsedData"], (result) => {
        if (result.contactFile && result.parsedData && result.parsedData.length > 0) {
          // Add debugging
          console.log("Opening contact preview for:", result.contactFile.name);
          
          // Show toast to indicate loading
          toast("Loading contact preview...", "info");
          
          // Load contactManager and show preview
          import('./contactManager.js')
            .then(module => {
              try {
                module.showContactFilePreview(result.contactFile);
              } catch (err) {
                console.error("Error in showContactFilePreview:", err);
                toast("Error displaying contact preview", "error");
              }
            })
            .catch(err => {
              console.error("Error importing contactManager module:", err);
              toast("Failed to show contact preview", "error");
            });
        } else {
          toast("No contact data available for preview", "error");
          console.warn("Missing contact data for preview:", { 
            hasContactFile: !!result.contactFile, 
            hasParsedData: !!(result.parsedData && result.parsedData.length > 0) 
          });
        }
      });
    });
    
    // Make the filename span look clickable
    if (fileNameSpan.style) {
      fileNameSpan.style.cursor = 'pointer';
      fileNameSpan.style.textDecoration = 'underline';
      fileNameSpan.title = 'Click to preview contacts';
    }
  }
  
  // Remove file button
  if (removeFileIcon) {
    addEventListenerWithCleanup(removeFileIcon, "click", () => {
      console.log("Remove file icon clicked");
      // Clear the uploads from storage immediately
      chrome.storage.local.remove(["contactFile", "contactFileBase64", "parsedData"], () => {
        if (chrome.runtime.lastError) {
          console.error("Error removing file from storage:", chrome.runtime.lastError);
          toast("Failed to remove contact file", "error");
          return;
        }
        
        // Reset UI elements
        if (fileNameSpan) fileNameSpan.textContent = "";
        if (fileDisplay) fileDisplay.style.display = "none";
        if (fileInput) fileInput.value = "";
        
        // Reset variables
        uploadedFile = null;
        parsedData = [];
        activeInputSource = 'none';
        
        // Update UI components
        updateSummary(
          [],
          { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
          { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle },
          { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
        );
        
        console.log("Contact file removed successfully");
        toast("Contact file removed. You can now upload a new file", "success");
        validateVariables(editor, [], variableError);
      });
    });
    
    // Make sure it's visible and styled as clickable
    removeFileIcon.style.cursor = "pointer";
    removeFileIcon.title = "Remove contact file";
  }
  
  // Sample download button
  if (sampleDownloadBtn) {
    addEventListenerWithCleanup(sampleDownloadBtn, "click", () => downloadSampleCsv(toast));
  }
  
  // Handle manual number input
  if (numbersArea) {
    // Debounce function for input handling
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }
    
    // Intercept paste event BEFORE it happens to prevent excessive contacts
    numbersArea.addEventListener('paste', (pasteEvent) => {
      console.log('[PASTE INTERCEPT] Intercepting paste event...');
      
      // Get clipboard data
      const clipboardData = pasteEvent.clipboardData || window.clipboardData;
      const pastedText = clipboardData.getData('text');
      
      // Count potential contacts by splitting and filtering empty lines
      const pastedNumbers = pastedText.split(/[\n,]/)
        .map(num => num.trim())
        .filter(num => num !== '');
      
      console.log('[PASTE INTERCEPT] Clipboard contains', pastedNumbers.length, 'potential numbers');
      
      // Check against maximum allowed
      if (pastedNumbers.length > MAX_MANUAL_CONTACTS) {
        // IMPORTANT: First cancel the default paste behavior
        pasteEvent.preventDefault();
        pasteEvent.stopPropagation();
        console.log('[PASTE INTERCEPT] Preventing paste of', pastedNumbers.length, 'contacts (exceeds limit of', MAX_MANUAL_CONTACTS, ')');
        
        // Now forcefully clear the textarea in multiple ways to ensure it works
        try {
          // Method 1: Direct value assignment
          document.getElementById('numbersArea').value = '';
          
          // Method 2: Selection API
          numbersArea.select();
          document.execCommand('delete');
          
          // Method 3: Use setTimeout to ensure it happens after event processing
          setTimeout(() => {
            document.getElementById('numbersArea').value = '';
            console.log('[PASTE INTERCEPT] Cleared textarea (delayed)');
          }, 50);
          
          console.log('[PASTE INTERCEPT] Cleared existing text in the textarea');
        } catch (e) {
          console.error('[PASTE INTERCEPT] Error clearing textarea:', e);
        }
        
        // Show error toast
        toast(`Cannot paste ${pastedNumbers.length} contacts. Maximum allowed is ${MAX_MANUAL_CONTACTS}. Please reduce the list size.`, "error", 7000);
        
        // Also clear any stored manual numbers data
        chrome.storage.local.remove(["parsedData", "manualNumbers", "activeInputSource"], () => {
          console.log('[PASTE INTERCEPT] Cleared stored manual numbers data');
        });
        
        // Update campaign summary to show zero contacts
        updateSummary(
          [], 
          { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput }, 
          { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle }, 
          { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
        );
        
        // Force the UI to update by dispatching an event
        document.dispatchEvent(new CustomEvent('contactDataUpdated', {
          detail: { parsedData: [] }
        }));
        
        // Vibrate the input field to provide feedback (if supported)
        if (navigator.vibrate) {
          navigator.vibrate(100);
        }
        
        // Apply a visual indicator by briefly adding an error class
        numbersArea.classList.add('paste-error');
        setTimeout(() => {
          numbersArea.classList.remove('paste-error');
        }, 500);
        
        return false;
      }
      
      console.log('[PASTE INTERCEPT] Allowing paste of', pastedNumbers.length, 'contacts (within limit)');
      // Let the default paste happen since it's within limits
    });
    
    // Process manual numbers with conflict handling
    const debouncedProcessNumbers = debounce((e) => {
      // If the textarea is empty, simply clear any parsed data and return
      if (!e.target.value.trim()) {
        parsedData = [];
        chrome.storage.local.remove(["parsedData", "manualNumbers", "activeInputSource"], () => {
          console.log("Cleared manual numbers from storage as textarea is empty");
          // Update campaign summary with empty data
          updateSummary(
            parsedData, 
            { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput }, 
            { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle }, 
            { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
          );
          validateVariables(editor, parsedData, variableError);
          
          // Force reset the campaign summary to show zeros
          if (totalContacts) totalContacts.textContent = "0";
          if (selectedContacts) selectedContacts.textContent = "0";
          if (estDuration) estDuration.textContent = "0h 0m";
          if (batches) batchesLabel.textContent = "0";
          
          // Clear variable menu since we're using manual entry
          updateVariableMenu([]);
          
          // Show toast notification for clearing contacts
          toast("All manual contacts have been cleared", "info");
        });
        return;
      }

      // Check for conflicts with file upload
      checkContactSourceConflict('file', 'manual', (shouldSwitch) => {
        if (!shouldSwitch) {
          // User canceled, clear the textarea and return
          e.target.value = '';
          toast("Manual entry canceled. Your uploaded file is kept.", "info");
          
          // Switch to the upload tab to show the file is still active
          if (uploadTabBtn) uploadTabBtn.click();
          return;
        }
        
        // User confirmed switch to manual entry, clear file data first
        clearContactSource('file').then(() => {
          // Now process manual numbers
          activeInputSource = 'manual';
          chrome.storage.local.set({ activeInputSource: 'manual' });
          
          // Show a notification that file has been cleared
          toast("Contact file has been removed to use manual numbers instead", "warning");

          // === Check contact limit BEFORE importing and processing ===
          console.log('[DEBUG] Inside debouncedProcessNumbers. MAX_MANUAL_CONTACTS:', MAX_MANUAL_CONTACTS);
          const currentRawText = numbersArea.value; // or e.target.value
          console.log('[DEBUG] currentRawText:', currentRawText.substring(0, 100) + '...'); // Log first 100 chars
          
          const rawPotentialNumbers = currentRawText.split(/[\n,]/)
            .map(num => num.trim())
            .filter(num => num !== '');
          console.log('[DEBUG] rawPotentialNumbers.length:', rawPotentialNumbers.length);

          if (rawPotentialNumbers.length > MAX_MANUAL_CONTACTS) {
            console.log('[DEBUG] Limit EXCEEDED. Clearing textarea and returning.');
            toast(`Maximum ${MAX_MANUAL_CONTACTS} manual contacts allowed. You entered ${rawPotentialNumbers.length}. Please reduce the list.`, "error", 5000);
            numbersArea.value = ''; // Clear the textarea
            // Potentially update summary to show 0 contacts if needed here
            updateSummary(
              [], 
              { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput }, 
              { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle }, 
              { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
            );
            return; // Stop further processing
          } else {
            console.log('[DEBUG] Limit NOT exceeded. Proceeding to import contactManager.');
          }
          // === End contact limit check ===
          
          // Parse manual numbers (returns Promise<string[]>) – import helper on demand to avoid scope issues
          import('./contactManager.js').then(module => {
            // Use the parseManualNumbers function which returns a Promise
            module.parseManualNumbers(numbersArea.value, toast)
              .then(newParsedData => {
                // Update local data
                parsedData = newParsedData;
                
                // Make sure to immediately update the campaign summary with the new data
                updateSummary(
                  parsedData, 
                  { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput }, 
                  { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle }, 
                  { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
                );
                
                // Add animation to make change noticeable
                if (totalContacts) totalContacts.classList.add('reset-animation');
                setTimeout(() => {
                  if (totalContacts) totalContacts.classList.remove('reset-animation');
                }, 1000);
                
                validateVariables(editor, parsedData, variableError);
                
                // Clear variable menu since we're using manual entry
                updateVariableMenu([]);
                
                // Analyze the numbers
                const analysisResult = analyzePhoneNumbers(numbersArea.value);
                
                // Force an explicit event dispatch to update any listeners
                document.dispatchEvent(new CustomEvent('contactDataUpdated', { 
                  detail: { parsedData: newParsedData }
                }));

                console.log("Manual numbers processed:", parsedData.length, "contacts");
              })
              .catch(error => {
                console.error("Error processing manual numbers:", error);
                toast("Failed to process phone numbers: " + error.message, "error");
              });
          }).catch(err => {
            console.error("Error importing contactManager module:", err);
            toast("Failed to process phone numbers", "error");
          });
        });
      });
    }, 800);
    
    // Add event listeners
    addEventListenerWithCleanup(numbersArea, "input", debouncedProcessNumbers);
    
    // Check for conflict on blur immediately - this ensures conflict message shows as soon as focus leaves textarea
    addEventListenerWithCleanup(numbersArea, "blur", () => {
      if (numbersArea.value.trim() !== '') {
        // Check current input source before saving
        chrome.storage.local.get(['activeInputSource', 'contactFile'], (result) => {
          if (result.activeInputSource === 'file' && result.contactFile) {
            // There's a file loaded and user is trying to enter manual numbers - show conflict
            checkContactSourceConflict('file', 'manual', (shouldSwitch) => {
              if (shouldSwitch) {
                // User chose to switch to manual - process the manual numbers
                clearContactSource('file').then(() => {
                  // Now save the manual numbers
                  chrome.storage.local.set({ 
                    manualNumbers: numbersArea.value,
                    activeInputSource: 'manual'
                  }, () => {
                    console.log("Manual numbers saved on blur after conflict resolution");
                    
                    // Parse the manual numbers to update the UI
                    import('./contactManager.js').then(module => {
                      module.parseManualNumbers(numbersArea.value, toast)
                        .then(() => {
                          // Clear variable menu since we're using manual entry
                          updateVariableMenu([]);
                        });
                    });
                  });
                });
              } else {
                // User chose to keep the file - clear the textarea
                numbersArea.value = '';
                toast("Manual entry canceled. Your uploaded file is kept.", "info");
                
                // Switch to the upload tab to show the file is still active
                if (uploadTabBtn) uploadTabBtn.click();
              }
            });
          } else {
            // No conflict, just save manual numbers
            chrome.storage.local.set({ 
              manualNumbers: numbersArea.value,
              activeInputSource: 'manual'
            }, () => {
              console.log("Manual numbers saved on blur:", numbersArea.value.split(/[\n,]/).filter(n => n.trim()).length, "numbers");
              // Parse the manual numbers to update the UI
              import('./contactManager.js').then(module => {
                module.parseManualNumbers(numbersArea.value, toast)
                  .then(() => {
                    // Clear variable menu since we're using manual entry
                    updateVariableMenu([]);
                  });
              });
              
              // Clear variable menu since we're using manual entry
              updateVariableMenu([]);
            });
          }
        });
      }
    });

    // Also check for conflict when the tab is clicked
    if (numberTabBtn) {
      addEventListenerWithCleanup(numberTabBtn, "click", () => {
        chrome.storage.local.get(['activeInputSource', 'contactFile', 'manualNumbers'], (result) => {
          // If we have a file loaded and there are already manual numbers, show the conflict
          if (result.activeInputSource === 'file' && result.contactFile && 
              result.manualNumbers && result.manualNumbers.trim() !== '') {
            
            // Show conflict message if switching to manually entered numbers that already exist
            checkContactSourceConflict('file', 'manual', (shouldSwitch) => {
              if (shouldSwitch) {
                // User wants to switch to manual - process the switch
                clearContactSource('file').then(() => {
                  // Restore the manual numbers that were saved
                  if (numbersArea) numbersArea.value = result.manualNumbers;
                  
                  chrome.storage.local.set({ activeInputSource: 'manual' }, () => {
                    console.log("Switched to manual numbers on tab change after conflict resolution");
                    
                    // Parse the manual numbers to update the UI
                    import('./contactManager.js').then(module => {
                      module.parseManualNumbers(numbersArea.value, toast);
                    });
                  });
                });
              } else {
                // User wants to keep the file - switch back to upload tab
                if (uploadTabBtn) uploadTabBtn.click();
                toast("Manual entry canceled. Your uploaded file is kept.", "info");
              }
            });
          } else if (result.manualNumbers && numbersArea) {
            // Just restore saved manual numbers without conflict
            numbersArea.value = result.manualNumbers;
          }
        });
      });
    }

    // Also save on the tab change to ensure manual numbers are not lost
    if (numberTabBtn) {
      addEventListenerWithCleanup(numberTabBtn, "click", () => {
        if (numbersArea && numbersArea.value.trim() !== '') {
          chrome.storage.local.set({ 
            manualNumbers: numbersArea.value
          }, () => {
            console.log("Manual numbers saved on tab change");
          });
        }
      });
    }

    // Validate on paste event
    addEventListenerWithCleanup(numbersArea, "paste", (e) => {
      // IMPORTANT: We must prevent default paste behavior first to handle conflict resolution
      const clipboardData = e.clipboardData || window.clipboardData;
      const pastedText = clipboardData.getData('text');
      
      // Only proceed if there's actual text to paste
      if (pastedText.trim()) {
        // Always prevent default paste first - we'll handle pasting manually after conflict resolution
        e.preventDefault();
        
        // Check for file conflict first - this needs to happen BEFORE any paste processing
        chrome.storage.local.get(['activeInputSource', 'contactFile'], (result) => {
          if (result.activeInputSource === 'file' && result.contactFile) {
            // We've detected a paste event while a file is loaded - show conflict
            
            // Show conflict dialog
            handleContactSourceConflict('file', 'manual', (shouldSwitch) => {
              if (shouldSwitch) {
                // User chose to switch to manual numbers - clear file first
                clearContactSource('file').then(() => {
                  // Now paste the text manually
                  numbersArea.value = pastedText;
                  
                  // Process the pasted numbers
                  chrome.storage.local.set({
                    manualNumbers: numbersArea.value,
                    activeInputSource: 'manual'
                  }, () => {
                    console.log("Manual numbers saved after paste and conflict resolution");
                    
                    // Parse the manual numbers
                    import('./contactManager.js').then(module => {
                      module.parseManualNumbers(numbersArea.value, toast);
                    });
                    
                    // Show a success toast
                    const analysis = analyzePhoneNumbers(numbersArea.value);
                    toast(`Successfully pasted ${analysis.total} contacts`, "success");
                  });
                });
              } else {
                // User chose to keep the file
                toast("Paste canceled. Your uploaded file is kept.", "info");
                
                // Switch to the upload tab to show the file is still active
                if (uploadTabBtn) uploadTabBtn.click();
              }
            });
          } else {
            // No conflict - proceed with normal paste
            numbersArea.value = pastedText;
            
            // Now validate and process the numbers
            const result = validatePhoneNumberList(numbersArea.value);
            showPhoneNumberFormatError(result);
            
            // Show a toast notification for pasted contacts
            if (result === true && numbersArea.value.trim()) {
              const analysis = analyzePhoneNumbers(numbersArea.value);
              toast(`Successfully pasted ${analysis.total} contacts`, "success");
              
              // Immediately trigger campaign summary update and animation
              import('./contactManager.js').then(module => {
                module.parseManualNumbers(numbersArea.value, () => {})
                  .then(newParsedData => {
                    // Update campaign summary with the new data
                    updateCampaignSummaryWithAnimation(newParsedData);
                  });
              });
            } else if (Array.isArray(result) && result.length > 0) {
              toast(`Warning: ${result.length} invalid contacts detected`, "warning");
            }
          }
        });
      }
    });
    
    // Also validate on input change (typing)
    addEventListenerWithCleanup(numbersArea, "input", (e) => {
      // This event handler is for validation only, conflict handling is in debouncedProcessNumbers
      const result = validatePhoneNumberList(numbersArea.value);
      showPhoneNumberFormatError(result);
      
      // Enable/disable start campaign button based on validation
      if (startCampaignBtn) {
        startCampaignBtn.disabled = (result !== true);
      }
      
      // Throttle the real-time campaign summary updates for typing
      clearTimeout(inputUpdateTimeout);
      inputUpdateTimeout = setTimeout(() => {
        if (numbersArea.value.trim()) {
          import('./contactManager.js').then(module => {
            module.parseManualNumbers(numbersArea.value, () => {})
              .then(newParsedData => {
                // Update campaign summary with the new data
                updateCampaignSummaryWithAnimation(newParsedData);
              });
          });
        } else {
          // If textarea is empty, reset summary to zero
          updateCampaignSummaryWithAnimation([]);
        }
      }, 300); // 300ms throttle for typing
    });
  }
  
  // Add robust phone number validation
  function validatePhoneInput(input) {
    const phoneInput = (input || '').trim();
    if (!phoneInput) return false;

    let normalised = phoneInput.startsWith('00') ? ('+' + phoneInput.slice(2)) : phoneInput;
    const e164Regex = /^\+[1-9]\d{7,14}$/;
    const digitsOnlyRegex = /^[1-9]\d{7,14}$/;
    return e164Regex.test(normalised) || digitsOnlyRegex.test(normalised);
  }

  // Format phone number for WhatsApp API
  function formatPhoneForWhatsApp(phone) {
    // First normalise to +E.164 using our formatter
    const e164 = formatPhoneNumber(phone);
    // WhatsApp expects digits only (no plus sign)
    return e164.startsWith('+') ? e164.slice(1) : e164;
  }

  // Parse manual numbers and update campaign summary
  function parseManualNumbers(text, toast) {
    if (!text || text.trim() === '') {
      return Promise.resolve([]);
    }
    
    // Split by newlines and commas
    const numbersRaw = text.split(/[\n,]/)
      .map(num => num.trim())
      .filter(num => num !== '');

    // Check limit BEFORE further processing
    if (numbersRaw.length > MAX_MANUAL_CONTACTS) {
      toast(`Maximum ${MAX_MANUAL_CONTACTS} manual contacts allowed. You entered ${numbersRaw.length}. Please reduce the list.`, "error", 5000); // Show error for 5 seconds
      if (contactsList) { // Ensure contactsList element is available
        contactsList.value = ''; // Clear the textarea
      }
      return Promise.resolve([]); // Return empty or indicate failure
    }
    
    // Process the phone numbers with proper formatting
    const parsedData = numbersRaw.map(num => {
      const formattedNumber = formatPhoneNumber(num);
      return {
        Name: num, // Keep original as name for reference
        Phone: formattedNumber
      };
    });
      
    // Save to storage with proper keys
    return new Promise((resolve) => {
      chrome.storage.local.set({
        parsedData: parsedData,
        manualNumbers: text,
        activeInputSource: 'manual'
      }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error saving manual numbers:", chrome.runtime.lastError);
          toast("Failed to save manual numbers", "error");
        } else {
          console.log("Manual numbers saved:", parsedData.length, "contacts");
          toast(`${parsedData.length} phone numbers processed`, "success");
          
          // Update campaign summary - IMPORTANT: Call this to ensure UI updates
          const randomTimeGapToggle = document.getElementById('randomTimeGapToggle');
          const splitBatchesToggle = document.getElementById('splitBatchesToggle');
          const randomTimeGapMaxInput = document.getElementById('randomTimeGapMax');
          const batchSizeInput = document.getElementById('batchSize');
          const delayBetweenBatchesInput = document.getElementById('delayBetweenBatches');
          const totalContacts = document.getElementById('totalContacts');
          const selectedContacts = document.getElementById('selectedContacts');
          const estDuration = document.getElementById('estDuration');
          const batches = document.getElementById('batches');
          
          // Directly call updateSummary here to ensure it's always updated
          if (typeof updateSummary === 'function') { // Ensure updateSummary is defined
            updateSummary(
              parsedData,
              { 
                batchSize: batchSizeInput, 
                delayBetweenBatches: delayBetweenBatchesInput, 
                randomTimeGapMax: randomTimeGapMaxInput 
              },
              { 
                randomTimeGap: randomTimeGapToggle, 
                splitBatches: splitBatchesToggle 
              },
              { 
                totalContacts, 
                selectedContacts, 
                estDuration, 
                batches 
              }
            );
          } else {
            console.warn('updateSummary function not found in parseManualNumbers scope');
          }
          
          // Dispatch an event to ensure other components update
          document.dispatchEvent(new CustomEvent('contactDataUpdated', { 
            detail: { parsedData: parsedData }
          }));
        }
        resolve(parsedData);
      });
    });
  }

  // Format phone number for consistency
  function formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return phoneNumber;

    // Remove all non-numeric characters except +
    let cleaned = phoneNumber.replace(/[^\d+]/g, '');

    // If starts with 00, convert to +
    if (cleaned.startsWith('00')) {
      cleaned = '+' + cleaned.substring(2);
    }

    // If starts with +, keep as is
    if (cleaned.startsWith('+')) {
      cleaned = cleaned;
    } else if (/^\d{8,15}$/.test(cleaned)) {
      // If it's just digits and 8-15 long, assume it's already in international format (no +)
      cleaned = '+' + cleaned;
    } else {
      // Fallback: try to extract country code if possible, else return as is
      cleaned = '+' + cleaned.replace(/^0+/, '');
    }

    // Remove any double pluses
    cleaned = cleaned.replace(/^\+{2,}/, '+');

    return cleaned;
  }

  // Helper function to update the campaign summary UI with animation
  function updateCampaignSummaryUI(contacts) {
    // Get UI elements
    const randomTimeGapToggle = document.getElementById('randomTimeGapToggle');
    const splitBatchesToggle = document.getElementById('splitBatchesToggle');
    const randomTimeGapMaxInput = document.getElementById('randomTimeGapMax');
    const batchSizeInput = document.getElementById('batchSize');
    const delayBetweenBatchesInput = document.getElementById('delayBetweenBatches');
    const totalContacts = document.getElementById('totalContacts');
    const selectedContacts = document.getElementById('selectedContacts');
    const estDuration = document.getElementById('estDuration');
    const batches = document.getElementById('batches');
    
    if (!contacts || !contacts.length) {
      // If no contacts, reset the summary
      if (totalContacts) totalContacts.textContent = "0";
      if (selectedContacts) selectedContacts.textContent = "0";
      if (estDuration) estDuration.textContent = "0h 0m";
      if (batches) batches.textContent = "0";
      return;
    }
    
    // Update the campaign summary with animation
    const campaignSummary = document.querySelector('.campaign-summary');
    
    // Add animation classes
    if (totalContacts) totalContacts.classList.add('reset-animation');
    if (selectedContacts) selectedContacts.classList.add('reset-animation');
    if (estDuration) estDuration.classList.add('reset-animation');
    if (batches) batches.classList.add('reset-animation');
    if (campaignSummary) campaignSummary.classList.add('reset-animation');
    
    // Use updateSummary to calculate and update values
    updateSummary(
      contacts,
      { 
        batchSize: batchSizeInput, 
        delayBetweenBatches: delayBetweenBatchesInput, 
        randomTimeGapMax: randomTimeGapMaxInput 
      },
      { 
        randomTimeGap: randomTimeGapToggle, 
        splitBatches: splitBatchesToggle 
      },
      { 
        totalContacts, 
        selectedContacts, 
        estDuration, 
        batches 
      }
    );
    
    // Remove animation classes after animation completes
    setTimeout(() => {
      if (totalContacts) totalContacts.classList.remove('reset-animation');
      if (selectedContacts) selectedContacts.classList.remove('reset-animation');
      if (estDuration) estDuration.classList.remove('reset-animation');
      if (batches) batches.classList.remove('reset-animation');
      if (campaignSummary) campaignSummary.classList.remove('reset-animation');
    }, 1000);
  }
  
  /**
   * Updates the campaign summary with animation
   * This function is called from multiple places to ensure the UI is always up-to-date
   * @param {Array} contacts Array of contact objects to use for the summary
   */
  function updateCampaignSummaryWithAnimation(contacts) {
    if (!contacts || !Array.isArray(contacts)) {
      console.warn('Invalid contacts passed to updateCampaignSummaryWithAnimation:', contacts);
      return;
    }
    
    console.log(`Updating campaign summary with animation: ${contacts.length} contacts`);
    
    // Get UI elements
    const randomTimeGapToggle = document.getElementById('randomTimeGapToggle');
    const splitBatchesToggle = document.getElementById('splitBatchesToggle');
    const randomTimeGapMaxInput = document.getElementById('randomTimeGapMax');
    const batchSizeInput = document.getElementById('batchSize');
    const delayBetweenBatchesInput = document.getElementById('delayBetweenBatches');
    const totalContacts = document.getElementById('totalContacts');
    const selectedContacts = document.getElementById('selectedContacts');
    const estDuration = document.getElementById('estDuration');
    const batches = document.getElementById('batches');
    
    // Get the campaign summary element
    const campaignSummary = document.querySelector('.campaign-summary');
    
    // Apply animation to elements
    [totalContacts, selectedContacts, estDuration, batches, campaignSummary]
      .filter(el => el) // Filter out null elements
      .forEach(el => {
        el.classList.add('reset-animation');
      });
    
    // Update the summary values
    updateSummary(
      contacts,
      { 
        batchSize: batchSizeInput, 
        delayBetweenBatches: delayBetweenBatchesInput, 
        randomTimeGapMax: randomTimeGapMaxInput 
      },
      { 
        randomTimeGap: randomTimeGapToggle, 
        splitBatches: splitBatchesToggle 
      },
      { 
        totalContacts, 
        selectedContacts, 
        estDuration, 
        batches 
      }
    );
    
    // Remove animation classes after animation completes
    setTimeout(() => {
      [totalContacts, selectedContacts, estDuration, batches, campaignSummary]
        .filter(el => el)
        .forEach(el => {
          el.classList.remove('reset-animation');
        });
    }, 1000);
  }

  // Validate a list of phone numbers and show user feedback
  function validatePhoneNumberList(text) {
    if (!text || text.trim() === '') return true;
    
    // Split text into lines, and then by commas if present
    const lines = text.split(/[\n,]/)
      .map(line => line.trim())
      .filter(line => line !== '');
    
    // Find invalid entries
    const invalidEntries = lines.filter(entry => {
      return !validatePhoneInput(entry);
    });
    
    return invalidEntries.length === 0 ? true : invalidEntries;
  }

  // Show error message for invalid phone numbers
  function showPhoneNumberFormatError(invalidEntries) {
    const errorElement = document.getElementById('numberFormatError');
    if (!errorElement) return;
    
    if (invalidEntries === true) {
      // No errors, hide the error message
      errorElement.style.display = 'none';
      errorElement.textContent = '';
    } else {
      // Show error message with examples of invalid entries
      let errorMsg = 'Invalid phone number format detected. Please check these numbers:';
      
      // Add examples of invalid entries if available
      if (invalidEntries.length > 0) {
        const maxExamples = Math.min(3, invalidEntries.length);
        errorMsg += '<ul>';
        
        for (let i = 0; i < maxExamples; i++) {
          errorMsg += `<li>"${invalidEntries[i]}"</li>`;
        }
        
        errorMsg += '</ul>';
        
        if (invalidEntries.length > maxExamples) {
          errorMsg += `<p>...and ${invalidEntries.length - maxExamples} more invalid numbers.</p>`;
        }
        
        errorMsg += '<p>Supported formats include:</p><ul>' +
                   '<li>International format: +971XXXXXXXX</li>' +
                   '<li>UAE format: 05XXXXXXXX or 5XXXXXXXX</li>' +
                   '<li>Other countries: +[country code][number]</li>' +
                   '</ul>';
      }
      
      errorMsg += '<p>Supported examples:</p><ul>' +
                   '<li>+12025550108 (USA)</li>' +
                   '<li>+447911123456 (UK)</li>' +
                   '<li>+8613712345678 (China)</li>' +
                 '</ul><p>Please use the full international number with country code (8–15 digits).</p>';
      
      errorElement.innerHTML = errorMsg;
      errorElement.style.display = 'block';
    }
  }

  // Toggle sections based on user input
  if (randomTimeGapToggle) {
    addEventListenerWithCleanup(randomTimeGapToggle, "change", () => {
      // Update UI
      if (randomTimeGapSection) {
        randomTimeGapSection.classList.toggle('active', randomTimeGapToggle.checked);
      }
      
      // Show warning when disabling the delay feature
      const warningMessage = document.getElementById('delayWarningMessage');
      if (warningMessage) {
        if (!randomTimeGapToggle.checked) {
          warningMessage.style.display = 'flex';
        } else {
          warningMessage.style.display = 'none';
        }
      }
      
      // Update input fields
      updateInputFieldsBasedOnToggles(
        randomTimeGapToggle, 
        splitBatchesToggle, 
        { 
          randomTimeGapMax: randomTimeGapMaxInput, 
          batchSize: batchSizeInput,
          delayBetweenBatches: delayBetweenBatchesInput 
        }
      );
      
      // Save settings
      saveSettings(
        { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
        { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle, skipInvalidNumbers: skipInvalidNumbersToggle }
      );
      
      // Update summary
      chrome.storage.local.get(['parsedData'], (result) => {
        if (result.parsedData && result.parsedData.length > 0) {
          updateSummary(
            result.parsedData,
            { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
            { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle },
            { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
          );
        }
      });
    });
  }
  
  if (splitBatchesToggle) {
    addEventListenerWithCleanup(splitBatchesToggle, "change", () => {
      // Update UI
      if (batchSettings) {
        batchSettings.classList.toggle('active', splitBatchesToggle.checked);
      }
      
      // Show warning when disabling the batch splitting feature
      const warningMessage = document.getElementById('batchWarningMessage');
      if (warningMessage) {
        if (!splitBatchesToggle.checked) {
          warningMessage.style.display = 'flex';
        } else {
          warningMessage.style.display = 'none';
        }
      }
      
      // Update input fields
      updateInputFieldsBasedOnToggles(
        randomTimeGapToggle, 
        splitBatchesToggle, 
        { 
          randomTimeGapMax: randomTimeGapMaxInput, 
          batchSize: batchSizeInput,
          delayBetweenBatches: delayBetweenBatchesInput 
        }
      );
      
      // Save settings
      saveSettings(
        { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
        { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle, skipInvalidNumbers: skipInvalidNumbersToggle }
      );
      
      // Update summary
      chrome.storage.local.get(['parsedData'], (result) => {
        if (result.parsedData && result.parsedData.length > 0) {
          updateSummary(
            result.parsedData,
            { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
            { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle },
            { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
          );
        }
      });
    });
  }
  
  // Handle input changes for numeric settings
  const setupNumericInput = (input, min = 1) => {
    if (!input) return;
    
    addEventListenerWithCleanup(input, "input", () => {
      // Validate input value
      let value = parseInt(input.value);
      const maxAttr = input.getAttribute('max');
      const maxVal = maxAttr ? parseInt(maxAttr) : null;

      if (isNaN(value) || value < min) {
        value = min;
      } else if (maxVal !== null && value > maxVal) {
        value = maxVal;
      }

      input.value = value;
      
      // Save settings
      saveSettings(
        { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
        { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle, skipInvalidNumbers: skipInvalidNumbersToggle }
      );
      
      // Update summary
      chrome.storage.local.get(['parsedData'], (result) => {
        if (result.parsedData && result.parsedData.length > 0) {
          updateSummary(
            result.parsedData,
            { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
            { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle },
            { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
          );
        }
      });
    });
  };
  
  // Accept any positive values; we'll enforce logical min<=max rules
  setupNumericInput(batchSizeInput, 1);
  setupNumericInput(batchSizeMaxInput, 1);
  setupNumericInput(delayBetweenBatchesInput, 1);
  setupNumericInput(delayBetweenBatchesMaxInput, 1);
  
  const validateBatchRange = () => {
    const minBatch = parseInt(batchSizeInput.value) || 1;
    const maxBatch = parseInt(batchSizeMaxInput.value) || minBatch;
    if (maxBatch < minBatch) batchSizeMaxInput.value = minBatch;

    const minDelay = parseInt(delayBetweenBatchesInput.value) || 1;
    const maxDelay = parseInt(delayBetweenBatchesMaxInput.value) || minDelay;
    if (maxDelay < minDelay) delayBetweenBatchesMaxInput.value = minDelay;
  };

  [batchSizeInput,batchSizeMaxInput,delayBetweenBatchesInput,delayBetweenBatchesMaxInput].forEach(inp=>{
    if(inp) addEventListenerWithCleanup(inp,'change',validateBatchRange);
  });
  
  // --- Random-time-gap MIN/MAX cross-validation ---
  const validateRandomGapInputs = () => {
    const minVal = parseInt(randomTimeGapMinInput.value) || 1;
    let maxVal = parseInt(randomTimeGapMaxInput.value) || (minVal + 5);

    // Enforce min >=1 and max>min
    if (minVal < 1) {
      randomTimeGapMinInput.value = 1;
      toast('Minimum delay must be at least 1 second', 'warning');
    }

    if (maxVal <= minVal) {
      maxVal = minVal + 1;
      randomTimeGapMaxInput.value = maxVal;
      toast('Max delay must be greater than Min delay', 'warning');
    }
  };

  if (randomTimeGapMinInput) addEventListenerWithCleanup(randomTimeGapMinInput, 'change', validateRandomGapInputs);
  if (randomTimeGapMaxInput) addEventListenerWithCleanup(randomTimeGapMaxInput, 'change', validateRandomGapInputs);
  
  // Skip invalid numbers toggle
  if (skipInvalidNumbersToggle) {
    addEventListenerWithCleanup(skipInvalidNumbersToggle, "change", () => {
      saveSettings(
        { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
        { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle, skipInvalidNumbers: skipInvalidNumbersToggle }
      );
    });
  }
  
  // Initialize attachment handling
  const setAttachment = (newAttachment) => {
    attachment = newAttachment;
  };
  
  // Handle image attachments
  if (imageInput) {
    addEventListenerWithCleanup(imageInput, "change", (e) => {
      const file = e.target.files[0];
      if (file) {
        handleAttachment(file, "image", imageInput, attachment, setAttachment, renderAttachment, attachmentError, attachmentPreview);
      }
    });
  }
  
  // Handle video attachments
  if (videoInput) {
    addEventListenerWithCleanup(videoInput, "change", (e) => {
      const file = e.target.files[0];
      if (file) {
        handleAttachment(file, "video", videoInput, attachment, setAttachment, renderAttachment, attachmentError, attachmentPreview);
      }
    });
  }
  
  // Handle PDF attachments
  if (pdfInput) {
    addEventListenerWithCleanup(pdfInput, "change", (e) => {
      const file = e.target.files[0];
      if (file) {
        handleAttachment(file, "pdf", pdfInput, attachment, setAttachment, renderAttachment, attachmentError, attachmentPreview);
      }
    });
  }
  
  // Load any saved attachment from storage
  if (attachmentPreview && attachmentError) {
    import('./attachmentManager.js').then(module => {
      module.loadSavedAttachment(attachmentPreview, attachmentError, setAttachment)
        .then(loaded => {
          if (loaded) {
            console.log("Loaded saved attachment from previous session");
          }
        })
        .catch(err => {
          console.error("Error loading saved attachment:", err);
        });
    }).catch(err => {
      console.error("Error importing attachmentManager module:", err);
    });
  }

  // Skip invalid numbers toggle
  if (skipInvalidNumbersToggle) {
    addEventListenerWithCleanup(skipInvalidNumbersToggle, "change", () => {
      saveSettings(
        { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
        { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle, skipInvalidNumbers: skipInvalidNumbersToggle }
      );
    });
  }
  
  // Initialize campaign start button
  if (startCampaignBtn) {
    addEventListenerWithCleanup(startCampaignBtn, "click", async () => {
      // Check license first with fast timeout
      try {
        const response = await chrome.runtime.sendMessage({ action: 'checkWhatsAppConnection' });
        if (!response.connected) {
          toast('Please connect to WhatsApp Web first', 'error');
          return;
        }
        
        // Get WhatsApp number and verify license
        const waResult = await chrome.storage.local.get(['waUserPhoneNumberResult']);
        if (!waResult.waUserPhoneNumberResult || !waResult.waUserPhoneNumberResult.number) {
          toast('Please connect to WhatsApp Web to verify your license', 'error');
          return;
        }
        
        const phoneNumber = waResult.waUserPhoneNumberResult.number;
        
        // Show loading state immediately
        toast('Verifying license...', 'info');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          toast('Backend server is offline. Please try again later.', 'error');
        }, 5000); // 5 second timeout
        
        const licenseResponse = await fetch('https://www.wacampaignsender.com/api/verify-license/', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ phone_number: phoneNumber }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!licenseResponse.ok) {
          throw new Error(`HTTP ${licenseResponse.status}: ${licenseResponse.statusText}`);
        }
        
        const licenseData = await licenseResponse.json();
        
        if (!licenseData.is_active) {
          showLicenseRequiredModal('extract saved contacts', licenseData.error || null);
          return;
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('License verification timed out');
          showLicenseVerificationFailedModal('Backend server is offline. Please try again later.');
        } else {
          console.error('License verification failed:', error);
          showLicenseVerificationFailedModal(error.message || 'Connection failed');
        }
        return;
      }
      
      // Get latest parsed data
      chrome.storage.local.get(['parsedData'], (result) => {
        parsedData = result.parsedData || [];
        
        // Validate inputs
        if (!parsedData || parsedData.length === 0) {
          toast("Please add contacts before starting your campaign", "error");
          return;
        }
        
        if (!editor || !editor.textContent.trim()) {
          toast("Please enter a message in the composer", "error");
          return;
        }
        
        // Check for invalid variables
        const hasInvalidVariables = variableError && variableError.style.display !== 'none';
        if (hasInvalidVariables) {
          toast("There are invalid variables in your message", "error");
          return;
        }
        
        // Final confirmation
        if (!confirm(`Are you ready to start your campaign to ${parsedData.length} contacts?`)) {
          return;
        }
        
        // Process attachment if any
        let processedAttachment = null;
        if (attachment) {
          processedAttachment = {
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
            base64String: attachment.base64String || null,
            attachmentRef: attachment.id || null,
            previewOnly: attachment.previewOnly || false
          };
        }
        
        // Campaign settings
        const campaignSettings = {
          contacts: parsedData,
          message: htmlToWhatsAppMarkdown(editor.innerHTML),
          attachment: processedAttachment,
          randomTimeGapEnabled: randomTimeGapToggle.checked,
          randomTimeGapMin: parseInt(randomTimeGapMinInput.value) || 15,
          randomTimeGapMax: parseInt(randomTimeGapMaxInput.value) || 20,
          humanPatternEnabled: delayPatternToggle?.checked || false,
          humanPatternIntensity: parseInt(document.getElementById('humanPatternIntensity')?.value) || 0,
          splitBatchesEnabled: splitBatchesToggle.checked,
          batchSizeMin: parseInt(batchSizeInput.value) || 1,
          batchSizeMax: parseInt(batchSizeMaxInput?.value) || 100,
          delayBetweenBatchesMin: parseInt(delayBetweenBatchesInput.value) || 1,
          delayBetweenBatchesMax: parseInt(delayBetweenBatchesMaxInput?.value) || 60,
          skipInvalidNumbers: skipInvalidNumbersToggle ? skipInvalidNumbersToggle.checked : true,
          useLegacyMethod: document.getElementById('legacyMethodToggle')?.checked || false,
          addTimestamp: document.getElementById('timestampToggle').checked || false,
          turboModeEnabled: turboModeToggle ? turboModeToggle.checked : false,
          inputSource: activeInputSource
        };
        
        // Start campaign with fallback to direct method if port connection fails
        startCampaign(campaignSettings);
      });
    });
  }
  
  // Reset stuck campaign button
  if (resetCampaignBtn) {
    addEventListenerWithCleanup(resetCampaignBtn, "click", async () => {
      // Check license for reset operation with fast timeout
      try {
        const waResult = await chrome.storage.local.get(['waUserPhoneNumberResult']);
        if (!waResult.waUserPhoneNumberResult || !waResult.waUserPhoneNumberResult.number) {
          toast('Please connect to WhatsApp Web to verify your license', 'error');
          return;
        }
        
        const phoneNumber = waResult.waUserPhoneNumberResult.number;
        
        // Show loading state immediately
        toast('Verifying license...', 'info');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          toast('Backend server is offline. Please try again later.', 'error');
        }, 5000); // 5 second timeout
        
        const licenseResponse = await fetch('https://www.wacampaignsender.com/api/verify-license/', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ phone_number: phoneNumber }),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!licenseResponse.ok) {
          throw new Error(`HTTP ${licenseResponse.status}: ${licenseResponse.statusText}`);
        }
        
        const licenseData = await licenseResponse.json();
        
        if (!licenseData.is_active) {
          showLicenseRequiredModal('reset campaigns', licenseData.error || null);
          return;
        }
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log('License verification timed out');
          showLicenseVerificationFailedModal('Backend server is offline. Please try again later.');
        } else {
          console.error('License verification failed:', error);
          showLicenseVerificationFailedModal(error.message || 'Connection failed');
        }
        return;
      }
      
      if (confirm('Are you sure you want to reset any stuck campaign state?')) {
        try {
          // Disable the button while processing
          resetCampaignBtn.disabled = true;
          resetCampaignBtn.textContent = 'Resetting...';
          
          // Use the imported resetStuckCampaign function
          const { resetStuckCampaign } = await import('./sendingControls.js');
          resetStuckCampaign();
          
          // No need for toast message here as the resetStuckCampaign function handles that
        } catch (error) {
          console.error('Error in reset campaign button handler:', error);
          toast('Failed to reset campaign state: ' + error.message, 'error');
          
          // Re-enable the button if there was an error
          resetCampaignBtn.disabled = false;
          resetCampaignBtn.textContent = 'Reset Stuck Campaign';
        }
      }
    });
  }
  
  // Restore UI state from storage
  chrome.storage.local.get(
    [
      "editorContent",
      "contactFile",
      "parsedData",
      "attachment",
      "contactFileBase64",
      "batchSize",
      "delayBetweenBatches",
      "randomTimeGapMax",
      "randomTimeGapEnabled",
      "splitBatchesEnabled",
      "skipInvalidNumbers",
      "manualNumbers",
      "activeInputSource"
    ],
    (result) => {
      // Handle storage errors
      if (chrome.runtime.lastError) {
        console.error("Error loading from storage:", chrome.runtime.lastError);
        return;
      }
      
      // Set active input source from storage or default to 'none'
      activeInputSource = result.activeInputSource || 'none';
      console.log("Restored active input source:", activeInputSource);
      
      // Restore contact input based on activeInputSource
      if (activeInputSource === 'file' && result.contactFile) {
        // Restore file UI and select the upload tab
        updateContactUI(result.contactFile, fileNameSpan, fileDisplay, fileInput);
        if (uploadTabBtn) {
          uploadTabBtn.click();
        }
      } else if (activeInputSource === 'manual' && result.manualNumbers && numbersArea) {
        // Restore manual numbers and select the numbers tab
        numbersArea.value = result.manualNumbers;
        if (numberTabBtn) {
          numberTabBtn.click();
        }
        
        // Process numbers to update number details panel and validate
        if (numbersArea.value.trim()) {
          // Analyze the numbers
          const analysisResult = analyzePhoneNumbers(numbersArea.value);
          
          // Show format errors if needed
          const validationResult = validatePhoneNumberList(numbersArea.value);
          showPhoneNumberFormatError(validationResult);
          
          // Make sure campaign summary uses the manually entered numbers
          if (result.parsedData) {
            updateSummary(
              result.parsedData,
              { 
                batchSize: batchSizeInput, 
                delayBetweenBatches: delayBetweenBatchesInput, 
                randomTimeGapMax: randomTimeGapMaxInput 
              },
              { 
                randomTimeGap: randomTimeGapToggle, 
                splitBatches: splitBatchesToggle 
              },
              { 
                totalContacts, 
                selectedContacts, 
                estDuration, 
                batches: batchesLabel 
              }
            );
            
            // Add animation to the campaign summary
            const summaryCard = document.querySelector('.campaign-summary');
            if (summaryCard) {
              summaryCard.classList.add('reset-animation');
              setTimeout(() => {
                summaryCard.classList.remove('reset-animation');
              }, 1000);
            }
          }
          
          console.log(`Restored ${analysisResult.total} manual numbers: ${analysisResult.valid.length} valid, ${analysisResult.invalid.length} invalid`);
        }
      }
      
      // Restore settings
      if (batchSizeInput && typeof result.batchSize === 'number') {
        batchSizeInput.value = result.batchSize;
      }
      
      if (delayBetweenBatchesInput && typeof result.delayBetweenBatches === 'number') {
        delayBetweenBatchesInput.value = result.delayBetweenBatches;
      }
      
      if (randomTimeGapMaxInput && typeof result.randomTimeGapMax === 'number') {
        randomTimeGapMaxInput.value = result.randomTimeGapMax;
      }
      
      // SAFETY FEATURE: Always ensure toggles are ON when extension reopens
      // This prevents users from accidentally leaving safety features off
      if (randomTimeGapToggle) {
        // Always enable random delay for safety
        randomTimeGapToggle.checked = true;
        // Trigger change handler so dependent UI (incl. pattern toggle) refreshes
        randomTimeGapToggle.dispatchEvent(new Event('change'));
      }
      
      if (splitBatchesToggle) {
        splitBatchesToggle.checked = true;
        splitBatchesToggle.dispatchEvent(new Event('change'));
      }
      
      if (skipInvalidNumbersToggle) {
        skipInvalidNumbersToggle.checked = result.skipInvalidNumbers !== undefined ? result.skipInvalidNumbers : true;
      }
      
      // Restore Turbo Mode toggle from saved settings
      if (turboModeToggle) {
        const storedTurbo = result.sendingControls && result.sendingControls.turboMode;
        if (typeof storedTurbo === 'boolean') {
          turboModeToggle.checked = storedTurbo;
        }
        // Ensure UI warning updates
        turboModeToggle.dispatchEvent(new Event('change'));
      }
      
      // Update input field states based on toggle settings (which are now always ON)
      updateInputFieldsBasedOnToggles(
        randomTimeGapToggle, 
        splitBatchesToggle, 
        { 
          randomTimeGapMax: randomTimeGapMaxInput, 
          batchSize: batchSizeInput,
          delayBetweenBatches: delayBetweenBatchesInput 
        }
      );
      
      // Update campaign summary for parsedData if it exists, regardless of source
      if (result.parsedData && Array.isArray(result.parsedData) && result.parsedData.length > 0) {
        console.log(`Restoring campaign summary with ${result.parsedData.length} contacts`);
        
        // Intentionally use a small delay to ensure the UI is ready
        setTimeout(() => {
          try {
            updateCampaignSummaryWithAnimation(result.parsedData);
          } catch (error) {
            console.error("Error updating campaign summary:", error);
            // Fall back to the simpler update method if the animation version fails
            updateSummary(
              result.parsedData,
              { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
              { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle },
              { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
            );
          }
        }, 100);
      } else {
        console.log("No contacts found for campaign summary");
      }
      
      // Save the forced ON state to storage
      saveSettings(
        { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
        { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle, skipInvalidNumbers: skipInvalidNumbersToggle }
      );
      
      console.log("Safety toggles forced to ON state on extension restart");
    }
  );
  
  // Add cleanup on unload
  addEventListenerWithCleanup(window, 'unload', cleanupEventListeners);
  
  // Clear manual numbers button
  const clearNumbersBtn = $("clearNumbersBtn");
  if (clearNumbersBtn && numbersArea) {
    addEventListenerWithCleanup(clearNumbersBtn, "click", (e) => {
      e.preventDefault();
      
      // Only prompt for confirmation if there are actually numbers in the textarea
      if (numbersArea.value.trim() !== '') {
        if (confirm("Are you sure you want to clear all phone numbers?")) {
          // Clear the textarea
          numbersArea.value = '';
          
          // Clear related data from storage
          chrome.storage.local.remove(["parsedData", "manualNumbers", "activeInputSource"], () => {
            console.log("Cleared manual numbers from storage using clear button");
            
            // Update campaign summary with empty data
            updateSummary(
              [],
              { batchSize: batchSizeInput, delayBetweenBatches: delayBetweenBatchesInput, randomTimeGapMax: randomTimeGapMaxInput },
              { randomTimeGap: randomTimeGapToggle, splitBatches: splitBatchesToggle },
              { totalContacts, selectedContacts, estDuration, batches: batchesLabel }
            );
            
            // Clear any validation errors
            if (variableError) variableError.style.display = 'none';
            if (document.getElementById('numberFormatError')) {
              document.getElementById('numberFormatError').style.display = 'none';
            }
            
            // Force reset the campaign summary to show zeros
            if (totalContacts) totalContacts.textContent = "0";
            if (selectedContacts) selectedContacts.textContent = "0";
            if (estDuration) estDuration.textContent = "0h 0m";
            if (batchesLabel) batchesLabel.textContent = "0";
            
            // Show toast notification
            toast("All manual contacts have been cleared", "success");
            
            // Add focus back to the textarea
            numbersArea.focus();
          });
        }
      } else {
        // If already empty, just show a message
        toast("No numbers to clear", "info");
      }
    });
  }
  
  console.log('Sender module initialization complete');
}

// Export the updateUIWithContactData function so it can be imported in sender-init.js
export function updateUIWithContactData() {
  chrome.storage.local.get(['parsedData', 'activeInputSource', 'manualNumbers', 'sendingControls'], (result) => {
    let contactsToUse = null;

    if (result.parsedData && Array.isArray(result.parsedData) && result.parsedData.length > 0) {
      contactsToUse = result.parsedData;
    } else if (result.manualNumbers && result.manualNumbers.trim() !== '') {
      // Fallback: we only had manual numbers stored – parse them on the fly so the summary is correct
      console.log('[Sender] No parsedData found, generating from stored manualNumbers');
      try {
        // Dynamically import helper to ensure availability without scope issues
        import('./contactManager.js').then(m => m.parseManualNumbers(result.manualNumbers, () => {}));
        // parseManualNumbers is async, but we can still optimistically build a contacts array for immediate UI update
        const numbers = result.manualNumbers.split(/[\n,]/).map(t=>t.trim()).filter(Boolean);
        contactsToUse = numbers.map(num=>({ Phone: num }));
      } catch (e) {
        console.error('[Sender] Failed to parse manualNumbers fallback:', e);
      }
    }

    if (!contactsToUse || contactsToUse.length === 0) return; // Nothing to update

    console.log(`[Sender] Updating Campaign Summary with ${contactsToUse.length} contacts`);

    // Get UI elements
    const randomTimeGapToggle = document.getElementById('randomTimeGapToggle');
    const splitBatchesToggle = document.getElementById('splitBatchesToggle');
    const randomTimeGapMaxInput = document.getElementById('randomTimeGapMax');
    const batchSizeInput = document.getElementById('batchSize');
    const delayBetweenBatchesInput = document.getElementById('delayBetweenBatches');
    const totalContacts = document.getElementById('totalContacts');
    const selectedContacts = document.getElementById('selectedContacts');
    const estDuration = document.getElementById('estDuration');
    const batches = document.getElementById('batches');
    
    // Initialize with saved sending controls or defaults
    if (result.sendingControls) {
      if (randomTimeGapMaxInput && result.sendingControls.delay?.maxTime) {
        randomTimeGapMaxInput.value = result.sendingControls.delay.maxTime;
      }
      if (batchSizeInput && result.sendingControls.batch?.size) {
        batchSizeInput.value = result.sendingControls.batch.size;
      }
      if (delayBetweenBatchesInput && result.sendingControls.batch?.delay) {
        delayBetweenBatchesInput.value = result.sendingControls.batch.delay;
      }
      if (randomTimeGapToggle && typeof result.sendingControls.delay?.randomTime !== 'undefined') {
        randomTimeGapToggle.checked = result.sendingControls.delay.randomTime;
      }
      if (splitBatchesToggle && typeof result.sendingControls.batch?.useBatches !== 'undefined') {
        splitBatchesToggle.checked = result.sendingControls.batch.useBatches;
      }
    }
    
    // Apply animation to make the update visible to the user
    const campaignSummary = document.querySelector('.campaign-summary');
    if (campaignSummary) {
      campaignSummary.classList.add('reset-animation');
      
      if (totalContacts) totalContacts.classList.add('reset-animation');
      if (selectedContacts) selectedContacts.classList.add('reset-animation');
      if (estDuration) estDuration.classList.add('reset-animation');
      if (batches) batches.classList.add('reset-animation');
      
      setTimeout(() => {
        if (campaignSummary) campaignSummary.classList.remove('reset-animation');
        if (totalContacts) totalContacts.classList.remove('reset-animation');
        if (selectedContacts) selectedContacts.classList.remove('reset-animation');
        if (estDuration) estDuration.classList.remove('reset-animation');
        if (batches) batches.classList.remove('reset-animation');
      }, 1000);
    }
    
    updateSummary(
      contactsToUse,
      {
        batchSize: batchSizeInput,
        delayBetweenBatches: delayBetweenBatchesInput,
        randomTimeGapMax: randomTimeGapMaxInput
      },
      {
        randomTimeGap: randomTimeGapToggle,
        splitBatches: splitBatchesToggle
      },
      {
        totalContacts,
        selectedContacts,
        estDuration,
        batches
      }
    );
  });
}

// Helper function to update variable menu with contact headers
function updateVariableMenu(parsedData) {
  const dynamicVariables = document.getElementById('dynamicVariables');
  const variableToggle = document.getElementById('variableToggle');
  
  if (!dynamicVariables) return;
  
  // Clear existing variables
  dynamicVariables.innerHTML = '';
  
  // Check if we have valid parsed data with headers (only when the first entry is an object)
  // For manual entry parsedData will be an array of strings; we should then show "No variables available."
  if (!parsedData || !parsedData.length || typeof parsedData[0] !== 'object' || parsedData[0] === null) {
    // No data available message
    const noVariablesMsg = document.createElement('div');
    noVariablesMsg.className = 'variable-option no-variables';
    noVariablesMsg.style.color = '#888';
    noVariablesMsg.style.fontStyle = 'italic';
    noVariablesMsg.style.cursor = 'default';
    noVariablesMsg.style.textAlign = 'center';
    noVariablesMsg.style.padding = '8px';
    
    dynamicVariables.appendChild(noVariablesMsg);
    
    if (variableToggle) {
      variableToggle.innerHTML = 'No Variables <i class="ri-arrow-down-s-line"></i>';
    }
    
    // Also clear any existing variables in the editor
    const editor = document.getElementById('editor');
    if (editor) {
      const content = editor.innerHTML;
      // Remove any existing variables
      const cleanedContent = content.replace(/{{[^}]+}}/g, '');
      editor.innerHTML = cleanedContent;
    }
    
    return;
  }
  
  // Update toggle button text
  if (variableToggle) {
    variableToggle.innerHTML = 'Insert Variable <i class="ri-arrow-down-s-line"></i>';
  }
  
  // Get headers from the first contact
  const headers = Object.keys(parsedData[0]);
  
  // Add each header as a variable option
  headers.forEach(header => {
    const button = document.createElement('button');
    button.className = 'variable-option';
    button.textContent = `{{${header}}}`;
    button.setAttribute('data-variable', header);
    
    button.addEventListener('click', () => {
      const variableText = `{{${header}}}`;
      const editor = document.getElementById('editor');
      if (editor) {
        insertTextIntoEditor(editor, variableText);
        const variableMenu = document.getElementById('variableMenu');
        if (variableMenu) {
          variableMenu.style.display = 'none';
        }
      }
    });
    
    dynamicVariables.appendChild(button);
  });
}

// Function to analyze phone numbers and return counts of valid/invalid
function analyzePhoneNumbers(text) {
  if (!text || text.trim() === '') {
    return { valid: [], invalid: [], total: 0 };
  }
  
  // Split by newlines and commas
  const numbers = text.split(/[\n,]/)
    .map(num => num.trim())
    .filter(num => num !== '');
  
  // Check each number for validity
  const valid = [];
  const invalid = [];
  
  numbers.forEach(num => {
    if (validatePhoneInput(num)) {
      valid.push(num);
    } else {
      invalid.push(num);
    }
  });
  
  return { 
    valid, 
    invalid,
    total: numbers.length
  };
}

// Add event listener for contactDataUpdated event
document.addEventListener('contactDataUpdated', function(event) {
  if (event.detail && event.detail.parsedData) {
    // Get UI elements
    const randomTimeGapToggle = document.getElementById('randomTimeGapToggle');
    const splitBatchesToggle = document.getElementById('splitBatchesToggle');
    const randomTimeGapMaxInput = document.getElementById('randomTimeGapMax');
    const batchSizeInput = document.getElementById('batchSize');
    const delayBetweenBatchesInput = document.getElementById('delayBetweenBatches');
    const totalContacts = document.getElementById('totalContacts');
    const selectedContacts = document.getElementById('selectedContacts');
    const estDuration = document.getElementById('estDuration');
    const batches = document.getElementById('batches');
    
    // Update campaign summary
    updateSummary(
      event.detail.parsedData,
      { 
        batchSize: batchSizeInput, 
        delayBetweenBatches: delayBetweenBatchesInput, 
        randomTimeGapMax: randomTimeGapMaxInput 
      },
      { 
        randomTimeGap: randomTimeGapToggle, 
        splitBatches: splitBatchesToggle 
      },
      { 
        totalContacts, 
        selectedContacts, 
        estDuration, 
        batches 
      }
    );
  }
});

// Additional event listener for when the extension page has fully loaded
window.addEventListener('load', function() {
  console.log('Window fully loaded - checking campaign summary values');
  
  // Verify that the campaign summary is displaying correct values
  const totalContacts = document.getElementById('totalContacts');
  const campaignSummary = document.querySelector('.campaign-summary');
  
  // Only trigger update if totalContacts is showing 0 but we have data
  if (totalContacts && totalContacts.textContent === '0') {
    chrome.storage.local.get(['parsedData'], (result) => {
      if (result.parsedData && Array.isArray(result.parsedData) && result.parsedData.length > 0) {
        console.log(`Window load: Found ${result.parsedData.length} contacts but summary shows 0. Updating...`);
        
        // Add visible feedback that we're refreshing the summary
        if (campaignSummary) {
          campaignSummary.style.opacity = '0.7';
          setTimeout(() => {
            campaignSummary.style.opacity = '1';
            updateCampaignSummaryWithAnimation(result.parsedData);
          }, 300);
        } else {
          updateCampaignSummaryWithAnimation(result.parsedData);
        }
      }
    });
  }
});

// Enhanced campaign status monitoring and UI feedback
let lastStatusUpdate = null;
let campaignMonitorInterval = null;
let campaignStatusTimeline = [];
let statusUpdateCounter = 0;
let campaignInProgress = false;

// Enhanced campaign progress monitoring
function startCampaignMonitoring() {
  // Cache UI elements
  progressSection = document.getElementById('campaignProgress');
  progressBar = document.getElementById('progressBar');
  progressPercentage = document.getElementById('progressPercentage');
  progressCount = document.getElementById('progressCount');
  sendingStatus = document.getElementById('sendingStatus');
  campaignStats = document.getElementById('campaignStats');
  campaignErrors = document.getElementById('campaignErrors');
  
  // Clear any existing interval
  if (campaignMonitorInterval) {
    clearInterval(campaignMonitorInterval);
  }
  
  // Reset status timeline
  campaignStatusTimeline = [];
  statusUpdateCounter = 0;
  lastStatusUpdate = null;
  campaignInProgress = true;
  
  // Show progress section
  if (progressSection) {
    progressSection.style.display = 'block';
    
    // Add CSS class for visibility
    progressSection.classList.add('active');
    
    // Scroll to progress section
    progressSection.scrollIntoView({ behavior: 'smooth' });
  }
  
  // Initial UI update
  updateProgressUI({
    status: 'starting',
    sentCount: 0,
    totalContacts: 0,
    message: 'Initializing campaign...'
  });
  
  // Start monitoring interval
  campaignMonitorInterval = setInterval(() => {
    checkCampaignStatus();
  }, 2000); // Check every 2 seconds
  
  console.log('Campaign monitoring started');
}

// Stop campaign monitoring
function stopCampaignMonitoring(finalStatus = 'completed') {
  // Clear interval
  if (campaignMonitorInterval) {
    clearInterval(campaignMonitorInterval);
    campaignMonitorInterval = null;
  }
  
  // Update UI with final status
  updateProgressUI({
    status: finalStatus,
    message: finalStatus === 'completed' ? 'Campaign completed successfully!' : 
             finalStatus === 'canceled' ? 'Campaign was canceled.' : 
             finalStatus === 'failed' ? 'Campaign failed.' : 
             'Campaign status unknown.'
  });
  
  // Set campaign as not in progress
  campaignInProgress = false;
  
  // Keep progress section visible but mark as completed
  if (progressSection) {
    progressSection.classList.add('completed');
    progressSection.classList.remove('active');
  }
  
  // Re-enable campaign start button after a delay
  setTimeout(() => {
    const startBtn = document.getElementById('startCampaignBtn');
    if (startBtn) {
      startBtn.disabled = false;
       }
  }, 2000);
  
  console.log('Campaign monitoring stopped with status: ' + finalStatus);
}

// Check campaign status with improved error handling
function checkCampaignStatus() {
  if (!campaignInProgress) return;
  
  // Check if we have an active port
  if (!campaignPort) {
    // Try to get campaign status directly from background
    chrome.runtime.sendMessage({ action: 'getCampaignStatus' }, (response) => {
      handleStatusResponse(response);
    });
    return;
  }
  
  // If we do have a port, query through it (this should be more reliable)

  try {
    campaignPort.postMessage({ action: 'getCampaignStatus' });
  } catch (error) {
    console.error('Error querying status through port:', error);
    
    // Port may be closed, try direct message instead
    chrome.runtime.sendMessage({ action: 'getCampaignStatus' }, (response) => {
      handleStatusResponse(response);
       });
  }
}

// Handle campaign status response with detailed analytics
function handleStatusResponse(response) {
  if (!response || !response.success) {
    // No campaign running or error
    statusUpdateCounter++;
    
    // If we've had several failed status checks (10), assume campaign is not running
    if (statusUpdateCounter > 10) {
      stopCampaignMonitoring('unknown');
    }
    return;
  }
  
  // Reset counter on successful update
  statusUpdateCounter = 0;
  
  // Check if this is a new status update (avoid processing duplicates)
  if (lastStatusUpdate && response.campaignStatus && 
      response.campaignStatus.lastUpdateTime === lastStatusUpdate.lastUpdateTime) {
    return; // Skip duplicate update
  }
  
  // Store last update
  lastStatusUpdate = response.campaignStatus;
  
  // Add to timeline for analytics
  if (response.campaignStatus) {
    campaignStatusTimeline.push({
      time: new Date().toISOString(),
      status: response.campaignStatus.status,
      sentCount: response.campaignStatus.sentCount || 0,
      failedCount: response.campaignStatus.failedCount || 0
    });
  }
  
  // Update UI
  updateProgressUI(response.campaignStatus);
  
  // Check if campaign is completed/canceled/failed
  if (response.campaignStatus && 
      ['completed', 'canceled', 'failed'].includes(response.campaignStatus.status)) {
    stopCampaignMonitoring(response.campaignStatus.status);
  }
}

// Enhanced progress UI updater with animations and detailed stats
function updateProgressUI(status) {
  if (!status) return;
  
  // Calculate progress percentage
  let percent = 0;
  let statusText = 'Preparing...';
  let sentCount = status.sentCount || 0;
  let failedCount = status.failedCount || 0;
  let totalCount = status.totalContacts || 0;
  
  // Override total count if we have it from campaign settings
  if (status.contacts && status.contacts.length) {
    totalCount = status.contacts.length;
  }
  
  // Calculate percent only if we have a valid total
  if (totalCount > 0) {
    const processedCount = sentCount + failedCount;
    percent = Math.round((processedCount / totalCount) * 100);
  }
  
  // Status text based on current status
  switch (status.status) {
    case 'starting':
      statusText = 'Starting campaign...';
      break;
    case 'sending':
      statusText = `Sending to contact ${status.currentIndex + 1}/${totalCount}`;
      if (status.currentContactName && status.currentPhone) {
        statusText += `: ${status.currentContactName} (${status.currentPhone})`;
      }
      break;
    case 'waiting':
      statusText = 'Waiting before next message...';
      if (status.waitEndTime) {
        const waitEnd = new Date(status.waitEndTime);
        const now = new Date();
        const waitSeconds = Math.max(0, Math.round((waitEnd - now) / 1000));
        if (waitSeconds > 0) {
          statusText += ` (${waitSeconds}s)`;
        }
      }
      break;
    case 'batch_delay':
      statusText = 'Waiting between batches...';
      if (status.nextBatchTime) {
        const batchStartTime = new Date(status.nextBatchTime);
        const now = new Date();
        const minutesLeft = Math.max(0, Math.round((batchStartTime - now) / 60000));
        if (minutesLeft > 0) {
          statusText += ` (${minutesLeft}m)`;
        }
      }
      break;
    case 'batch_completed':
      statusText = `Batch ${status.completedBatches} completed.`;
      break;
    case 'completed':
      statusText = 'Campaign completed successfully!';
      break;
    case 'canceled':
      statusText = 'Campaign was canceled.';
      break;
    case 'failed':
      statusText = 'Campaign failed.';
      break;
    case 'recovering':
      statusText = 'Recovering from interruption...';
      break;
    case 'auto_reset':
      statusText = 'Auto-resolving stuck state...';
      break;
    default:
      statusText = status.status || 'Processing...';
  }
  
  // Update UI elements if they exist
  if (progressBar) {
    // Animate progress bar
    const currentWidth = parseInt(progressBar.style.width || '0');
    if (percent > currentWidth) {
      // Smooth animation for increasing progress
      animateProgressBar(currentWidth, percent);
    } else {
      // Immediate update for decreasing progress (shouldn't happen often)
      progressBar.style.width = `${percent}%`;
    }
    
    // Update aria values for accessibility
    progressBar.setAttribute('aria-valuenow', percent);
    progressBar.setAttribute('aria-valuetext', `${percent}% complete`);
  }
  
  if (progressPercentage) {
    progressPercentage.textContent = `${percent}%`;
  }
  
  if (progressCount) {
    progressCount.textContent = `${sentCount} of ${totalCount} sent`;
    if (failedCount > 0) {
      progressCount.textContent += ` (${failedCount} failed)`;
    }
  }
  
  if (sendingStatus) {
    // Add an animation class when status changes
    const currentText = sendingStatus.textContent;
    if (currentText !== statusText) {
      sendingStatus.classList.add('status-change');
      setTimeout(() => {
        sendingStatus.classList.remove('status-change');
      }, 500);
    }
    sendingStatus.textContent = statusText;
  }
  
  // Update detailed stats if available
  if (campaignStats && totalCount > 0) {
    let statsHtml = `
      <div class="stat-item">
        <span class="stat-label">Sent:</span>
        <span class="stat-value success">${sentCount}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Failed:</span>
        <span class="stat-value ${failedCount > 0 ? 'error' : ''}">${failedCount}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Progress:</span>
        <span class="stat-value">${percent}%</span>
      </div>
    `;
    
    // Add success rate if we have sent or failed messages
    if (sentCount > 0 || failedCount > 0) {
      const successRate = Math.round((sentCount / (sentCount + failedCount)) * 100) || 0;
      statsHtml += `
        <div class="stat-item">
          <span class="stat-label">Success Rate:</span>
          <span class="stat-value ${successRate > 90 ? 'success' : successRate > 70 ? 'warning' : 'error'}">${successRate}%</span>
        </div>
      `;
    }
    
    // Add time info if available
    if (status.startTime) {
      const startTime = new Date(status.startTime);
      const formattedStart = startTime.toLocaleTimeString();
      statsHtml += `
        <div class="stat-item">
          <span class="stat-label">Started:</span>
          <span class="stat-value">${formattedStart}</span>
        </div>
      `;
      
      // Add elapsed time if still running
      if (!['completed', 'canceled', 'failed'].includes(status.status)) {
        const elapsed = Math.round((new Date() - startTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        statsHtml += `
          <div class="stat-item">
            <span class="stat-label">Elapsed:</span>
            <span class="stat-value">${minutes}m ${seconds}s</span>
          </div>
        `;
      }
      
      // Add end time if completed
      if (status.endTime) {
        const endTime = new Date(status.endTime);
        const formattedEnd = endTime.toLocaleTimeString();
        const duration = Math.round((endTime - startTime) / 1000);
        const durationMinutes = Math.floor(duration / 60);
        const durationSeconds = duration % 60;
        
        statsHtml += `
          <div class="stat-item">
            <span class="stat-label">Ended:</span>
            <span class="stat-value">${formattedEnd}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Duration:</span>
            <span class="stat-value">${durationMinutes}m ${durationSeconds}s</span>
          </div>
        `;
      }
    }
    
    // Add sending method info if available
    if (status.successDetails && status.successDetails.method) {
      statsHtml += `
        <div class="stat-item">
          <span class="stat-label">Send Method:</span>
          <span class="stat-value">${status.successDetails.method}</span>
        </div>
      `;
    }
    
    campaignStats.innerHTML = statsHtml;
  }
  
  // Show errors if available
  if (campaignErrors && status.errorLog && status.errorLog.length > 0) {
    let errorsHtml = '<h4>Recent Errors:</h4><ul class="error-list">';
    
    status.errorLog.forEach(error => {
      errorsHtml += `<li>${error}</li>`;
    });
    
    errorsHtml += '</ul>';
    
    // Show the errors
    campaignErrors.innerHTML = errorsHtml;
    campaignErrors.style.display = 'block';
  } else if (campaignErrors) {
    // No errors to show
    campaignErrors.style.display = 'none';
  }
  
  // Update buttons based on campaign state
  updateCampaignControlButtons(status.status);
}

// Animate progress bar for smoother transitions
function animateProgressBar(from, to) {
  if (!progressBar) return;
  
  // Cancel any existing animation
  if (progressBar._animation) {
    clearInterval(progressBar._animation);
  }
  
  const duration = 500; // ms
  const steps = 20;
  const increment = (to - from) / steps;
  let current = from;
  let step = 0;
  
  progressBar._animation = setInterval(() => {
    step++;
    current += increment;
    
    // Ensure we don't exceed target
    if ((increment > 0 && current >= to) || (increment < 0 && current <= to) || step >= steps) {
      clearInterval(progressBar._animation);
      progressBar.style.width = `${to}%`;
      return;
    }
    
    progressBar.style.width = `${Math.round(current)}%`;
  }, duration / steps);
}

// Update campaign control buttons based on status
function updateCampaignControlButtons(status) {
  const startBtn = document.getElementById('startCampaignBtn');
  const cancelBtn = document.getElementById('cancelCampaignBtn');
  const resetBtn = document.getElementById('resetCampaignBtn');
  
  if (!startBtn || !cancelBtn || !resetBtn) return;
  
  // Active campaign states
  const activeStates = ['starting', 'sending', 'waiting', 'batch_delay', 'batch_completed', 'recovering', 'auto_reset'];
  
  if (activeStates.includes(status)) {
    // Campaign is active
    startBtn.disabled = true;
    cancelBtn.disabled = false;
    cancelBtn.style.display = 'inline-block';
    resetBtn.disabled = true;
  } else if (['completed', 'canceled', 'failed'].includes(status)) {
    // Campaign is finished
    startBtn.disabled = false;
    cancelBtn.disabled = true;
    cancelBtn.style.display = 'none';
    resetBtn.disabled = false;
  } else {
    // Default state (no campaign or unknown)
    startBtn.disabled = false;
    cancelBtn.disabled = true;
    cancelBtn.style.display = 'none';
    resetBtn.disabled = false;
  }
}

// Enhanced campaign cancel function with confirmation
async function cancelActiveCampaign() {
  if (!campaignInProgress) {
    toast('No active campaign to cancel', 'warning');
    return;
  }
  
  // Ask for confirmation
  if (!confirm('Are you sure you want to cancel the active campaign? This cannot be undone.')) {
    return;
  }
  
  try {
    // Try to cancel via port first
    if (campaignPort) {
      campaignPort.postMessage({ action: 'cancelCampaign' });
      toast('Canceling campaign...', 'info');
    } else {
      // Fall back to direct message
      chrome.runtime.sendMessage(
        { action: 'cancelCampaign' },
        (response) => {
          if (response && response.success) {
            toast('Campaign canceled successfully', 'success');
            stopCampaignMonitoring('canceled');
          } else {
            toast('Failed to cancel campaign: ' + (response?.error || 'Unknown error'), 'error');
          }
        }
      );
    }
  } catch (error) {
    console.error('Error canceling campaign:', error);
    toast('Error canceling campaign: ' + error.message, 'error');
  }
}

// Enhanced campaign error handling and reporting
function processCampaignError(error) {
  console.error('Campaign error:', error);
  
  // Update UI
  if (sendingStatus) {
    sendingStatus.textContent = 'Campaign error: ' + (error.message || 'Unknown error');
    sendingStatus.classList.add('error');
  }
  
  // Add to campaign errors
  if (campaignErrors) {
    if (!campaignErrors.innerHTML) {
      campaignErrors.innerHTML = '<h4>Campaign Errors:</h4><ul class="error-list"></ul>';
    }
    
    const errorList = campaignErrors.querySelector('.error-list');
    if (errorList) {
      const errorItem = document.createElement('li');
      errorItem.textContent = error.message || 'Unknown error';
      errorList.appendChild(errorItem);
      
      // Show the errors section
      campaignErrors.style.display = 'block';
    }
  }
  
  // Show toast notification
  toast('Campaign error: ' + (error.message || 'Unknown error'), 'error');
}

// Reconnect to an active campaign if page is refreshed
function checkForActiveCampaign() {
  // First check if there was a recent reset operation
  chrome.storage.local.get(['campaignResetTimestamp'], (resetResult) => {
    const resetTimestamp = resetResult.campaignResetTimestamp || 0;
    const currentTime = Date.now();
    const timeSinceReset = currentTime - resetTimestamp;
    
    // If a reset happened in the last 10 seconds, don't try to reconnect
    if (resetTimestamp && timeSinceReset < 10000) {
      console.log('Recent campaign reset detected, not attempting to reconnect');
      return;
    }
    
    // No recent reset, check for active campaign
    chrome.runtime.sendMessage({ action: 'getCampaignStatus' }, (response) => {
      if (response && response.success && response.campaignStatus) {
        // There's an active campaign, reconnect to it
        const status = response.campaignStatus;
        
        if (!['completed', 'canceled', 'failed', 'reset'].includes(status.status)) {
          console.log('Reconnecting to active campaign with status:', status.status);
          startCampaignMonitoring();
          
          // Update UI with current status
          updateProgressUI(status);
          
          // Show toast notification
          toast('Reconnected to active campaign', 'info');
        }
      }
    });
  });
}

// Start campaign with the direct approach
async function startCampaign(campaignSettings) {
    try {
        // Check for active campaign first
        const activeCampaign = await checkForActiveCampaign();
        if (activeCampaign) {
            toast('Please stop the active campaign first', 'error');
            return;
        }

        // Get current contact sources
        const result = await chrome.storage.local.get(['parsedData', 'manualNumbers', 'activeInputSource']);
        
        // Validate contact sources
        if (!result.activeInputSource) {
            toast('Please add contacts before starting a campaign', 'error');
            return;
        }

        // Check if we have valid contacts
        let contacts = [];
        if (result.activeInputSource === 'file') {
            if (!result.parsedData || result.parsedData.length === 0) {
                toast('Please upload a valid contact file', 'error');
                return;
            }
            contacts = result.parsedData;
        } else if (result.activeInputSource === 'manual') {
            if (!result.manualNumbers || result.manualNumbers.trim() === '') {
                toast('Please enter phone numbers', 'error');
                return;
            }
            // Parse manual numbers (returns Promise<string[]>) – import helper on demand to avoid scope issues
            const { parseManualNumbers } = await import('./contactManager.js');
            const manualNumbersArr = await parseManualNumbers(result.manualNumbers, toast);
            if (!manualNumbersArr || manualNumbersArr.length === 0) {
                toast('No valid phone numbers found', 'error');
                return;
            }
            // Convert to contact objects with Phone property for downstream compatibility
            contacts = manualNumbersArr.map(entry => {
                if (typeof entry === 'string') {
                    return { Phone: entry };
                } else if (typeof entry === 'object' && entry !== null) {
                    // If already has Phone property, use it; otherwise look for phone/text variations
                    if (entry.Phone) {
                        return { ...entry, Phone: entry.Phone };
                    }
                    if (entry.phone) {
                        return { ...entry, Phone: entry.phone };
                    }
                    // Fallback: stringify the entry
                    return { Phone: String(entry) };
                }
                // Fallback for unexpected types
                return { Phone: String(entry) };
            });
        }

        // Validate message content
        const messageContent = document.getElementById('editor').innerHTML;
        if (!messageContent || messageContent.trim() === '') {
            toast('Please enter a message', 'error');
            return;
        }

        // Create campaign settings
        const settings = {
            ...campaignSettings,
            contacts,
            message: messageContent,
            source: result.activeInputSource
        };

        // Start the campaign
        await startCampaignDirectly(settings);
        
    } catch (error) {
        console.error('Error starting campaign:', error);
        toast('Failed to start campaign: ' + error.message, 'error');
    }
}

// Start campaign using direct method without ports
function startCampaignDirectly(campaignSettings) {
  console.log('Starting campaign directly using WhatsApp URL scheme...');
  
  if (!campaignSettings || !campaignSettings.contacts || !campaignSettings.contacts.length) {
    toast('No contacts specified', 'error');
    return;
  }
  
  if (!campaignSettings.message) {
    toast('No message specified', 'error');
    return;
  }
  
  // Validate phone numbers
  const invalidNumbers = [];
  if (campaignSettings.skipInvalidNumbers) {
    // Filter contacts with valid phone numbers
    campaignSettings.contacts = campaignSettings.contacts.filter(contact => {
      const isValid = isValidPhoneNumber(contact.Phone);
      if (!isValid) {
        invalidNumbers.push(contact.Phone);
      }
      return isValid;
    });
  }
  
  // Show warning if no valid contacts
  if (campaignSettings.contacts.length === 0) {
    toast('No valid contacts to send to', 'error');
    return;
  }
  
  // Show warning about invalid numbers
  if (invalidNumbers.length > 0) {
    toast(`${invalidNumbers.length} invalid numbers skipped`, 'warning');
  }
  
  // Display starting message
  toast("Starting campaign...", "info");
  
  // Persist settings first so background can retrieve full contacts without huge message
  chrome.storage.local.set({ pendingCampaignSettings: campaignSettings }, () => {
    chrome.runtime.sendMessage({
      action: 'startCampaignDirectly',
      campaignSettings: { idPlaceholder: true } // minimal stub
    }).then(response => {
      if (response.success) {
        // Store campaign ID for navigation
        const campaignId = response.campaignId;
        window.location.href = chrome.runtime.getURL(`html/campaign-progress.html?id=${campaignId}`);
      } else {
        toast(response.error || 'Failed to start campaign', 'error');
      }
    }).catch(error => {
      toast('Error starting campaign: ' + error.message, 'error');
    });
  });
}

// Validate phone number for WhatsApp
function isValidPhoneNumber(phone) {
  return validatePhoneInput(phone);
}

// Connect to background script for sending
function connectToBackground() {
  try {
    // Try direct connection method first before falling back to port
    const bgPort = chrome.runtime.connect({ name: 'sender' });
    
    bgPort.onMessage.addListener(function(message) {
      if (message.type === 'sendResult') {
        handleSendResult(message);
      } else if (message.type === 'error') {
        displayErrorMessage(message.error);
        enableSendButton();
      } else if (message.type === 'campaignProgress') {
        updateCampaignProgress(message.data);
      }
    });
    
    bgPort.onDisconnect.addListener(function() {
      console.log('Background connection closed');
      if (chrome.runtime.lastError) {
        console.error('Connection error:', chrome.runtime.lastError);
      }
      
      // Try direct sending if connection fails
      useDirect = true;
    });
    
    return bgPort;
  } catch (e) {
    console.error('Failed to connect to background:', e);
    // Use direct sending as fallback
    useDirect = true;
    return null;
  }
}

// Setup direct sender
let useDirect = false;
async function initializeDirectSender() {
  // Deprecated: direct sender no longer used after legacy engine adoption
  useDirect = false;
  return false;
}

// Try to initialize direct sender on page load
initializeDirectSender();

// Send a message or start campaign
async function sendMessage(options) {
  // Disable send button while processing
  disableSendButton();
  
  // Check if we should use direct sender
  if (useDirect) {
    try {
      // For single message
      if (options.type === 'single') {
        const result = await directSender.sendMessage(options.phone, options.message);
        handleSendResult({
          success: result.success,
          error: result.error,
          phone: options.phone
        });
      } 
      // For campaign
      else if (options.type === 'campaign') {
        startDirectCampaign(options);
      }
    } catch (error) {
      displayErrorMessage(`Error using direct sender: ${error.message}`);
      enableSendButton();
    }
  } 
  // Fall back to traditional port method
  else {
    if (!bgPort) {
      bgPort = connectToBackground();
      if (!bgPort) {
        displayErrorMessage('Failed to connect to background script');
        enableSendButton();
        return;
      }
    }
    
    // Try legacy port-based sending
    bgPort.postMessage({
      action: 'sendMessage',
      ...options
    });
  }
}

// Start campaign using direct sender
async function startDirectCampaign(options) {
  try {
    // Prepare contacts for campaign
    const contacts = options.contacts.map(phone => ({ Phone: phone }));
    
    // Flag to ensure forced silent self-message is sent only once (5th contact)
    let forcedSafetySent = false;
    
    // Set up progress tracking
    let campaign = {
      id: Date.now().toString(),
      startTime: new Date().toISOString(),
      status: 'running',
      totalContacts: contacts.length,
      sentCount: 0,
      failedCount: 0,
      currentIndex: 0,
      message: options.message,
      // expose key delay settings so content-script can compute the same gap
      randomTimeGapEnabled: options.settings?.randomTimeGapEnabled ?? true,
      randomTimeGapMin: options.settings?.randomTimeGapMin ?? 6,
      randomTimeGapMax: options.settings?.randomTimeGapMax ?? 10,
      humanPatternEnabled: options.settings?.humanPatternEnabled ?? false,
      humanPatternIntensity: options.settings?.humanPatternIntensity ?? 0,
      splitBatchesEnabled: options.settings?.splitBatchesEnabled ?? false,
      batchSizeMin: options.settings?.batchSize ?? 40,
      batchSizeMax: options.settings?.batchSizeMax || 50,
      delayBetweenBatchesMin: options.settings?.delayBetweenBatchesMin ?? options.settings?.delayBetweenBatches ?? 20,
      delayBetweenBatchesMax: options.settings?.delayBetweenBatchesMax || 50,
      settings: options // keep full settings for backward compatibility
    };
    
    // Save initial campaign state
    updateCampaign(campaign);
    
    // Process campaign in batches – honour new universal property names
    const useBatches = (options.settings?.splitBatchesEnabled ?? options.settings?.splitBatches) || false;
    const batchSizeMin = options.settings?.batchSizeMin ?? options.settings?.batchSize ?? 79;
    const batchSizeMax = options.settings?.batchSizeMax ?? batchSizeMin;
    const delayMin = options.settings?.delayBetweenBatchesMin ?? options.settings?.delayBetweenBatches ?? 20;
    const delayMax = options.settings?.delayBetweenBatchesMax ?? delayMin;
    
    // Helper to pick random int inclusive
    const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    
    let batchSize = randInt(batchSizeMin, batchSizeMax);
    let batchDelay = randInt(delayMin, delayMax); // minutes
    
    // Time-gap handling (human-like delays)
    const randomDelayEnabled = (options.settings?.randomTimeGapEnabled ?? options.settings?.randomTimeGap) !== false; // default true
    const minDelay = options.settings?.randomTimeGapMin ?? 15;  // seconds
    const maxDelay = options.settings?.randomTimeGapMax ?? 20; // seconds
    
    // Prepare all contacts
    const allContacts = contacts.map((phone, index) => ({
      Phone: phone,
      Name: `Contact ${index + 1}`,
      Index: index
    }));
    
    let currentBatch = 1;
    const totalBatches = useBatches ? Math.ceil(allContacts.length / batchSize) : 1;
    
    // Process contacts in batches
    for (let i = 0; i < allContacts.length; i += (useBatches ? batchSize : allContacts.length)) {
      // Get current batch of contacts
      const batchContacts = allContacts.slice(i, i + (useBatches ? batchSize : allContacts.length));
      
      // Update campaign status for this batch
      campaign = {
        ...campaign,
        currentBatch,
        totalBatches,
        status: 'sending'
      };
      updateCampaign(campaign);
      
      // Send batch using time intervals
      for (let j = 0; j < batchContacts.length; j++) {
        // honour pause/resume/abort signals
        await ensureRunning();
        const contact = batchContacts[j];
        const absoluteIndex = i + j;

        // Force silent self-message on the 5th contact with longer delay
        if (!forcedSafetySent && absoluteIndex === 4) {
          forcedSafetySent = true;
          try {
            // Wait 3 seconds before sending safety message to avoid performance issues
            await new Promise(r => setTimeout(r, 3000));
            
            chrome.storage.local.get('waUserPhoneNumberResult', (res) => {
              const entry = res.waUserPhoneNumberResult;
              const selfNumber = entry && entry.number ? entry.number : '';
              chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
                if (tabs && tabs.length > 0) {
                  chrome.tabs.sendMessage(tabs[0].id, {
                    action: 'sendSafetyMessage',
                    number: selfNumber,
                    message: '.'
                  }, (response) => {
                    console.log('[WA-Sender] Safety message sent with delay:', response);
                  });
                } else {
                  console.warn('[WA-Sender] No WhatsApp tab found to send safety message');
                }
              });
            });
            
            // Wait another 2 seconds after sending to let it complete
            await new Promise(r => setTimeout(r, 2000));
          } catch (err) {
            console.error('[WA-Sender] Error sending safety message:', err);
          }
        }

        try {
          // Calculate delay based on settings
          const turboEnabled = options.settings?.turboModeEnabled === true;
          let delay = 0;
          if (!turboEnabled) {
          if (randomDelayEnabled) {
            delay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay) * 1000; // ms
          } else if (minDelay > 0) {
            delay = minDelay * 1000;
            }
          }
          
          // Update with current contact
          updateCurrentNumber(contact.Phone); // notify content-script floating UI
          campaign = {
            ...campaign,
            currentIndex: absoluteIndex,
            currentNumber: contact.Phone,
            status: 'sending'
          };
          updateCampaign(campaign);
          
          // Send the message
          const result = await directSender.sendMessage(contact.Phone, options.message);
          
          // Update campaign with result
          if (result.success) {
            campaign.sentCount++;
          } else {
            campaign.failedCount++;
            campaign.lastError = result.error;
          }
          
          // Save progress
          updateCampaign(campaign);
          
          // Update UI
          updateCampaignProgress({
            total: allContacts.length,
            current: absoluteIndex + 1,
            success: campaign.sentCount,
            failed: campaign.failedCount,
            batch: {
              current: currentBatch,
              total: totalBatches
            }
          });
          
          // Apply delay between messages (if not the last message)
          if (j < batchContacts.length - 1) {
            if (turboEnabled) {
              // small fixed wait to let WA queue the message
              await new Promise(r=>setTimeout(r,200));
            } else if (delay > 0) {
            campaign = await waitWithPause(delay, 'waiting', campaign);
            }
          }
        } catch (error) {
          console.error(`Error sending to ${contact.Phone}:`, error);
          campaign.failedCount++;
          campaign.lastError = error.message;
          updateCampaign(campaign);
        }
      }
      
      // Apply batch delay if there are more batches
      if (useBatches && currentBatch < totalBatches) {
        // Pick fresh random delay for next cooldown
        batchDelay = randInt(delayMin, delayMax);
        const delayMs = batchDelay * 60 * 1000;
        campaign = await waitWithPause(delayMs, 'batch_delay', { ...campaign, completedBatches: currentBatch });
        currentBatch++;
        // Pick new random batch size for next batch
        batchSize = randInt(batchSizeMin, batchSizeMax);
      }
    }
    
    // Campaign completed
    campaign = {
      ...campaign,
      status: 'completed',
      completionTime: new Date().toISOString()
    };
    updateCampaign(campaign);
    
    // Update UI with final status
    displaySuccessMessage(`Campaign completed: ${campaign.sentCount} sent, ${campaign.failedCount} failed`);
    enableSendButton();
    
  } catch (error) {
    console.error('Campaign execution error:', error);
    displayErrorMessage(`Campaign failed: ${error.message}`);
    enableSendButton();
  }
}

// Update campaign data
function updateCampaign(campaign) {
  // Save to storage
  chrome.storage.local.set({ activeCampaign: campaign });
  
  // Notify other parts of the extension
  chrome.runtime.sendMessage({
    action: 'campaignStatusUpdate',
    status: campaign
  }).catch(error => {
    console.error('Error notifying about campaign update:', error);
  });
}

export function populateVariableDropdown(dynamicVariables, parsedData, editor, variableError) {
  if (!dynamicVariables) return;
  while (dynamicVariables.firstChild) dynamicVariables.removeChild(dynamicVariables.firstChild);

  chrome.storage.local.get(['activeInputSource'], (result) => {
    // Only show variables if parsedData[0] is a non-null object (CSV upload)
    if (
      !Array.isArray(parsedData) ||
      parsedData.length === 0 ||
      typeof parsedData[0] !== 'object' ||
      parsedData[0] === null ||
      result.activeInputSource === 'manual'
    ) {
      const noVariablesMsg = document.createElement('div');
      noVariablesMsg.className = 'variable-item no-data';
      noVariablesMsg.textContent = 'No variables available.';
      dynamicVariables.appendChild(noVariablesMsg);
      return;
    }

    // Only reach here for CSV upload with object data
    const headers = Object.keys(parsedData[0]);
    headers.forEach(header => {
      const button = document.createElement('button');
      button.className = 'variable-option';
      button.textContent = `{{${header}}}`;
      button.setAttribute('data-variable', header);
      button.addEventListener('click', () => {
        const variableText = `{{${header}}}`;
        if (editor) {
          insertTextIntoEditor(editor, variableText);
          const variableMenu = document.getElementById('variableMenu');
          if (variableMenu) variableMenu.style.display = 'none';
        }
      });
      dynamicVariables.appendChild(button);
    });
  });
}

/**
 * Update the floating UI with the current phone number being processed
 * @param {string} phoneNumber - The phone number currently being processed
 */
function updateCurrentNumber(phoneNumber) {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    const activeTab = tabs[0];
    if (activeTab) {
      chrome.tabs.sendMessage(activeTab.id, {
        action: 'updateCurrentNumber',
        phoneNumber: phoneNumber
      }).catch(error => console.error('[WA-Sender] Error updating current number:', error));
    }
  });
}

/**
 * Send a message to a contact
 * @param {object} contact - Contact object with phone number and variables
 * @param {string} messageTemplate - Message template with placeholders
 * @param {object} settings - Sending settings
 * @param {File} attachment - Attachment file (optional)
 * @returns {Promise} - Resolves when message is sent
 */
async function sendMessageToContact(contact, messageTemplate, settings, attachment) {
  return new Promise((resolve, reject) => {
    try {
      // Get phone number and format message for this contact
      const phoneNumber = contact.phone;
      
      // Update the UI to show which number is being processed
      updateCurrentNumber(phoneNumber);
      
      const formattedMessage = replaceVariables(messageTemplate, contact);
      
      // Send message to content script
      chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
        const activeTab = tabs[0];
        if (!activeTab) {
          reject(new Error('No active tab found'));
          return;
        }
        
        // ... existing code ...
      });
    } catch (error) {
      console.error('[WA-Sender] Error in sendMessageToContact:', error);
      reject(error);
    }
  });
}

// ---------------- Global direct-campaign control (for Pause/Resume/Stop from floating-UI) ----------------
let directCampaignState = 'running'; // 'running' | 'paused' | 'aborted'

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch(msg.action){
    case 'pauseCampaign':
      directCampaignState = 'paused';
      return sendResponse && sendResponse({success:true});
    case 'resumeCampaign':
      directCampaignState = 'running';
      return sendResponse && sendResponse({success:true});
    case 'abortCampaign':
      directCampaignState = 'aborted';
      return sendResponse && sendResponse({success:true});
    default:
      break;
  }
});

// Helper to wait while paused or exit if aborted
async function ensureRunning() {
  while(directCampaignState==='paused'){
    await new Promise(r=>setTimeout(r,500));
  }
  if(directCampaignState==='aborted') throw new Error('direct_campaign_aborted');
}

// Wait for a given duration (ms) while honouring pause/resume and keeping UI timers accurate
async function waitWithPause(totalMs, statusType, campaign, extraFields = {}) {
  let remaining = totalMs;
  let endTime = Date.now() + remaining;
  while (remaining > 0) {
    // If we are currently paused, freeze the countdown until resumed
    if (directCampaignState === 'paused') {
      const pauseStarted = Date.now();
      await ensureRunning(); // this will return only when resumed or aborted
      const pausedDuration = Date.now() - pauseStarted;
      endTime += pausedDuration; // extend the end-time so user still waits full period
    }

    // Update campaign object so floating-UI sees countdown
    const countdownFields = (statusType === 'waiting')
      ? { waitEndTime: endTime }
      : { nextBatchTime: endTime };
    const updatedCampaign = { ...campaign, status: statusType, ...countdownFields, ...extraFields };
    updateCampaign(updatedCampaign);

    // Sleep in small slices so pause can be detected quickly
    const slice = Math.min(500, remaining);
    await new Promise(r => setTimeout(r, slice));
    remaining = endTime - Date.now();
    campaign = updatedCampaign; // propagate latest object to caller
  }
  return campaign;
}

// --- Timestamp Toggle Handling ---
const timestampToggle = document.getElementById('timestampToggle');
if (timestampToggle) {
  const timestampWarning = document.getElementById('timestamp-warning');

  const updateWarningVisibility = () => {
    if (timestampWarning) {
      timestampWarning.style.display = timestampToggle.checked ? 'none' : 'block';
    }
  };

  chrome.storage.local.get(['addTimestamp'], (result) => {
    // Default to true if not set
    timestampToggle.checked = result.addTimestamp !== false;
    updateWarningVisibility();
  });

  timestampToggle.addEventListener('change', () => {
    chrome.storage.local.set({ addTimestamp: timestampToggle.checked });
    updateWarningVisibility();
  });
}

// Initialize the sender script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSender);
} else {
  initSender();
}