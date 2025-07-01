// Contact validation and processing utilities

/**
 * Validates a phone number according to E.164 standard
 * @param {string} phoneNumber - The phone number to validate
 * @returns {Object} - { isValid: boolean, formattedNumber: string, error: string }
 */
export function validatePhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    return {
      isValid: false,
      formattedNumber: '',
      error: 'Phone number is required'
    };
  }

  // Remove all non-digit characters except leading +
  const cleaned = phoneNumber.replace(/[^0-9+]/g, '');
  
  // Check for valid E.164 format
  const e164Regex = /^\+[1-9]\d{7,14}$/;
  
  // Format the number
  let formatted = cleaned;
  
  // If number starts with 00, replace with +
  if (formatted.startsWith('00')) {
    formatted = '+' + formatted.substring(2);
  }
  
  // If no + but has 10+ digits, assume it's missing country code
  if (!formatted.startsWith('+') && formatted.length >= 10) {
    formatted = '+' + formatted; // You might want to add a default country code here
  }
  
  // Final validation
  if (e164Regex.test(formatted)) {
    return {
      isValid: true,
      formattedNumber: formatted,
      error: ''
    };
  }
  
  return {
    isValid: false,
    formattedNumber: formatted,
    error: 'Invalid phone number format. Expected format: +[country code][number]'
  };
}

/**
 * Checks if a number is likely blocked based on error messages
 * @param {string} errorMessage - The error message from WhatsApp
 * @returns {boolean}
 */
export function isBlockedNumberError(errorMessage) {
  if (!errorMessage) return false;
  
  const blockedIndicators = [
    'blocked',
    'not on WhatsApp',
    'invalid number',
    'failed to send',
    'not authorized',
    'not registered',
    'temporarily blocked'
  ];
  
  const lowerError = errorMessage.toLowerCase();
  return blockedIndicators.some(indicator => lowerError.includes(indicator));
}

/**
 * Formats a phone number for display
 * @param {string} phoneNumber - The phone number to format
 * @returns {string} - Formatted phone number
 */
export function formatForDisplay(phoneNumber) {
  if (!phoneNumber) return '';
  
  // Simple formatting for display: +1 (555) 123-4567
  const match = phoneNumber.match(/^(\+?\d{1,3})?(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    return `${match[1] || ''} (${match[2]}) ${match[3]}-${match[4]}`.trim();
  }
  
  return phoneNumber;
}

/**
 * Extracts phone numbers from a string (CSV, newline, comma, or space separated)
 * @param {string} input - The input string containing phone numbers
 * @returns {string[]} - Array of extracted phone numbers
 */
export function extractPhoneNumbers(input) {
  if (!input) return [];
  
  // Split by common delimiters and filter out empty strings
  return input
    .split(/[\n,;\s]+/)
    .map(num => num.trim())
    .filter(num => num.length > 0);
}

/**
 * Processes a list of raw phone numbers into validated contact objects
 * @param {string[]} numbers - Array of raw phone numbers
 * @param {Function} toast - Toast notification function
 * @param {number} [maxNumbers=10000] - Maximum number of contacts allowed
 * @returns {Object} - { validContacts: Array, invalidContacts: Array }
 */
export function processPhoneNumbers(numbers, toast, maxNumbers = 10000) {
  const validContacts = [];
  const invalidContacts = [];

  // Enforce maximum number of contacts
  if (numbers.length > maxNumbers) {
    const errorMessage = `Maximum ${maxNumbers} phone numbers allowed. You entered ${numbers.length}.`;
    toast(errorMessage, 'error');
    return { validContacts: [], invalidContacts: [] };
  }

  // Process each number
  numbers.forEach(number => {
    const validation = validatePhoneNumber(number);
    
    if (validation.isValid) {
      validContacts.push({
        phone: validation.formattedNumber,
        displayPhone: formatForDisplay(validation.formattedNumber),
        name: '',
        isValid: true,
        status: 'pending',
        lastAttempt: null,
        error: null
      });
    } else {
      invalidContacts.push({
        original: number,
        formatted: validation.formattedNumber,
        error: validation.error
      });
    }
  });

  // Show toast for invalid numbers if any
  if (invalidContacts.length > 0) {
    const message = `Skipped ${invalidContacts.length} invalid number(s): ${invalidContacts
      .slice(0, 3)
      .map(n => n.original)
      .join(', ')}${invalidContacts.length > 3 ? '...' : ''}`;
    
    toast(message, 'warning');
    console.warn('Invalid phone numbers detected:', invalidContacts);
  }

  return { validContacts, invalidContacts };
}
