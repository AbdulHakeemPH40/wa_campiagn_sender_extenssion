// injector.js
(function() {
    console.log('WA Campaign Sender: injector.js (contacts extractor) loaded.');

    // --- Store Accessor ---
    function getStore() {
        if (window.Store && window.Store.Contact && window.Store.Chat && window.Store.Msg && window.Store.GroupMetadata) {
            return window.Store;
        }
        if (typeof window.require === 'function') {
            const moduleIds = [
                'WAWebCollections', 'WAWebStoreUtils', 'whatsapp-web-store', 'Store', 'Chat', 'Msg',
                'ContactCollection', 'ChatCollection'
            ];
            for (const id of moduleIds) {
                try {
                    const mod = window.require(id);
                    const cands = [mod, mod?.default, mod?.Store];
                    for (const cand of cands) {
                        if (cand && cand.Contact && cand.Chat && cand.Msg && cand.GroupMetadata) {
                            window.Store = cand;
                            return cand;
                        }
                    }
                } catch(_) {}
            }
            // Heuristic fallback – scan require.c cache
            if (window.require.c) {
                for (const mid in window.require.c) {
                    const exp = window.require.c[mid]?.exports;
                    const cands = [exp, exp?.default];
                    for (const cand of cands) {
                        if (cand && cand.Contact && cand.Chat && cand.Msg && cand.GroupMetadata) {
                            window.Store = cand;
                            return cand;
                        }
                    }
                }
            }
        }
        return null;
    }

    // --- Helpers ---
    function post(type, payload = {}) {
        window.postMessage({ type, source: 'injector-script', ...payload }, '*');
    }

    // --- Fetch own phone number (unchanged) ---
    function getOwnPhoneNumber(retry = 4) {
        try {
            const mod = window.require?.('WAWebUserPrefsMeUser');
            const me = mod?.getMaybeMeUser?.();
            if (me?.user) {
                post('WHATSAPP_NUMBER_FETCHER_RESULT', { phoneNumber: me.user });
                return;
            }
        } catch(_) {}
        if (retry > 0) setTimeout(() => getOwnPhoneNumber(retry-1), 1000);
        else post('WHATSAPP_NUMBER_FETCHER_RESULT', { phoneNumber: null, message: 'Could not retrieve own phone number.' });
    }

    // --- Converters ---
    const toContactObj = (contact, extra = {}) => ({
        name: contact?.name || contact?.formattedName || contact?.pushname || contact?.shortName || 'N/A',
        phoneNumber: contact?.id?.user,
        ...extra
    });

    // Saved contacts
    function fetchSavedContacts() {
        const S = getStore();
        if (!S?.Contact) return post('INJECTOR_SAVED_CONTACTS_RESULT', { status: 'error', error: 'Store.Contact not found.' });
        try {
            // Filter only real address-book contacts that have a regular phone JID (server === 'c.us')
            const validContacts = S.Contact
                .filter(c => (c.isMyContact || c.isAddressBookContact) && c.id?.server === 'c.us')
                .map(c => toContactObj(c))
                // Keep only numeric phone numbers between 7-13 digits (skip internal 14-15 digit IDs)
                .filter(c => /^\d{7,13}$/.test(c.phoneNumber));

            // Deduplicate by phone number to avoid duplicate rows for the same contact
            const uniqueMap = new Map();
            validContacts.forEach(c => {
                if (!uniqueMap.has(c.phoneNumber)) {
                    uniqueMap.set(c.phoneNumber, c);
                }
            });
            const contacts = Array.from(uniqueMap.values());

            post('INJECTOR_SAVED_CONTACTS_RESULT', { status: 'success', contacts });
        } catch(e) {
            post('INJECTOR_SAVED_CONTACTS_RESULT', { status: 'error', error: e.message });
        }
    }

    // Group contacts (all groups)
    function fetchGroupContacts() {
        const S = getStore();
        if (!S?.Chat || !S?.Contact) return post('INJECTOR_GROUP_CONTACTS_RESULT', { status: 'error', error: 'Store.Chat/Contact not found.' });
        try {
            const list = [];
            S.Chat.filter(ch => ch.isGroup && ch.groupMetadata?.participants).forEach(gr => {
                const gName = gr.name || gr.formattedTitle || 'N/A';
                gr.groupMetadata.participants.forEach(p => {
                    const c = S.Contact.get(p.id);
                    list.push(toContactObj(c, { groupName: gName, contactName: toContactObj(c).name }));
                });
            });
            post('INJECTOR_GROUP_CONTACTS_RESULT', { status: 'success', contacts: list });
        } catch(e) {
            post('INJECTOR_GROUP_CONTACTS_RESULT', { status: 'error', error: e.message });
        }
    }

    // Individual chat contacts
    function fetchChatContacts() {
        const S = getStore();
        if (!S?.Chat || !S?.Contact) {
            return post('INJECTOR_CHAT_CONTACTS_RESULT', { status: 'error', error: 'Store.Chat/Contact not found.' });
        }
        try {
            const chats = S.Chat
                .filter(ch => !ch.isGroup && ch.id?.server === 'c.us')
                .map(ch => {
                    const contact = S.Contact.get(ch.id);
                    if (contact) {
                        // Use the name from the contact record (already handled by toContactObj)
                        return toContactObj(contact);
                    }
                    // Fallback to chat title if contact record missing
                    return {
                        name: ch.name || ch.formattedTitle || 'N/A',
                        phoneNumber: ch.id.user
                    };
                });
            post('INJECTOR_CHAT_CONTACTS_RESULT', { status: 'success', contacts: chats });
        } catch (e) {
            post('INJECTOR_CHAT_CONTACTS_RESULT', { status: 'error', error: e.message });
        }
    }

    // Group list
    function fetchGroupList() {
        const S = getStore();
        if (!S?.GroupMetadata) return post('INJECTOR_GROUP_LIST_RESULT', { status: 'error', error: 'Store.GroupMetadata not found.' });
        try {
            const groups = S.GroupMetadata.toArray().map(g => ({ id: g.id._serialized, name: g.name || g.subject || 'Unnamed Group' }));
            post('INJECTOR_GROUP_LIST_RESULT', { status: 'success', groups });
        } catch(e) {
            post('INJECTOR_GROUP_LIST_RESULT', { status: 'error', error: e.message });
        }
    }

    // Contacts from selected groups
    function fetchSelectedGroupContacts(selectedGroups) {
        const S = getStore();
        if (!S?.GroupMetadata || !S?.Contact) return post('INJECTOR_SELECTED_GROUP_CONTACTS_RESULT', { status: 'error', error: 'Store.GroupMetadata/Contact not found.' });
        try {
            let collected = [];
            selectedGroups.forEach(g => {
                const grp = S.GroupMetadata.get(g.id);
                if (!grp?.participants) return;
                grp.participants.forEach(p => {
                    const c = S.Contact.get(p.id);
                    collected.push(toContactObj(c, { groupName: g.name || grp.name || grp.subject || 'Group', contactName: toContactObj(c).name }));
                });
            });
            post('INJECTOR_SELECTED_GROUP_CONTACTS_RESULT', { status: 'success', contacts: collected });
        } catch(e) {
            post('INJECTOR_SELECTED_GROUP_CONTACTS_RESULT', { status: 'error', error: e.message });
        }
    }

    // Listener from content-script
    window.addEventListener('message', (ev) => {
        if (ev.source !== window || ev.data?.source !== 'content-script') return;
        switch(ev.data.type) {
            case 'GET_SAVED_CONTACTS': fetchSavedContacts(); break;
            case 'GET_GROUP_CONTACTS': fetchGroupContacts(); break;
            case 'GET_CHAT_CONTACTS': fetchChatContacts(); break;
            case 'GET_GROUP_LIST': fetchGroupList(); break;
            case 'GET_SELECTED_GROUP_CONTACTS': fetchSelectedGroupContacts(ev.data.selectedGroups || []); break;
        }
    }, false);

    // Kick-off own number fetch
    if (window.self === window.top && window.location.hostname.includes('whatsapp.com')) {
        setTimeout(getOwnPhoneNumber, 500);
    }
})();
