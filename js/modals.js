// modals.js - Centralized modal handling for the extension

/**
 * Creates and shows a license required modal
 * @param {string} action - The action requiring a license (e.g., "start campaigns", "reset campaigns")
 * @param {string} errorMessage - Optional error message to display
 */
export function showLicenseRequiredModal(action = "use this feature", errorMessage = null) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
  
  const content = document.createElement('div');
  content.style.cssText = 'background:white;padding:20px;border-radius:8px;text-align:center;max-width:340px;position:relative;';
  
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '×';
  closeBtn.style.cssText = 'position:absolute;top:10px;right:15px;background:none;border:none;font-size:20px;cursor:pointer;color:#666;';
  closeBtn.onclick = () => modal.remove();
  
  const title = document.createElement('h3');
  title.textContent = 'Unlock Full Access';
  title.style.marginTop = '0';
  
  const desc = document.createElement('p');
  desc.textContent = `A license is required to ${action}.`;
  
  const trial = document.createElement('p');
  trial.innerHTML = '<strong>Enjoy every feature free for 14 days</strong>';
  
  const credit = document.createElement('p');
  credit.innerHTML = '<small>No credit card needed · Cancel anytime</small>';
  
  const tryBtn = document.createElement('button');
  tryBtn.textContent = 'Start Free Trial';
  tryBtn.style.cssText = 'background:#25D366;color:white;border:none;padding:10px 22px;border-radius:5px;margin:6px;cursor:pointer;';
  tryBtn.onclick = () => window.open('https://www.wacampaignsender.com/#pricing', '_blank');
  
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Maybe Later';
  cancelBtn.style.cssText = 'background:#ccc;color:black;border:none;padding:10px 22px;border-radius:5px;margin:6px;cursor:pointer;';
  cancelBtn.onclick = () => modal.remove();
  
  content.appendChild(closeBtn);
  content.appendChild(title);
  content.appendChild(desc);
  content.appendChild(trial);
  content.appendChild(credit);
  if (errorMessage) {
    const error = document.createElement('p');
    error.textContent = errorMessage;
    error.style.cssText = 'color:red;font-size:14px;';
    content.appendChild(error);
  }
  content.appendChild(tryBtn);
  content.appendChild(cancelBtn);
  
  modal.appendChild(content);
  document.body.appendChild(modal);
}

/**
 * Creates and shows a license verification failed modal
 * @param {string} errorMessage - Optional error message to display
 */
export function showLicenseVerificationFailedModal(errorMessage = null) {
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';
  
  const content = document.createElement('div');
  content.style.cssText = 'background:white;padding:20px;border-radius:8px;text-align:center;max-width:340px;position:relative;';
  
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '×';
  closeBtn.style.cssText = 'position:absolute;top:10px;right:15px;background:none;border:none;font-size:20px;cursor:pointer;color:#666;';
  closeBtn.onclick = () => modal.remove();
  
  const title = document.createElement('h3');
  title.textContent = 'License Check Failed';
  title.style.marginTop = '0';
  
  const desc = document.createElement('p');
  desc.textContent = 'We couldn’t verify your license. Let’s get you a free 14‑day pass while we sort this out.';
  
  const trial = document.createElement('p');
  trial.innerHTML = '<strong>All features · 14 days · Free</strong>';
  
  const credit = document.createElement('p');
  credit.innerHTML = '<small>No card required · Cancel anytime</small>';
  
  const tryBtn = document.createElement('button');
  tryBtn.textContent = 'Start Free Trial';
  tryBtn.style.cssText = 'background:#25D366;color:white;border:none;padding:10px 22px;border-radius:5px;margin:6px;cursor:pointer;';
  tryBtn.onclick = () => window.open('https://www.wacampaignsender.com/#pricing', '_blank');
  
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Try Again Later';
  cancelBtn.style.cssText = 'background:#ccc;color:black;border:none;padding:10px 22px;border-radius:5px;margin:6px;cursor:pointer;';
  cancelBtn.onclick = () => modal.remove();
  
  content.appendChild(closeBtn);
  content.appendChild(title);
  content.appendChild(desc);
  content.appendChild(trial);
  content.appendChild(credit);
  if (errorMessage) {
    const error = document.createElement('p');
    error.textContent = errorMessage;
    error.style.cssText = 'color:red;font-size:14px;';
    content.appendChild(error);
  }
  content.appendChild(tryBtn);
  content.appendChild(cancelBtn);
  
  modal.appendChild(content);
  document.body.appendChild(modal);
}
