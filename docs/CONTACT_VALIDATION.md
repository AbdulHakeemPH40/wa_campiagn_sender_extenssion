# Contact Validation and Handling

This document describes the enhanced contact validation and handling features implemented in the WA Broadcast Sender extension.

## Features

### 1. Phone Number Validation
- Validates phone numbers according to E.164 standard
- Supports international phone numbers with country codes
- Detects and flags invalid phone numbers
- Formats phone numbers for consistent display

### 2. Error Handling
- Identifies and categorizes invalid numbers
- Provides detailed error messages for each invalid number
- Groups similar errors for better readability
- Offers suggestions for fixing common formatting issues

### 3. User Interface
- Real-time validation feedback
- Summary of valid and invalid numbers
- Detailed error modal with search and filter capabilities
- Responsive design for all screen sizes

### 4. File Handling
- Supports CSV and Excel file uploads
- Validates file format and size
- Processes large files efficiently
- Provides clear error messages for file-related issues

## Implementation Details

### Phone Number Validation
Phone numbers are validated using the following rules:
- Must be in E.164 format (e.g., +1234567890)
- Must include country code
- Must be between 8-15 digits (excluding country code)
- Must not contain letters or special characters (except leading +)

### Error Categories
1. **Invalid Format**: Number doesn't match E.164 standard
2. **Missing Country Code**: Number doesn't include country code
3. **Too Short/Long**: Number is outside valid length range
4. **Blocked Number**: Number is known to be blocked by WhatsApp

### File Processing
1. **CSV Files**:
   - First row should contain headers
   - Must include a 'phone' column
   - Supports additional columns for contact details

2. **Excel Files**:
   - First sheet is processed by default
   - Must include a 'phone' column
   - Supports multiple sheets and formats (.xls, .xlsx)

## Usage

### Manual Entry
1. Enter phone numbers in the text area, separated by commas or newlines
2. The system will validate numbers in real-time
3. Invalid numbers will be highlighted with error messages

### File Upload
1. Click "Upload CSV/Excel"
2. Select your file
3. The system will process and validate the file
4. Review the validation results
5. Correct any errors before proceeding

### Error Resolution
1. Click "Show Details" to view all invalid numbers
2. Use the search box to filter results
3. Correct the numbers in your source file or manually
4. Re-upload the file or update the manual entry

## Best Practices
1. Always include country codes in phone numbers
2. Use the sample CSV template for reference
3. Test with a small batch of numbers first
4. Review validation results before sending messages
5. Keep your contact lists up to date

## Troubleshooting

### Common Issues
1. **Numbers marked as invalid**
   - Ensure country code is included
   - Remove any special characters or spaces
   - Check for leading zeros that should be part of the country code

2. **File upload fails**
   - Check file size (max 5MB)
   - Ensure file is in CSV or Excel format
   - Verify the file is not corrupted

3. **Validation errors**
   - Review error messages for specific issues
   - Check for hidden characters in your file
   - Try saving the file in a different format

## API Reference

### `validatePhoneNumber(phoneNumber)`
Validates a phone number and returns a result object.

**Parameters:**
- `phoneNumber` (String): The phone number to validate

**Returns:**
```javascript
{
  isValid: Boolean,
  formattedNumber: String,
  error: String
}
```

### `processPhoneNumbers(numbers, options)`
Processes an array of phone numbers and returns validation results.

**Parameters:**
- `numbers` (Array): Array of phone number strings
- `options` (Object): Configuration options

**Returns:**
```javascript
{
  valid: Array,    // Valid contact objects
  invalid: Array,   // Invalid contact objects with errors
  summary: Object   // Summary statistics
}
```

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
