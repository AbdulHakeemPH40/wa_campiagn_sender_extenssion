// js/contactManagerNew.js - Enhanced contact management with better validation
import { toast } from './utils.js';
import { 
  processPhoneNumbers,
  extractPhoneNumbers,
  formatForDisplay
} from './utils/contactValidator.js';

const MAX_MANUAL_CONTACTS = 5000;
const MAX_FILE_CONTACTS = 10000;

/**
 * Parses manual input of phone numbers
 * @param {string} text - Raw input text with phone numbers
 * @param {Function} toast - Toast notification function
 * @returns {Array} Array of valid contact objects
 */
export function parseManualNumbers(text, toast) {
  if (!text || !text.trim()) return [];
  
  // Extract and validate phone numbers
  const numbers = extractPhoneNumbers(text);
  const { validContacts, invalidContacts } = processPhoneNumbers(
    numbers, 
    toast,
    MAX_MANUAL_CONTACTS
  );
  
  // Update UI with validation results
  updateValidationUI(validContacts, invalidContacts);
  
  return validContacts;
}

/**
 * Handles file upload and processing
 * @param {File} file - The uploaded file
 * @param {Function} toast - Toast notification function
 * @returns {Promise<Array>} Promise resolving to array of contact objects
 */
export async function handleContactFile(file, toast) {
  if (!file) {
    toast('No file selected', 'error');
    return [];
  }

  const fileType = file.name.split('.').pop().toLowerCase();
  
  try {
    // Read file content
    const content = await readFileAsText(file);
    
    // Parse based on file type
    let numbers = [];
    if (fileType === 'csv') {
      numbers = await parseCsvContent(content);
    } else if (['xls', 'xlsx'].includes(fileType)) {
      numbers = await parseExcelContent(content, fileType);
    } else {
      throw new Error('Unsupported file type. Please upload a CSV or Excel file.');
    }
    
    // Process and validate the extracted numbers
    const { validContacts, invalidContacts } = processPhoneNumbers(
      numbers,
      toast,
      MAX_FILE_CONTACTS
    );
    
    // Update UI with validation results
    updateValidationUI(validContacts, invalidContacts);
    
    return validContacts;
    
  } catch (error) {
    console.error('Error processing contact file:', error);
    toast(`Error: ${error.message}`, 'error');
    return [];
  }
}

/**
 * Updates the UI to show validation results
 * @param {Array} validContacts - Array of valid contact objects
 * @param {Array} invalidContacts - Array of invalid contact objects
 */
function updateValidationUI(validContacts, invalidContacts) {
  const validationResults = document.getElementById('validationResults');
  if (!validationResults) return;
  
  // Clear previous results
  validationResults.innerHTML = '';
  
  // Add valid numbers summary
  if (validContacts.length > 0) {
    const validEl = document.createElement('div');
    validEl.className = 'validation-valid';
    validEl.innerHTML = `✓ ${validContacts.length} valid numbers found`;
    validationResults.appendChild(validEl);
  }
  
  // Add invalid numbers summary if any
  if (invalidContacts.length > 0) {
    const invalidEl = document.createElement('div');
    invalidEl.className = 'validation-invalid';
    invalidEl.innerHTML = `⚠ ${invalidContacts.length} invalid numbers detected`;
    
    // Add click to show details
    const detailsBtn = document.createElement('button');
    detailsBtn.className = 'btn-link';
    detailsBtn.textContent = 'Show details';
    detailsBtn.onclick = () => showInvalidNumbersDetails(invalidContacts);
    
    invalidEl.appendChild(document.createElement('br'));
    invalidEl.appendChild(detailsBtn);
    validationResults.appendChild(invalidEl);
  }
}

/**
 * Shows a modal with details of invalid numbers
 * @param {Array} invalidContacts - Array of invalid contact objects
 */
function showInvalidNumbersDetails(invalidContacts) {
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
        <h3>Invalid Phone Numbers (${invalidContacts.length})</h3>
        <span class="close">&times;</span>
      </div>
      <div class="modal-body">
        <div class="table-container">
          <table class="invalid-numbers-table">
            <thead>
              <tr>
                <th>Original</th>
                <th>Formatted</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              ${invalidContacts.map(contact => `
                <tr>
                  <td>${escapeHtml(contact.original || '')}</td>
                  <td>${escapeHtml(contact.formatted || '')}</td>
                  <td>${escapeHtml(contact.error || 'Unknown error')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="document.getElementById('invalidNumbersModal').style.display='none'">
          Close
        </button>
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
 * Helper function to read file as text
 * @param {File} file - File to read
 * @returns {Promise<string>} - Promise resolving to file content
 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('Error reading file'));
    reader.readAsText(file);
  });
}

// Export the functions needed by other modules
export default {
  parseManualNumbers,
  handleContactFile,
  updateValidationUI
};
