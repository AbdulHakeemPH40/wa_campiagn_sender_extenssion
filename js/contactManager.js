// js/contactManager.js
import { toast, fileToBase64, base64ToFile, ensureLibraryLoaded, safeAsync, ErrorTypes } from './utils.js';
import { validatePhoneNumber, formatForDisplay, extractPhoneNumbers } from './utils/phoneUtils.js';

const MAX_CONTACTS = 10000; // Maximum allowed contacts per upload
export const MAX_MANUAL_CONTACTS = 5000; // Maximum allowed manual contacts pasted into the numbers list

// Create a global tracking variable for library loading status
const libraryStatus = {
  papaparse: false,
  sheetjs: false
};

// Export the getContacts function to be used by other modules
export function getContacts() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['parsedData'], (result) => {
      if (chrome.runtime.lastError) {
        console.error("Error retrieving contacts:", chrome.runtime.lastError);
        resolve([]);
      } else {
        if (window.contactManager && typeof window.contactManager.getContacts === 'function') {
          // Try to get contacts from the ContactManager instance if available
          const managerContacts = window.contactManager.getContacts();
          if (managerContacts && managerContacts.length > 0) {
            resolve(managerContacts);
            return;
          }
        }
        // Fall back to storage data
        resolve(result.parsedData || []);
      }
    });
  });
}

// Export additional functions needed by sender.js
export function setupContactManager() {
  if (!window.contactManager) {
    window.contactManager = new ContactManager();
  }
  return window.contactManager;
}

export function hasContactsData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['parsedData'], (result) => {
      resolve(!!(result.parsedData && result.parsedData.length > 0));
    });
  });
}

// Preload libraries when the file loads
async function preloadLibraries() {
  try {
    // Try to load PapaParse
    await ensureLibraryLoaded("Papa", "libs/papaparse.min.js", 5000);
    libraryStatus.papaparse = true;
    console.log("PapaParse library loaded successfully");
    
    // Try to load SheetJS
    await ensureLibraryLoaded("XLSX", "libs/xlsx.full.min.js", 5000);
    libraryStatus.sheetjs = true;
    console.log("SheetJS library loaded successfully");
  } catch (error) {
    console.error("Error preloading libraries:", error);
    // Don't show toast here - we'll handle errors when actually using the libraries
  }
}

// Start preloading libraries right away
preloadLibraries();

function showContactUploadError(message) {
  const errorDiv = document.getElementById('contactUploadError');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = message ? 'block' : 'none';
    if (message) {
      // Keep error visible for 10 seconds, then hide
      setTimeout(() => {
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';
      }, 10000);
    }
  }
}

export async function handleFile(file, toast, updateContactUI, parseFile) {
    try {
        // First check if there's an existing file in storage
        const result = await new Promise((resolve) => {
            chrome.storage.local.get(["contactFile", "activeInputSource", "manualNumbers"], resolve);
        });

        // Check if we have manually entered numbers that need to be cleared
        if (result.activeInputSource === 'manual' && result.manualNumbers && result.manualNumbers.trim() !== '') {
            // Show confirmation dialog
            const shouldProceed = await new Promise((resolve) => {
                const conflictDiv = document.getElementById('contactSourceConflict');
                const messageDiv = conflictDiv.querySelector('.conflict-message');
                const switchBtn = conflictDiv.querySelector('.conflict-action-switch');
                const cancelBtn = conflictDiv.querySelector('.conflict-action-cancel');

                messageDiv.innerHTML = '<strong>Contact source conflict:</strong> You already have manually entered numbers. Uploading a CSV file will replace these numbers. What would you like to do?';
                switchBtn.textContent = 'Upload CSV (remove manual numbers)';
                cancelBtn.textContent = 'Keep manual numbers';

                conflictDiv.style.display = 'block';

                switchBtn.onclick = () => {
                    conflictDiv.style.display = 'none';
                    resolve(true);
                };

                cancelBtn.onclick = () => {
                    conflictDiv.style.display = 'none';
                    resolve(false);
                };
            });

            if (!shouldProceed) {
                toast("File upload cancelled", "info");
                return;
            }

            // Clear manual numbers
            const numbersArea = document.getElementById('numbersArea');
            if (numbersArea) {
                numbersArea.value = '';
            }
            
            // Clear manual numbers from storage
            await new Promise(resolve => {
                chrome.storage.local.remove(['manualNumbers'], resolve);
            });
            
            toast("Manual numbers have been cleared as you're now using a contact file", "info");
        }

        if (!file) {
            toast("No file selected", "error");
            return;
        }

        const fileType = file.name.split(".").pop().toLowerCase();
        if (!["csv", "xls", "xlsx"].includes(fileType)) {
            toast("Please upload a CSV, XLS, or XLSX file", "error");
            return;
        }

        const contactFile = {
            name: file.name,
            size: (file.size / 1048576).toFixed(2) + " MB",
        };
        
        // Get UI elements for updating
        const fileNameSpan = document.getElementById('fileName');
        const fileDisplay = document.getElementById('fileDisplay');
        const fileInput = document.getElementById('importContactsInput');
        
        // First ensure we clear any previous file data
        await new Promise(resolve => {
            chrome.storage.local.remove(["contactFile", "contactFileBase64", "parsedData"], resolve);
        });
        
        // Update UI with loading state
        updateContactUI(contactFile, fileNameSpan, fileDisplay, fileInput);
        toast("File uploaded, processing...", "info");
        
        // Process the new file
        const base64String = await fileToBase64(file);
        
        // Validate Base64 string before storing
        if (!base64String || !base64String.includes(",")) {
            throw new Error("Invalid Base64 string generated");
        }
        
        // Save the file data
        await new Promise((resolve, reject) => {
            chrome.storage.local.set(
                {
                    contactFile,
                    contactFileBase64: base64String,
                    activeInputSource: 'file'
                },
                () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                }
            );
        });

        // Parse the file
        const parsedData = await parseFile(file, toast);
        
        // Update variable menu with the new headers
        if (parsedData && parsedData.length > 0) {
            // Import and call updateVariableMenu from sender.js
            const senderModule = await import('./sender.js');
            if (senderModule.updateVariableMenu) {
                senderModule.updateVariableMenu(parsedData);
            }
        }
        
        // Update UI again to ensure filename is displayed correctly
        setTimeout(() => {
            updateContactUI(contactFile, fileNameSpan, fileDisplay, fileInput);
        }, 100);

    } catch (error) {
        console.error("Error handling file:", error);
        toast("Failed to process contact file: " + error.message, "error");
        
        // Reset UI on error
        const fileNameSpan = document.getElementById('fileName');
        const fileDisplay = document.getElementById('fileDisplay');
        const fileInput = document.getElementById('importContactsInput');
        updateContactUI(null, fileNameSpan, fileDisplay, fileInput);
        
        // Clear variable menu
        const senderModule = await import('./sender.js');
        if (senderModule.updateVariableMenu) {
            senderModule.updateVariableMenu([]);
        }
    }
}

export async function parseFile(file, toast) {
  let parsedData = [];
  const fileType = file.name.split(".").pop().toLowerCase();
  const fileNameSpan = document.getElementById('fileName');
  const fileDisplay = document.getElementById('fileDisplay');
  const fileInput = document.getElementById('importContactsInput');
  
  function clearLargeFileUI() {
    console.log("Clearing large contact file from storage and UI...");
    
    // Clear all data from storage completely
    chrome.storage.local.remove(["contactFile", "contactFileBase64", "parsedData", "activeInputSource"], () => {
      console.log("Storage cleared for file data");
      
      // Make multiple attempts to clear UI elements with redundant approaches
      try {
        // Method 1: Direct DOM element manipulation using getElementById
        const fileNameSpanElement = document.getElementById('fileName');
        const fileDisplayElement = document.getElementById('fileDisplay');
        const fileInputElement = document.getElementById('importContactsInput');
        
        if (fileNameSpanElement) {
          fileNameSpanElement.textContent = "";
          fileNameSpanElement.innerText = "";
        }
        
        if (fileDisplayElement) {
          fileDisplayElement.style.display = "none";
          fileDisplayElement.style.visibility = "hidden";
        }
        
        if (fileInputElement) {
          fileInputElement.value = "";
          // Try to trigger change event to ensure file input is updated
          const event = new Event('change', { bubbles: true });
          fileInputElement.dispatchEvent(event);
        }
        
        // Method 2: Also use the function arguments if available
        if (fileNameSpan) fileNameSpan.textContent = "";
        if (fileDisplay) fileDisplay.style.display = "none";
        if (fileInput) fileInput.value = "";
        
        // Method 3: Add a delayed attempt as well
        setTimeout(() => {
          const fileNameDelayed = document.getElementById('fileName');
          const fileDisplayDelayed = document.getElementById('fileDisplay');
          const fileInputDelayed = document.getElementById('importContactsInput');
          
          if (fileNameDelayed) fileNameDelayed.textContent = "";
          if (fileDisplayDelayed) fileDisplayDelayed.style.display = "none";
          if (fileInputDelayed) fileInputDelayed.value = "";
          
          console.log("Completed delayed UI clearing");
        }, 100);
        
        // Force the UI to update by dispatching an event
        document.dispatchEvent(new CustomEvent('contactDataUpdated', {
          detail: { parsedData: [] }
        }));
        
        console.log("Successfully cleared file UI elements");
      } catch (e) {
        console.error("Error while clearing file UI:", e);
      }
    });
  }
  
  // Function to update the Campaign Summary after parsing is complete
  function updateCampaignSummary(parsedData) {
    // Dispatch a custom event to trigger Campaign Summary animation
    const event = new CustomEvent('contactDataUpdated', { 
      detail: { parsedData: parsedData }
    });
    document.dispatchEvent(event);
    
    console.log(`Data parsed and campaign summary update triggered: ${parsedData.length} contacts`);
  }
  
  try {
    if (fileType === "csv") {
      try {
        // Use our new ensureLibraryLoaded function to make sure PapaParse is available
        // This will attempt to load it dynamically if it's not already loaded
        await ensureLibraryLoaded("Papa", "libs/papaparse.min.js", 10000);
        
        Papa.parse(file, {
          complete: function (results) {
            if (results.data.length > MAX_CONTACTS) {
              showContactUploadError(`Maximum ${MAX_CONTACTS} contacts allowed. Your file has ${results.data.length}. Please upload a smaller file.`);
              // Clear the file immediately rather than waiting
              clearLargeFileUI();
              // Hide the error message after 4 seconds
              setTimeout(() => {
                showContactUploadError("");
              }, 4000);
              toast(`Contact file exceeds the maximum allowed (${MAX_CONTACTS}) contacts. File has been removed.`, "error");
              return;
            }
            parsedData = processParsedData(results.data, true, toast);
            chrome.storage.local.set(
              {
                parsedData: parsedData,
                activeInputSource: 'file'  // Ensure activeInputSource is set to 'file'
              },
              () => {
                if (chrome.runtime.lastError) {
                  console.error("Error saving parsed data:", chrome.runtime.lastError);
                  toast("Failed to save parsed data.", "error");
                } else {
                  console.log("Parsed data saved:", parsedData);
                  toast(`Contact file parsed successfully. ${parsedData.length} contacts imported.`, "success");
                  
                  // Ensure the file UI is displayed correctly
                  const fileNameSpan = document.getElementById('fileName');
                  const fileDisplay = document.getElementById('fileDisplay');
                  if (fileNameSpan && fileDisplay && file) {
                    fileNameSpan.textContent = file.name;
                    fileDisplay.style.display = "flex";
                    console.log("Updated UI with file display:", file.name);
                  }
                  
                  // Trigger the Campaign Summary animation
                  updateCampaignSummary(parsedData);
                }
              }
            );
          },
          header: true,
          skipEmptyLines: true,
          error: function (err) {
            toast("Error parsing CSV file: " + err.message, "error");
            console.error("CSV parse error:", err);
          },
        });
      } catch (error) {
        console.error("Failed to load PapaParse library:", error);
        toast("Failed to load PapaParse library for CSV parsing. Using fallback parser.", "warning");
        // Use the fallback parser (already defined in sender.html)
        Papa.parse(file, {
          complete: function (results) {
            if (results.data.length > MAX_CONTACTS) {
              showContactUploadError(`Contact file exceeds the maximum allowed (${MAX_CONTACTS}) contacts. Please upload a smaller file.`);
              setTimeout(clearLargeFileUI, 2000);
              return;
            }
            parsedData = processParsedData(results.data, true, toast);
            chrome.storage.local.set(
              {
                parsedData: parsedData,
              },
              () => {
                if (chrome.runtime.lastError) {
                  console.error("Error saving parsed data:", chrome.runtime.lastError);
                  toast("Failed to save parsed data.", "error");
                } else {
                  console.log("Parsed data saved:", parsedData);
                  toast("Contact file parsed successfully using fallback parser.", "success");
                  // Trigger the Campaign Summary animation
                  updateCampaignSummary(parsedData);
                }
              }
            );
          },
          header: true,
          skipEmptyLines: true,
          error: function (err) {
            toast("Error parsing CSV file with fallback parser: " + err.message, "error");
            console.error("CSV parse error (fallback):", err);
            chrome.storage.local.remove(["parsedData"], () => {
              console.log("Cleared parsed data due to parsing error.");
            });
          },
        });
      }
    } else if (fileType === "xls" || fileType === "xlsx") {
      try {
        // Use our new ensureLibraryLoaded function to make sure XLSX is available
        await ensureLibraryLoaded("XLSX", "libs/xlsx.full.min.js", 10000);
        
        const reader = new FileReader();
        reader.onload = function (e) {
          try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: "array" });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });
            if (json.length - 1 > MAX_CONTACTS) { // -1 for header row
              showContactUploadError(`Maximum ${MAX_CONTACTS} contacts allowed. Your file has ${json.length - 1}. Please upload a smaller file.`);
              // Clear the file immediately rather than waiting
              clearLargeFileUI();
              // Hide the error message after 4 seconds
              setTimeout(() => {
                showContactUploadError("");
              }, 4000);
              toast(`Contact file exceeds the maximum allowed (${MAX_CONTACTS}) contacts. File has been removed.`, "error");
              return;
            }
            parsedData = processParsedData(json, false, toast);
            chrome.storage.local.set(
              {
                parsedData: parsedData,
                activeInputSource: 'file'  // Ensure activeInputSource is set to 'file'
              },
              () => {
                if (chrome.runtime.lastError) {
                  console.error("Error saving parsed data:", chrome.runtime.lastError);
                  toast("Failed to save parsed data.", "error");
                } else {
                  console.log("Parsed data saved:", parsedData);
                  toast(`Contact file parsed successfully. ${parsedData.length} contacts imported.`, "success");
                  
                  // Ensure the file UI is displayed correctly
                  const fileNameSpan = document.getElementById('fileName');
                  const fileDisplay = document.getElementById('fileDisplay');
                  if (fileNameSpan && fileDisplay && file) {
                    fileNameSpan.textContent = file.name;
                    fileDisplay.style.display = "flex";
                    console.log("Updated UI with Excel file display:", file.name);
                    
                    // Make filename clickable for preview
                    fileNameSpan.style.cursor = 'pointer';
                    fileNameSpan.style.color = 'var(--whatsapp-green-dark)';
                    fileNameSpan.style.textDecoration = 'underline';
                  }
                  
                  // Trigger the Campaign Summary animation
                  updateCampaignSummary(parsedData);
                }
              }
            );
          } catch (err) {
            toast("Error parsing Excel file: " + err.message, "error");
            console.error("Excel parse error:", err);
            chrome.storage.local.remove(["parsedData"], () => {
              console.log("Cleared parsed data due to parsing error.");
            });
          }
        };
        reader.onerror = function () {
          toast("Error reading Excel file: " + reader.error.message, "error");
          console.error("FileReader error:", reader.error);
          chrome.storage.local.remove(["parsedData"], () => {
            console.log("Cleared parsed data due to reading error.");
          });
        };
        reader.readAsArrayBuffer(file);
      } catch (error) {
        console.error("Failed to load SheetJS library:", error);
        toast("Failed to load SheetJS library for Excel parsing. Please try again.", "error");
      }
    } else {
      toast("Unsupported file type", "error");
    }
  } catch (error) {
    console.error("Library loading error:", error);
    toast("Required libraries (PapaParse or SheetJS) failed to load: " + error.message, "error");
  }
  return parsedData;
}

// Parse manual numbers with enhanced country code support
export function parseManualNumbers(text, toast) {
  console.log('parseManualNumbers called with text:', text); 
  if (!text || !text.trim()) return [];
  
  // Extract and validate phone numbers
  const numbers = extractPhoneNumbers(text);
  const validatedNumbers = [];
  const invalidNumbers = [];
  
  // Enforce maximum allowed manual contacts
  if (numbers.length > MAX_MANUAL_CONTACTS) {
    const errorMessage = `Maximum ${MAX_MANUAL_CONTACTS} phone numbers allowed for manual entry. You entered ${numbers.length}. Please reduce the list size.`;
    toast(errorMessage, 'error');
    return [];
  }
  
  numbers.forEach(number => {
    const validation = validatePhoneNumber(number);
    if (validation.isValid) {
      validatedNumbers.push({
        phone: validation.formattedNumber,
        displayPhone: formatForDisplay(validation.formattedNumber),
        name: '',
        isValid: true,
        status: 'pending',
        lastAttempt: null,
        error: null
      });
    } else {
      invalidNumbers.push({
        original: number,
        error: validation.error
      });
    }
  });
  
  // Show toast for invalid numbers if any
  if (invalidNumbers.length > 0) {
    const message = `Skipped ${invalidNumbers.length} invalid number(s): ${invalidNumbers.slice(0, 3).map(n => n.original).join(', ')}${invalidNumbers.length > 3 ? '...' : ''}`;
    toast(message, 'warning');
    
    // Log detailed errors to console
    console.warn('Invalid phone numbers detected:', invalidNumbers);
  }
  
  // Update UI with validation results
  updateNumberValidationUI(validatedNumbers, invalidNumbers);
  
  // Persist the parsed contacts and related flags, then resolve
  return new Promise((resolve) => {
    chrome.storage.local.set({
      parsedData: validatedNumbers,
      manualNumbers: text,
      activeInputSource: 'manual'
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving manual numbers:', chrome.runtime.lastError);
        toast('Failed to save manual numbers', 'error');
      } else {
        console.log('Manual numbers saved:', validatedNumbers.length, 'contacts');
        // Inform other components that contact data has changed
        document.dispatchEvent(new CustomEvent('contactDataUpdated', {
          detail: { parsedData: validatedNumbers }
        }));
      }
      console.log('Validated numbers before saving:', validatedNumbers);
      resolve(validatedNumbers);
    });
  });
}

/**
 * Updates the UI to show validation results
 * @param {Array} validNumbers - Array of valid number objects
 * @param {Array} invalidNumbers - Array of invalid number objects
 */
function updateNumberValidationUI(validNumbers, invalidNumbers) {
  const validationResults = document.getElementById('validationResults');
  if (!validationResults) return;
  
  // Clear previous results
  validationResults.innerHTML = '';
  
  // Add valid numbers summary
  if (validNumbers.length > 0) {
    const validEl = document.createElement('div');
    validEl.className = 'validation-valid';
    validEl.innerHTML = `✓ ${validNumbers.length} valid numbers found`;
    validationResults.appendChild(validEl);
  }
  
  // Add invalid numbers summary
  if (invalidNumbers.length > 0) {
    const invalidEl = document.createElement('div');
    invalidEl.className = 'validation-invalid';
    invalidEl.innerHTML = `⚠ ${invalidNumbers.length} invalid numbers detected`;
    
    // Add click to show details
    const detailsBtn = document.createElement('button');
    detailsBtn.className = 'btn-link';
    detailsBtn.textContent = 'Show details';
    detailsBtn.onclick = () => showInvalidNumbersDetails(invalidNumbers);
    
    invalidEl.appendChild(document.createElement('br'));
    invalidEl.appendChild(detailsBtn);
    validationResults.appendChild(invalidEl);
  }
}

/**
 * Shows a detailed modal with invalid numbers and reasons
 * @param {Array} invalidNumbers - Array of invalid number objects
 */
function showInvalidNumbersDetails(invalidNumbers) {
  // Create or find modal
  let modal = document.getElementById('invalidNumbersModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'invalidNumbersModal';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  
  // Escape HTML to prevent XSS
  const escapeHtml = (unsafe) => {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };
  
  // Modal content
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h3>Invalid Phone Numbers</h3>
        <span class="close">&times;</span>
      </div>
      <div class="modal-body">
        <table class="invalid-numbers-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            ${invalidNumbers.map(num => `
              <tr>
                <td>${escapeHtml(num.original)}</td>
                <td>${escapeHtml(num.error)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  
  // Close button functionality
  const closeBtn = modal.querySelector('.close');
  closeBtn.onclick = () => modal.style.display = 'none';
  
  // Close when clicking outside modal
  window.onclick = (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
    }
  };
  
  // Show modal
  modal.style.display = 'block';
}

/**
 * Process file data and extract contacts
 * @param {File} file - The file to process
 * @param {Function} toast - Toast notification function
 * @returns {Promise<Array>} - Promise resolving to array of contact objects
 */
async function processContactFile(file, toast) {
  const fileType = file.name.split('.').pop().toLowerCase();
  
  try {
    // Read file content
    const content = await readFileContent(file);
    
    // Parse based on file type
    if (fileType === 'csv') {
      return await parseCsvContent(content, toast);
    } else if (['xls', 'xlsx'].includes(fileType)) {
      return await parseExcelContent(content, fileType, toast);
    } else {
      throw new Error('Unsupported file type');
    }
  } catch (error) {
    console.error('Error processing contact file:', error);
    toast(`Error processing file: ${error.message}`, 'error');
    throw error;
  }

  // First check if we have a file that needs to be removed
  return new Promise((resolve) => {
    chrome.storage.local.get(['contactFile', 'contactFileBase64', 'activeInputSource'], (result) => {
      // Clear any existing file data if present
      if (result.activeInputSource === 'file' && result.contactFile) {
        // If switching from file to manual, clear the file data
        chrome.storage.local.remove(["contactFile", "contactFileBase64"], () => {
          console.log("Cleared existing file data when switching to manual numbers");
          // Clear file display UI elements
          const fileNameSpan = document.getElementById('fileName');
          const fileDisplay = document.getElementById('fileDisplay');
          const fileInput = document.getElementById('importContactsInput');
          if (fileNameSpan) fileNameSpan.textContent = '';
          if (fileDisplay) fileDisplay.style.display = 'none';
          if (fileInput) fileInput.value = '';
        });
      }
      // Save the manual numbers and set activeInputSource
      chrome.storage.local.set({
        parsedData: parsedData,
        manualNumbers: text,
        activeInputSource: 'manual' // Track that we're using manual entry
      }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error saving manual numbers:", chrome.runtime.lastError);
          toast("Failed to save manual numbers", "error");
          resolve([]);
        } else {
          console.log("Manual numbers saved:", parsedData.length, "contacts");
          toast(`${parsedData.length} phone numbers processed`, "success");
          // IMPORTANT: Trigger the Campaign Summary animation by dispatching an event
          // This ensures the UI updates with the new contacts
          document.dispatchEvent(new CustomEvent('contactDataUpdated', { 
            detail: { parsedData: parsedData }
          }));
          resolve(parsedData);
        }
      });
    });
  });
}

/**
 * Format phone number with enhanced country code handling
 * @param {string} phoneNumber - The raw phone number input
 * @returns {string} - Properly formatted phone number in E.164 (with leading +)
 */
function formatPhoneNumber(phoneNumber) {
  if (!phoneNumber) return phoneNumber;

  // Remove all characters except digits and plus
  let cleaned = phoneNumber.replace(/[^\d+]/g, '');

  // Convert 00 international prefix to +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  }

  // Ensure it starts with +. If it does not, assume user omitted + but included country code
  if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }

  // Remove any duplicated + (e.g., ++123...)
  cleaned = cleaned.replace(/^\++/, '+');

  // Final validation: E.164 allows 8–15 digits after +
  const e164Regex = /^\+[1-9]\d{7,14}$/;
  if (!e164Regex.test(cleaned)) {
    // If invalid, just return the original trimmed input so that other validation can flag it
    return phoneNumber.trim();
  }

  return cleaned;
}

// ==== NEW: universal phone-number validator based on E.164 ====
function validatePhoneInput(input) {
  const phoneInput = (input || '').trim();
  if (!phoneInput) return false;

  // Normalise by converting any leading 00 to +
  let normalised = phoneInput;
  if (normalised.startsWith('00')) {
    normalised = '+' + normalised.slice(2);
  }

  const e164Regex = /^\+[1-9]\d{7,14}$/; // plus followed by 8-15 digits
  const digitsOnlyRegex = /^[1-9]\d{7,14}$/; // 8-15 digits without plus
  return e164Regex.test(normalised) || digitsOnlyRegex.test(normalised);
}

// Function to update number details panel
function updateNumberDetailsPanel(analysisResult) {
  const panel = document.getElementById('numberDetailsPanel');
  const summary = document.getElementById('numberCountSummary');
  const validCount = document.getElementById('validNumbersCount');
  const invalidCount = document.getElementById('invalidNumbersCount');
  
  if (!panel || !summary || !validCount || !invalidCount) return;
  
  // Only show panel if we have numbers
  if (analysisResult.total === 0) {
    panel.style.display = 'none';
    return;
  }
  
  // Update counts
  summary.textContent = `${analysisResult.total} numbers found`;
  validCount.textContent = analysisResult.valid.length;
  invalidCount.textContent = analysisResult.invalid.length;
  
  // Add error class if needed
  if (analysisResult.invalid.length > 0) {
    invalidCount.classList.add('has-error');
  } else {
    invalidCount.classList.remove('has-error');
  }
  
  // Show the panel
  panel.style.display = 'block';
}

// Process Excel/CSV data with enhanced phone number handling
export function processParsedData(data, isCsv, toast) {
  let parsedData = [];
  if (data.length < 1) {
    toast("File is empty", "error");
    return parsedData;
  }
  
  let headers = isCsv ? Object.keys(data[0]) : data[0];
  headers = headers.map((h) => h.trim());
  
  // Check for the exact case-sensitive "Name" and "Phone" headers
  const hasExactPhoneHeader = headers.includes("Phone");
  
  // Check for incorrectly cased headers (for more descriptive error messages)
  const hasLowercasePhoneHeader = headers.some(h => h.toLowerCase() === "phone" && h !== "Phone");
  
  if (!hasExactPhoneHeader) {
    // Create a detailed error message
    let errorMsg = 'File must contain a case-sensitive "Phone" column.';
    
    if (hasLowercasePhoneHeader) {
      errorMsg += ' Found "phone" but it should be "Phone".';
    } else if (!hasExactPhoneHeader) {
      errorMsg += ' Missing "Phone" column.';
    }
    
    // Show error with more context
    showContactUploadError(errorMsg);
    toast(errorMsg, "error");
    return [];
  }
  
  // Process data based on format (CSV or Excel)
  if (isCsv) {
    // CSV data already has headers as object keys
    parsedData = data.filter(row => {
      return row.Name && row.Phone && row.Name.trim() !== '' && row.Phone.trim() !== '';
    }).map(row => {
      // Create a new object with the same properties
      const newRow = {...row};
      // Format the phone number
      if (newRow.Phone) {
        newRow.Phone = formatPhoneNumber(newRow.Phone);
      }
      return newRow;
    });
  } else {
    // Excel data needs to be converted to objects
    const nameIndex = headers.indexOf("Name");
    const phoneIndex = headers.indexOf("Phone");
    
    // Skip header row and create objects
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[phoneIndex] && row[phoneIndex].toString().trim() !== '') {
        
        const contact = {
          Name: row[nameIndex] && row[nameIndex].toString().trim() !== '' ? row[nameIndex].toString().trim() : row[phoneIndex].toString().trim()
        };
        
        // Format the phone number
        contact.Phone = formatPhoneNumber(row[phoneIndex].toString().trim());
        
        // Add all other fields from headers
        headers.forEach((header, index) => {
          if (header !== 'Name' && header !== 'Phone' && row[index] !== undefined) {
            contact[header] = row[index].toString().trim();
          }
        });
        
        parsedData.push(contact);
      }
    }
  }
  
  console.log(`Processed ${parsedData.length} contacts from file with phone number formatting`);
  return parsedData;
}

// Function to update the contact UI
export function updateContactUI(contactFile, fileNameSpan, fileDisplay, fileInput) {
  // Look up elements if they weren't passed in
  fileNameSpan = fileNameSpan || document.getElementById('fileName');
  fileDisplay = fileDisplay || document.getElementById('fileDisplay');
  fileInput = fileInput || document.getElementById('importContactsInput');
  
  if (!fileNameSpan || !fileDisplay) {
    console.error("Missing UI elements for contact display");
    return;
  }

  // Clear any existing input value
  if (fileInput) {
    fileInput.value = "";
  }

  if (contactFile) {
    // Show file info in UI with improved visibility
    fileNameSpan.textContent = contactFile.name;
    fileDisplay.style.display = "flex";
    fileDisplay.classList.add('file-added'); // Add animation class
    
    // Make filename clickable
    fileNameSpan.style.cursor = 'pointer';
    fileNameSpan.style.textDecoration = 'underline';
    fileNameSpan.style.color = 'var(--whatsapp-green-dark)';
    fileNameSpan.title = 'Click to preview contacts';
    
    // Force the layout to refresh (helps with display issues)
    void fileDisplay.offsetHeight; // Force reflow
    
    // Add click event for preview
    fileNameSpan.onclick = () => {
      chrome.storage.local.get(['contactFile', 'parsedData'], (result) => {
        if (result.contactFile && result.parsedData && result.parsedData.length > 0) {
          showContactFilePreview(result.contactFile);
        } else {
          toast("No contact data available for preview", "error");
        }
      });
    };
    
    // Log success with file name for debugging
    console.log("Contact file UI updated:", contactFile.name);
    
    // Add a small delay and double-check the filename is displayed
    setTimeout(() => {
      if (!fileNameSpan.textContent && contactFile.name) {
        fileNameSpan.textContent = contactFile.name;
        console.log("Re-applied filename after delay:", contactFile.name);
      }
    }, 100);
  } else {
    // Clear UI
    fileNameSpan.textContent = "";
    fileDisplay.style.display = "none";
    fileDisplay.classList.remove('file-added');
    if (fileInput) fileInput.value = "";
    fileNameSpan.onclick = null;
    fileNameSpan.style.cursor = '';
    fileNameSpan.style.textDecoration = '';
    fileNameSpan.title = '';
    console.log("Contact file UI cleared");
  }
}

// Download a sample CSV file with various international phone formats
export function downloadSampleCsv(toast) {
  // Create a sample CSV with various phone number formats
  const csvContent = `Name,Phone,Company,Notes
John Doe,+12025550108,Acme Corp,US Format with country code
Jane Smith,2025550109,XYZ Inc,US Format without country code
Abdullah,+971501234567,UAE Company,UAE Format with + prefix
Mohammed,971551234567,Dubai LLC,UAE Format without + prefix
Sara,0551234567,Abu Dhabi Co,UAE Format with leading 0
Ahmed,501234567,Sharjah Ltd,UAE Format mobile only
Fatima,00971561234567,RAK Inc,UAE Format with international prefix
Li Wei,+8613912345678,China Corp,China Format
Maria Garcia,+34612345678,Spain Ltd,Spain Format
Alex Kumar,+919876543210,India Tech,India Format`;

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", "WA_Campaign_sample.csv");
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  toast("Sample CSV with international phone formats downloaded", "success");
}

// Function to show a preview of the contact file data
export function showContactFilePreview(contactFile) {
  // Remove any existing contact preview to avoid duplication
  const existingModal = document.getElementById('contact-preview-modal');
  if (existingModal) {
    existingModal.remove();
    console.log('Removed existing contact preview modal');
  }

  // Get the parsed data from storage
  chrome.storage.local.get(['parsedData'], (result) => {
    if (!result.parsedData || result.parsedData.length === 0) {
      toast("No contact data available to preview", "error");
      return;
    }
    
    // Create modal overlay container (single element to simplify removal)
    const modal = document.createElement('div');
    modal.id = 'contact-preview-modal'; // Add ID for easy reference
    modal.className = 'modal';
    modal.style.display = 'block';
    modal.style.position = 'fixed';
    modal.style.zIndex = '1000';
    modal.style.left = '0';
    modal.style.top = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.overflow = 'auto';
    modal.style.backgroundColor = 'rgba(0,0,0,0.4)';
    
    // Create modal content
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.backgroundColor = '#fefefe';
    modalContent.style.margin = '5% auto';
    modalContent.style.padding = '20px';
    modalContent.style.border = '1px solid #888';
    modalContent.style.borderRadius = '8px';
    modalContent.style.width = '80%';
    modalContent.style.maxWidth = '800px';
    modalContent.style.maxHeight = '80vh';
    modalContent.style.overflow = 'auto';
    
    // Function to close modal - defined once and reused
    const closeModal = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (modal && modal.parentNode) {
        modal.parentNode.removeChild(modal);
        console.log('Contact preview modal closed completely');
      }
    };
    
    // Create close button with better styling
    const closeBtn = document.createElement('span');
    closeBtn.className = 'modal-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.style.color = '#aaa';
    closeBtn.style.float = 'right';
    closeBtn.style.fontSize = '28px';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '0 5px';
    closeBtn.style.marginTop = '-5px';
    
    // Add close handler that removes the entire modal in one action
    closeBtn.addEventListener('click', closeModal, {capture: true});
    
    // Also close when clicking the dark background (outside modal content)
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeModal(e);
      }
    }, {capture: true});
    
    // Add title
    const title = document.createElement('h3');
    title.textContent = `Preview: ${contactFile.name} (${result.parsedData.length} contacts)`;
    title.style.marginBottom = '15px';
    title.style.color = 'var(--whatsapp-green-dark, #128c7e)';
    
    // Create table for contact data
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.marginBottom = '20px';
    
    // Create table header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    
    // Define preferred column order
    const preferredOrder = ['Name', 'Phone', 'Company', 'Notes'];
    
    // Get all headers from first contact object
    let allHeaders = Object.keys(result.parsedData[0]);
    
    // Create sorted headers: first the preferred ones in order, then any remaining ones
    let sortedHeaders = [];
    
    // First add preferred headers in their specific order
    preferredOrder.forEach(header => {
      if (allHeaders.includes(header)) {
        sortedHeaders.push(header);
      }
    });
    
    // Then add any other headers that weren't in preferred list
    allHeaders.forEach(header => {
      if (!preferredOrder.includes(header)) {
        sortedHeaders.push(header);
      }
    });
    
    // Add headers to table in the sorted order
    sortedHeaders.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      th.style.padding = '8px';
      th.style.textAlign = 'left';
      th.style.borderBottom = '2px solid #ddd';
      th.style.backgroundColor = '#f2f2f2';
      headerRow.appendChild(th);
    });
    
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Create table body
    const tbody = document.createElement('tbody');
    
    // Limit to first 100 contacts for performance
    const displayLimit = Math.min(result.parsedData.length, 100);
    
    // Add contacts to table
    for (let i = 0; i < displayLimit; i++) {
      const contact = result.parsedData[i];
      const row = document.createElement('tr');
      row.style.borderBottom = '1px solid #ddd';
      
      // Add each field to the row in the same sorted order as headers
      sortedHeaders.forEach(header => {
        const td = document.createElement('td');
        td.textContent = contact[header] || '';
        td.style.padding = '8px';
        row.appendChild(td);
      });
      
      tbody.appendChild(row);
    }
    
    table.appendChild(tbody);
    
    // Add note if not showing all contacts
    if (result.parsedData.length > 100) {
      const note = document.createElement('p');
      note.textContent = `Showing first 100 of ${result.parsedData.length} contacts`;
      note.style.fontStyle = 'italic';
      note.style.color = '#666';
      modalContent.appendChild(note);
    }
    
    // Assemble modal
    modalContent.appendChild(closeBtn);
    modalContent.appendChild(title);
    modalContent.appendChild(table);
    modal.appendChild(modalContent);
    
    // Add click event to close modal when clicking outside content
    modal.onclick = function(event) {
      if (event.target === modal) {
        document.body.removeChild(modal);
      }
    };
    
    // Add modal to body
    document.body.appendChild(modal);
  });
}

// Initialize event listeners for the UI components (file upload, preview, removal)
export function initContactUIElements() {
  console.log("Initializing contact UI elements");
  
  // Find all UI elements
  const fileInput = document.getElementById('importContactsInput');
  const previewBtn = document.getElementById('previewBtn');
  const removeFileBtn = document.getElementById('removeFileBtn');
  const fileDisplay = document.getElementById('fileDisplay');
  const fileNameSpan = document.getElementById('fileName');
  
  // Set up event listeners if elements exist
  if (removeFileBtn) {
    removeFileBtn.addEventListener('click', function() {
      console.log("Remove file button clicked");
      
      // Clear contact data from storage with proper callback
      chrome.storage.local.remove(['contactFile', 'contactFileBase64', 'parsedData'], () => {
        // Update UI elements to show file was removed
        if (fileNameSpan) fileNameSpan.textContent = '';
        if (fileDisplay) fileDisplay.style.display = 'none';
        if (fileInput) fileInput.value = '';
        
        // Reset any campaign summary or contact list displays
        document.dispatchEvent(new CustomEvent('contactDataUpdated', { 
          detail: { parsedData: [] }
        }));
        
        // Alert user with toast
        toast("Contact file removed successfully", "success");
        console.log("Contact file and data removed successfully");
      });
    });
  }
  
  if (previewBtn) {
    previewBtn.addEventListener('click', function() {
      console.log("Preview button clicked");
      chrome.storage.local.get(['contactFile'], (result) => {
        if (result.contactFile) {
          console.log("Contact file found, showing preview");
          showContactFilePreview(result.contactFile);
        } else {
          toast("No contact file available for preview", "error");
        }
      });
    });
  }
  
  // Check if we have an existing file to display in the UI
  chrome.storage.local.get(['contactFile', 'activeInputSource'], (result) => {
    if (result.contactFile && fileDisplay && fileNameSpan) {
      // Only display if the active input source is 'file'
      if (result.activeInputSource === 'file' || !result.activeInputSource) {
        // Display the file info in the UI
        fileNameSpan.textContent = result.contactFile.name;
        fileDisplay.style.display = 'flex';
        
        // Make sure it's visible by forcing a layout refresh
        fileDisplay.offsetWidth;
        
        // Make the filename clickable for preview
        fileNameSpan.style.cursor = 'pointer';
        fileNameSpan.style.textDecoration = 'underline';
        fileNameSpan.title = 'Click to preview contacts';
        
        fileNameSpan.onclick = () => {
          chrome.storage.local.get(['contactFile', 'parsedData'], (innerResult) => {
            if (innerResult.contactFile && innerResult.parsedData && innerResult.parsedData.length > 0) {
              showContactFilePreview(innerResult.contactFile);
            } else {
              toast("No contact data available for preview", "error");
            }
          });
        };
        
        console.log("Restored file display for:", result.contactFile.name);
      }
    }
  });
  
  console.log("Contact UI elements initialized");
}

// Contact Manager class for managing contacts and state
class ContactManager {
  constructor() {
    this.contacts = [];
    this.loaded = false;
    this._loadContacts();
  }
  
  async _loadContacts() {
    try {
      this.contacts = await getContacts();
      this.loaded = true;
      console.log('ContactManager loaded', this.contacts.length, 'contacts');
    } catch (error) {
      console.error('Error loading contacts in ContactManager:', error);
      this.contacts = [];
      this.loaded = false;
    }
  }
  
  getContacts() {
    return this.contacts;
  }
  
  async reload() {
    await this._loadContacts();
    return this.contacts;
  }
  
  isLoaded() {
    return this.loaded;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Set up UI elements
  initContactUIElements();
  
  // Preview button handler for sender.html
  const previewBtn = document.getElementById('previewBtn');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      chrome.storage.local.get(['contactFile', 'parsedData'], (result) => {
        if (result.contactFile && result.parsedData && result.parsedData.length > 0) {
          showContactFilePreview(result.contactFile);
        } else {
          toast("No contact data available for preview", "error");
        }
      });
    });
  }

  // Remove file (trash) button handler for sender.html
  const removeFileIcon = document.getElementById('removeFile'); // <-- updated to match sender.html
  if (removeFileIcon) {
    removeFileIcon.addEventListener('click', (event) => {
      // Prevent event propagation to parent elements
      event.stopPropagation();
      
      chrome.storage.local.remove(["contactFile", "contactFileBase64", "parsedData"], () => {
        const fileDisplay = document.getElementById('fileDisplay');
        const fileNameSpan = document.getElementById('fileName');
        const fileInput = document.getElementById('importContactsInput');
        
        if (fileDisplay) fileDisplay.style.display = 'none';
        if (fileNameSpan) fileNameSpan.textContent = '';
        if (fileInput) fileInput.value = '';
        
        toast("Contact file removed", "success");
      });
    });
  }
});