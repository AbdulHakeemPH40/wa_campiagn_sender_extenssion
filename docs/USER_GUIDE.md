# User Guide for WhatsApp Campaign Sender Extension

This guide provides detailed instructions on how to use the WhatsApp Campaign Sender Extension effectively.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Contact Management](#contact-management)
3. [Message Composition](#message-composition)
4. [Sending Controls](#sending-controls)
5. [Running Campaigns](#running-campaigns)
6. [Monitoring Progress](#monitoring-progress)
7. [Advanced Features](#advanced-features)
8. [Troubleshooting](#troubleshooting)

## Getting Started

### Accessing the Extension

1. Click the extension icon in your browser toolbar
2. If the icon is not visible, click the puzzle piece icon and pin the extension
3. Click the extension icon to open the popup interface

### Main Interface

The extension has three main sections:
- **Message Sender**: For creating and sending campaigns
- **Contact Extractor**: For extracting contacts from WhatsApp groups
- **Active Campaign**: Shows information about any running campaign

### Connecting to WhatsApp Web

1. Click "Open WhatsApp Web" in the extension popup
2. Scan the QR code with your phone's WhatsApp app
3. Wait for the connection to be established
4. The extension will show "Connected" when ready

## Contact Management

### Manual Entry

1. Open the Message Sender interface
2. Select the "Number List" tab
3. Enter phone numbers in the text area
4. Use international format (e.g., +17133003000)
5. Separate numbers with commas or newlines

**Example**:
```
+17133003000
+447911123456
+8613712345678
```

### CSV/Excel Import

1. Open the Message Sender interface
2. Select the "Upload CSV" tab
3. Drag and drop your file or click "Browse Files"
4. The file should have a header row with column names
5. At least one column should contain phone numbers

**Sample CSV Format**:
```csv
Name,Phone,Company
John Doe,+17133003000,ABC Corp
Jane Smith,+447911123456,XYZ Inc
```

### Downloading a Sample CSV

1. Click the "Sample Download" button
2. Open the downloaded file in Excel or a text editor
3. Use it as a template for your contact list

### Viewing Imported Contacts

1. After importing a CSV file, the filename will be displayed
2. Click on the filename to preview the imported contacts
3. The preview shows the first few contacts and their data

## Message Composition

### Basic Text Entry

1. Type your message in the Message Composer area
2. Use the toolbar buttons for formatting (bold, italic, strikethrough)
3. The message will be sent exactly as it appears in the editor

### Formatting Options

- **Bold**: Click the B button or use `*text*`
- **Italic**: Click the I button or use `_text_`
- **Strikethrough**: Click the S button or use `~text~`

### Using Variables

Variables allow you to personalize messages with contact information:

1. Click "Add Variable" to see available fields
2. Select a variable to insert it into your message
3. Variables appear as `{{FieldName}}` in the editor
4. When sent, variables are replaced with the contact's data

**Example**:
```
Hello {{Name}},

Thank you for your interest in our products at {{Company}}.
```

### Adding Attachments

1. Click one of the attachment buttons (Image, Video, PDF)
2. Select a file from your computer
3. The attachment will be displayed in the preview area
4. To remove an attachment, click the X button in the preview

**Supported Formats**:
- **Images**: JPEG, PNG
- **Videos**: MP4, WebM
- **Documents**: PDF

## Sending Controls

### Delay Settings

#### Turbo Mode
- Disables all artificial delays between messages
- Significantly increases the risk of being flagged
- Use only for very small campaigns in emergency situations

#### Delay Between Messages
- Adds a random delay between messages
- Recommended: 6-10 seconds
- Helps avoid detection as automated messaging

### Batch Processing

#### Split Messages into Batches
- Sends messages in smaller batches with cooldown periods
- Recommended for campaigns with more than 50 contacts
- Configure batch size and cooldown period

**Recommended Settings**:
- **Batch Size**: 40-50 messages
- **Cooldown Period**: 11-16 minutes

### Human-like Patterns

- Mimics natural typing behavior
- Adds occasional pauses and variable typing speeds
- Adjust intensity based on your needs

### Safety Features

#### Safety Mode
- Periodically sends messages to your own number
- Creates a more natural usage pattern
- Reduces the risk of being flagged

#### Add Unique Timestamp
- Adds a small timestamp to each message
- Helps avoid detection as duplicate content
- Recommended to keep enabled

### Direct URL Navigation

- Uses WhatsApp's direct URL scheme to open chats
- More reliable for unsaved numbers
- Better support for attachments

## Running Campaigns

### Before Starting

1. Review your contact list and message
2. Check the Campaign Summary for:
   - Total Contacts: Number of recipients
   - Selected: Number of contacts that will receive messages
   - Est. Duration: Estimated time to complete the campaign
   - Batches: Number of batches the campaign will be split into

### Starting a Campaign

1. Click "Start Campaign"
2. Confirm when prompted
3. The campaign will begin sending messages
4. The extension will open a new tab to track progress

### Pausing and Resuming

1. In the campaign progress tab, click "Pause Campaign"
2. The campaign will pause after the current message
3. Click "Resume Campaign" to continue

### Canceling a Campaign

1. In the campaign progress tab, click "Cancel Campaign"
2. Confirm when prompted
3. The campaign will stop immediately

## Monitoring Progress

### Progress Indicators

- **Progress Bar**: Visual representation of campaign completion
- **Sent Count**: Number of messages sent successfully
- **Failed Count**: Number of messages that failed to send
- **Current Status**: What the campaign is currently doing

### Status Messages

- **Starting**: Campaign is initializing
- **Sending**: Currently sending a message
- **Waiting**: Waiting between messages
- **Batch Delay**: Cooldown period between batches
- **Completed**: Campaign finished successfully
- **Canceled**: Campaign was manually canceled
- **Failed**: Campaign encountered an error

### Detailed Statistics

- **Success Rate**: Percentage of messages sent successfully
- **Start Time**: When the campaign began
- **Elapsed Time**: How long the campaign has been running
- **Send Method**: Method used to send messages

### Error Reporting

- The campaign progress page shows any errors encountered
- Common errors include:
  - Invalid phone numbers
  - Network issues
  - WhatsApp Web disconnections

## Advanced Features

### Contact Extractor

1. Open WhatsApp Web and navigate to a group
2. Click the extension icon and select "Contact Extractor"
3. Click "Extract Contacts from Current Group"
4. The extension will extract all visible contacts
5. Export the contacts as CSV or copy to clipboard

### Campaign Templates

1. Compose a message in the Message Composer
2. Click "Save as Template" (if available)
3. Give the template a name
4. Access saved templates from the dropdown menu

### Customizing Timestamps

1. Enable "Add Unique Timestamp"
2. Click "Customize Format" (if available)
3. Choose a format for the timestamp
4. Preview how it will appear in your messages

## Troubleshooting

### Common Issues

#### Messages Not Sending

**Possible Causes**:
- WhatsApp Web disconnected
- Invalid phone numbers
- Network issues

**Solutions**:
- Refresh WhatsApp Web
- Check phone number format
- Verify internet connection

#### Campaign Gets Stuck

**Possible Causes**:
- Browser performance issues
- WhatsApp Web errors
- Extension conflicts

**Solutions**:
- Click "Reset Stuck Campaign"
- Refresh WhatsApp Web
- Restart the browser

#### Variable Errors

**Possible Causes**:
- Missing fields in contact data
- Typos in variable names

**Solutions**:
- Check your CSV file for missing data
- Verify variable names match CSV headers exactly

### Getting Help

If you encounter issues not covered in this guide:

1. Check the [Troubleshooting](./TROUBLESHOOTING.md) document
2. Review the [FAQ](./FAQ.md) for common questions
3. Submit an issue on the project's GitHub page

## Best Practices

1. **Start Small**: Begin with smaller campaigns to test settings
2. **Use Delays**: Always maintain delays between messages
3. **Enable Batches**: Use batch processing for larger campaigns
4. **Keep Safety Mode On**: This significantly reduces the risk of account restrictions
5. **Personalize Messages**: Use variables to make messages unique
6. **Monitor Progress**: Keep an eye on campaign success rates
7. **Respect Recipients**: Only send messages to people who expect them