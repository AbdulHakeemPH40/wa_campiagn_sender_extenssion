// Excel Parser for XLSX/XLS files
// Minimal implementation using SheetJS

class ExcelParser {
  constructor() {
    this.XLSX = null;
    this.loaded = false;
  }

  async loadLibrary() {
    if (this.loaded) return true;
    
    try {
      // Load SheetJS from CDN
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      
      await new Promise((resolve, reject) => {
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      
      this.XLSX = window.XLSX;
      this.loaded = true;
      return true;
    } catch (error) {
      console.error('[ExcelParser] Failed to load XLSX library:', error);
      return false;
    }
  }

  async parseFile(file) {
    try {
      if (!await this.loadLibrary()) {
        throw new Error('Failed to load Excel library');
      }

      const arrayBuffer = await this.readFileAsArrayBuffer(file);
      const workbook = this.XLSX.read(arrayBuffer, { type: 'array' });
      
      // Get first worksheet
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON
      const jsonData = this.XLSX.utils.sheet_to_json(worksheet, { 
        header: 1,
        defval: '',
        raw: false
      });
      
      if (jsonData.length < 2) {
        throw new Error('Excel file must have at least 2 rows (header + data)');
      }
      
      // Convert to objects
      const headers = jsonData[0];
      const contacts = [];
      
      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        const contact = {};
        
        headers.forEach((header, index) => {
          if (header && row[index]) {
            contact[header.trim()] = row[index].toString().trim();
          }
        });
        
        // Skip empty rows
        if (Object.keys(contact).length > 0) {
          contacts.push(contact);
        }
      }
      
      return contacts;
    } catch (error) {
      console.error('[ExcelParser] Parse error:', error);
      throw error;
    }
  }

  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  isExcelFile(file) {
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    
    return name.endsWith('.xlsx') || 
           name.endsWith('.xls') || 
           type.includes('spreadsheet') ||
           type.includes('excel');
  }
}

// Export for use in other scripts
window.ExcelParser = ExcelParser;