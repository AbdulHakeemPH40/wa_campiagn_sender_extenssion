// Library fallback and verification logic
if (typeof Papa === 'undefined') {
  console.warn("PapaParse not loaded, using minimal fallback implementation");
  window.Papa = {
    parse: function(file, options) {
      // Simple CSV parsing fallback implementation
      const reader = new FileReader();
      reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split(/\r\n|\n/);
        const result = [];
        let headers = lines[0].split(',').map(h => h.trim());
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue; // Skip empty lines
          const cols = line.split(',');
          const obj = {};
          headers.forEach((header, index) => {
            obj[header] = cols[index] ? cols[index].trim() : '';
          });
          result.push(obj);
        }
        if (options.complete) options.complete({ data: result });
      };
      reader.onerror = function() {
        if (options.error) options.error(new Error("Failed to read CSV file"));
      };
      reader.readAsText(file);
    }
  };
  console.log("PapaParse fallback defined");
} else {
  console.log("PapaParse loaded successfully");
}

if (typeof XLSX === 'undefined') {
  console.error("SheetJS not loaded");
  // Create a toast notification
  const toast = document.createElement('div');
  toast.className = "toast toast-error";
  toast.textContent = "Failed to load Excel parsing library. XLS/XLSX uploads may not work.";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
} else {
  console.log("SheetJS successfully loaded");
}