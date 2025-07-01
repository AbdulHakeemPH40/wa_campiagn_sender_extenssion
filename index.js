/**
 * WhatsApp Campaign Sender Extension
 * Main entry point for the extension
 * 
 * This file serves as the central index for the WhatsApp Campaign Sender Extension,
 * providing an overview of the project structure and main components.
 */

// Core modules
import { initSender, updateUIWithContactData } from './js/sender.js';
import { handleFile, parseFile, updateContactUI, downloadSampleCsv } from './js/contactManager.js';
import { insertTextIntoEditor, validateVariables, htmlToWhatsAppMarkdown } from './js/messageComposer.js';
import { handleAttachment, renderAttachment } from './js/attachmentManager.js';
import { saveSettings, updateSummary, toggleSection, resetStuckCampaign } from './js/sendingControls.js';
import { toast } from './js/utils.js';
import { initializeTabs } from './js/tabs.js';
import { initializeSafetyMode } from './js/safetyMode.js';

/**
 * Extension Structure Overview:
 * 
 * 1. Background Scripts:
 *    - js/background/background.js: Service worker that handles background tasks and messaging
 * 
 * 2. Content Scripts:
 *    - js/content/content_script.js: Injected into WhatsApp Web to interact with the page
 *    - js/content/fl.js: Handles direct interaction with WhatsApp Web's internal API
 *    - js/content/injector.js: Injects scripts into the WhatsApp Web page
 * 
 * 3. UI Components:
 *    - popup.html: Main extension popup
 *    - html/sender.html: Message campaign interface
 *    - html/extractor.html: Contact extraction interface
 *    - html/campaign-progress.html: Campaign progress tracking
 * 
 * 4. Core Functionality:
 *    - Contact Management: Import, validation, and processing of contact lists
 *    - Message Composition: Rich text editor with variable support
 *    - Campaign Sending: Batch processing with configurable delays
 *    - Safety Features: Self-messaging and human-like delay patterns
 * 
 * 5. Utilities:
 *    - Phone number validation and formatting
 *    - File handling for attachments and contact imports
 *    - UI helpers for notifications and animations
 */

/**
 * Main Features:
 * 
 * 1. Contact Management
 *    - Manual entry of phone numbers
 *    - CSV/Excel file import with variable support
 *    - Contact validation and formatting
 * 
 * 2. Message Composition
 *    - Rich text editor with formatting options
 *    - Variable insertion for personalized messages
 *    - Support for image, video, and PDF attachments
 * 
 * 3. Sending Controls
 *    - Configurable delay between messages
 *    - Batch processing with cooldown periods
 *    - Human-like delay patterns
 *    - Safety mode with self-messaging
 * 
 * 4. Campaign Monitoring
 *    - Real-time progress tracking
 *    - Success/failure statistics
 *    - Pause/resume/cancel functionality
 */

/**
 * Safety Features:
 * 
 * 1. Self-Messaging Mechanism
 *    - Periodically sends a message to the user's own number
 *    - Simulates normal WhatsApp activity to reduce ban risk
 * 
 * 2. Human-like Delay Patterns
 *    - Variable delays between messages
 *    - Mimics natural typing and sending behavior
 * 
 * 3. Batch Processing
 *    - Sends messages in smaller batches
 *    - Implements cooldown periods between batches
 * 
 * 4. Unique Timestamps
 *    - Adds unique identifiers to messages
 *    - Helps avoid spam detection by WhatsApp
 */

// Export main functionality for use in other modules
export {
  initSender,
  updateUIWithContactData,
  handleFile,
  parseFile,
  updateContactUI,
  downloadSampleCsv,
  insertTextIntoEditor,
  validateVariables,
  htmlToWhatsAppMarkdown,
  handleAttachment,
  renderAttachment,
  saveSettings,
  updateSummary,
  toggleSection,
  resetStuckCampaign,
  toast,
  initializeTabs,
  initializeSafetyMode
};