// js/safetyMode.js - Simplified safety mode management

function updateOwnNumberStatusUI() {
  const statusDisplay = document.getElementById('own-phone-number-display');
  if (!statusDisplay) return;

  chrome.storage.local.get('waUserPhoneNumberResult', (result) => {
    const entry = result.waUserPhoneNumberResult;
    if (entry && entry.status === 'success' && entry.number) {
      statusDisplay.textContent = entry.number;
      statusDisplay.style.color = '#198754';
    } else {
      statusDisplay.textContent = 'Not Found';
      statusDisplay.style.color = '#dc3545';
    }
  });
}

function initializeSafetyMode() {
  const safetyModeToggle = document.getElementById('safetyModeToggle');
  const safetyModeWarning = document.getElementById('safetyModeWarning');

  if (!safetyModeToggle || !safetyModeWarning) return;

  chrome.storage.local.get('safetyModeEnabled', (data) => {
    const isEnabled = data.safetyModeEnabled !== false;
    safetyModeToggle.checked = isEnabled;
    safetyModeWarning.style.display = isEnabled ? 'none' : 'block';
    
    chrome.storage.local.set({ safetyModeEnabled: isEnabled });
    updateOwnNumberStatusUI();
  });

  safetyModeToggle.addEventListener('change', (event) => {
    const isEnabled = event.target.checked;
    chrome.storage.local.set({ safetyModeEnabled: isEnabled }, () => {
      safetyModeWarning.style.display = isEnabled ? 'none' : 'block';
      updateOwnNumberStatusUI();
    });
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.waUserPhoneNumberResult) {
      updateOwnNumberStatusUI();
    }
  });
  
  fetchOwnWhatsAppNumber();
}

async function fetchOwnWhatsAppNumber() {
  try {
    const result = await chrome.storage.local.get('waUserPhoneNumberResult');
    if (result.waUserPhoneNumberResult?.status === 'success' && result.waUserPhoneNumberResult?.number) {
      return result.waUserPhoneNumberResult.number;
    }
    
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (tabs.length === 0) return null;
    
    await chrome.tabs.sendMessage(tabs[0].id, { action: 'getOwnWhatsAppNumber' });
    return null;
  } catch (error) {
    return null;
  }
}

export { initializeSafetyMode, fetchOwnWhatsAppNumber };