// js/utils.js
export function toast(msg, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  
  // Use toast container if available, otherwise append to body
  const container = document.getElementById('toastContainer') || 
                    document.querySelector('.toast-container');
  
  if (container) {
    container.appendChild(toast);
    
    // Use animation classes for smoother transitions
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  } else {
    // Fallback to body if container not found
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
    console.warn('Toast container not found, appending to body');
  }
}

export function showModalMessage(title = 'Notice', message = '', type = 'info') {
  // Remove any existing simple modal
  const existing = document.getElementById('simpleModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'simpleModal';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.4);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;`;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: #fff;
    padding: 22px 26px;
    border-radius: 8px;
    width: 92%;
    max-width: 420px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.15);
    animation: fadeIn 0.2s ease-out;`;

  const h2 = document.createElement('h2');
  h2.textContent = title;
  h2.style.margin = '0 0 12px 0';

  const p = document.createElement('p');
  p.innerHTML = message;
  p.style.marginBottom = '18px';

  const btn = document.createElement('button');
  btn.textContent = 'OK';
  btn.className = 'btn btn-primary';
  btn.style.padding = '6px 18px';
  btn.onclick = () => overlay.remove();

  modal.appendChild(h2);
  modal.appendChild(p);
  modal.appendChild(btn);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string' && result.startsWith('data:')) {
        resolve(result);
      } else {
        reject(new Error("FileReader result is not a valid data URL"));
      }
    };
    reader.onerror = (error) => {
      console.error("FileReader error:", error);
      reject(error);
    };
    reader.readAsDataURL(file);
  });
}

export function base64ToFile(base64String, fileName, mimeType) {
  try {
    if (!base64String || typeof base64String !== "string" || !base64String.includes(",")) {
      throw new Error("Invalid Base64 string: Must be a valid data URL");
    }
    let byteString;
    try {
      byteString = atob(base64String.split(",")[1]);
    } catch (error) {
      throw new Error("Failed to decode Base64 string: " + error.message);
    }
    const ia = Uint8Array.from(byteString, (char) => char.charCodeAt(0));
    const blob = new Blob([ia], { type: mimeType });
    return new File([blob], fileName, { type: mimeType });
  } catch (error) {
    console.error("Error in base64ToFile:", error, { base64String, fileName, mimeType });
    throw error;
  }
}

export async function waitForGlobal(globalVar, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const check = () => {
      if (window[globalVar]) {
        console.log(`${globalVar} library loaded after ${Date.now() - startTime}ms`);
        resolve(window[globalVar]);
      } else if (Date.now() - startTime > timeout) {
        reject(new Error(`${globalVar} not defined after ${timeout}ms`));
      } else {
        setTimeout(check, 100);
      }
    };
    console.log(`Waiting for ${globalVar} to be defined...`);
    check();
  });
}

/**
 * Ensures a library is loaded by injecting the script if needed
 * @param {string} libraryName - Global variable name of the library
 * @param {string} scriptPath - Path to the script
 * @param {number} timeout - Maximum wait time in ms
 * @returns {Promise<any>} - The library object
 */
export async function ensureLibraryLoaded(libraryName, scriptPath, timeout = 10000) {
  // First check if library is already available
  if (window[libraryName]) {
    console.log(`${libraryName} is already loaded`);
    return window[libraryName];
  }
  
  // Try to load the script
  try {
    console.log(`Loading ${libraryName} from ${scriptPath}`);
    // Create a promise that resolves when script is loaded
    const loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL(scriptPath);
      script.onload = () => {
        console.log(`${libraryName} script loaded successfully`);
        resolve();
      };
      script.onerror = (error) => {
        console.error(`Failed to load ${libraryName} script:`, error);
        reject(new Error(`Failed to load ${libraryName} script`));
      };
      document.head.appendChild(script);
    });
    
    // Wait for script to load
    await loadPromise;
    
    // Then wait for the global variable to be defined
    return await waitForGlobal(libraryName, timeout);
  } catch (error) {
    console.error(`Error loading ${libraryName}:`, error);
    throw error;
  }
}

// Event listener registry for easier cleanup
const eventListenerRegistry = new Map();

/**
 * Add event listener with automatic cleanup registration
 * @param {Element} element - DOM element to attach listener to
 * @param {string} eventType - Event type (e.g., 'click', 'input')
 * @param {Function} handler - Event handler function
 * @param {Object} options - Event listener options
 * @returns {Function} - Function to remove this specific listener
 */
export function addListener(element, eventType, handler, options = {}) {
  if (!element || !eventType || typeof handler !== 'function') {
    console.error('Invalid parameters for addListener:', { element, eventType, handler });
    return () => {};
  }

  element.addEventListener(eventType, handler, options);
  
  // Register the listener for later cleanup
  if (!eventListenerRegistry.has(element)) {
    eventListenerRegistry.set(element, new Map());
  }
  
  const elementListeners = eventListenerRegistry.get(element);
  if (!elementListeners.has(eventType)) {
    elementListeners.set(eventType, new Set());
  }
  
  elementListeners.get(eventType).add(handler);
  
  // Return a function to remove just this listener
  return () => {
    element.removeEventListener(eventType, handler, options);
    const listeners = eventListenerRegistry.get(element)?.get(eventType);
    if (listeners) {
      listeners.delete(handler);
      if (listeners.size === 0) {
        elementListeners.delete(eventType);
        if (elementListeners.size === 0) {
          eventListenerRegistry.delete(element);
        }
      }
    }
  };
}

/**
 * Remove all registered event listeners from an element
 * @param {Element} element - DOM element to remove listeners from
 */
export function removeAllListeners(element) {
  if (!element || !eventListenerRegistry.has(element)) return;
  
  const elementListeners = eventListenerRegistry.get(element);
  elementListeners.forEach((handlers, eventType) => {
    handlers.forEach(handler => {
      element.removeEventListener(eventType, handler);
    });
  });
  
  eventListenerRegistry.delete(element);
}

/**
 * Remove all registered event listeners
 */
export function cleanupAllListeners() {
  eventListenerRegistry.forEach((elementListeners, element) => {
    elementListeners.forEach((handlers, eventType) => {
      handlers.forEach(handler => {
        element.removeEventListener(eventType, handler);
      });
    });
  });
  
  eventListenerRegistry.clear();
}

/**
 * Error types for better categorization and handling
 */
export const ErrorTypes = {
  NETWORK: 'network',
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  TIMEOUT: 'timeout',
  WHATSAPP: 'whatsapp',
  STORAGE: 'storage',
  UNKNOWN: 'unknown'
};

/**
 * Enhanced error class with additional metadata
 */
export class ExtensionError extends Error {
  constructor(message, type = ErrorTypes.UNKNOWN, originalError = null, data = {}) {
    super(message);
    this.name = 'ExtensionError';
    this.type = type;
    this.originalError = originalError;
    this.data = data;
    this.timestamp = new Date().toISOString();
  }
  
  // Log this error with full context
  log() {
    console.error(`[${this.timestamp}] ${this.name} (${this.type}): ${this.message}`, {
      originalError: this.originalError,
      data: this.data,
      stack: this.stack
    });
    
    return this; // For chaining
  }
  
  // Show a toast with this error
  notify() {
    const message = this.data.userMessage || this.message;
    toast(message, 'error');
    return this; // For chaining
  }
}

/**
 * Safe wrapper for async functions with standardized error handling
 * @param {Function} asyncFn - Async function to execute
 * @param {Object} options - Error handling options
 * @returns {Promise} - Promise that handles errors consistently
 */
export function safeAsync(asyncFn, options = {}) {
  const {
    onError = null,
    showToast = true,
    logError = true,
    defaultErrorMessage = 'An error occurred',
    errorType = ErrorTypes.UNKNOWN,
    timeout = 30000
  } = options;
  
  // Create a timeout promise if timeout is specified
  const timeoutPromise = timeout > 0 
    ? new Promise((_, reject) => {
        setTimeout(() => {
          reject(new ExtensionError(
            'Operation timed out', 
            ErrorTypes.TIMEOUT, 
            null, 
            { timeout, userMessage: 'Operation took too long to complete' }
          ));
        }, timeout);
      }) 
    : null;
  
  // Function to handle errors consistently
  const handleError = (error) => {
    // Convert regular errors to ExtensionError
    const extError = error instanceof ExtensionError 
      ? error 
      : new ExtensionError(
          error.message || defaultErrorMessage,
          errorType,
          error,
          { userMessage: defaultErrorMessage }
        );
    
    // Log the error if requested
    if (logError) {
      extError.log();
    }
    
    // Show toast if requested
    if (showToast) {
      extError.notify();
    }
    
    // Call custom error handler if provided
    if (typeof onError === 'function') {
      onError(extError);
    }
    
    // Rethrow the enhanced error
    throw extError;
  };
  
  // Execute the async function with error handling
  try {
    const resultPromise = asyncFn();
    
    // If no valid promise returned, reject
    if (!resultPromise || typeof resultPromise.then !== 'function') {
      return Promise.reject(new ExtensionError(
        'Function did not return a promise',
        ErrorTypes.UNKNOWN,
        null,
        { userMessage: defaultErrorMessage }
      )).catch(handleError);
    }
    
    // Race with timeout if specified
    const activePromise = timeoutPromise 
      ? Promise.race([resultPromise, timeoutPromise]) 
      : resultPromise;
      
    return activePromise.catch(handleError);
  } catch (error) {
    return Promise.reject(error).catch(handleError);
  }
}

/**
 * Validation utilities
 */
export const Validators = {
  /**
   * Validate phone number format
   * @param {string} phoneNumber - Phone number to validate
   * @returns {Object} - Validation result with isValid and formattedNumber
   */
  phoneNumber(phoneNumber) {
    if (!phoneNumber) return { isValid: false, error: 'Phone number is required' };
    
    // Remove all non-numeric characters except +
    const cleaned = phoneNumber.replace(/[^\d+]/g, '');
    
    // Must be at least 8 digits and no more than 15 (international standard)
    const digitsOnly = cleaned.replace(/\+/g, '');
    if (digitsOnly.length < 8 || digitsOnly.length > 15) {
      return { 
        isValid: false, 
        error: 'Phone number must be between 8 and 15 digits',
        original: phoneNumber,
        cleaned
      };
    }
    
    // Format with + if it's missing and has country code
    let formatted = cleaned;
    if (!formatted.startsWith('+') && formatted.length >= 10) {
      formatted = '+' + formatted;
    }
    
    return { 
      isValid: true, 
      formattedNumber: formatted,
      original: phoneNumber,
      cleaned 
    };
  },
  
  /**
   * Validate file upload by type and size
   * @param {File} file - File to validate
   * @param {Object} options - Validation options
   * @returns {Object} - Validation result
   */
  fileUpload(file, options = {}) {
    const {
      maxSizeMB = 10,
      allowedTypes = null,
      allowedExtensions = null
    } = options;
    
    if (!file) return { isValid: false, error: 'No file provided' };
    
    // Validate file size
    const maxSizeBytes = maxSizeMB * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      return {
        isValid: false,
        error: `File size exceeds ${maxSizeMB}MB limit`,
        file
      };
    }
    
    // Validate file type if specified
    if (allowedTypes && allowedTypes.length > 0) {
      const isValidType = allowedTypes.some(type => file.type.startsWith(type));
      if (!isValidType) {
        return {
          isValid: false,
          error: `Unsupported file type. Allowed types: ${allowedTypes.join(', ')}`,
          file
        };
      }
    }
    
    // Validate file extension if specified
    if (allowedExtensions && allowedExtensions.length > 0) {
      const fileExt = file.name.split('.').pop().toLowerCase();
      if (!allowedExtensions.includes(fileExt)) {
        return {
          isValid: false,
          error: `Unsupported file extension. Allowed extensions: ${allowedExtensions.join(', ')}`,
          file
        };
      }
    }
    
    return { isValid: true, file };
  },
  
  /**
   * Validate message content
   * @param {string} message - Message content to validate
   * @param {Object} options - Validation options
   * @returns {Object} - Validation result
   */
  messageContent(message, options = {}) {
    const {
      maxLength = 4096,  // WhatsApp message limit
      minLength = 1,
      requireContent = true
    } = options;
    
    // Check if content is required
    if (requireContent && (!message || message.trim().length === 0)) {
      return {
        isValid: false,
        error: 'Message content is required',
        message
      };
    }
    
    // If content is not required and empty, it's valid
    if (!requireContent && (!message || message.trim().length === 0)) {
      return { isValid: true, message: '' };
    }
    
    // Trim the message
    const trimmed = message.trim();
    
    // Check minimum length
    if (trimmed.length < minLength) {
      return {
        isValid: false,
        error: `Message must be at least ${minLength} characters`,
        message: trimmed
      };
    }
    
    // Check maximum length
    if (trimmed.length > maxLength) {
      return {
        isValid: false,
        error: `Message exceeds maximum length of ${maxLength} characters`,
        message: trimmed
      };
    }
    
    return { isValid: true, message: trimmed };
  }
};

/**
 * Utility functions for WhatsApp Broadcast Sender
 */

/**
 * Validates a phone number format
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid
 */
function isValidPhoneNumber(phone) {
  if (!phone) return false;
  
  // Remove all non-numeric characters except +
  const cleaned = phone.replace(/[^\d+]/g, '');
  
  // Basic validation: must have at least 8 digits after removing non-numeric chars
  if (cleaned.replace(/\+/g, '').length < 8) return false;
  
  // Country-specific validations
  
  // UAE validation
  if (
    // International format with UAE country code (971)
    (cleaned.startsWith('971') || cleaned.startsWith('+971')) && 
    (cleaned.replace(/\+/g, '').length >= 12 && cleaned.replace(/\+/g, '').length <= 14)
  ) {
    return true;
  } 
  // UAE mobile starting with 0
  else if (cleaned.startsWith('0') && cleaned.length === 10 && cleaned.charAt(1) === '5') {
    return true;
  } 
  // UAE mobile without prefix (just 9 digits starting with 5)
  else if (cleaned.length === 9 && cleaned.startsWith('5')) {
    return true;
  }
  
  // India validation
  else if (
    // International format with India country code (91)
    (cleaned.startsWith('91') || cleaned.startsWith('+91')) && 
    cleaned.replace(/\+/g, '').length === 12
  ) {
    return true;
  }
  // India mobile starting with 0
  else if (cleaned.startsWith('0') && cleaned.length === 11 && 
           /^0[6-9]/.test(cleaned)) {
    return true;
  }
  // India mobile without prefix (10 digits)
  else if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
    return true;
  }
  
  // US validation
  else if (
    // International format with US country code (1)
    (cleaned.startsWith('1') || cleaned.startsWith('+1')) && 
    cleaned.replace(/\+/g, '').length === 11
  ) {
    return true;
  }
  // US format without country code (10 digits)
  else if (cleaned.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(cleaned)) {
    return true;
  }
  
  // Russia validation
  else if (
    // International format with Russia country code (7)
    (cleaned.startsWith('7') || cleaned.startsWith('+7')) && 
    cleaned.replace(/\+/g, '').length === 11
  ) {
    return true;
  }
  // Russia format with leading 8 (domestic format)
  else if (cleaned.startsWith('8') && cleaned.length === 11) {
    return true;
  }
  
  // Saudi Arabia validation
  else if (
    (cleaned.startsWith('966') || cleaned.startsWith('+966')) && 
    cleaned.replace(/\+/g, '').length >= 12 && 
    cleaned.replace(/\+/g, '').length <= 14
  ) {
    return true;
  }
  
  // Egypt validation
  else if (
    (cleaned.startsWith('20') || cleaned.startsWith('+20')) && 
    cleaned.replace(/\+/g, '').length >= 11 && 
    cleaned.replace(/\+/g, '').length <= 13
  ) {
    return true;
  }
  
  // International format: starts with + followed by country code and number
  if (cleaned.startsWith('+') && cleaned.length >= 9) return true;
  
  // International format without +, must have country code (assumed if length >= 10)
  if (cleaned.length >= 10 && cleaned.length <= 15) return true;
  
  // General validation for other formats
  // Must have at least 8 digits for local formats (most countries have 8-15 digit phone numbers)
  return cleaned.length >= 8 && cleaned.length <= 15;
}

/**
 * Format phone number for WhatsApp (remove special characters, add country code if needed)
 * @param {string} phone - Phone number to format
 * @returns {string} - Formatted phone number
 */
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // Remove all non-numeric characters except +
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // If starts with +, remove it as WhatsApp API doesn't need it
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }
  
  // Remove any double zeros at the beginning (international prefix)
  while (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }
  
  // Handle special UAE cases
  if (cleaned.startsWith('971') && cleaned.length >= 12) {
    // Already has country code, just return it
    return cleaned;
  } else if (cleaned.startsWith('0') && cleaned.length === 10 && cleaned.charAt(1) === '5') {
    // UAE format with leading 0 (05x xxx xxxx) - replace with 971
    return '971' + cleaned.substring(1);
  } else if (cleaned.length === 9 && cleaned.startsWith('5')) {
    // UAE number without country code (5x xxx xxxx)
    return '971' + cleaned;
  }
  
  // Handle India cases
  else if (cleaned.startsWith('0') && cleaned.length === 11 && /^0[6-9]/.test(cleaned)) {
    // India format with leading 0 (0xxxxxxxxxx) - replace with 91
    return '91' + cleaned.substring(1);
  } else if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
    // India number without country code (10 digits starting with 6-9)
    return '91' + cleaned;
  }
  
  // Handle US cases
  else if (cleaned.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(cleaned)) {
    // US number without country code (10 digits, area code doesn't start with 0 or 1)
    return '1' + cleaned;
  }
  
  // Handle Russia cases
  else if (cleaned.startsWith('8') && cleaned.length === 11) {
    // Russia domestic format (8xxxxxxxxxx) - replace with 7
    return '7' + cleaned.substring(1);
  }
  
  // Handle Saudi Arabia cases
  else if (cleaned.startsWith('0') && cleaned.length === 10 && (cleaned.charAt(1) === '5' || cleaned.charAt(1) === '9')) {
    // Saudi format with leading 0 (05x xxxx xxx) - replace with 966
    return '966' + cleaned.substring(1);
  } else if (cleaned.length === 9 && (cleaned.startsWith('5') || cleaned.startsWith('9'))) {
    // Saudi number without country code
    return '966' + cleaned;
  }
  
  // Handle Egypt cases
  else if (cleaned.startsWith('0') && cleaned.length === 11 && (cleaned.charAt(1) === '1')) {
    // Egypt format with leading 0 (01x xxxx xxxx) - replace with 20
    return '20' + cleaned.substring(1);
  }
  
  // General case: if number starts with 0, it's likely a local number
  // Try to determine country code
  if (cleaned.startsWith('0') && cleaned.length >= 10) {
    // This is a local number with leading 0
    // We need to remove the 0, but we don't know the country code
    // Default to international format without country code
    cleaned = cleaned.substring(1);
    
    // IMPORTANT NOTE TO USERS: You should add proper country code
    console.warn('Phone number starts with 0, country code unknown. Add proper country code for international sending.');
  }
  
  // Return cleaned number
  return cleaned;
}

/**
 * Format a date object to a readable string
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
  if (!date) return '';
  
  const d = new Date(date);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

/**
 * Sanitize text for display or storage
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeText(text) {
  if (!text) return '';
  
  // Remove HTML tags
  text = text.replace(/<[^>]*>/g, '');
  
  // Escape special characters
  text = text.replace(/&/g, '&amp;')
             .replace(/</g, '&lt;')
             .replace(/>/g, '&gt;')
             .replace(/"/g, '&quot;')
             .replace(/'/g, '&#039;');
             
  return text;
}

/**
 * Generate a random ID
 * @returns {string} - Random ID
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

/**
 * Calculate time remaining in a friendly format
 * @param {number} total - Total items
 * @param {number} processed - Items processed
 * @param {number} timeElapsedMs - Time elapsed in milliseconds
 * @returns {string} - Time remaining string
 */
function calculateTimeRemaining(total, processed, timeElapsedMs) {
  if (processed === 0) return 'Calculating...';
  
  const itemsRemaining = total - processed;
  const timePerItem = timeElapsedMs / processed;
  const timeRemainingMs = itemsRemaining * timePerItem;
  
  // Convert to seconds
  let timeRemaining = Math.round(timeRemainingMs / 1000);
  
  if (timeRemaining < 60) {
    return `${timeRemaining} seconds`;
  } else if (timeRemaining < 3600) {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    return `${minutes} min ${seconds} sec`;
  } else {
    const hours = Math.floor(timeRemaining / 3600);
    const minutes = Math.floor((timeRemaining % 3600) / 60);
    return `${hours} hr ${minutes} min`;
  }
}

// Export utilities for other scripts to use
window.utils = {
  isValidPhoneNumber,
  formatPhoneNumber,
  formatDate,
  sanitizeText,
  generateId,
  calculateTimeRemaining,
  loadExternalScript,
  showModalMessage,
  queryAny
};

export async function loadExternalScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
      if (existing.dataset.loaded) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load script')));
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${url}`));
    document.head.appendChild(script);
  });
}

export function queryAny(selectors = []) {
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

// ---------------- Text helpers ----------------
export function collapseBlankLines(str) {
  if (!str) return str;

  // 1) Normalise Windows CRLF to LF for consistency
  str = str.replace(/\r\n/g, '\n');

  /*
   * 2) Collapse runs of blank lines to a single \n.
   *    A "blank" line may contain only whitespace (spaces or tabs).
   *    Example patterns to collapse:
   *      "\n\n"                     -> one newline
   *      "\n   \n"                  -> one newline
   *      "\n \t  \n  \t\n"         -> one newline
   */
  return str.replace(/([ \t]*\n){2,}/g, '\n');
}