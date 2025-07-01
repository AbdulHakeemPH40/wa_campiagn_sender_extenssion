// Feature Guard - Controls access to premium features
import { licenseManager } from './licenseManager.js';

export function guardFeature(featureName, callback) {
  // Check if user has valid license
  if (licenseManager.canAccessFeatures()) {
    callback();
  } else {
    licenseManager.showBuyNowModal();
  }
}

// Add guards to sender and extractor buttons
export function initFeatureGuards() {
  // Guard Message Sender
  const startCampaignBtn = document.getElementById('startCampaignBtn');
  if (startCampaignBtn) {
    const originalHandler = startCampaignBtn.onclick;
    startCampaignBtn.onclick = (e) => {
      e.preventDefault();
      guardFeature('campaign', () => {
        if (originalHandler) originalHandler(e);
      });
    };
  }

  // Guard Contact Extractor
  const extractorBtns = document.querySelectorAll('[id*="extractor"], [id*="extract"]');
  extractorBtns.forEach(btn => {
    const originalHandler = btn.onclick;
    btn.onclick = (e) => {
      e.preventDefault();
      guardFeature('extractor', () => {
        if (originalHandler) originalHandler(e);
      });
    };
  });
}