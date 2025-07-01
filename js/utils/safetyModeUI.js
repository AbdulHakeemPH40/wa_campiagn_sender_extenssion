/**
 * Safety Mode UI
 * 
 * This module provides UI components and functions for the safety mode feature.
 * It handles displaying the safety mode status, testing the safety message mechanism,
 * and updating the UI based on the results.
 */

import { testSafetyMessage, runComprehensiveSafetyTest } from './testSafetyMessage.js';
import { fetchOwnWhatsAppNumber } from '../safetyMode.js';

/**
 * Initializes the safety mode UI components
 */
export function initSafetyModeUI() {
  const safetyModeToggle = document.getElementById('safetyModeToggle');
  const safetyModeWarning = document.getElementById('safetyModeWarning');
  const ownPhoneNumberDisplay = document.getElementById('own-phone-number-display');
  const safetyModeStatus = document.getElementById('safety-mode-status');
  
  if (!safetyModeToggle || !safetyModeWarning || !ownPhoneNumberDisplay || !safetyModeStatus) {
    console.error('[SafetyUI] Required UI elements not found');
    return;
  }
  
  // Add test button if it doesn't exist
  if (!document.getElementById('safety-test-button')) {
    const testButton = document.createElement('button');
    testButton.id = 'safety-test-button';
    testButton.className = 'safety-test-button';
    testButton.innerHTML = '<i class="ri-test-tube-line"></i> Test Safety Message';
    testButton.addEventListener('click', handleSafetyTest);
    safetyModeStatus.appendChild(testButton);
  }
  
  // Add result container if it doesn't exist
  if (!document.getElementById('safety-test-result')) {
    const resultContainer = document.createElement('div');
    resultContainer.id = 'safety-test-result';
    resultContainer.className = 'safety-test-result';
    resultContainer.style.display = 'none';
    safetyModeStatus.appendChild(resultContainer);
  }
  
  // Update phone number display
  updatePhoneNumberDisplay();
  
  // Listen for storage changes to update the UI
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.waUserPhoneNumberResult) {
      updatePhoneNumberDisplay();
    }
  });
}

/**
 * Updates the phone number display in the UI
 */
function updatePhoneNumberDisplay() {
  const ownPhoneNumberDisplay = document.getElementById('own-phone-number-display');
  if (!ownPhoneNumberDisplay) return;
  
  chrome.storage.local.get('waUserPhoneNumberResult', (result) => {
    const entry = result.waUserPhoneNumberResult;
    
    if (entry && entry.status === 'success' && entry.number) {
      ownPhoneNumberDisplay.textContent = entry.number;
      ownPhoneNumberDisplay.className = 'phone-number-value';
    } else if (entry && entry.status === 'pending_injector') {
      ownPhoneNumberDisplay.textContent = 'Checking...';
      ownPhoneNumberDisplay.className = 'phone-number-value checking';
    } else {
      ownPhoneNumberDisplay.textContent = 'Not Found';
      ownPhoneNumberDisplay.className = 'phone-number-value not-found';
      
      // Try to fetch the number if it's not found
      fetchOwnWhatsAppNumber().then(number => {
        if (number) {
          ownPhoneNumberDisplay.textContent = number;
          ownPhoneNumberDisplay.className = 'phone-number-value';
        }
      });
    }
  });
}

/**
 * Handles the safety test button click
 */
async function handleSafetyTest() {
  const testButton = document.getElementById('safety-test-button');
  const resultContainer = document.getElementById('safety-test-result');
  
  if (!testButton || !resultContainer) return;
  
  // Disable button and show pending state
  testButton.disabled = true;
  testButton.classList.add('safety-testing');
  testButton.innerHTML = '<i class="ri-loader-4-line"></i> Testing...';
  
  resultContainer.className = 'safety-test-result pending';
  resultContainer.textContent = 'Testing safety message mechanism...';
  resultContainer.style.display = 'block';
  
  try {
    // Run the comprehensive test
    const testResult = await runComprehensiveSafetyTest();
    
    // Update UI based on result
    if (testResult.success) {
      resultContainer.className = 'safety-test-result success';
      resultContainer.innerHTML = '<i class="ri-check-line"></i> Safety message test successful! At least one method worked.';
      
      // Show details of which methods worked
      const successMethods = testResult.results.filter(r => r.success).map(r => r.method);
      if (successMethods.length > 0) {
        resultContainer.innerHTML += `<br>Working methods: ${successMethods.join(', ')}`;
      }
    } else {
      resultContainer.className = 'safety-test-result error';
      resultContainer.innerHTML = '<i class="ri-error-warning-line"></i> Safety message test failed. All methods failed.';
      
      // Show error details
      const errors = testResult.results.map(r => `${r.method}: ${r.error || 'Unknown error'}`);
      if (errors.length > 0) {
        resultContainer.innerHTML += `<br>Errors: ${errors.join('; ')}`;
      }
    }
  } catch (error) {
    resultContainer.className = 'safety-test-result error';
    resultContainer.innerHTML = `<i class="ri-error-warning-line"></i> Error testing safety message: ${error.message}`;
  } finally {
    // Re-enable button
    testButton.disabled = false;
    testButton.classList.remove('safety-testing');
    testButton.innerHTML = '<i class="ri-test-tube-line"></i> Test Safety Message';
  }
}