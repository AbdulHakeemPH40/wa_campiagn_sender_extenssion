// js/attachmentManager.js
import { toast, fileToBase64, base64ToFile, loadExternalScript, showModalMessage } from './utils.js';

const MAX_BASE64_SAVE_BYTES = 2.5 * 1024 * 1024; // 2.5 MB safeguard against QUOTA_BYTES limit

// Determine safe per-item storage budget depending on platform
function getMaxPersistBytes() {
  // Increase budget so a 5 MB binary (≈6.7 MB base64) fits wholly in chrome.storage.local
  return 7.5 * 1024 * 1024;
}

// Attempt to compress image (JPEG/PNG) into <= targetBytes
async function compressImage(file, targetBytes) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      let quality = 0.9;
      const attempt = () => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(file); return; }
          if (blob.size <= targetBytes || quality < 0.4) {
            resolve(new File([blob], file.name, { type: blob.type }));
          } else {
            quality -= 0.1;
            attempt();
          }
        }, 'image/jpeg', quality);
      };
      attempt();
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

// Compress PDF using pdf-lib (lossless object stream compression)
async function compressPdf(file, targetBytes) {
  try {
    if (!window.PDFLib) {
      await loadExternalScript('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js');
    }
    const { PDFDocument } = window.PDFLib;
    const bytes = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(bytes);
    const compressed = await pdfDoc.save({ useObjectStreams: true, compress: true });
    const compressedFile = new File([compressed], file.name, { type: file.type });
    // If still too large, return original – we'll fallback to previewOnly
    if (compressedFile.size <= targetBytes) return compressedFile;
    return file;
  } catch (e) {
    console.warn('PDF compression failed:', e);
    return file;
  }
}

// Utility to attempt compression when necessary
async function maybeCompress(file, targetBytes) {
  if (file.size <= targetBytes) return file;

  if (file.type.startsWith('image/')) {
    toast('Compressing large image to fit quota…', 'info');
    return await compressImage(file, targetBytes);
  }
  if (file.type === 'application/pdf') {
    toast('Compressing PDF to fit quota…', 'info');
    return await compressPdf(file, targetBytes);
  }
  // Videos or others: return original
  return file;
}

// Simple IndexedDB helper (no Dexie, plain API) ------------------------------------
const ATTACHMENT_DB_NAME = 'wa_sender_attachments';
const ATTACHMENT_STORE = 'attachments';

function openAttachmentDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(ATTACHMENT_DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        db.createObjectStore(ATTACHMENT_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function saveBlobToIndexedDB(id, blob, meta) {
  const db = await openAttachmentDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(ATTACHMENT_STORE, 'readwrite');
    tx.objectStore(ATTACHMENT_STORE).put({ id, blob, meta });
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function getBlobFromIndexedDB(id) {
  const db = await openAttachmentDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(ATTACHMENT_STORE, 'readonly');
    const req = tx.objectStore(ATTACHMENT_STORE).get(id);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}

export async function handleAttachment(file, type, inputElement, attachment, setAttachment, renderAttachmentFn, attachmentError, attachmentPreview) {
  // Remove any existing extraction messages at the start of handling a new attachment
  const extractionMessages = document.querySelectorAll('.extraction-message, .pdf-extraction-status, [id*="pdf-extract"], [class*="pdf-extract"]');
  extractionMessages.forEach(msg => msg.remove());
  
  // Also clear any extraction status messages in the DOM
  const statusElements = document.querySelectorAll('[data-role="status"], [role="status"], .status-message');
  statusElements.forEach(el => {
    if (el.textContent.toLowerCase().includes('extract') && el.textContent.toLowerCase().includes('pdf')) {
      el.style.display = 'none';
      el.textContent = '';
    }
  });
  
  if (attachment && attachment.file && attachmentPreview && attachmentPreview.style.display !== "none") {
    showModalMessage('Attachment limit', 'Only one attachment is allowed at a time. Please remove the existing file first.', 'warning');
    attachmentError.textContent = "Only one attachment is allowed at a time. Remove the existing file first.";
    attachmentError.style.display = "block";
    inputElement.value = "";
    return;
  }
  // Maybe compress before any quota checks
  const QUOTA_BYTES = getMaxPersistBytes();
  file = await maybeCompress(file, QUOTA_BYTES);
  const fileSizeMB = file.size / 1048576;
  // Video attachments now limited to 5.25 MB (was 7.5 MB)
  const maxSizeMB = type === "video" ? 5.25 : 5;
  if (fileSizeMB > maxSizeMB) {
    const limitExplain = type === 'video'
      ? 'Videos up to 5.25 MB are supported.'
      : 'Images or PDF documents up to 5 MB are supported.';
    showModalMessage(
      'File too large',
      `The selected file is ${fileSizeMB.toFixed(2)} MB. ${limitExplain}`,
      'error'
    );
    attachmentError.textContent = limitExplain;
    attachmentError.style.display = "block";
    inputElement.value = "";
    return;
  }
  if (type === "video") {
    const validVideoExtensions = ["mp4", "webm", "ogg", "mov", "avi", "mkv"];
    const fileExtension = file.name.split(".").pop().toLowerCase();
    if (!validVideoExtensions.includes(fileExtension)) {
      showModalMessage('Unsupported video format', `The file extension <b>${fileExtension}</b> is not supported. Allowed formats: ${validVideoExtensions.join(', ')}.`, 'error');
      attachmentError.textContent = `Unsupported video format: ${fileExtension}. Supported formats are: ${validVideoExtensions.join(", ")}.`;
      attachmentError.style.display = "block";
      inputElement.value = "";
      return;
    }
  }
  attachmentError.textContent = "";
  attachmentError.style.display = "none";
  try {
    let base64String = await fileToBase64(file);
    const shouldPersistBase64 = base64String && base64String.length <= QUOTA_BYTES;

    // Prepare IndexedDB reference id (timestamp + random)
    const attachmentId = 'att_' + Date.now() + '_' + Math.floor(Math.random()*1e5);

    const newAttachment = {
      file,
      type,
      name: file.name,
      size: fileSizeMB.toFixed(2) + " MB",
      previewOnly: !shouldPersistBase64,
      id: attachmentId,
      ...(shouldPersistBase64 ? { base64String } : {})
    };
    
    // First set the attachment in memory
    setAttachment(newAttachment);
    
    // We persist either the Base64 *or* an IndexedDB reference. If we saved the blob in
    // IndexedDB we consider the attachment fully restorable – no need to ask the user
    // to re-upload next session.
    const storagePayload = {
      attachment: {
        type,
        name: file.name,
        size: fileSizeMB.toFixed(2) + " MB"
      },
      ...(shouldPersistBase64 ? { attachmentBase64: base64String } : { attachmentRef: attachmentId })
    };

    // If the payload itself still looks dangerously close to the quota (defensive)
    // we simply omit the Base64 to be safe.
    if (!shouldPersistBase64) {
       // Attempt to persist the raw Blob in IndexedDB so the user doesn't have to re-upload
       let persisted = false;
       try {
         await saveBlobToIndexedDB(attachmentId, file, { name: file.name, type });
         console.log('[AttachmentManager] Blob stored in IndexedDB with id', attachmentId);
         newAttachment.previewOnly = false;
         persisted = true;
       } catch (idbErr) {
         console.warn('[AttachmentManager] IndexedDB save failed:', idbErr);
       }

       // Show the warning toast only when the attachment could NOT be persisted
       if (!persisted) {
         console.warn('Attachment is larger than storage allowance – storing metadata only');
         toast('Large attachment will need to be re-uploaded next time you open the extension.', 'warning');
       }
     }

    chrome.storage.local.set(storagePayload, () => {
      if (chrome.runtime.lastError) {
        console.error("Error saving attachment data:", chrome.runtime.lastError);
        toast("Failed to save attachment data.", "error");
        setAttachment(null);
      } else {
        console.log("Attachment data saved:", { type, name: file.name, size: file.size, persistedBase64: shouldPersistBase64 });
        toast("Attachment saved successfully.", "success");
        
        // Call renderAttachment with the current attachment
        if (renderAttachmentFn) {
          setTimeout(() => {
            renderAttachmentFn(newAttachment, attachmentPreview, attachmentError, setAttachment);
          }, 50);
        }
      }
    });
  } catch (error) {
    console.error("Error processing attachment:", error);
    attachmentError.textContent = `Failed to process attachment: ${error.message}`;
    attachmentError.style.display = "block";
    setAttachment(null);
  }
  inputElement.value = "";
}

export function renderAttachment(attachment, attachmentPreview, attachmentError, setAttachment) {
  if (!attachment) {
    attachmentPreview.style.display = "none";
    attachmentPreview.innerHTML = "";
    attachmentError.textContent = "";
    attachmentError.style.display = "none";
    return;
  }
  
  // Force any existing but hidden preview to display (fixes UI visibility issues)
  if (attachmentPreview.style.display === "none" || !attachmentPreview.innerHTML.trim()) {
    console.log("Attachment exists but preview was hidden. Showing attachment:", attachment);
  }
  
  const iconClass =
    attachment.type === "image"
      ? "ri-image-line"
      : attachment.type === "video"
      ? "ri-video-line"
      : attachment.type === "pdf"
      ? "ri-file-pdf-2-line"
      : "ri-file-line";
      
  // Add a small badge/indicator for preview-only attachments
  const previewOnlyBadge = (attachment.previewOnly && !attachment.file) || attachment.displayInfo
    ? `<span style="position: absolute; bottom: 0; right: 0; background: #FFA500; color: white; font-size: 8px; padding: 2px 4px; border-radius: 2px;">Re-upload needed</span>`
    : '';
    
  attachmentPreview.innerHTML = `
    <div class="attachment-item">
      <div class="attachment-thumb preview-trigger" data-type="${attachment.type}" style="cursor: pointer; position: relative;">
        <i class="${iconClass} attachment-icon"></i>
        ${previewOnlyBadge}
      </div>
      <div class="attachment-info">
        <p class="preview-trigger" style="cursor: pointer; margin: 0; color: #128C7E; text-decoration: underline;" title="${attachment.name}">${attachment.name.length > 25 ? attachment.name.substring(0, 25) + '...' : attachment.name}</p>
        <p style="margin: 0; font-size: 0.9em; color: #666;">${attachment.size}</p>
        ${attachment.previewOnly || attachment.displayInfo ? '<p style="margin: 0; font-size: 0.8em; color: #FFA500;">Re-upload needed</p>' : ''}
      </div>
      <i class="ri-delete-bin-line delete-attachment"></i>
    </div>
  `;
  attachmentPreview.style.display = "block";
  
  // Add click event for delete
  const deleteIcon = attachmentPreview.querySelector(".delete-attachment");
  deleteIcon.addEventListener("click", () => {
    setAttachment(null);
    chrome.storage.local.remove(["attachment", "attachmentBase64"], () => {
      if (chrome.runtime.lastError) {
        console.error("Error removing attachment from storage:", chrome.runtime.lastError);
        toast("Failed to remove attachment from storage.", "error");
      } else {
        renderAttachment(null, attachmentPreview, attachmentError, setAttachment);
        toast("Attachment removed", "success");
        console.log("Attachment removed from storage.");
      }
    });
  });
  
  // Add click events for preview triggers
  const previewTriggers = attachmentPreview.querySelectorAll(".preview-trigger");
  previewTriggers.forEach(trigger => {
    trigger.addEventListener("click", () => {
      showAttachmentPreview(attachment);
    });
  });
}

export function showAttachmentPreview(attachment) {
  // If this is a preview-only attachment without a file object
  if (!attachment.file) {
    if (attachment.previewOnly || attachment.displayInfo) {
      // Display a more helpful message about re-uploading
      toast("This attachment was saved from a previous session. To send it, please re-upload the file.", "info");
      return;
    }
    
    // For regular attachments that are missing their file object
    toast("File preview not available. Please re-upload the attachment.", "error");
    return;
  }

  try {
    // Remove any existing extraction message from the UI that might have been added by extractor.js
    const extractionMessages = document.querySelectorAll('.extraction-message, .pdf-extraction-status');
    extractionMessages.forEach(msg => msg.remove());
    
    if (attachment.type === "pdf") {
      // Create a preview container if it doesn't exist
      let previewContainer = document.getElementById('pdfPreviewContainer');
      let previewContent = document.getElementById('pdfPreviewContent');
      let closePreviewBtn = document.getElementById('closePdfPreviewBtn');
      
      if (!previewContainer || !previewContent || !closePreviewBtn) {
        console.log("Creating PDF preview container");
        
        // Create preview elements
        const container = document.createElement('div');
        container.id = 'pdfPreviewContainer';
        container.className = 'preview-container';
        container.style.display = 'none';
        container.style.position = 'fixed';
        container.style.top = '0';
        container.style.left = '0';
        container.style.right = '0';
        container.style.bottom = '0';
        container.style.transform = 'none';
        container.style.zIndex = '1000';
        container.style.maxWidth = '100%';
        container.style.maxHeight = '100%';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.overflow = 'hidden';
        container.style.backgroundColor = '#fff';
        container.style.borderRadius = '0';
        container.style.boxShadow = 'none';
        
        const header = document.createElement('div');
        header.className = 'preview-header';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
        header.style.padding = '10px 15px';
        header.style.backgroundColor = '#f8f9fa';
        header.style.borderBottom = '1px solid #dee2e6';
        header.style.position = 'absolute';
        header.style.top = '0';
        header.style.left = '0';
        header.style.right = '0';
        header.style.zIndex = '2';
        
        const title = document.createElement('h3');
        title.textContent = 'PDF Preview';
        title.style.margin = '0';
        
        const closeBtn = document.createElement('button');
        closeBtn.id = 'closePdfPreviewBtn';
        closeBtn.className = 'btn btn-sm btn-danger';
        closeBtn.textContent = '×';
        closeBtn.style.fontSize = '20px';
        closeBtn.style.padding = '0 8px';
        closeBtn.style.lineHeight = '1';
        
        const content = document.createElement('div');
        content.id = 'pdfPreviewContent';
        content.className = 'preview-content';
        content.style.padding = '0';
        content.style.position = 'absolute';
        content.style.top = '45px'; // Height of header
        content.style.left = '0';
        content.style.right = '0';
        content.style.bottom = '0';
        content.style.overflow = 'hidden';
        
        header.appendChild(title);
        header.appendChild(closeBtn);
        container.appendChild(header);
        container.appendChild(content);
        
        // Add to the DOM
        const mainContent = document.querySelector('.main-content') || document.body;
        mainContent.appendChild(container);
        
        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'pdfPreviewOverlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        overlay.style.zIndex = '999';
        overlay.style.display = 'none';
        
        document.body.appendChild(overlay);
        
        // Update references
        previewContainer = container;
        previewContent = content;
        closePreviewBtn = closeBtn;
      }
      
      // Create blob URL for PDF
      const fileUrl = URL.createObjectURL(attachment.file);
      
      // Create an iframe to display the PDF
      const iframe = document.createElement('iframe');
      iframe.src = fileUrl;
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      iframe.style.display = 'block';
      
      // Clear previous content and add the iframe
      previewContent.innerHTML = '';
      previewContent.appendChild(iframe);
      
      // Show the preview container and overlay
      previewContainer.style.display = 'block';
      const overlay = document.getElementById('pdfPreviewOverlay');
      if (overlay) overlay.style.display = 'block';
      
      console.log("PDF preview displayed in extension");
      toast("PDF preview displayed", "success");
      
      // Enhanced cleanup function that completely removes elements instead of just hiding them
      const cleanup = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        
        // Revoke the blob URL to prevent memory leaks
        URL.revokeObjectURL(fileUrl);
        
        // Remove elements entirely rather than just hiding them
        if (previewContainer && previewContainer.parentNode) {
          previewContainer.parentNode.removeChild(previewContainer);
        }
        
        const overlayElement = document.getElementById('pdfPreviewOverlay');
        if (overlayElement && overlayElement.parentNode) {
          overlayElement.parentNode.removeChild(overlayElement);
        }
        
        console.log('PDF preview completely removed from DOM');
      };
      
      // Set up close button click handler with capture to ensure it runs first
      closePreviewBtn.removeEventListener('click', cleanup); // Remove any existing handlers
      closePreviewBtn.addEventListener('click', cleanup, {capture: true});
      
      // Also clean up when clicking the overlay with capture
      const overlayElement = document.getElementById('pdfPreviewOverlay');
      if (overlayElement) {
        overlayElement.removeEventListener('click', cleanup);
        overlayElement.addEventListener('click', cleanup, {capture: true});
      }
    } else if (attachment.type === "image") {
      // Simple image preview implementation
      let previewContainer = document.getElementById('imagePreviewContainer');
      
      if (!previewContainer) {
        // Create a simple container
        previewContainer = document.createElement('div');
        previewContainer.id = 'imagePreviewContainer';
        previewContainer.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: white;
          padding: 12px;
          border-radius: 6px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
          z-index: 1000;
          width: 480px;
          max-width: 90vw;
        `;
        
        // Add close button
        const closeButton = document.createElement('button');
        closeButton.textContent = '×';
        closeButton.style.cssText = `
          position: absolute;
          right: -10px;
          top: -10px;
          background: #ff4444;
          border: none;
          color: white;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          z-index: 1001;
        `;
        
        // Add dark overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 999;';

        // Append elements to DOM
        document.body.appendChild(overlay);
        document.body.appendChild(previewContainer);

        // ---------- Image element ----------
        const imgEl = document.createElement('img');
        const fileUrl = URL.createObjectURL(attachment.file);
        imgEl.src = fileUrl;
        imgEl.style.cssText = 'max-width:100%; max-height:80vh; display:block; border-radius:4px;';

        // Clear any existing child nodes and add the image
        previewContainer.innerHTML = '';
        previewContainer.appendChild(closeButton);
        previewContainer.appendChild(imgEl);

        // Enhanced cleanup function for image preview
        const cleanupPreview = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          
          // Clean up resources
          URL.revokeObjectURL(fileUrl);
          
          // Completely remove elements in a single operation
          if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
          if (previewContainer && previewContainer.parentNode) previewContainer.parentNode.removeChild(previewContainer);
          
          console.log('Image preview completely removed');
          
          // Remove any event listeners that might still be active
          document.removeEventListener('keydown', escKeyHandler);
        };
        
        // Add ESC key handler for better UX
        const escKeyHandler = (e) => {
          if (e.key === 'Escape' || e.keyCode === 27) {
            cleanupPreview(e);
          }
        };
        document.addEventListener('keydown', escKeyHandler, {capture: true});

        // Enhanced close actions with capture phase to ensure they fire first
        overlay.addEventListener('click', cleanupPreview, {capture: true});
        closeButton.addEventListener('click', cleanupPreview, {capture: true});
      }
      // Show the preview container (in case it was previously hidden)
      previewContainer.style.display = 'block';
    } else if (attachment.type === "video") {
      // ----- Video preview implementation -----
      let vidPreview = document.getElementById('videoPreviewContainer');
      if (!vidPreview) {
        vidPreview = document.createElement('div');
        vidPreview.id = 'videoPreviewContainer';
        vidPreview.style.cssText = `
          position: fixed;
          top: 50%; left: 50%; transform: translate(-50%, -50%);
          background: #000; padding: 8px; border-radius: 6px;
          z-index: 1000; max-width: 90vw; max-height: 90vh; box-shadow: 0 2px 8px rgba(0,0,0,.35);`;
        // close btn
        const close = document.createElement('button');
        close.textContent = '×';
        close.style.cssText = `position:absolute; top:-10px; right:-10px; background:#ff4444;color:#fff;border:none;width:24px;height:24px;border-radius:50%;cursor:pointer;`;
        vidPreview.appendChild(close);
        document.body.appendChild(vidPreview);
        close.addEventListener('click', ()=>{ vidPreview.style.display='none'; video.pause(); URL.revokeObjectURL(fileURL); });
      }
      // Clear previous content each time to avoid duplicate videos/handlers
      vidPreview.innerHTML = '';
      const fileURL = URL.createObjectURL(attachment.file);

      // Close button
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = 'position:absolute; top:-10px; right:-10px; background:#ff4444;color:#fff;border:none;width:24px;height:24px;border-radius:50%;cursor:pointer;';

      // Video element
      const video = document.createElement('video');
      video.src = fileURL;
      video.controls = true;
      video.style.maxWidth = '80vw';
      video.style.maxHeight = '80vh';
      video.style.display = 'block';

      vidPreview.appendChild(closeBtn);
      vidPreview.appendChild(video);
      vidPreview.style.display = 'block';
      toast('Video preview displayed', 'success');

      // Enhanced cleanup function that completely removes the video preview
      const closePreview = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        
        // Stop video playback
        if (video) video.pause();
        
        // Clean up resources
        URL.revokeObjectURL(fileURL);
        
        // Remove the preview element completely
        if (vidPreview && vidPreview.parentNode) {
          vidPreview.parentNode.removeChild(vidPreview);
          console.log('Video preview completely removed');
        }
        
        // Remove all event listeners
        document.removeEventListener('mousedown', outsideClick);
        document.removeEventListener('keydown', escKeyHandler);
      };

      // Add ESC key handler for better UX
      const escKeyHandler = (e) => {
        if (e.key === 'Escape' || e.keyCode === 27) {
          closePreview(e);
        }
      };
      document.addEventListener('keydown', escKeyHandler, {capture: true});
      
      // Direct event handler for close button with capture phase
      closeBtn.addEventListener('click', closePreview, {capture: true});

      // Improved outside click handling with capture phase
      const outsideClick = (e) => {
        if (!vidPreview.contains(e.target)) {
          closePreview(e);
        }
      };
      setTimeout(() => document.addEventListener('mousedown', outsideClick, {capture: true}), 0);
    } else {
      // Fallback for unsupported types
      toast('Preview not available for this attachment type.', 'info');
    }
  } catch (err) {
    console.error('Error displaying attachment preview:', err);
    toast('Failed to display attachment preview', 'error');
  }
}

/**
 * Loads a previously saved attachment from chrome.storage (with optional IndexedDB blob)
 * and renders it via renderAttachment(). Returns true if something was restored.
 */
export async function loadSavedAttachment(attachmentPreview, attachmentError, setAttachment) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['attachment', 'attachmentBase64', 'attachmentRef'], async (result) => {
      if (chrome.runtime.lastError) {
        console.error('Error loading saved attachment:', chrome.runtime.lastError);
        resolve(false);
        return;
      }

      if (!result.attachment) { resolve(false); return; }

      const meta = result.attachment;
      let file = null;

      // ---- Enforce new size limits on restored attachments ----
      const isVideo = meta.type === 'video';
      const SIZE_LIMIT_MB = 5.25;

      // Helper to parse numeric MB from stored meta.size (e.g. "6.13 MB")
      const parseMB = (s) => {
        if (!s) return null;
        const n = parseFloat(String(s).replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : n;
      };

      // If meta already tells us it's too large, wipe and bail early
      const metaSize = parseMB(meta.size);
      if (isVideo && metaSize && metaSize > SIZE_LIMIT_MB) {
        chrome.storage.local.remove(['attachment', 'attachmentBase64', 'attachmentRef'], () => {
          toast(`Previous video attachment (${metaSize.toFixed(2)} MB) exceeded the 5.25 MB limit and was removed.`, 'warning');
          console.warn('Removed oversized video attachment from storage during restoration.');
          resolve(false);
        });
        return;
      }

      // Try Base64 first
      if (result.attachmentBase64) {
        try {
          const guessMime = meta.type === 'pdf' ? 'application/pdf' : meta.type === 'image' ? 'image/jpeg' : meta.type === 'video' ? 'video/mp4' : 'application/octet-stream';
          file = await base64ToFile(result.attachmentBase64, meta.name, guessMime);
        } catch (e) { console.warn('base64→File failed:', e); }
      }

      // IndexedDB fallback
      if (!file && result.attachmentRef) {
        try {
          const rec = await getBlobFromIndexedDB(result.attachmentRef);
          if (rec && rec.blob) {
            file = new File([rec.blob], rec.meta?.name || meta.name || 'attachment', { type: rec.blob.type || 'application/octet-stream' });
          }
        } catch (idbErr) { console.warn('IndexedDB fetch failed:', idbErr); }
      }

      // Compose attachment object (after size-limit enforcement)
      const restored = {
        ...meta,
        ...(file ? { file } : { previewOnly: true, displayInfo: true }),
        base64String: result.attachmentBase64 || null
      };

      // Final safety: if we managed to reconstruct the File object, double-check its
      // actual size before restoring.
      if (isVideo && file && (file.size / 1048576) > SIZE_LIMIT_MB) {
        chrome.storage.local.remove(['attachment', 'attachmentBase64', 'attachmentRef'], () => {
          toast(`Previous video attachment exceeded the 5.25 MB limit and was removed.`, 'warning');
          console.warn('Removed oversized video file from storage during restoration (file object check).');
          resolve(false);
        });
        return;
      }

      setAttachment(restored);
      renderAttachment(restored, attachmentPreview, attachmentError, setAttachment);
      resolve(true);
    });
  });
}