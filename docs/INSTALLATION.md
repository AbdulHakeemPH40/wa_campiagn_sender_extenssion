# Installation Guide for WhatsApp Campaign Sender Extension

This guide provides step-by-step instructions for installing and setting up the WhatsApp Campaign Sender Extension in your browser.

## System Requirements

- **Browser**: Chrome 88+ or Edge 88+ (Chromium-based browsers)
- **Operating System**: Windows 10+, macOS 10.15+, or Linux
- **WhatsApp Web**: Access to https://web.whatsapp.com
- **Internet Connection**: Stable internet connection

## Installation Methods

### Method 1: Developer Mode (Recommended for Development)

1. **Download the Extension**
   - Clone the repository or download the ZIP file
   - Extract the files to a folder on your computer

2. **Open Chrome Extensions Page**
   - Open Chrome and navigate to `chrome://extensions/`
   - Or click the three dots menu → More tools → Extensions

3. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

4. **Load the Extension**
   - Click the "Load unpacked" button
   - Browse to the folder containing the extension files
   - Select the folder and click "Open"

5. **Verify Installation**
   - The extension icon should appear in your browser toolbar
   - If the icon is not visible, click the puzzle piece icon to see all extensions
   - Pin the extension by clicking the pin icon

### Method 2: Chrome Web Store (When Available)

1. **Visit the Chrome Web Store**
   - Navigate to the Chrome Web Store
   - Search for "WhatsApp Campaign Sender"

2. **Add to Chrome**
   - Click the "Add to Chrome" button
   - Confirm by clicking "Add extension" in the popup

3. **Verify Installation**
   - The extension icon should appear in your browser toolbar
   - If the icon is not visible, click the puzzle piece icon to see all extensions
   - Pin the extension by clicking the pin icon

## Post-Installation Setup

### Connect to WhatsApp Web

1. **Open WhatsApp Web**
   - Click the extension icon in your browser toolbar
   - Click the "Open WhatsApp Web" button
   - Or navigate directly to https://web.whatsapp.com

2. **Scan QR Code**
   - Open WhatsApp on your phone
   - Tap Menu (three dots) or Settings
   - Select "WhatsApp Web" or "Linked Devices"
   - Scan the QR code displayed in your browser

3. **Verify Connection**
   - The extension should show "Connected" status
   - Your WhatsApp contacts should be visible in WhatsApp Web

### Initial Configuration

1. **Access Extension Settings**
   - Click the extension icon in your browser toolbar
   - Click "Message Sender" to open the main interface

2. **Configure Safety Settings**
   - Enable "Safety Mode" (recommended)
   - Set appropriate delay between messages (6-10 seconds recommended)
   - Enable "Split Messages into Batches" for larger campaigns

3. **Test with a Small Campaign**
   - Add a few test contacts (your own number or test accounts)
   - Compose a simple test message
   - Start a small campaign to verify functionality

## Troubleshooting Installation Issues

### Extension Not Loading

1. **Check for Errors**
   - Go to `chrome://extensions/`
   - Look for any error messages under the extension
   - Click "Errors" to see detailed information

2. **Verify Files**
   - Ensure all required files are present in the extension folder
   - Check that `manifest.json` is properly formatted

3. **Reload Extension**
   - Click the refresh icon on the extension card
   - Or remove the extension and load it again

### Connection Issues

1. **WhatsApp Web Not Connecting**
   - Make sure you have a stable internet connection
   - Clear browser cookies and cache
   - Try logging out and back into WhatsApp Web

2. **Extension Not Detecting WhatsApp**
   - Make sure you're using the official WhatsApp Web (https://web.whatsapp.com)
   - Reload the WhatsApp Web page
   - Reinstall the extension

### Permission Issues

1. **Missing Permissions**
   - Right-click the extension icon
   - Select "Options" or "Extension options"
   - Check if the extension is requesting additional permissions

2. **Storage Permission**
   - The extension requires storage permission to save contacts and settings
   - Make sure this permission is granted in the extension settings

## Updating the Extension

### Developer Mode Updates

1. **Download the Latest Version**
   - Pull the latest changes from the repository
   - Or download the latest release

2. **Update the Extension**
   - Go to `chrome://extensions/`
   - Find the WhatsApp Campaign Sender Extension
   - Click the refresh icon or remove and reload the extension

### Chrome Web Store Updates (When Available)

1. **Automatic Updates**
   - Chrome automatically updates extensions from the Web Store
   - No action required

2. **Manual Update Check**
   - Go to `chrome://extensions/`
   - Click "Update" button at the top
   - Or toggle Developer mode off and on

## Uninstalling the Extension

1. **Remove from Chrome**
   - Go to `chrome://extensions/`
   - Find the WhatsApp Campaign Sender Extension
   - Click "Remove" or the trash icon

2. **Clear Data (Optional)**
   - After uninstalling, you may want to clear any remaining data
   - Go to Chrome Settings → Privacy and security → Clear browsing data
   - Select "Cookies and other site data" and "Cached images and files"
   - Click "Clear data"

## Security Notes

- Always download the extension from trusted sources
- Review the permissions requested by the extension
- Keep the extension updated to the latest version
- Use the extension in accordance with WhatsApp's Terms of Service

## Next Steps

After successful installation, refer to the following documentation:

- [User Guide](./USER_GUIDE.md) - Learn how to use the extension
- [Security Considerations](./SECURITY.md) - Best practices for safe usage
- [API Reference](./API_REFERENCE.md) - Technical reference for developers