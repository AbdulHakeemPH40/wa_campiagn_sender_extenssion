# WhatsApp Campaign Sender Extension

A browser extension for automating WhatsApp Web messaging campaigns with advanced features for contact management, message personalization, and safe delivery.

## Features

### Contact Management
- **Manual Entry**: Directly input phone numbers with comma or newline separation
- **CSV/Excel Import**: Upload contact lists with support for custom fields
- **Contact Validation**: Automatic validation of phone number formats
- **Variable Support**: Use contact fields as variables in messages

### Message Composition
- **Rich Text Editor**: Format messages with bold, italic, and strikethrough
- **Variable Insertion**: Insert contact fields as personalized variables
- **Media Attachments**: Support for images, videos, and PDF files
- **Message Preview**: See how your message will appear before sending

### Sending Controls
- **Delay Configuration**: Set random delays between messages
- **Batch Processing**: Send messages in batches with cooldown periods
- **Human-like Patterns**: Mimic natural typing and sending behavior
- **Safety Mode**: Periodically send messages to your own number to reduce ban risk

### Campaign Monitoring
- **Real-time Progress**: Track campaign progress with detailed statistics
- **Success/Failure Tracking**: Monitor successful and failed message deliveries
- **Pause/Resume/Cancel**: Control campaign execution at any time
- **Error Reporting**: View detailed error logs for troubleshooting

## Installation

1. Download the extension files
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the extension directory
5. The extension icon will appear in your browser toolbar

## Usage

### Setting Up Contacts

#### Manual Entry
1. Open the extension and click "Message Sender"
2. Select the "Number List" tab
3. Enter phone numbers in international format (e.g., +17133003000)
4. Separate numbers using commas or newlines

#### CSV/Excel Import
1. Open the extension and click "Message Sender"
2. Select the "Upload CSV" tab
3. Drag and drop your file or click "Browse Files"
4. The first row should contain column headers (e.g., Name, Phone)
5. The "Phone" column must contain numbers in international format

### Composing Messages

1. Type your message in the Message Composer
2. Use the formatting toolbar for text styling
3. Insert variables by clicking "Add Variable" and selecting a field
4. Add attachments using the attachment buttons (Image, Video, PDF)

### Configuring Send Settings

1. Set delay between messages (recommended: 6-10 seconds)
2. Enable batch processing for larger campaigns
3. Configure batch size (recommended: 40-50 messages)
4. Set cooldown period between batches (recommended: 11-16 minutes)
5. Enable Safety Mode to reduce ban risk

### Starting a Campaign

1. Review your campaign summary (contacts, duration, batches)
2. Click "Start Campaign" to begin sending
3. Monitor progress in the campaign progress screen
4. Use pause/resume/cancel controls as needed

## Safety Features

### Turbo Mode
Disables all artificial delays between messages. Use with caution as this significantly increases the risk of being flagged by WhatsApp.

### Human-like Delay Patterns
Mimics natural typing behavior with occasional pauses and variable typing speeds to make the messaging pattern appear more human-like.

### Safety Mode
Periodically sends a message to your own number to simulate normal WhatsApp activity, reducing the risk of being flagged for automated behavior.

### Unique Timestamp
Adds a unique timestamp to each message to help avoid spam detection by WhatsApp's automated systems.

## Best Practices

1. **Start Small**: Begin with smaller campaigns (10-20 contacts) to test settings
2. **Use Delays**: Always maintain delays between messages (6-10 seconds recommended)
3. **Enable Batches**: For campaigns over 50 contacts, use batch processing with cooldowns
4. **Keep Safety Mode On**: This significantly reduces the risk of account restrictions
5. **Avoid Spam Content**: Don't send identical messages to large numbers of recipients
6. **Use Variables**: Personalize messages with recipient names or other variables
7. **Monitor Regularly**: Keep an eye on campaign progress and success rates

## Troubleshooting

### Common Issues

#### Messages Not Sending
- Ensure WhatsApp Web is properly connected
- Check that phone numbers are in the correct international format
- Verify your internet connection is stable

#### Extension Not Connecting to WhatsApp
- Make sure you're using the official WhatsApp Web (https://web.whatsapp.com)
- Try refreshing the WhatsApp Web page
- Restart the browser and reconnect

#### Campaign Gets Stuck
- Use the "Reset Stuck Campaign" button
- Refresh WhatsApp Web and restart the campaign
- Check for any error messages in the campaign progress

## Project Structure

```
wa_campaign_sender_extension/
├── css/                  # Stylesheets
├── docs/                 # Documentation
├── fonts/                # Font files
├── html/                 # HTML pages
├── icons/                # Extension icons
├── images/               # Image assets
├── js/                   # JavaScript files
│   ├── background/       # Background scripts
│   ├── content/          # Content scripts
│   ├── injected/         # Injected scripts
│   ├── lib-fallbacks/    # Library fallbacks
│   └── utils/            # Utility functions
├── libs/                 # Third-party libraries
├── index.js              # Main entry point
├── manifest.json         # Extension manifest
├── popup.html            # Main popup
└── README.md             # Documentation
```

## Technical Details

### Silent Sending Mechanism

The extension uses a sophisticated approach to send messages without user interaction:

1. **Script Injection**: Content scripts are injected into the WhatsApp Web page
2. **Communication Bridge**: Events are used to communicate between isolated contexts
3. **WhatsApp API Access**: The injected script accesses WhatsApp's internal modules
4. **Direct Message Sending**: Messages are sent directly through WhatsApp's internal API

### Safety Mechanisms

To reduce the risk of account restrictions:

1. **Self-Messaging**: Periodically sends messages to the user's own number
2. **Variable Delays**: Implements random delays between messages
3. **Batch Processing**: Sends messages in batches with cooldown periods
4. **Unique Identifiers**: Adds timestamps to messages to avoid detection

## License

This extension is for educational purposes only. Use responsibly and in accordance with WhatsApp's terms of service.