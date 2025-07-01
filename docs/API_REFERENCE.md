# WhatsApp Campaign Sender Extension API Reference

This document provides a reference for the key functions and modules in the WhatsApp Campaign Sender Extension.

## Table of Contents

1. [Contact Management](#contact-management)
2. [Message Composition](#message-composition)
3. [Sending Controls](#sending-controls)
4. [Attachment Handling](#attachment-handling)
5. [Safety Features](#safety-features)
6. [Utility Functions](#utility-functions)
7. [Background Services](#background-services)
8. [Content Scripts](#content-scripts)

## Contact Management

### `contactManager.js`

#### `parseFile(file, toastFn)`
Parses a CSV or Excel file and extracts contact information.

- **Parameters**:
  - `file`: File object to parse
  - `toastFn`: Function to display notifications
- **Returns**: Promise that resolves to an array of contact objects

#### `parseManualNumbers(text, toastFn)`
Parses manually entered phone numbers.

- **Parameters**:
  - `text`: String containing phone numbers (comma or newline separated)
  - `toastFn`: Function to display notifications
- **Returns**: Promise that resolves to an array of contact objects

#### `validatePhoneNumberList(text)`
Validates a list of phone numbers.

- **Parameters**:
  - `text`: String containing phone numbers
- **Returns**: `true` if all numbers are valid, otherwise an array of invalid entries

#### `formatPhoneNumber(phoneNumber)`
Formats a phone number to E.164 format.

- **Parameters**:
  - `phoneNumber`: Phone number to format
- **Returns**: Formatted phone number string

#### `downloadSampleCsv(toastFn)`
Downloads a sample CSV file for contacts.

- **Parameters**:
  - `toastFn`: Function to display notifications

## Message Composition

### `messageComposer.js`

#### `insertTextIntoEditor(editor, text)`
Inserts text at the current cursor position in the editor.

- **Parameters**:
  - `editor`: DOM element of the editor
  - `text`: Text to insert

#### `validateVariables(editor, parsedData, errorElement)`
Validates variables in the message against available contact fields.

- **Parameters**:
  - `editor`: DOM element of the editor
  - `parsedData`: Array of contact objects
  - `errorElement`: DOM element to display errors

#### `htmlToWhatsAppMarkdown(html)`
Converts HTML content to WhatsApp markdown format.

- **Parameters**:
  - `html`: HTML string
- **Returns**: WhatsApp markdown formatted string

#### `whatsappMarkdownToHtml(markdown)`
Converts WhatsApp markdown to HTML.

- **Parameters**:
  - `markdown`: WhatsApp markdown string
- **Returns**: HTML string

#### `initToolbar(editor, toolbar)`
Initializes the formatting toolbar for the editor.

- **Parameters**:
  - `editor`: DOM element of the editor
  - `toolbar`: DOM element of the toolbar

## Sending Controls

### `sendingControls.js`

#### `saveSettings(inputs, toggles)`
Saves sending settings to storage.

- **Parameters**:
  - `inputs`: Object containing input elements
  - `toggles`: Object containing toggle elements

#### `updateSummary(contacts, inputs, toggles, elements)`
Updates the campaign summary UI.

- **Parameters**:
  - `contacts`: Array of contact objects
  - `inputs`: Object containing input elements
  - `toggles`: Object containing toggle elements
  - `elements`: Object containing UI elements to update

#### `toggleSection(sectionId)`
Toggles the visibility of a section.

- **Parameters**:
  - `sectionId`: ID of the section to toggle

#### `resetStuckCampaign()`
Resets a stuck campaign state.

## Attachment Handling

### `attachmentManager.js`

#### `handleAttachment(file, type, inputElement, currentAttachment, setAttachment, renderFn, errorElement, previewElement)`
Handles file attachment for messages.

- **Parameters**:
  - `file`: File object to attach
  - `type`: Type of attachment ('image', 'video', 'pdf')
  - `inputElement`: File input element
  - `currentAttachment`: Current attachment object
  - `setAttachment`: Function to set the attachment
  - `renderFn`: Function to render the attachment preview
  - `errorElement`: Element to display errors
  - `previewElement`: Element to display the preview

#### `renderAttachment(attachment, previewElement)`
Renders an attachment preview.

- **Parameters**:
  - `attachment`: Attachment object
  - `previewElement`: Element to display the preview

#### `loadSavedAttachment(previewElement, errorElement, setAttachment)`
Loads a saved attachment from storage.

- **Parameters**:
  - `previewElement`: Element to display the preview
  - `errorElement`: Element to display errors
  - `setAttachment`: Function to set the attachment
- **Returns**: Promise that resolves to a boolean indicating success

## Safety Features

### `safetyMode.js`

#### `initializeSafetyMode()`
Initializes the safety mode features.

#### `logOwnWhatsAppNumberStatus()`
Logs the status of the user's own WhatsApp number.

#### `sendSafetyMessage(number, message)`
Sends a safety message to the specified number.

- **Parameters**:
  - `number`: Phone number to send to
  - `message`: Message to send
- **Returns**: Promise that resolves when the message is sent

## Utility Functions

### `utils.js`

#### `toast(message, type, duration)`
Displays a toast notification.

- **Parameters**:
  - `message`: Message to display
  - `type`: Type of toast ('success', 'error', 'info', 'warning')
  - `duration`: Duration in milliseconds

#### `debounce(func, wait)`
Creates a debounced function that delays invoking `func`.

- **Parameters**:
  - `func`: Function to debounce
  - `wait`: Milliseconds to delay
- **Returns**: Debounced function

#### `formatDuration(seconds)`
Formats seconds into a human-readable duration.

- **Parameters**:
  - `seconds`: Number of seconds
- **Returns**: Formatted duration string (e.g., "2h 30m")

## Background Services

### `background.js`

#### `startCampaign(campaignSettings)`
Starts a messaging campaign.

- **Parameters**:
  - `campaignSettings`: Object containing campaign settings
- **Returns**: Promise that resolves with the campaign status

#### `cancelCampaign()`
Cancels the active campaign.

- **Returns**: Promise that resolves when the campaign is canceled

#### `getCampaignStatus()`
Gets the status of the active campaign.

- **Returns**: Promise that resolves with the campaign status object

## Content Scripts

### `content_script.js`

#### `injectScript(file)`
Injects a script into the WhatsApp Web page.

- **Parameters**:
  - `file`: Path to the script file

#### `setupMessageListener()`
Sets up a listener for messages from the extension.

### `fl.js`

#### `window.WWebJS.sendMessage(chatId, message)`
Sends a message using WhatsApp's internal API.

- **Parameters**:
  - `chatId`: Chat ID to send to
  - `message`: Message to send
- **Returns**: Promise that resolves when the message is sent

#### `window.WWebJS.getChats()`
Gets all chats from WhatsApp.

- **Returns**: Promise that resolves with an array of chat objects

### `injector.js`

#### `injectLibrary()`
Injects the WhatsApp Web library hooks.

#### `bypassFilePicker()`
Bypasses the file picker dialog for attachments.

## Event Communication

The extension uses several custom events for communication between components:

### `contactDataUpdated`
Fired when contact data is updated.

- **Detail**: `{ parsedData: Array }`

### `campaignStatusUpdate`
Fired when campaign status changes.

- **Detail**: Campaign status object

### `send-silent-message`
Fired to send a message silently.

- **Detail**: `{ chatId: String, message: String }`