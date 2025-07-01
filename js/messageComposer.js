// js/messageComposer.js
import { toast } from './utils.js';

// Insert text into the editor (e.g., variables like {{Name}})
export function insertTextIntoEditor(editor, text, isHtml = false) {
  if (!editor) {
    console.error("Editor not found during insertion");
    return;
  }
  
  try {
    // Focus the editor
    editor.focus();
    
    // Get the current selection
    const selection = window.getSelection();
    let range;
    
    if (selection.rangeCount > 0) {
      range = selection.getRangeAt(0);
    } else {
      // If no range exists, create a new range and set it to the current cursor position.
      // This ensures text is inserted at the end if no specific selection/cursor is active.
      range = document.createRange();
      range.setStart(editor, editor.childNodes.length);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    
    // Delete the current selection
    range.deleteContents();
    
    // Strip HTML tags if the text contains them
    let cleanText = text;
    if (text.includes('<') && text.includes('>')) {
      // Create a temporary div to parse HTML
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = text;
      cleanText = tempDiv.textContent || tempDiv.innerText || '';
      console.log(`Stripped HTML tags from: "${text}" to: "${cleanText}"`);
    }
    
    // Create a text node with the variable
    const textNode = document.createTextNode(cleanText);
    
    // Insert the text node
    range.insertNode(textNode);
    
    // Move the cursor after the inserted text
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    
    // Update the selection
    selection.removeAllRanges();
    selection.addRange(range);
    
    // Trigger input event to update the editor
    const event = new Event("input", { bubbles: true });
    editor.dispatchEvent(event);
    
    console.log(`Variable "${cleanText}" inserted successfully`);
  } catch (err) {
    console.error("Error inserting text into editor:", err);
    toast("Failed to insert text", "error");
  }
}

// Validate variables (e.g., {{Name}}) against parsed CSV/Excel data
export function validateVariables(editor, parsedData, variableError) {
  const markdown = htmlToWhatsAppMarkdown(editor.innerHTML);
  const variableRegex = /\{\{([^}]+)\}\}/g;
  let match;
  const variables = [];
  while ((match = variableRegex.exec(markdown)) !== null) {
    variables.push(match[1].trim());
  }
  if (!variables.length) {
    variableError.style.display = "none";
    variableError.textContent = "";
    return { isValid: true };
  }
  if (!Array.isArray(parsedData) || parsedData.length === 0) {
    variableError.style.display = "block";
    variableError.textContent = "Please import a contact list (CSV/Excel) to use variables in your message. The column headers in your file will be available as variables.";
    return { isValid: false, invalidVariable: "No contacts imported" };
  }
  const headers = Object.keys(parsedData[0]).map(header => header.toLowerCase());
  for (const variable of variables) {
    if (!headers.includes(variable.toLowerCase())) {
      variableError.style.display = "block";
      variableError.textContent = `The variable "{{${variable}}}" doesn't match any column in your contact list. Available columns are: ${headers.join(', ')}. Make sure your CSV/Excel file has a column named "${variable}".`;
      return { isValid: false, invalidVariable: `{{${variable}}}` };
    }
  }
  variableError.style.display = "none";
  variableError.textContent = "";
  return { isValid: true };
}

// Convert editor HTML to WhatsApp markdown, preserving exact line breaks
export function htmlToWhatsAppMarkdown(htmlContent) {
  let text = htmlContent;

  // First, normalize all line break representations 
  text = text
    // Handle opening block tags (no line break)
    .replace(/<div[^>]*>/gi, '')
    .replace(/<p[^>]*>/gi, '')
    
    // Convert closing block tags to a single line break
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    
    // Replace all <br> variations with a single newline
    .replace(/<br\s*\/?>/gi, '\n')
    
    // Remove non-breaking spaces and normalize multiple newlines
    .replace(/&nbsp;/gi, ' ');
  
  // Process remaining tags  
  text = text.replace(/<li[^>]*>/gi, '');
  text = text.replace(/<\/li>/gi, '\n');

  // Convert inline formatting tags to WhatsApp markdown
  text = text.replace(/<b>([\s\S]*?)<\/b>/gi, '*$1*');
  text = text.replace(/<strong>([\s\S]*?)<\/strong>/gi, '*$1*');
  text = text.replace(/<i>([\s\S]*?)<\/i>/gi, '_$1_');
  text = text.replace(/<em>([\s\S]*?)<\/em>/gi, '_$1_');
  text = text.replace(/<s>([\s\S]*?)<\/s>/gi, '~$1~');
  text = text.replace(/<strike>([\s\S]*?)<\/strike>/gi, '~$1~');

  // Strip any remaining HTML tags
  text = text.replace(/<\/?.+?>/g, '');

  // Decode common HTML entities
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');

  // Limit consecutive newlines to 2 at most (one blank line) and trim
  text = text
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  console.log('Final WhatsApp Markdown:', text);
  return text;
}

// Convert WhatsApp markdown back to HTML for editor display
export function whatsappMarkdownToHtml(text) {
  let html = text;
  html = html.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  html = html.replace(/_([^_]+)_/g, '<i>$1</i>');
  html = html.replace(/~([^~]+)~/g, '<s>$1</s>');
  if (!html.startsWith("<")) {
    html = `<p>${html}</p>`;
  }
  return html;
}

// Populate dropdown with variable headers from parsed data
export function populateVariableDropdown(dynamicVariables, parsedData, editor, variableError) {
  if (!dynamicVariables) {
    console.error("Variable dropdown element not found");
    return;
  }
  while (dynamicVariables.firstChild) {
    dynamicVariables.removeChild(dynamicVariables.firstChild);
  }
  chrome.storage.local.get(['activeInputSource'], (result) => {
    if (
      result.activeInputSource === 'manual' ||
      !Array.isArray(parsedData) ||
      parsedData.length === 0 ||
      typeof parsedData[0] !== 'object'
    ) {
      const noVariablesMsg = document.createElement('div');
      noVariablesMsg.className = 'variable-item no-data';
      noVariablesMsg.textContent = 'No variables available.';
      noVariablesMsg.style.color = '#888';
      noVariablesMsg.style.fontStyle = 'italic';
      noVariablesMsg.style.cursor = 'default';
      noVariablesMsg.style.textAlign = 'center';
      noVariablesMsg.style.padding = '12px 8px';
      dynamicVariables.appendChild(noVariablesMsg);
      if (editor) {
        const content = editor.innerHTML;
        const cleanedContent = content.replace(/{{[^}]+}}/g, '');
        editor.innerHTML = cleanedContent;
      }
      if (variableError) {
        variableError.style.display = 'none';
        variableError.textContent = '';
      }
      return;
    }

    try {
      const headers = Object.keys(parsedData[0]);
      const hasNameHeader = headers.includes('Name');
      const hasPhoneHeader = headers.includes('Phone');
      
      if (!hasNameHeader || !hasPhoneHeader) {
        if (variableError) {
          variableError.style.display = "block";
          variableError.textContent = `Your contact file is missing the required headers. "Name" and "Phone" headers are case-sensitive and required.`;
        }
        const errorItem = document.createElement('div');
        errorItem.className = 'variable-item error';
        errorItem.innerHTML = '<i class="ri-error-warning-line"></i> Header case error';
        dynamicVariables.appendChild(errorItem);
        const explanationItem = document.createElement('div');
        explanationItem.className = 'variable-item explanation';
        let explanation = 'Your contact file must have "Name" and "Phone" columns with exact case.';
        const hasLowercaseName = headers.some(h => h.toLowerCase() === 'name' && h !== 'Name');
        const hasLowercasePhone = headers.some(h => h.toLowerCase() === 'phone' && h !== 'Phone');
        if (hasLowercaseName) {
          explanation += ' Found "name" but should be "Name".';
        }
        if (hasLowercasePhone) {
          explanation += ' Found "phone" but should be "Phone".';
        }
        explanationItem.textContent = explanation;
        dynamicVariables.appendChild(explanationItem);
        if (headers.length > 0) {
          const availableItem = document.createElement('div');
          availableItem.className = 'variable-item header';
          availableItem.textContent = 'Available headers:';
          dynamicVariables.appendChild(availableItem);
        }
      } else {
        const headerSection = document.createElement('div');
        headerSection.className = 'variable-item header';
        dynamicVariables.appendChild(headerSection);
      }
      
      headers.forEach(header => {
        const variableItem = document.createElement('div');
        variableItem.className = 'variable-item';
        if ((header.toLowerCase() === 'name' && header !== 'Name') || 
            (header.toLowerCase() === 'phone' && header !== 'Phone')) {
          variableItem.className += ' incorrect-case';
          variableItem.innerHTML = `${header} <span class="case-warning">(incorrect case)</span>`;
        } else {
          variableItem.textContent = header;
        }
        variableItem.addEventListener('click', () => {
          insertTextIntoEditor(editor, `{{${header}}}`, false);
          const variableMenu = document.querySelector('#variableMenu');
          if (variableMenu) {
            variableMenu.style.display = 'none';
          }
          validateVariables(editor, parsedData, variableError);
        });
        dynamicVariables.appendChild(variableItem);
      });
      
      console.log(`Populated variable dropdown with ${headers.length} headers`);
    } catch (error) {
      console.error("Error populating variable dropdown:", error);
      const errorItem = document.createElement('div');
      errorItem.className = 'variable-item error';
      errorItem.textContent = 'Error loading variables';
      dynamicVariables.appendChild(errorItem);
    }
  });
}

// Initialize the editor toolbar, including undo/redo and formatting
export function initToolbar(editor, toolbar) {
  if (!editor || !toolbar) {
    console.error("Editor or toolbar not found");
    return;
  }

  console.log("Initializing toolbar with editor and toolbar elements");
  
  // ===== NEW: Track and restore text selection =====
  let savedRange = null; // Holds latest user selection inside the editor

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      // Clone to decouple from live DOM changes
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  };

  // Whenever user changes selection, store it
  editor.addEventListener('keyup', saveSelection);
  editor.addEventListener('mouseup', saveSelection);
  editor.addEventListener('mouseleave', saveSelection);
  editor.addEventListener('touchend', saveSelection);
  // Also capture when editor gains focus via keyboard navigation
  editor.addEventListener('focus', saveSelection);
  // ===== END selection tracking =====
  
  // Undo/Redo history stack
  const history = {
    stack: [],
    currentIndex: -1,
    maxSize: 50, // Limit history size to prevent memory issues
    saveState() {
      const content = editor.innerHTML;
      // Truncate stack if not at the end (after undo)
      if (this.currentIndex < this.stack.length - 1) {
        this.stack = this.stack.slice(0, this.currentIndex + 1);
      }
      // Add new state
      this.stack.push(content);
      this.currentIndex++;
      // Trim history if exceeding maxSize
      if (this.stack.length > this.maxSize) {
        this.stack.shift();
        this.currentIndex--;
      }
      console.log('Saved editor state:', { index: this.currentIndex, content });
    },
    undo() {
      if (this.currentIndex > 0) {
        this.currentIndex--;
        editor.innerHTML = this.stack[this.currentIndex];
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('Undo to state:', { index: this.currentIndex, content: this.stack[this.currentIndex] });
      }
    },
    redo() {
      if (this.currentIndex < this.stack.length - 1) {
        this.currentIndex++;
        editor.innerHTML = this.stack[this.currentIndex];
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('Redo to state:', { index: this.currentIndex, content: this.stack[this.currentIndex] });
      }
    }
  };

  // Load saved content and initialize history
  loadEditorContent(editor);
  history.saveState();
  
  // Save state on input
  editor.addEventListener('input', () => {
    history.saveState();
    saveEditorContent(editor);
  });

  // Add paste event listener to handle pasting text at the cursor position
  editor.addEventListener('paste', function(event) {
      event.preventDefault();
      event.stopImmediatePropagation(); // Stop all other listeners for this event

      const text = event.clipboardData.getData('text/plain');
      const selection = window.getSelection();

      if (!selection.rangeCount) {
          return;
      }

      const range = selection.getRangeAt(0);
      range.deleteContents(); // Delete any currently selected text

      const textNode = document.createTextNode(text);
      range.insertNode(textNode);

      // Move cursor to the end of the inserted text
      range.setStartAfter(textNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);

      // Dispatch an input event to ensure the history stack is updated
      editor.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);

  // Add keydown event listener for custom undo/redo
  editor.addEventListener('keydown', (event) => {
      // Check for Ctrl+Z (Undo)
      if (event.ctrlKey && event.key === 'z') {
          event.preventDefault(); // Prevent default browser undo
          history.undo();
      }
      // Check for Ctrl+Y or Ctrl+Shift+Z (Redo)
      if ((event.ctrlKey && event.key === 'y') || (event.ctrlKey && event.shiftKey && event.key === 'Z')) {
          event.preventDefault(); // Prevent default browser redo
          history.redo();
      }
  });
  
  // Initialize variable dropdown
  const variableToggle = document.getElementById('variableToggle');
  const variableMenu = document.getElementById('variableMenu');
  const dynamicVariables = document.getElementById('dynamicVariables');
  const variableError = document.getElementById('variableError');
  
  if (variableToggle && variableMenu) {
    variableToggle.addEventListener('click', () => {
      variableMenu.style.display = variableMenu.style.display === 'none' ? 'block' : 'none';
      if (variableMenu.style.display === 'block') {
        chrome.storage.local.get(['parsedData'], (result) => {
          if (chrome.runtime.lastError) {
            console.error("Error retrieving contacts:", chrome.runtime.lastError);
            return;
          }
          populateVariableDropdown(dynamicVariables, result.parsedData || [], editor, variableError);
        });
      }
    });
    
    document.addEventListener('click', (event) => {
      if (!variableToggle.contains(event.target) && !variableMenu.contains(event.target)) {
        variableMenu.style.display = 'none';
      }
    });
  }
  
  // Add direct event listeners to each button
  const boldButton = toolbar.querySelector('button[data-cmd="bold"]');
  const italicButton = toolbar.querySelector('button[data-cmd="italic"]');
  const strikethroughButton = toolbar.querySelector('button[data-cmd="strikethrough"]');
  
  // Prevent toolbar buttons from stealing focus (which wipes the selection)
  ;[boldButton, italicButton, strikethroughButton].forEach(btn => {
    if (btn) {
      btn.addEventListener('mousedown', e => e.preventDefault());
    }
  });
  
  console.log("Found buttons:", { 
    bold: boldButton ? "yes" : "no", 
    italic: italicButton ? "yes" : "no", 
    strikethrough: strikethroughButton ? "yes" : "no" 
  });
  
  // Apply markdown formatting (bold, italic, strikethrough)
  function applyMarkdownFormatting(command) {
    console.log(`Applying ${command} markdown formatting`);
    // Restore previously saved selection if the click moved focus away
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    // Ensure editor has focus so keyboard continues from correct position
    editor.focus();

    const selection = window.getSelection();
    if (!selection.rangeCount) {
      console.log("No selection found");
      return;
    }
    
    const range = selection.getRangeAt(0);
    const selectedText = selection.toString();
    
    if (!selectedText) {
      console.log("No text selected");
      return;
    }

    // After any mutation, re-store selection for subsequent actions
    const rememberSelection = () => {
      saveSelection();
    };

    try {
      let markdownSymbol = "";
      if (command === "bold") {
        markdownSymbol = "*";
      } else if (command === "italic") {
        markdownSymbol = "_";
      } else if (command === "strikethrough") {
        markdownSymbol = "~";
      }
      
      console.log(`Using markdown symbol: ${markdownSymbol}`);
      const editorText = editor.textContent;
      let isFormatted = false;
      
      if (command === "bold") {
        isFormatted = selectedText.startsWith("*") && selectedText.endsWith("*");
        console.log(`Bold direct check: "${selectedText}" starts with * = ${selectedText.startsWith("*")}, ends with * = ${selectedText.endsWith("*")}`);
      } else if (command === "italic") {
        isFormatted = selectedText.startsWith("_") && selectedText.endsWith("_");
        console.log(`Italic direct check: "${selectedText}" starts with _ = ${selectedText.startsWith("_")}, ends with _ = ${selectedText.endsWith("_")}`);
      } else {
        isFormatted = selectedText.startsWith(markdownSymbol) && selectedText.endsWith(markdownSymbol);
        console.log(`${command} direct check: "${selectedText}" starts with ${markdownSymbol} = ${selectedText.startsWith(markdownSymbol)}, ends with ${markdownSymbol} = ${selectedText.endsWith(markdownSymbol)}`);
      }
      
      if (!isFormatted) {
        const escapedText = selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\${markdownSymbol}${escapedText}\\${markdownSymbol}`);
        isFormatted = regex.test(editorText);
        console.log(`${command} regex test: ${regex} on "${editorText}" = ${isFormatted}`);
      }
      
      console.log(`Text is ${isFormatted ? "already" : "not"} formatted with ${markdownSymbol}`);
      
      const newRange = document.createRange();
      newRange.setStart(range.startContainer, range.startOffset);
      newRange.setEnd(range.endContainer, range.endOffset);
      
      if (isFormatted) {
        console.log("Removing formatting");
        let cleanText = selectedText.replace(new RegExp(`^\\${markdownSymbol}|\\${markdownSymbol}$`, 'g'), '');
        newRange.deleteContents();
        newRange.insertNode(document.createTextNode(cleanText));
      } else {
        console.log("Adding formatting");
        const formattedText = `${markdownSymbol}${selectedText}${markdownSymbol}`;
        newRange.deleteContents();
        newRange.insertNode(document.createTextNode(formattedText));
      }
      
      selection.removeAllRanges();
      selection.addRange(newRange);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      console.log(`Markdown formatting applied: ${command} to "${selectedText}"`);
    } catch (err) {
      console.error("Error applying markdown formatting:", err);
      toast("Failed to apply formatting", "error");
    } finally {
      // Keep reference updated for consecutive clicks
      rememberSelection();
    }
  }
  
  if (boldButton) {
    boldButton.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log("Bold button clicked");
      applyMarkdownFormatting("bold");
    });
  } else {
    console.error("Bold button not found in toolbar");
  }
  
  if (italicButton) {
    italicButton.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log("Italic button clicked");
      applyMarkdownFormatting("italic");
    });
  }
  
  if (strikethroughButton) {
    strikethroughButton.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log("Strikethrough button clicked");
      applyMarkdownFormatting("strikethrough");
    });
  }
  
  toolbar.addEventListener("click", function(e) {
    console.log("Toolbar clicked (fallback handler)");
    const button = e.target.closest("button[data-cmd]");
    if (button) {
      const command = button.getAttribute("data-cmd");
      console.log(`Button clicked via fallback: ${command}`);
      if (command === "bold" || command === "italic" || command === "strikethrough") {
        applyMarkdownFormatting(command);
      }
    }
  });
  
  // Track paste state to prevent duplicate handling
  let isPasting = false;
  
  editor.addEventListener("paste", function(e) {
    // If we're already handling a paste event, don't process this one
    if (isPasting) {
      console.log('Ignoring duplicate paste event');
      return;
    }
    
    // Set flag to prevent recursive paste handling
    isPasting = true;
    
    // Prevent default paste behavior
    e.preventDefault();
    
    try {
      // Get the plain text from clipboard
      let text = e.clipboardData.getData("text/plain");
      console.log('Processing paste event with text length:', text.length);
      
      // Clear the entire editor content completely to prevent duplication
      editor.innerHTML = '';
      
      // Create a new selection at the start of the editor
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(true); // collapse to start
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Process line breaks in the pasted text
      const lines = text.split(/\r?\n/);
      let htmlLines = [];
      
      for (let i = 0; i < lines.length; i++) {
        htmlLines.push(lines[i]);
        if (i < lines.length - 1) {
          htmlLines.push("<br>");
        }
      }
      
      // Create and insert the HTML fragment
      const fragment = document.createRange().createContextualFragment(htmlLines.join(''));
      range.insertNode(fragment);
      
      // Move cursor to the end of inserted content
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Trigger input event to save the content
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      console.log('Paste completed successfully with full content replacement');
    } catch (err) {
      console.error('Error during paste operation:', err);
    } finally {
      // Always reset the pasting flag when done
      setTimeout(() => {
        isPasting = false;
        console.log('Paste handling completed, reset flag');
      }, 100);
    }
  });
  
  editor.addEventListener("keydown", function(e) {
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      history.undo();
      return;
    }
    if (e.ctrlKey && e.key === 'y') {
      e.preventDefault();
      history.redo();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const br = document.createElement('br');
        range.insertNode(br);
        const emptyText = document.createTextNode('');
        range.insertNode(emptyText);
        range.setStartAfter(br);
        range.setEndAfter(br);
        selection.removeAllRanges();
        selection.addRange(range);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "b") {
        e.preventDefault();
        applyMarkdownFormatting("bold");
      } else if (e.key === "i") {
        e.preventDefault();
        applyMarkdownFormatting("italic");
      } else if (e.key === "u") {
        e.preventDefault();
        applyMarkdownFormatting("strikethrough");
      }
    }
  });
  
  editor.addEventListener("beforeinput", function(e) {
    if (e.inputType === "formatBold" || 
        e.inputType === "formatItalic" || 
        e.inputType === "formatUnderline" || 
        e.inputType === "formatStrikeThrough") {
      e.preventDefault();
    }
  });
  
  const originalExecCommand = document.execCommand;
  document.execCommand = function(commandId, showUI, value) {
    if (commandId === "bold" || 
        commandId === "italic" || 
        commandId === "underline" || 
        commandId === "strikethrough") {
      console.log(`Prevented formatting command: ${commandId}`);
      return false;
    }
    return originalExecCommand.apply(this, arguments);
  };
  
  editor.setAttribute("data-plaintext-only", "true");
  const style = document.createElement("style");
  style.textContent = `
    [data-plaintext-only="true"] {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    [data-plaintext-only="true"] * {
      font-style: normal !important;
      font-weight: normal !important;
      text-decoration: none !important;
    }
  `;
  document.head.appendChild(style);
}

// Find the nearest markdown node for cursor positioning
export function findNearestMarkdownNode(cursorNode, markdownSymbol, editor) {
  let currentNode = cursorNode;
  let textContent = "";
  if (currentNode.nodeType === 3) {
    textContent = currentNode.textContent;
  } else if (currentNode.nodeType === 1) {
    textContent = currentNode.textContent;
  }
  
  const regex = new RegExp(`\\${markdownSymbol}[^\\${markdownSymbol}]+\\${markdownSymbol}`);
  if (regex.test(textContent)) {
    let cursorPosition = 0;
    if (currentNode.nodeType === 3) {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        cursorPosition = range.startOffset;
      }
    }
    
    let match;
    let lastIndex = 0;
    while ((match = regex.exec(textContent)) !== null) {
      const startPos = match.index;
      const endPos = startPos + match[0].length;
      if (cursorPosition >= startPos && cursorPosition <= endPos) {
        const range = document.createRange();
        range.setStart(currentNode, startPos);
        range.setEnd(currentNode, endPos);
        return range;
      }
      lastIndex = regex.lastIndex;
    }
  }
  
  let parentNode = currentNode;
  while (parentNode && parentNode !== editor) {
    if (parentNode.nodeType === 1) {
      textContent = parentNode.textContent;
      if (regex.test(textContent)) {
        const range = document.createRange();
        range.selectNodeContents(parentNode);
        return range;
      }
    }
    parentNode = parentNode.parentNode;
  }
  
  let node = cursorNode;
  while (node) {
    if (node.nodeType === 3 || node.nodeType === 1) {
      textContent = node.textContent;
      if (regex.test(textContent)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range;
      }
    }
    node = node.previousSibling;
  }
  
  node = cursorNode;
  while (node) {
    if (node.nodeType === 3 || node.nodeType === 1) {
      textContent = node.textContent;
      if (regex.test(textContent)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range;
      }
    }
    node = node.nextSibling;
  }
  
  return null;
}

// Save editor content to Chrome storage
export function saveEditorContent(editor) {
  if (!editor) return;
  
  // Convert to markdown representation with the right number of line breaks
  const markdown = htmlToWhatsAppMarkdown(editor.innerHTML);
  
  // Save the HTML version (normalized, with <br> for linebreaks)
  const htmlContent = markdown.replace(/\n/g, '<br>');
  
  chrome.storage.local.set({ 
    composerMessageContent: htmlContent,
    composerMessageMarkdown: markdown // Save raw markdown too
  }, () => {
    if (chrome.runtime.lastError) {
      console.error('Error saving composerMessageContent:', chrome.runtime.lastError);
    } else {
      console.log('Composer message content saved (HTML):', htmlContent);
    }
  });
}

// Load editor content from Chrome storage
export function loadEditorContent(editor) {
  if (!editor) return;
  
  chrome.storage.local.get(['composerMessageContent', 'composerMessageMarkdown', 'savedMessageContent'], (result) => {
    if (chrome.runtime.lastError) {
      console.error('Error loading composer content:', chrome.runtime.lastError);
      return;
    }

    let content = '';
    
    // First try using markdown version (has proper line breaks)
    if (result.composerMessageMarkdown) {
      // Properly preserve user line breaks - each newline becomes a <br>
      content = result.composerMessageMarkdown.replace(/\n/g, '<br>');
      console.log('Restored from saved markdown with exact line breaks');
    } 
    // Fall back to HTML content (legacy)
    else if (result.composerMessageContent) {
      content = result.composerMessageContent;
      console.log('Restored and normalized composerMessageContent (HTML):', content);
    } 
    // Very old format (plain text)
    else if (result.savedMessageContent) {
      content = result.savedMessageContent.replace(/\r?\n/g, '<br>');
      console.log('Restored and converted legacy savedMessageContent (plain):', content);
    }

    if (content) {
      editor.innerHTML = content;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

// Clear editor content and storage
export function clearMessageContent(editor) {
  if (!editor) return;
  
  editor.textContent = '';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  console.log('Message content cleared');
  
  chrome.storage.local.remove(['savedMessageContent'], () => {
    if (chrome.runtime.lastError) {
      console.error('Error clearing saved message content:', chrome.runtime.lastError);
    } else {
      console.log('Saved message content cleared successfully');
    }
  });
}

// Initialize the message composer
export function initializeMessageComposer(editor) {
  if (!editor) return;
  
  loadEditorContent(editor);
  console.log('Message composer initialized');
}

// Get the current editor content
export function getMessageContent(editor) {
  if (!editor) return '';
  
  return editor.textContent || '';
}

// Set the editor content
export function setMessageContent(editor, content) {
  if (!editor) return;
  
  editor.textContent = content;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  console.log('Message content set');
  
  saveEditorContent(editor);
}