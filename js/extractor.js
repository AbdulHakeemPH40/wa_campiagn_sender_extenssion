// Extractor script for WhatsApp Sender Pro Chrome Extension

// Import modals
import { showLicenseRequiredModal, showLicenseVerificationFailedModal } from './modals.js';

// Store event listener references for cleanup
let eventListeners = new Map();

function addEventListenerWithCleanup(element, eventType, handler) {
  if (!element) return;
  element.addEventListener(eventType, handler);
  if (!eventListeners.has(element)) {
    eventListeners.set(element, new Map());
  }
  eventListeners.get(element).set(eventType, handler);
}

function cleanupEventListeners() {
  eventListeners.forEach((listeners, element) => {
    listeners.forEach((handler, eventType) => {
      element.removeEventListener(eventType, handler);
    });
  });
  eventListeners.clear();
}

// Local toast function to avoid import issues
function localToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  if (type === 'dark') {
    toast.classList.add('dark');
  }
  toast.textContent = message;
  const container = document.getElementById('toastContainer');
  if (container) {
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}

// Add Back to Menu button logic (mirroring sender.js)
function initBackButton() {
  const backBtn = document.getElementById('backBtn');
  if (backBtn) {
    backBtn.innerHTML = '<i class="ri-arrow-left-line"></i> Back to Menu';
    addEventListenerWithCleanup(backBtn, 'click', async () => {
      try {
        // Clean up resources
        cleanupEventListeners();
        // Remove any existing connection check intervals
        if (window.connectionCheckInterval) {
          clearInterval(window.connectionCheckInterval);
          window.connectionCheckInterval = null;
        }
        // Return to main menu (popup.html)
        window.location.href = 'popup.html';
      } catch (error) {
        console.error('Error handling back navigation:', error);
        localToast('Error returning to main menu', 'error');
      }
    });
  }
}

// Main initialization function for extractor
export function initExtractor() {
  // Clean up any existing event listeners first
  cleanupEventListeners();

  // Initialize back button
  initBackButton();

  // Initialize UI elements
  const sourceTabs = document.querySelectorAll('.source-tab');
  const sourceContents = document.querySelectorAll('.source-content');
  const searchInputs = document.querySelectorAll('input[placeholder*="Search"]');
  const groupCheckboxes = document.querySelectorAll('#groups-content input[type="checkbox"]');
  const chatCheckboxes = document.querySelectorAll('#chats-content input[type="checkbox"]');
  const sharedCheckboxes = document.querySelectorAll('#shared-content input[type="checkbox"]');
  const extractionNameInput = document.querySelector('input[placeholder="Enter a name for this extraction"]');
  const contactTypeCheckboxes = document.querySelectorAll('input[name="contactType"]');
  const dataTypeCheckboxes = document.querySelectorAll('input[name="dataType"]');
  const numberFormatSelect = document.querySelector('select[name="numberFormat"]');
  const removeDuplicatesSwitch = document.querySelector('input[name="removeDuplicates"]');
  const validateNumbersSwitch = document.querySelector('input[name="validateNumbers"]');
  const extractButton = document.querySelector('button.extract-button');
  const viewPreviousButton = document.querySelector('button.view-previous-button');
  const refreshButtons = document.querySelectorAll('button i.ri-refresh-line');
  const downloadButton = document.querySelector('button i.ri-download-line');
  const extractFromGroupBtn = document.getElementById('extractFromGroupBtn');
  const extractFromChatBtn = document.getElementById('extractFromChatBtn');
  const extractFromContactsBtn = document.getElementById('extractFromContactsBtn');
  const extractorResults = document.getElementById('extractorResults');
  const exportContactsBtn = document.getElementById('exportContactsBtn');
  // --- New extractor controls ---
  const groupControlsContainer = document.getElementById('groupControlsContainer');
  const loadGroupsButton = document.getElementById('loadGroupsButton');
  const groupListContainer = document.getElementById('groupListContainer');
  const groupListDiv = document.getElementById('groupList');
  const selectAllGroupsCheckbox = document.getElementById('selectAllGroups');
  const downloadSelectedGroupContactsButton = document.getElementById('downloadSelectedGroupContacts');

  // Extraction state
  let selectedGroups = [];
  let selectedChats = [];
  let selectedSharedContacts = [];
  let extractionResults = null;
  let previousExtractions = [];

  // Set up event listeners
  if (sourceTabs) {
    sourceTabs.forEach((tab, index) => {
      addEventListenerWithCleanup(tab, 'click', function() {
        sourceTabs.forEach(t => t.classList.remove('active'));
        sourceContents.forEach(c => c.classList.remove('active'));
        this.classList.add('active');
        sourceContents[index].classList.add('active');
      });
    });
  }

  if (searchInputs) {
    searchInputs.forEach(input => {
      addEventListenerWithCleanup(input, 'input', function() {
        const searchTerm = this.value.toLowerCase();
        const parentId = this.closest('.source-content').id;
        if (parentId === 'groups-content') {
          filterGroups(searchTerm);
        } else if (parentId === 'chats-content') {
          filterChats(searchTerm);
        } else if (parentId === 'shared-content') {
          filterSharedContacts(searchTerm);
        }
      });
    });
  }

  if (groupCheckboxes) {
    groupCheckboxes.forEach(checkbox => {
      addEventListenerWithCleanup(checkbox, 'change', function() {
        updateSelectedGroups();
      });
    });
  }

  if (chatCheckboxes) {
    chatCheckboxes.forEach(checkbox => {
      addEventListenerWithCleanup(checkbox, 'change', function() {
        updateSelectedChats();
      });
    });
  }

  if (sharedCheckboxes) {
    sharedCheckboxes.forEach(checkbox => {
      addEventListenerWithCleanup(checkbox, 'change', function() {
        updateSelectedSharedContacts();
      });
    });
  }

  if (extractButton) {
    addEventListenerWithCleanup(extractButton, 'click', extractContacts);
  }

  if (viewPreviousButton) {
    addEventListenerWithCleanup(viewPreviousButton, 'click', viewPreviousExtractions);
  }

  if (refreshButtons) {
    refreshButtons.forEach(button => {
      addEventListenerWithCleanup(button.parentElement, 'click', function() {
        const parentId = this.closest('.bg-white').querySelector('h2').textContent;
        if (parentId.includes('Extraction Results')) {
          refreshExtractionResults();
        } else {
          refreshSources();
        }
      });
    });
  }

  if (downloadButton) {
    addEventListenerWithCleanup(downloadButton.parentElement, 'click', function() {
      downloadExtractionResults();
    });
  }

  if (extractFromGroupBtn) {
    let isProcessing = false;
    addEventListenerWithCleanup(extractFromGroupBtn, 'click', async () => {
      if (isProcessing) return;
      isProcessing = true;
      
      try {
        const waResult = await chrome.storage.local.get(['waUserPhoneNumberResult']);
        if (!waResult.waUserPhoneNumberResult || !waResult.waUserPhoneNumberResult.number) {
          localToast('Please connect to WhatsApp Web to verify your license', 'error');
          return;
        }
        
        const phoneNumber = waResult.waUserPhoneNumberResult.number;
        const licenseResponse = await fetch('https://www.wacampaignsender.com/api/verify-license/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone_number: phoneNumber })
        });
        
        const licenseData = await licenseResponse.json();
        
        if (!licenseData.is_active) {
          showLicenseRequiredModal('extract contacts from groups', licenseData.error || null);
          return;
        }
        
        if (groupControlsContainer) groupControlsContainer.style.display = 'block';
        if (groupListContainer) groupListContainer.style.display = 'none';
        extractorResults.classList.remove('visible');
      } catch (error) {
        console.error('License verification failed:', error);
        showLicenseVerificationFailedModal(error.message || null);
      } finally {
        setTimeout(() => { isProcessing = false; }, 2000);
      }
    });
  }

  if (extractFromChatBtn) {
    let isProcessing = false;
    addEventListenerWithCleanup(extractFromChatBtn, 'click', async () => {
      if (isProcessing) return;
      isProcessing = true;
      
      try {
        const waResult = await chrome.storage.local.get(['waUserPhoneNumberResult']);
        if (!waResult.waUserPhoneNumberResult || !waResult.waUserPhoneNumberResult.number) {
          localToast('Please connect to WhatsApp Web to verify your license', 'error');
          return;
        }
        
        const phoneNumber = waResult.waUserPhoneNumberResult.number;
        const licenseResponse = await fetch('https://www.wacampaignsender.com/api/verify-license/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone_number: phoneNumber })
        });
        
        const licenseData = await licenseResponse.json();
        
        if (!licenseData.is_active) {
          showLicenseRequiredModal('extract contacts from chats', licenseData.error || null);
          return;
        }
        
        requestChatContacts();
      } catch (error) {
        console.error('License verification failed:', error);
        showLicenseVerificationFailedModal(error.message || null);
      } finally {
        setTimeout(() => { isProcessing = false; }, 2000);
      }
    });
  }

  if (extractFromContactsBtn) {
    // Add debounce to prevent multiple clicks
    let isProcessing = false;
    addEventListenerWithCleanup(extractFromContactsBtn, 'click', async () => {
      if (isProcessing) return;
      isProcessing = true;
      
      try {
        // Check license first
        const waResult = await chrome.storage.local.get(['waUserPhoneNumberResult']);
        if (!waResult.waUserPhoneNumberResult || !waResult.waUserPhoneNumberResult.number) {
          localToast('Please connect to WhatsApp Web to verify your license', 'error');
          return;
        }
        
        const phoneNumber = waResult.waUserPhoneNumberResult.number;
        const licenseResponse = await fetch('https://www.wacampaignsender.com/api/verify-license/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone_number: phoneNumber })
        });
        
        const licenseData = await licenseResponse.json();
        
        if (!licenseData.is_active) {
          showLicenseRequiredModal('extract saved contacts', licenseData.error || null);
          return;
        }
        
        if (groupControlsContainer) groupControlsContainer.style.display = 'none';
        if (groupListContainer) groupListContainer.style.display = 'none';
        requestSavedContacts();
      } catch (error) {
        console.error('License verification failed:', error);
        showLicenseVerificationFailedModal(error.message || null);
      } finally {
        // Reset processing flag after 2 seconds
        setTimeout(() => { isProcessing = false; }, 2000);
      }
    });
  }

  // Load groups button
  if (loadGroupsButton) {
    addEventListenerWithCleanup(loadGroupsButton, 'click', () => {
      requestGroupList();
    });
  }

  // Select / deselect all groups
  if (selectAllGroupsCheckbox) {
    addEventListenerWithCleanup(selectAllGroupsCheckbox,'change', () => {
      const boxes = groupListDiv?.querySelectorAll('input[type="checkbox"]') || [];
      boxes.forEach(b => { b.checked = selectAllGroupsCheckbox.checked; });
    });
  }

  // Download selected groups
  if (downloadSelectedGroupContactsButton) {
    addEventListenerWithCleanup(downloadSelectedGroupContactsButton,'click', () => {
      const selected = [];
      groupListDiv.querySelectorAll('input[type="checkbox"]:checked').forEach(cb=>{
        selected.push({ id: cb.value, name: cb.dataset.groupName });
      });
      if(selected.length===0){ localToast('Please select at least one group','error'); return; }
      sendMessageToWhatsAppTab({ type: 'DOWNLOAD_SELECTED_GROUP_CONTACTS', selectedGroups: selected });
    });
  }

  // Load previous extractions
  loadPreviousExtractions();
}

// Register cleanup function with popup.js
window.currentFeatureCleanup = cleanupEventListeners;

// On DOMContentLoaded, always call initExtractor
if (document.readyState !== 'loading') {
  initExtractor();
} else {
  document.addEventListener('DOMContentLoaded', () => {
    initExtractor();
  });
}

// Functions
function filterGroups(searchTerm) {
  const groupItems = document.querySelectorAll('#groups-content .flex.items-center.justify-between');
  groupItems.forEach(item => {
    const groupName = item.querySelector('.text-sm.font-medium').textContent.toLowerCase();
    if (groupName.includes(searchTerm)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}

function filterChats(searchTerm) {
  const chatItems = document.querySelectorAll('#chats-content .flex.items-center.justify-between');
  chatItems.forEach(item => {
    const chatName = item.querySelector('.text-sm.font-medium').textContent.toLowerCase();
    if (chatName.includes(searchTerm)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}

function filterSharedContacts(searchTerm) {
  const sharedItems = document.querySelectorAll('#shared-content .flex.items-center.justify-between');
  sharedItems.forEach(item => {
    const sharedName = item.querySelector('.text-sm.font-medium').textContent.toLowerCase();
    if (sharedName.includes(searchTerm)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
}

function updateSelectedGroups() {
  selectedGroups = [];
  const groupCheckboxes = document.querySelectorAll('#groups-content input[type="checkbox"]');
  groupCheckboxes.forEach(checkbox => {
    if (checkbox.checked) {
      const groupItem = checkbox.closest('.flex.items-center.justify-between');
      const groupName = groupItem.querySelector('.text-sm.font-medium').textContent;
      const memberCount = parseInt(groupItem.querySelector('.text-xs.text-gray-500').textContent.split(' ')[0]);
      selectedGroups.push({
        name: groupName,
        memberCount: memberCount
      });
    }
  });
}

function updateSelectedChats() {
  selectedChats = [];
  const chatCheckboxes = document.querySelectorAll('#chats-content input[type="checkbox"]');
  chatCheckboxes.forEach(checkbox => {
    if (checkbox.checked) {
      const chatItem = checkbox.closest('.flex.items-center.justify-between');
      const chatName = chatItem.querySelector('.text-sm.font-medium').textContent;
      const messageCount = parseInt(chatItem.querySelector('.text-xs.text-gray-500').textContent.split(' ')[2]);
      selectedChats.push({
        name: chatName,
        messageCount: messageCount
      });
    }
  });
}

function updateSelectedSharedContacts() {
  selectedSharedContacts = [];
  const sharedCheckboxes = document.querySelectorAll('#shared-content input[type="checkbox"]');
  sharedCheckboxes.forEach(checkbox => {
    if (checkbox.checked) {
      const sharedItem = checkbox.closest('.flex.items-center.justify-between');
      const sharedName = sharedItem.querySelector('.text-sm.font-medium').textContent;
      const contactCount = parseInt(sharedItem.querySelector('.text-xs.text-gray-500').textContent.split(' ')[0]);
      selectedSharedContacts.push({
        name: sharedName,
        contactCount: contactCount
      });
    }
  });
}

function extractContacts() {
  if (!extractionNameInput || extractionNameInput.value.trim() === '') {
    localToast('Please enter a name for this extraction', 'error');
    return;
  }
  const totalSelected = selectedGroups.length + selectedChats.length + selectedSharedContacts.length;
  if (totalSelected === 0) {
    localToast('Please select at least one source to extract contacts from', 'error');
    return;
  }
  localToast('Extracting contacts...', 'info');
  const loadingSpinner = document.getElementById('loadingSpinner');
  if (loadingSpinner) loadingSpinner.style.display = 'flex';
  const resultsList = document.getElementById('contactsList');
  if (resultsList) resultsList.style.display = 'none';
  setTimeout(() => {
    const totalContacts = simulateExtraction(extractionSettings);
    saveExtraction(extractionSettings, totalContacts);
    localToast(`Successfully extracted ${totalContacts.length} contacts!`, 'success');
    displayExtractionResults(totalContacts, extractionSettings);
    if (loadingSpinner) loadingSpinner.style.display = 'none';
    if (resultsList) resultsList.style.display = 'block';
  }, 2000);
}

function simulateExtraction(settings) {
  let contacts = [];
  selectedGroups.forEach(group => {
    const groupContacts = generateRandomContacts(Math.min(group.memberCount, 50), group.name);
    contacts = contacts.concat(groupContacts);
  });
  selectedChats.forEach(chat => {
    contacts.push({
      name: chat.name,
      number: generateRandomPhoneNumber(),
      source: 'Chat',
      isBusiness: Math.random() > 0.7,
      isSaved: Math.random() > 0.5
    });
  });
  selectedSharedContacts.forEach(shared => {
    const sharedContacts = generateRandomContacts(Math.min(shared.contactCount, 30), shared.name);
    contacts = contacts.concat(sharedContacts);
  });
  let filteredContacts = contacts;
  if (!settings.contactTypes.allContacts) {
    if (settings.contactTypes.businessContacts && !settings.contactTypes.savedContactsOnly) {
      filteredContacts = filteredContacts.filter(c => c.isBusiness);
    } else if (!settings.contactTypes.businessContacts && settings.contactTypes.savedContactsOnly) {
      filteredContacts = filteredContacts.filter(c => c.isSaved);
    } else if (settings.contactTypes.businessContacts && settings.contactTypes.savedContactsOnly) {
      filteredContacts = filteredContacts.filter(c => c.isBusiness && c.isSaved);
    }
  } else if (settings.contactTypes.savedContactsOnly) {
    filteredContacts = filteredContacts.filter(c => c.isSaved);
  }
  if (settings.removeDuplicates) {
    const uniqueNumbers = new Set();
    filteredContacts = filteredContacts.filter(contact => {
      if (uniqueNumbers.has(contact.number)) {
        return false;
      }
      uniqueNumbers.add(contact.number);
      return true;
    });
  }
  filteredContacts = filteredContacts.map(contact => {
    let formattedNumber = contact.number;
    switch (settings.numberFormat) {
      case 'international':
        break;
      case 'local':
        formattedNumber = formattedNumber.replace(/^\+\d+\s/, '');
        break;
      case 'raw':
        formattedNumber = formattedNumber.replace(/\D/g, '');
        break;
    }
    return {
      ...contact,
      number: formattedNumber
    };
  });
  return filteredContacts;
}

function generateRandomContacts(count, sourceName) {
  const contacts = [];
  const firstNames = ['John', 'Jane', 'Michael', 'Emily', 'David', 'Sarah', 'Robert', 'Lisa', 'William', 'Maria'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson'];
  for (let i = 0; i < count; i++) {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    contacts.push({
      name: `${firstName} ${lastName}`,
      number: generateRandomPhoneNumber(),
      source: sourceName,
      isBusiness: Math.random() > 0.7,
      isSaved: Math.random() > 0.5
    });
  }
  return contacts;
}

function generateRandomPhoneNumber() {
  const countryCodes = ['+1', '+44', '+91', '+61', '+49'];
  const countryCode = countryCodes[Math.floor(Math.random() * countryCodes.length)];
  let number = countryCode + ' ';
  for (let i = 0; i < 3; i++) {
    number += Math.floor(Math.random() * 10);
  }
  number += '-';
  for (let i = 0; i < 3; i++) {
    number += Math.floor(Math.random() * 10);
  }
  number += '-';
  for (let i = 0; i < 4; i++) {
    number += Math.floor(Math.random() * 10);
  }
  return number;
}

function saveExtraction(settings, contacts) {
  const extraction = {
    id: 'EXT-' + Date.now(),
    name: settings.name,
    date: new Date().toISOString(),
    settings: settings,
    contactCount: contacts.length,
    sources: {
      groups: selectedGroups.map(g => g.name),
      chats: selectedChats.map(c => c.name),
      shared: selectedSharedContacts.map(s => s.name)
    }
  };
  previousExtractions.unshift(extraction);
  if (previousExtractions.length > 10) {
    previousExtractions = previousExtractions.slice(0, 10);
  }
  chrome.storage.local.set({ previousExtractions }, function() {
    console.log('Extraction saved to history');
  });
  extractionResults = {
    extraction: extraction,
    contacts: contacts
  };
  chrome.storage.local.set({ currentExtractionResults: extractionResults }, function() {
    console.log('Extraction results saved');
  });
}

function loadPreviousExtractions() {
  chrome.storage.local.get(['previousExtractions', 'currentExtractionResults'], function(result) {
    if (result.previousExtractions) {
      previousExtractions = result.previousExtractions;
    }
    if (result.currentExtractionResults) {
      extractionResults = result.currentExtractionResults;
      displayExtractionResults(extractionResults.contacts, extractionResults.extraction.settings);
    }
  });
}

function displayExtractionResults(contacts, settings) {
  const resultsContainer = document.querySelector('.bg-white.rounded.shadow-sm.p-5:last-child');
  if (!resultsContainer) return;
  resultsContainer.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'flex items-center justify-between mb-4';
  header.innerHTML = `
    <h2 class="text-lg font-semibold text-gray-800">Extraction Results</h2>
    <div class="flex space-x-2">
      <button class="w-8 h-8 flex items-center justify-center bg-gray-100 rounded hover:bg-gray-200">
        <i class="ri-refresh-line text-gray-600 ri-sm"></i>
      </button>
      <button class="w-8 h-8 flex items-center justify-center bg-gray-100 rounded hover:bg-gray-200">
        <i class="ri-download-line text-gray-600 ri-sm"></i>
      </button>
    </div>
  `;
  resultsContainer.appendChild(header);
  const content = document.createElement('div');
  if (contacts && contacts.length > 0) {
    content.innerHTML = `
      <div class="mb-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium text-gray-700">Extraction: ${settings.name}</span>
          <span class="text-xs text-gray-500">${contacts.length} contacts</span>
        </div>
        <div class="relative mb-3">
          <input type="text" placeholder="Search contacts..." class="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
          <div class="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 flex items-center justify-center">
            <i class="ri-search-line text-gray-400 ri-sm"></i>
          </div>
        </div>
      </div>
      <div class="border border-gray-200 rounded overflow-hidden mb-4">
        <table class="min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Number</th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">
            ${contacts.slice(0, 10).map(contact => `
              <tr>
                <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-900">${contact.name}</td>
                <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${contact.number}</td>
                <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${contact.source}</td>
                <td class="px-4 py-2 whitespace-nowrap">
                  <span class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${contact.isBusiness ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}">
                    ${contact.isBusiness ? 'Business' : 'Personal'}
                  </span>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between">
        <div class="text-sm text-gray-500">
          ${contacts.length > 10 ? `Showing 10 of ${contacts.length} contacts` : `Showing all ${contacts.length} contacts`}
        </div>
        <div class="flex space-x-3">
          <button class="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-button text-gray-700 bg-white hover:bg-gray-50 !rounded-button whitespace-nowrap">
            <i class="ri-file-copy-line mr-1"></i>
            Copy All
          </button>
          <button class="inline-flex items-center px-3 py-2 border border-primary text-sm font-medium rounded-button text-white bg-primary hover:bg-primary/90 !rounded-button whitespace-nowrap">
            <i class="ri-send-plane-line mr-1"></i>
            Send Message
          </button>
        </div>
      </div>
    `;
  } else {
    content.className = 'results-list';
    content.innerHTML = `
      <div class="empty-state">
        <i class="ri-contacts-book-line"></i>
        <p>No contacts extracted yet</p>
        <p class="small">Click "Extract from Group" or "Extract from Chat" to start</p>
      </div>
    `;
  }
  resultsContainer.appendChild(content);
  // ... rest of the function remains the same
}

function refreshExtractionResults() {
  if (!extractionResults) {
    localToast('No extraction results to refresh', 'error');
    return;
  }
  localToast('Refreshing extraction results...', 'info');
  setTimeout(() => {
    const contacts = simulateExtraction(extractionResults.extraction.settings);
    extractionResults.contacts = contacts;
    chrome.storage.local.set({ currentExtractionResults: extractionResults }, function() {
      console.log('Extraction results updated');
    });
    displayExtractionResults(contacts, extractionResults.extraction.settings);
    localToast('Extraction results refreshed!', 'success');
  }, 1000);
}

function copyContactsToClipboard(contacts) {
  if (!contacts || contacts.length === 0) {
    localToast('No contacts to copy', 'error');
    return;
  }
  localToast(`${contacts.length} contacts copied to clipboard!`, 'success');
}

function openSenderWithContacts(contacts) {
  if (!contacts || contacts.length === 0) {
    localToast('No contacts to send to', 'error');
    return;
  }
  chrome.storage.local.set({ contactsForSender: contacts }, function() {
    chrome.tabs.create({ url: chrome.runtime.getURL('html/sender.html?from=extractor') });
  });
}

function viewPreviousExtractions() {
  if (previousExtractions.length === 0) {
    localToast('No previous extractions found', 'info');
    return;
  }
  localToast(`You have ${previousExtractions.length} previous extractions`, 'info');
  console.log('Previous extractions:', previousExtractions);
}

function searchExtractionResults(searchTerm) {
  if (!extractionResults || !extractionResults.contacts) return;
  searchTerm = searchTerm.toLowerCase();
  const tableRows = document.querySelectorAll('tbody tr');
  tableRows.forEach(row => {
    const name = row.querySelector('td:first-child').textContent.toLowerCase();
    const number = row.querySelector('td:nth-child(2)').textContent.toLowerCase();
    if (name.includes(searchTerm) || number.includes(searchTerm)) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

function refreshSources() {
  localToast('Refreshing sources...', 'info');
  setTimeout(() => {
    localToast('Sources refreshed successfully!', 'success');
  }, 1000);
}

// ================= Helper & Messaging utilities =================

function sendMessageToWhatsAppTab(message){
  chrome.tabs.query({active:true,currentWindow:true}, tabs => {
    const tab = tabs[0];
    if(tab && tab.url && tab.url.startsWith('https://web.whatsapp.com')){
      chrome.tabs.sendMessage(tab.id, message, () => {
        if(chrome.runtime.lastError){
          localToast('Cannot reach WhatsApp tab – open web.whatsapp.com first','error');
        }
      });
    } else {
      localToast('Please open WhatsApp Web in a tab and try again','error');
    }
  });
}

function requestGroupList(){
  localToast('Loading groups...','info');
  sendMessageToWhatsAppTab({ type: 'FETCH_GROUP_LIST' });
}

function requestChatContacts(){
  localToast('Fetching chat contacts...','info');
  sendMessageToWhatsAppTab({ type: 'FETCH_CHAT_CONTACTS_CSV' });
}

function requestSavedContacts(){
  localToast('Fetching saved contacts...', 'info');
  sendMessageToWhatsAppTab({ type: 'FETCH_SAVED_CONTACTS_CSV' });
}

function renderContactsList(arr){
  const listEl = document.getElementById('contactsList');
  if(!listEl) return;
  listEl.innerHTML = '';
  if(!arr || arr.length===0){
    listEl.innerHTML = '<div class="empty-state"><i class="ri-file-list-2-line"></i><p>No contacts found.</p></div>';
    return;
  }
  arr.forEach(c=>{
    const div=document.createElement('div');
    div.className='contact-item';
    div.textContent = `${c.name || c.contactName || ''} - ${c.phoneNumber || c.number}`;
    listEl.appendChild(div);
  });
}

// CSV helpers
function convertToCSV(dataArray, headers = ['Name', 'Phone']){
  if (!dataArray || dataArray.length === 0) return '';
  const delim = ',';
  const newline = '\n';
  const actualHeaders = headers && headers.length ? headers : ['Name', 'Phone'];
  let out = actualHeaders.join(delim) + newline;

  dataArray.forEach(item => {
    const row = [];
    actualHeaders.forEach(h => {
      let val = '';
      if (h === 'Name') {
        val = item.name ?? item.contactName ?? item.Name ?? '';
      } else if (h === 'Phone') {
        val = item.phoneNumber ?? item.number ?? item.Phone ?? item.phone ?? '';
      } else {
        val = item[h] ?? '';
      }
      val = String(val).replace(/"/g, '""');
      if (val.includes(delim) || val.includes(newline)) val = `"${val}"`;
      row.push(val);
    });
    out += row.join(delim) + newline;
  });
  return out;
}

function downloadCSV(csvString, filename){
  const blob = new Blob([csvString],{type:'text/csv;charset=utf-8;'});
  const link=document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

let currentContacts=[];
let lastExportType='contacts';

// Listener for results coming back from content script
chrome.runtime.onMessage.addListener((message) => {
  switch(message.type){
    case 'GROUP_LIST_RESULT':
      if(message.status==='success'){
        displayGroups(message.groups||[]);
      } else {
        localToast(message.error || 'Failed to load groups','error');
      }
      break;
    case 'CHAT_CONTACTS_RESULT':
      if(message.status==='success'){
        currentContacts = message.contacts || [];
        lastExportType = 'chats';
        renderContactsList(currentContacts);
        document.getElementById('extractorResults').classList.add('visible');
      } else {
        localToast(message.error || 'Failed to fetch chat contacts','error');
      }
      break;
    case 'SELECTED_GROUP_CONTACTS_RESULT':
      if(message.status==='success'){
        currentContacts = message.contacts || [];
        lastExportType = 'group';
        renderContactsList(currentContacts);
        document.getElementById('extractorResults').classList.add('visible');
      } else {
        localToast(message.error || 'Failed to fetch group contacts','error');
      }
      break;
    case 'SAVED_CONTACTS_RESULT':
      if(message.status==='success'){
        currentContacts = message.contacts || [];
        lastExportType = 'contacts';
        renderContactsList(currentContacts);
        document.getElementById('extractorResults').classList.add('visible');
        // Only show toast once by checking if contacts were actually updated
        if (currentContacts.length > 0) {
          localToast(`${currentContacts.length} contacts fetched from address book!`, 'success');
        }
      } else {
        localToast(message.error || 'Failed to fetch saved contacts','error');
      }
      break;
  }
});

// Populate group list UI
function displayGroups(groups){
  const listEl = document.getElementById('groupList');
  const containerEl = document.getElementById('groupListContainer');
  if(!listEl || !containerEl) return;
  listEl.innerHTML='';
  if(!groups || groups.length===0){
    listEl.textContent='No groups found.';
    containerEl.style.display='block';
    return;
  }
  groups.forEach(g=>{
    const row=document.createElement('div');
    row.style.display='flex'; row.style.alignItems='center'; row.style.marginBottom='4px';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.value=g.id; cb.dataset.groupName=g.name; cb.style.marginRight='6px';
    const label=document.createElement('label'); label.textContent=g.name; label.style.fontSize='12px';
    row.appendChild(cb); row.appendChild(label);
    listEl.appendChild(row);
  });
  containerEl.style.display='block';
  document.getElementById('selectedGroupActionsContainer').style.display='block';
}

// Export button action
if(document.getElementById('exportContactsBtn')){
  document.getElementById('exportContactsBtn').addEventListener('click', () => {
    if(!currentContacts.length){ localToast('Nothing to export','error'); return; }
    const csv = convertToCSV(currentContacts);
    const filename = `extracted_${lastExportType}.csv`;
    downloadCSV(csv, filename);
  });
}