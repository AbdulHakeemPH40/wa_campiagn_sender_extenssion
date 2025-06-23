// js/content/content_script.js  – enhanced for contact extraction
console.log("WA Campaign Sender: Content script (contacts extractor) loaded.");

const storageKey = 'waUserPhoneNumberResult';

function injectScript(filePath){
  const scriptId = 'wa-bs-injector';
  const prev = document.getElementById(scriptId);
  if(prev) prev.remove();
  const sc = document.createElement('script');
  sc.id = scriptId;
  sc.type = 'text/javascript';
  sc.src = filePath;
  (document.head||document.documentElement).appendChild(sc);
  sc.onerror = (e)=>{
    console.error('Injector load error',e);
    chrome.runtime.sendMessage({type:'WHATSAPP_NUMBER_RESULT',status:'error',message:`Failed to inject script: ${filePath}`});
  };
}

// --------------------------------------------------
// Handle messages FROM the injector (window.postMessage)
window.addEventListener('message',(ev)=>{
  if(ev.source!==window || !ev.data || ev.data.source!=='injector-script') return;
  const d=ev.data;
  switch(d.type){
    case 'WHATSAPP_NUMBER_FETCHER_RESULT':
      chrome.runtime.sendMessage({type:'WHATSAPP_NUMBER_RESULT',status:d.phoneNumber?'success_injector':'error',number:d.phoneNumber, message:d.message});
      break;
    case 'INJECTOR_SAVED_CONTACTS_RESULT':
      chrome.runtime.sendMessage({type:'SAVED_CONTACTS_RESULT',status:d.status,contacts:d.contacts,error:d.error});
      break;
    case 'INJECTOR_GROUP_CONTACTS_RESULT':
      chrome.runtime.sendMessage({type:'GROUP_CONTACTS_RESULT',status:d.status,contacts:d.contacts,error:d.error});
      break;
    case 'INJECTOR_CHAT_CONTACTS_RESULT':
      chrome.runtime.sendMessage({type:'CHAT_CONTACTS_RESULT',status:d.status,contacts:d.contacts,error:d.error});
      break;
    case 'INJECTOR_GROUP_LIST_RESULT':
      chrome.runtime.sendMessage({type:'GROUP_LIST_RESULT',status:d.status,groups:d.groups,error:d.error});
      break;
    case 'INJECTOR_SELECTED_GROUP_CONTACTS_RESULT':
      chrome.runtime.sendMessage({type:'SELECTED_GROUP_CONTACTS_RESULT',status:d.status,contacts:d.contacts,error:d.error});
      break;
  }
},false);

// --------------------------------------------------
let pendingMessageTimeoutId=null;
function attemptFetchingNumber(){
  if(!window.location.hostname.includes('web.whatsapp.com')) return;
  if(pendingMessageTimeoutId){clearTimeout(pendingMessageTimeoutId);pendingMessageTimeoutId=null;}
  injectScript(chrome.runtime.getURL('js/content/injector.js'));
  pendingMessageTimeoutId=setTimeout(()=>{
    pendingMessageTimeoutId=null;
    chrome.storage.local.get([storageKey],res=>{
      const last=res[storageKey];
      if(!last|| (last.status!=='success_injector'&&last.status!=='error')){
        chrome.runtime.sendMessage({type:'WHATSAPP_NUMBER_RESULT',status:'pending_injector',message:'Attempting to fetch number. Please wait...'});
      }
    });
  },3500);
}
attemptFetchingNumber();

// --------------------------------------------------
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
  switch(msg.type){
    case 'FETCH_WHATSAPP_NUMBER_AGAIN':
    case 'FETCH_WA_USER_NUMBER_AGAIN':
      attemptFetchingNumber();
      sendResponse({status:'fetch_number_attempt_triggered'});
      return true;
    case 'WHATSAPP_NUMBER_RESULT':{
      const entry={ status:msg.status, number:msg.number, message:msg.message, timestamp:Date.now() };
      chrome.storage.local.set({ [storageKey]:entry, lastNumberResult:entry });
      break; }
    case 'FETCH_SAVED_CONTACTS_CSV':
      window.postMessage({type:'GET_SAVED_CONTACTS',source:'content-script'},'*');
      sendResponse({status:'request_relayed_to_injector'});return true;
    case 'FETCH_GROUP_CONTACTS_CSV':
      window.postMessage({type:'GET_GROUP_CONTACTS',source:'content-script'},'*');
      sendResponse({status:'request_relayed_to_injector'});return true;
    case 'FETCH_CHAT_CONTACTS_CSV':
      window.postMessage({type:'GET_CHAT_CONTACTS',source:'content-script'},'*');
      sendResponse({status:'request_relayed_to_injector'});return true;
    case 'FETCH_GROUP_LIST':
      window.postMessage({type:'GET_GROUP_LIST',source:'content-script'},'*');
      sendResponse({status:'request_group_list_relayed_to_injector'});return true;
    case 'DOWNLOAD_SELECTED_GROUP_CONTACTS':
      window.postMessage({type:'GET_SELECTED_GROUP_CONTACTS',source:'content-script',selectedGroups:msg.selectedGroups},'*');
      sendResponse({status:'request_selected_groups_relayed_to_injector'});return true;
  }
});

console.log("WA Campaign Sender: Number Fetcher Content Script Initialized.");
