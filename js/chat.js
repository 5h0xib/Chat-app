// js/chat.js

let activeFriend = null;
let messagesSubscription = null;
let currentImageAttachment = null;

// Colour palette for sender name highlighting in group chat
const SENDER_COLORS = [
    '#58a6ff', '#79c0ff', '#56d364', '#3fb950',
    '#d2a8ff', '#bc8cff', '#ffa657', '#f0883e',
    '#ff7b72', '#f85149', '#39d353', '#26a641',
];
function getSenderColor(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
    return SENDER_COLORS[Math.abs(hash) % SENDER_COLORS.length];
}

// Initialize chat system
document.addEventListener('DOMContentLoaded', () => {
    const isChatPage = window.location.pathname.toLowerCase().endsWith('chat.html');

    if (!isChatPage) return;

    const messageForm = document.getElementById('messageForm');
    if (messageForm) {
        messageForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('messageInput');
            const text = input.value.trim();
            input.value = ''; // Clear input immediately
            await sendMessage(text);
        });

        // Setup image attachment handlers
        setupImageAttachment();
    }

    // subscribeToMessages() is called from friends.js after currentUser is confirmed ready
});

/**
 * Open chat with a specific friend
 */
window.openChat = async function (friend) {
    activeFriend = friend;

    // Request notification permission upon user interaction
    if (typeof requestNotificationPermission === 'function') {
        requestNotificationPermission();
    }

    // Update UI
    document.getElementById('emptyChat').style.display = 'none';
    document.getElementById('activeChat').style.display = 'flex';

    const chatTitle = friend.isGroup ? friend.name : friend.username;
    document.getElementById('currentChatName').textContent = chatTitle;
    
    // Show actual avatar in header
    const avatarEl = document.getElementById('currentChatAvatar');
    if (friend.avatar_url) {
        avatarEl.style.backgroundImage = `url('${friend.avatar_url}')`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
    } else {
        avatarEl.style.backgroundImage = 'none';
        avatarEl.textContent = friend.isGroup ? 'G' : chatTitle.charAt(0).toUpperCase();
    }

    // Clear current messages
    document.getElementById('messagesContainer').innerHTML = '<div class="loading-text">Loading messages...</div>';

    const chatHeader = document.querySelector('.chat-header');
    if (friend.isGroup && typeof setupGroupSettings === 'function') {
        chatHeader.style.cursor = 'pointer';
        chatHeader.onclick = () => setupGroupSettings(friend);
    } else {
        chatHeader.style.cursor = 'default';
        chatHeader.onclick = null;
    }

    // Load existing messages
    await loadMessages();
};

/**
 * Close chat (useful for mobile)
 */
window.closeChat = function () {
    activeFriend = null;
    document.getElementById('emptyChat').style.display = 'flex';
    document.getElementById('activeChat').style.display = 'none';
};

/**
 * Load messages for the active friend
 */
async function loadMessages() {
    if (!activeFriend || !currentUser) return;

    const container = document.getElementById('messagesContainer');

    try {
        let query = supabaseClient.from('messages').select('*');
        if (activeFriend.isGroup) {
            query = query.eq('group_id', activeFriend.id);
        } else {
            query = query.or(
                `and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeFriend.id}),` +
                `and(sender_id.eq.${activeFriend.id},receiver_id.eq.${currentUser.id})`
            );
        }
        const { data, error } = await query.order('created_at', { ascending: true });

        if (error) throw error;

        container.innerHTML = '';

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="loading-text">Start of conversation</div>';
            return;
        }

        // For group chats, fetch all unique sender profiles in one shot
        if (activeFriend.isGroup) {
            const senderIds = [...new Set(data.map(m => m.sender_id))];
            const { data: profiles } = await supabaseClient
                .from('profiles')
                .select('id, username')
                .in('id', senderIds);
            const profileMap = {};
            if (profiles) profiles.forEach(p => { profileMap[p.id] = p; });
            data.forEach(msg => { msg.profiles = profileMap[msg.sender_id] || null; });
        }

        data.forEach(msg => {
            appendMessage(msg);
        });

        scrollToBottom();

        // Mark unread messages as read
        const unreadIds = data.filter(m => m.receiver_id === currentUser.id && !m.is_read).map(m => m.id);
        if (unreadIds.length > 0) {
            supabaseClient.from('messages').update({ is_read: true }).in('id', unreadIds).then();
        }

        // Hide badge for this friend
        const badgeInfo = document.getElementById(`badge-${activeFriend.id}`);
        if (badgeInfo) {
            badgeInfo.style.display = 'none';
            badgeInfo.textContent = '0';
        }
    } catch (err) {
        console.error('Error loading messages:', err.message);
        container.innerHTML = '<div class="loading-text" style="color:red">Error loading messages</div>';
    }
}

/**
 * Send a message
 */
async function sendMessage(text) {
    if (!currentUser || !activeFriend) return;
    if (!text && !currentImageAttachment) return; // Need text or image

    // Optimistic UI update for text message (if no image)
    let tempMsgId = null;
    if (text && !currentImageAttachment) {
        tempMsgId = 'temp-' + Date.now();
        const tempMsg = {
            id: tempMsgId,
            sender_id: currentUser.id,
            receiver_id: activeFriend.id,
            message: text,
            created_at: new Date().toISOString()
        };
        appendMessage(tempMsg);
        scrollToBottom();
    }

    try {
        let imageUrl = null;

        // Handle image upload if attached
        if (currentImageAttachment) {
            const file = currentImageAttachment;
            const fileExt = file.name.split('.').pop();
            const fileName = `${currentUser.id}/${Date.now()}.${fileExt}`;

            // Show loading state
            const sendBtn = document.getElementById('sendBtn');
            const originalSendHtml = sendBtn.innerHTML;
            sendBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><circle cx="12" cy="12" r="10" stroke-dasharray="31.4 31.4" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>';
            sendBtn.disabled = true;

            try {
                const { error: uploadError } = await supabaseClient.storage
                    .from('chat-images')
                    .upload(fileName, file);

                if (uploadError) throw uploadError;

                const { data } = supabaseClient.storage
                    .from('chat-images')
                    .getPublicUrl(fileName);

                imageUrl = data.publicUrl;
            } finally {
                sendBtn.innerHTML = originalSendHtml;
                sendBtn.disabled = false;
                // Clear attachment UI
                clearImageAttachment();
            }
        }

        const newMsg = {
            sender_id: currentUser.id,
            message: text || null, // null if only image
            image_url: imageUrl,
            is_read: false
        };

        if (activeFriend.isGroup) {
            newMsg.group_id = activeFriend.id;
        } else {
            newMsg.receiver_id = activeFriend.id;
        }

        const { error } = await supabaseClient
            .from('messages')
            .insert([newMsg]);

        if (error) throw error;
    } catch (err) {
        console.error('Error sending message:', err.message);
        if (tempMsgId) {
            const failDiv = document.querySelector(`[data-id="${tempMsgId}"]`);
            if (failDiv) {
                const timeEl = failDiv.querySelector('.message-time');
                if (timeEl) {
                    timeEl.textContent += ' (Failed)';
                    timeEl.style.color = 'red';
                }
            }
        }
    }
}

/**
 * Subscribe to realtime messages globally
 */
function subscribeToMessages() {
    if (!currentUser) {
        // currentUser not ready yet — retry shortly
        setTimeout(subscribeToMessages, 200);
        return;
    }
    if (messagesSubscription) return;

    messagesSubscription = supabaseClient
        .channel('realtime:messages:' + currentUser.id)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async payload => {
            const newMsg = payload.new;

            // Always fetch sender profile so we have a name (works for both DMs and groups)
            if (!newMsg.profiles) {
                const { data: prof } = await supabaseClient
                    .from('profiles')
                    .select('id, username')
                    .eq('id', newMsg.sender_id)
                    .single();
                if (prof) newMsg.profiles = prof;
            }

            // Is it relevant to us?
            const isForUs = newMsg.receiver_id === currentUser.id ||
                            newMsg.sender_id === currentUser.id ||
                            isUserInGroup(newMsg.group_id);

            if (!isForUs) return;

            // Is it part of the currently open chat?
            const isForCurrentChat = activeFriend && (
                (!activeFriend.isGroup && (
                    (newMsg.sender_id === currentUser.id && newMsg.receiver_id === activeFriend.id) ||
                    (newMsg.sender_id === activeFriend.id && newMsg.receiver_id === currentUser.id)
                )) ||
                (activeFriend.isGroup && newMsg.group_id === activeFriend.id)
            );

            if (isForCurrentChat) {
                if (newMsg.sender_id === currentUser.id) {
                    // Our own message confirmed — replace optimistic temp bubble
                    const tempMsgs = document.querySelectorAll('[data-id^="temp-"]');
                    let found = false;
                    for (const tm of tempMsgs) {
                        if (tm.textContent.includes(newMsg.message || '')) {
                            tm.dataset.id = newMsg.id;
                            const tickSvg = tm.querySelector('.read-receipt');
                            if (tickSvg) tickSvg.setAttribute('stroke', newMsg.is_read ? '#ffffff' : '#8b949e');
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        appendMessage(newMsg);
                        scrollToBottom();
                    }
                } else {
                    // Incoming message in the active chat
                    appendMessage(newMsg);
                    scrollToBottom();

                    if (!newMsg.group_id) {
                        supabaseClient.from('messages').update({ is_read: true }).eq('id', newMsg.id).then();
                    }
                }
            } else {
                // Not the active chat — bump badge
                if (newMsg.sender_id !== currentUser.id) {
                    const badgeId = newMsg.group_id ? `badge-${newMsg.group_id}` : `badge-${newMsg.sender_id}`;
                    const badgeInfo = document.getElementById(badgeId);
                    if (badgeInfo) {
                        const count = parseInt(badgeInfo.textContent || '0') + 1;
                        badgeInfo.textContent = count;
                        badgeInfo.style.display = 'inline-block';
                    }
                }
            }

            // Push notifications
            if (newMsg.sender_id !== currentUser.id &&
                (newMsg.receiver_id === currentUser.id || newMsg.group_id)) {
                if (typeof showNotification === 'function') {
                    let senderName = 'Someone';
                    if (newMsg.profiles && newMsg.profiles.username) {
                        senderName = newMsg.profiles.username;
                    } else if (!newMsg.group_id) {
                        const f = (typeof friendList !== 'undefined') &&
                            friendList.find(f => f.id === newMsg.sender_id);
                        if (f) senderName = f.username;
                    }
                    if (!isForCurrentChat || document.visibilityState !== 'visible') {
                        showNotification(senderName, newMsg.message || 'Image attached');
                    }
                }
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
            const updatedMsg = payload.new;
            const msgEl = document.querySelector(`[data-id="${updatedMsg.id}"]`);
            if (msgEl) {
                if (updatedMsg.is_read) {
                    const tickSvg = msgEl.querySelector('.read-receipt');
                    if (tickSvg) tickSvg.setAttribute('stroke', '#ffffff');
                }
                if (updatedMsg.deleted_at) {
                    const textNode = msgEl.querySelector('.message-content-text');
                    const imgNode = msgEl.querySelector('img');
                    const deleteBtn = msgEl.querySelector('.message-delete-btn');
                    if (textNode) {
                        textNode.innerHTML = '<i>This message was deleted</i>';
                        textNode.style.color = 'var(--wa-text-light)';
                    }
                    if (imgNode) imgNode.remove();
                    if (deleteBtn) deleteBtn.remove();
                }
            }
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[Chat] Realtime subscription active');
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('[Chat] Realtime subscription issue:', status, '— will retry');
                messagesSubscription = null;
                setTimeout(subscribeToMessages, 3000);
            }
        });
}

/** Helper: check if the current user is a member of a given group (based on loaded friendList/groups) */
function isUserInGroup(groupId) {
    if (!groupId) return false;
    if (typeof friendList === 'undefined') return false;
    // friendList contains group objects too (with isGroup flag)
    // We check sidebar items as a fallback
    return !!document.getElementById(`badge-${groupId}`);
}

/**
 * Handle Image Image selection and preview
 */
function setupImageAttachment() {
    const input = document.getElementById('imageAttachmentInput');
    const previewContainer = document.getElementById('imagePreviewContainer');
    const previewImg = document.getElementById('imagePreview');
    const removeBtn = document.getElementById('removeImageBtn');
    const textInput = document.getElementById('messageInput');

    if (!input) return;

    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            if (!file.type.startsWith('image/')) {
                alert('Please select an image file');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                alert('Image must be under 5MB');
                return;
            }

            currentImageAttachment = file;

            // Show preview
            const reader = new FileReader();
            reader.onload = (e) => {
                previewImg.src = e.target.result;
                previewContainer.style.display = 'flex';
                // Adjust text input styling so they sit together
                textInput.style.borderTopLeftRadius = '0';
                textInput.style.borderBottomLeftRadius = '0';
            };
            reader.readAsDataURL(file);
        }
    });

    removeBtn.addEventListener('click', clearImageAttachment);
}

function clearImageAttachment() {
    const input = document.getElementById('imageAttachmentInput');
    const previewContainer = document.getElementById('imagePreviewContainer');
    const textInput = document.getElementById('messageInput');

    currentImageAttachment = null;
    input.value = '';
    previewContainer.style.display = 'none';
    textInput.style.borderTopLeftRadius = '6px';
    textInput.style.borderBottomLeftRadius = '6px';
}

/**
 * Delete a message (Soft Delete)
 */
window.deleteMessage = async function(msgId) {
    if (!confirm('Are you sure you want to delete this message?')) return;
    
    try {
        const { error } = await supabaseClient
            .from('messages')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', msgId)
            .eq('sender_id', currentUser.id); // Extra safety check

        if (error) throw error;
        // Realtime UPDATE listener will catch this and modify the DOM for everyone!
    } catch (err) {
        console.error('Error deleting message:', err);
        alert('Failed to delete message.');
    }
}

/**
 * Append a single message to UI
 */
function appendMessage(msg) {
    const container = document.getElementById('messagesContainer');

    // Remove "Start of conversation" loading text if present
    const loadingText = container.querySelector('.loading-text');
    if (loadingText) {
        loadingText.remove();
    }

    if (msg.id && !msg.id.startsWith('temp-') && document.querySelector(`[data-id="${msg.id}"]`)) {
        return;
    }

    const isOut = msg.sender_id === currentUser.id;

    const div = document.createElement('div');
    div.className = `message ${isOut ? 'message-out' : 'message-in'}`;
    if (msg.id) div.dataset.id = msg.id;

    const contentDiv = document.createElement('div');
    contentDiv.style.display = 'flex';
    contentDiv.style.flexDirection = 'column';
    contentDiv.style.gap = '4px';

    // Show sender name in group chat (with per-user colour)
    if (activeFriend && activeFriend.isGroup && !isOut) {
        const senderName = (msg.profiles && msg.profiles.username) ? msg.profiles.username : 'Group Member';
        const senderNode = document.createElement('span');
        senderNode.style.fontSize = '12px';
        senderNode.style.fontWeight = '700';
        senderNode.style.color = getSenderColor(senderName);
        senderNode.style.marginBottom = '2px';
        senderNode.style.letterSpacing = '0.3px';
        senderNode.textContent = senderName;
        contentDiv.appendChild(senderNode);
    }

    if (msg.image_url) {
        const img = document.createElement('img');
        img.src = msg.image_url;
        img.style.maxWidth = '100%';
        img.style.maxHeight = '300px';
        img.style.objectFit = 'contain';
        img.style.borderRadius = '4px';
        contentDiv.appendChild(img);
    }

    if (msg.message && !msg.deleted_at) {
        const textNode = document.createElement('span');
        textNode.className = 'message-content-text';
        textNode.textContent = msg.message;
        contentDiv.appendChild(textNode);
    } else if (msg.deleted_at) {
        const textNode = document.createElement('span');
        textNode.className = 'message-content-text';
        textNode.innerHTML = '<i>This message was deleted</i>';
        contentDiv.appendChild(textNode);
    }

    const timeInfo = new Date(msg.created_at);
    const timeStr = timeInfo.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const timeNode = document.createElement('span');
    timeNode.className = 'message-time';

    let deleteHtml = '';
    if (isOut && !msg.deleted_at && msg.id && !msg.id.startsWith('temp-')) {
        deleteHtml = `<button class="message-delete-btn" onclick="deleteMessage('${msg.id}')" title="Delete Message">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>`;
    }

    if (isOut) {
        const tickColor = msg.is_read ? '#ffffff' : '#8b949e';
        const ticksHtml = `<svg class="read-receipt" data-msg-id="${msg.id}" viewBox="0 0 24 24" width="16" height="16" stroke="${tickColor}" stroke-width="2" fill="none" style="margin-left: 4px; vertical-align: bottom;"><polyline points="18 6 11 15 7 11"></polyline><polyline points="22 6 15 15"></polyline></svg>`;
        timeNode.innerHTML = `${deleteHtml} ${timeStr} ${ticksHtml}`;
    } else {
        timeNode.textContent = timeStr;
    }

    div.appendChild(contentDiv);
    div.appendChild(timeNode);

    container.appendChild(div);
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    if (container) container.scrollTop = container.scrollHeight;
}

/**
 * Open and manage Group Settings modal
 */
window.setupGroupSettings = async function(group) {
    const modal = document.getElementById('groupSettingsModal');
    const closeBtn = document.getElementById('closeGroupSettingsModal');
    const avatarPreview = document.getElementById('groupSettingsAvatarPreview');
    const listEl = document.getElementById('groupSettingsMembersList');
    const errDiv = document.getElementById('groupSettingsError');
    const addMemberContainer = document.getElementById('groupSettingsAddMemberContainer');
    const selectEl = document.getElementById('groupSettingsAddMemberSelect');
    const addBtn = document.getElementById('groupSettingsAddMemberBtn');
    const fileInput = document.getElementById('groupAvatarInput');
    const leaveBtn = document.getElementById('leaveGroupBtn');
    
    // reset UI
    if (errDiv) errDiv.style.display = 'none';
    if (listEl) listEl.innerHTML = '<div style="text-align:center;color:var(--wa-text-light);">Loading...</div>';
    
    // Set avatar
    if (group.avatar_url) {
        avatarPreview.style.backgroundImage = `url('${group.avatar_url}')`;
        avatarPreview.style.backgroundSize = 'cover';
        avatarPreview.style.backgroundPosition = 'center';
        avatarPreview.textContent = '';
    } else {
        avatarPreview.style.backgroundImage = 'none';
        avatarPreview.textContent = 'G';
    }
    
    modal.style.display = 'flex';
    
    // Close listener
    const closeListener = () => {
        modal.style.display = 'none';
        closeBtn.removeEventListener('click', closeListener);
    };
    closeBtn.addEventListener('click', closeListener);
    
    const isAdmin = group.created_by === currentUser.id;
    addMemberContainer.style.display = isAdmin ? 'block' : 'none';
    
    // Load members
    const loadGroupMembers = async () => {
        try {
            const { data, error } = await supabaseClient
                .from('group_members')
                .select('user_id, profiles(*)')
                .eq('group_id', group.id);
                
            if (error) throw error;
            
            listEl.innerHTML = '';
            const memberIds = [];
            data.forEach(m => {
                const p = m.profiles;
                if (!p) return;
                memberIds.push(p.id);
                
                const div = document.createElement('div');
                div.style.display = 'flex';
                div.style.justifyContent = 'space-between';
                div.style.alignItems = 'center';
                
                let avatarHtml = `<div class="avatar" style="width: 32px; height: 32px; font-size: 14px;">` + p.username.charAt(0).toUpperCase() + `</div>`;
                if (p.avatar_url) {
                    avatarHtml = `<div class="avatar" style="width: 32px; height: 32px; font-size: 0; background-image: url('` + p.avatar_url + `'); background-size: cover; background-position: center;"></div>`;
                }
                
                let rmBtn = '';
                if (isAdmin && p.id !== currentUser.id) {
                    rmBtn = `<button class="action-btn" style="padding: 4px 8px; font-size: 11px; background: transparent; border: 1px solid #ff7b72; color: #ff7b72;" onclick="removeMember('` + group.id + `', '` + p.id + `')">Remove</button>`;
                }
                
                div.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        ` + avatarHtml + `
                        <span style="color: var(--wa-text-main);">` + p.username + (p.id === group.created_by ? ' <span style="font-size: 10px; color: var(--wa-green);">(Admin)</span>' : '') + `</span>
                    </div>
                    ` + rmBtn + `
                `;
                listEl.appendChild(div);
            });
            
            // Populate select for adding members
            if (isAdmin && typeof friendList !== 'undefined') {
                selectEl.innerHTML = '<option value="">Select a friend</option>';
                friendList.forEach(f => {
                    if (!memberIds.includes(f.id)) {
                        const opt = document.createElement('option');
                        opt.value = f.id;
                        opt.textContent = f.username;
                        selectEl.appendChild(opt);
                    }
                });
            }
        } catch (err) {
            console.error(err);
            listEl.innerHTML = '<div style="color: red;">Error loading members.</div>';
        }
    };
    
    await loadGroupMembers();
    
    // Add Member setup
    addBtn.onclick = async () => {
        const uid = selectEl.value;
        if (!uid) return;
        addBtn.disabled = true;
        try {
            const { error } = await supabaseClient.from('group_members').insert([{ group_id: group.id, user_id: uid }]);
            if (error) throw error;
            await loadGroupMembers();
        } catch (err) {
            console.error(err);
            alert('Failed to add member.');
        } finally {
            addBtn.disabled = false;
        }
    };
    
    // Leave Group setup
    leaveBtn.onclick = async () => {
        if (!confirm('Are you sure you want to leave this group?')) return;
        try {
            const { error } = await supabaseClient.from('group_members').delete().eq('group_id', group.id).eq('user_id', currentUser.id);
            if (error) throw error;
            closeListener();
            window.closeChat();
            if (typeof loadFriends === 'function') loadFriends(); 
        } catch (err) {
            console.error(err);
            alert('Failed to leave group.');
        }
    };
    
    // Upload Avatar setup
    fileInput.onchange = async (e) => {
        if (!isAdmin) {
            alert('Only admins can change the group picture.');
            return;
        }
        errDiv.style.display = 'none';
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = group.id + "/" + Date.now() + "." + fileExt;
            
            const { error: uploadError } = await supabaseClient.storage.from('group-avatars').upload(fileName, file);
            if (uploadError) throw uploadError;
            
            const { data } = supabaseClient.storage.from('group-avatars').getPublicUrl(fileName);
            const avatarUrl = data.publicUrl;
            
            const { error: updateErr } = await supabaseClient.from('groups').update({ avatar_url: avatarUrl }).eq('id', group.id);
            if (updateErr) throw updateErr;
            
            // update UI globally
            group.avatar_url = avatarUrl;
            document.getElementById('currentChatAvatar').style.backgroundImage = `url('${avatarUrl}')`;
            avatarPreview.style.backgroundImage = `url('${avatarUrl}')`;
            avatarPreview.textContent = '';
            
            if (typeof loadFriends === 'function') loadFriends();
        } catch (err) {
            console.error(err);
            errDiv.textContent = 'Failed to update picture: ' + err.message;
            errDiv.style.display = 'block';
        }
    };
};

window.removeMember = async function(groupId, userId) {
    if (!confirm('Remove member from group?')) return;
    try {
        const { error } = await supabaseClient.from('group_members').delete().eq('group_id', groupId).eq('user_id', userId);
        if (error) throw error;
        // re-open settings or trigger reload via some event
        alert('Member removed. Please reopen settings to refresh list.');
    } catch (err) {
        console.error(err);
        alert('Failed to remove member.');
    }
};
