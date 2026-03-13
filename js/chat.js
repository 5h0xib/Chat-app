// js/chat.js

let activeFriend = null;
let messagesSubscription = null;
let currentImageAttachment = null;

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

        // Subscribe to globally incoming messages
        subscribeToMessages();
    }

    // Request notification permission if not asked
    // This was moved to openChat for user gesture
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

    document.getElementById('currentChatName').textContent = friend.username;
    document.getElementById('currentChatAvatar').textContent = friend.username.charAt(0).toUpperCase();

    // Clear current messages
    document.getElementById('messagesContainer').innerHTML = '<div class="loading-text">Loading messages...</div>';

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
        const { data, error } = await supabaseClient
            .from('messages')
            .select('*')
            .or(`and(sender_id.eq.${currentUser.id}, receiver_id.eq.${activeFriend.id}), and(sender_id.eq.${activeFriend.id}, receiver_id.eq.${currentUser.id})`)
            .order('created_at', { ascending: true });

        if (error) throw error;

        container.innerHTML = '';

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="loading-text">Start of conversation</div>';
            return;
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

            const { error: uploadError } = await supabaseClient.storage
                .from('chat-images')
                .upload(fileName, file);

            if (uploadError) throw uploadError;

            const { data } = supabaseClient.storage
                .from('chat-images')
                .getPublicUrl(fileName);

            imageUrl = data.publicUrl;

            // Clear attachment UI
            clearImageAttachment();
        }

        const newMsg = {
            sender_id: currentUser.id,
            receiver_id: activeFriend.id,
            message: text || null, // null if only image
            image_url: imageUrl,
            is_read: false
        };

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
    if (!currentUser) return;
    if (messagesSubscription) return;

    messagesSubscription = supabaseClient.channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            const newMsg = payload.new;

            // Is it relevant to us?
            if (newMsg.receiver_id === currentUser.id || newMsg.sender_id === currentUser.id) {

                // If it's part of the currently open chat
                const isForCurrentChat = activeFriend && (
                    (newMsg.sender_id === currentUser.id && newMsg.receiver_id === activeFriend.id) ||
                    (newMsg.sender_id === activeFriend.id && newMsg.receiver_id === currentUser.id)
                );

                if (isForCurrentChat) {
                    if (newMsg.sender_id === currentUser.id) {
                        // Our own message just arrived (realtime confirm)
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
                        // Other person sent a message in the active chat
                        appendMessage(newMsg);
                        scrollToBottom();

                        // We tell the server it's read immediately
                        supabaseClient.from('messages').update({ is_read: true }).eq('id', newMsg.id).then();
                    }
                } else {
                    // Message is NOT for the active chat.
                    // If we received it, increment the badge
                    if (newMsg.receiver_id === currentUser.id) {
                        const badgeInfo = document.getElementById(`badge-${newMsg.sender_id}`);
                        if (badgeInfo) {
                            const count = parseInt(badgeInfo.textContent || '0') + 1;
                            badgeInfo.textContent = count;
                            badgeInfo.style.display = 'inline-block';
                        }
                    }
                }

                // Notifications for any incoming message
                if (newMsg.receiver_id === currentUser.id) {
                    if (typeof showNotification === 'function') {
                        const sender = friendList.find(f => f.id === newMsg.sender_id);
                        const senderName = sender ? sender.username : 'Someone';
                        if (document.visibilityState !== 'visible' || (!activeFriend || activeFriend.id !== newMsg.sender_id)) {
                            showNotification(senderName, newMsg.message || 'Image attached');
                        }
                    }
                }
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
            const updatedMsg = payload.new;
            // Update the tick color if it's currently rendered
            const msgEl = document.querySelector(`[data-id="${updatedMsg.id}"]`);
            if (msgEl && updatedMsg.is_read) {
                const tickSvg = msgEl.querySelector('.read-receipt');
                if (tickSvg) {
                    tickSvg.setAttribute('stroke', '#ffffff');
                }
            }
        })
        .subscribe();
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
    contentDiv.style.gap = '8px';

    if (msg.image_url) {
        const img = document.createElement('img');
        img.src = msg.image_url;
        img.style.maxWidth = '100%';
        img.style.maxHeight = '300px';
        img.style.objectFit = 'contain';
        img.style.borderRadius = '4px';
        contentDiv.appendChild(img);
    }

    if (msg.message) {
        const textNode = document.createTextNode(msg.message);
        contentDiv.appendChild(textNode);
    }

    const timeInfo = new Date(msg.created_at);
    const timeStr = timeInfo.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const timeNode = document.createElement('span');
    timeNode.className = 'message-time';

    if (isOut) {
        const tickColor = msg.is_read ? '#ffffff' : '#8b949e';
        const ticksHtml = `<svg class="read-receipt" data-msg-id="${msg.id}" viewBox="0 0 24 24" width="16" height="16" stroke="${tickColor}" stroke-width="2" fill="none" style="margin-left: 4px; vertical-align: bottom;"><polyline points="18 6 11 15 7 11"></polyline><polyline points="22 6 15 15"></polyline></svg>`;
        timeNode.innerHTML = `${timeStr} ${ticksHtml}`;
    } else {
        timeNode.textContent = timeStr;
    }

    div.appendChild(contentDiv);
    div.appendChild(timeNode);

    container.appendChild(div);
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}
