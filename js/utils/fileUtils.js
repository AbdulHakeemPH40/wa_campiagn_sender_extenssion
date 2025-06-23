// File handling utilities

/**
 * Converts a file to base64 string
 * @param {File} file - The file to convert
 * @returns {Promise<string>} - Promise resolving to base64 string
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

/**
 * Converts base64 string to a File object
 * @param {string} base64 - The base64 string
 * @param {string} filename - The desired filename
 * @param {string} mimeType - The MIME type of the file
 * @returns {File} - The File object
 */
export function base64ToFile(base64, filename, mimeType) {
  const byteString = atob(base64.split(',')[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  
  return new File([ab], filename, { type: mimeType });
}

/**
 * Parses CSV content into an array of objects
 * @param {string} csvText - The CSV content as text
 * @param {string} delimiter - The delimiter character (default: ',')
 * @returns {Array<Object>} - Array of contact objects
 */
export function parseCSV(csvText, delimiter = ',') {
  // Implementation of CSV parsing
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(delimiter).map(h => h.trim());
  
  return lines.slice(1).map(line => {
    const values = line.split(delimiter).map(v => v.trim());
    return headers.reduce((obj, header, index) => {
      obj[header] = values[index] || '';
      return obj;
    }, {});
  });
}

/**
 * Parses Excel file content
 * @param {string} content - The file content
 * @param {string} type - The file type ('xls' or 'xlsx')
 * @returns {Promise<Array<Object>>} - Promise resolving to array of contact objects
 */
export async function parseExcel(content, type) {
  try {
    // Dynamic import of XLSX to reduce bundle size
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(content, { type: 'binary' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    
    return XLSX.utils.sheet_to_json(worksheet, { raw: true });
  } catch (error) {
    console.error('Error parsing Excel file:', error);
    throw new Error('Failed to parse Excel file. Please check the file format.');
  }
}

/**
 * Downloads data as a file
 * @param {string} data - The data to download
 * @param {string} filename - The name of the file
 * @param {string} type - The MIME type of the file
 */
export function downloadFile(data, filename, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  
  // Cleanup
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Validates file size
 * @param {File} file - The file to validate
 * @param {number} maxSizeMB - Maximum size in MB
 * @returns {boolean} - True if file is within size limit
 */
export function validateFileSize(file, maxSizeMB = 5) {
  return file.size <= maxSizeMB * 1024 * 1024;
}

/**
 * Validates file type
 * @param {File} file - The file to validate
 * @param {Array<string>} allowedTypes - Array of allowed MIME types
 * @returns {boolean} - True if file type is allowed
 */
export function validateFileType(file, allowedTypes) {
  return allowedTypes.includes(file.type);
}

/**
 * Reads a file as text
 * @param {File} file - The file to read
 * @returns {Promise<string>} - Promise resolving to file content as text
 */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('Error reading file'));
    reader.readAsText(file);
  });
}

/**
 * Reads a file as an ArrayBuffer
 * @param {File} file - The file to read
 * @returns {Promise<ArrayBuffer>} - Promise resolving to file content as ArrayBuffer
 */
export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(new Error('Error reading file'));
    reader.readAsArrayBuffer(file);
  });
}
