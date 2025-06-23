(() => {
  try {
    if (!HTMLInputElement.prototype.__waPickerBypassed) {
      Object.defineProperty(HTMLInputElement.prototype, '__waPickerBypassed', { value: true });

      // Suppress the experimental showPicker (Chromium ≥ 114)
      if (typeof HTMLInputElement.prototype.showPicker === 'function') {
        HTMLInputElement.prototype.showPicker = function () {
          /* picker suppressed by WA Campaign Sender */
        };
      }

      // Suppress File-System-Access API picker (showOpenFilePicker)
      if (navigator && typeof navigator.showOpenFilePicker === 'function') {
        navigator.showOpenFilePicker = async () => {
          throw new DOMException('File picker disabled');
        };
      }

      // Ignore programmatic .click() on file inputs (prevents user-activation requirement)
      const origClick = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function (...args) {
        if (this.type === 'file') {
          console.debug('[PickerBypass] Suppressed .click() on <input type="file">');
          return;
        }
        return origClick.apply(this, args);
      };

      console.log('[PickerBypass] File-chooser bypass active');
    }
  } catch (err) {
    console.error('[PickerBypass] Failed to install:', err);
  }
})(); 