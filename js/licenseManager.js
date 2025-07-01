// License Manager - Handles backend communication for license verification
const API_BASE_URL = 'https://www.wacampaignsender.com/api'; // Django backend URL
const PRICING_URL = 'https://www.wacampaignsender.com/#pricing'; // Pricing page URL

class LicenseManager {
  constructor() {
    this.userLicense = null;
    this.whatsappNumber = null;
  }

  // Verify license with backend (with cache check)
  async verifyLicense(phoneNumber) {
    try {
      // Check if backend is reachable first with fast timeout
      const backendCheck = await this.checkBackendConnection();
      if (!backendCheck) {
        // Backend offline - clear cached license and return inactive
        await chrome.storage.local.remove(['userLicense', 'licenseVerified', 'licenseTimestamp']);
        return { is_active: false, error: 'Backend server is offline' };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(`${API_BASE_URL}/verify-license/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone_number: phoneNumber }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      const data = await response.json();
      
      if (response.ok) {
        this.userLicense = data;
        this.whatsappNumber = phoneNumber;
        
        // Store license info in extension storage with timestamp
        chrome.storage.local.set({
          userLicense: data,
          whatsappNumber: phoneNumber,
          licenseVerified: true,
          licenseTimestamp: Date.now()
        });
        
        return data;
      } else {
        throw new Error(data.error || 'License verification failed');
      }
    } catch (error) {
      console.error('License verification error:', error);
      
      // Check if campaign is running - don't clear cache during active campaign
      const campaignStatus = await chrome.storage.local.get('activeCampaign');
      const isRunning = campaignStatus.activeCampaign && 
                       !['completed','canceled','failed','aborted'].includes(campaignStatus.activeCampaign.status);
      
      if (!isRunning) {
        // Only clear cache if no campaign is running
        await chrome.storage.local.remove(['userLicense', 'licenseVerified', 'licenseTimestamp']);
      }
      
      return { is_active: false, error: error.message };
    }
  }

  // Check if backend server is reachable with fast timeout
  async checkBackendConnection() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
      
      const response = await fetch(`${API_BASE_URL}/verify-license/`, {
        method: 'OPTIONS',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      console.log('Backend connection check failed:', error);
      return false;
    }
  }

  // Check if user can access features (always verify fresh)
  async canAccessFeatures() {
    // Always return false to force fresh verification
    return false;
  }

  // Get license status
  getLicenseStatus() {
    if (!this.userLicense) return 'No License';
    if (this.userLicense.is_trial) return `Trial (${this.userLicense.days_remaining} days left)`;
    if (this.userLicense.is_active) return 'Pro Version';
    return 'Expired';
  }

  // Get pricing URL
  getPricingUrl() {
    return PRICING_URL;
  }

  // Show buy now modal
  showBuyNowModal() {
    const modal = document.createElement('div');
    modal.innerHTML = `
      <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;">
        <div style="background:white;padding:20px;border-radius:8px;text-align:center;max-width:400px;">
          <h3>Upgrade Required</h3>
          <p>This feature requires a Pro license. Your current status: ${this.getLicenseStatus()}</p>
          <button onclick="window.open('${PRICING_URL}', '_blank')" style="background:#25D366;color:white;border:none;padding:10px 20px;border-radius:5px;margin:5px;">
            Buy Now
          </button>
          <button onclick="this.parentElement.parentElement.remove()" style="background:#ccc;color:black;border:none;padding:10px 20px;border-radius:5px;margin:5px;">
            Cancel
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
}

export const licenseManager = new LicenseManager();