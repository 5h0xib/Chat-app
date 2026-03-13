// js/chat.js

let activeFriend = null;
let messagesSubscription = null;

// Ensure this only runs on chat interface
document.addEventListener('DOMContentLoaded', () => {
    const isChatPage = window.location.pathname.toLowerCase().endsWith('chat.html');

    if (!isChatPage) return;

    const messageForm = document.getElementById('messageForm');
    if (messageForm) {
        messageForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await sendMessage();
        });
    }

    // Request notification permission if not asked
    if (typeof requestNotificationPermission === 'function') {
        requestNotificationPermission();
    }
});

/**
 * Open chat with a specific friend
 */
window.openChat = async function (friend) {
    activeFriend = friend;

    // Update UI
    document.getElementById('emptyChat').style.display = 'none';
    document.getElementById('activeChat').style.display = 'flex';

    document.getElementById('currentChatName').textContent = friend.username;
    document.getElementById('currentChatAvatar').textContent = friend.username.charAt(0).toUpperCase();

    // Clear current messages
    document.getElementById('messagesContainer').innerHTML = '<div class="loading-text">Loading messages...</div>';

    // Load existing messages
    await loadMessages();

    // Subscribe to new messages
    subscribeToMessages();
};

/**
 * Close chat (useful for mobile)
 */
window.closeChat = function () {
    activeFriend = null;
    document.getElementById('emptyChat').style.display = 'flex';
    document.getElementById('activeChat').style.display = 'none';

    if (messagesSubscription) {
        supabaseClient.removeChannel(messagesSubscription);
        messagesSubscription = null;
    }
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
            .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeFriend.id}),and(sender_id.eq.${activeFriend.id},receiver_id.eq.${currentUser.id})`)
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
    } catch (err) {
        console.error('Error loading messages:', err.message);
        container.innerHTML = '<div class="loading-text" style="color:red">Error loading messages</div>';
    }
}

/**
 * Send a message
 */
async function sendMessage() {
    if (!activeFriend || !currentUser) return;

    const input = document.getElementById('messageInput');
    const text = input.value.trim();

    if (!text) return;

    input.value = '';

    // Optimistic UI updates
    const tempId = 'temp-' + Date.now();
    const tempMsg = {
        id: tempId,
        sender_id: currentUser.id,
        receiver_id: activeFriend.id,
        message: text,
        created_at: new Date().toISOString()
    };

    appendMessage(tempMsg);
    scrollToBottom();

    try {
        const { error } = await supabaseClient
            .from('messages')
            .insert([
                { sender_id: currentUser.id, receiver_id: activeFriend.id, message: text }
            ]);

        if (error) throw error;

        // Success: Let realtime handle exact duplicates, or leave optimistic one.

    } catch (err) {
        console.error('Error sending message:', err.message);
        const failDiv = document.querySelector(`[data-id="${tempMsg.id}"]`);
        if (failDiv) {
            const timeEl = failDiv.querySelector('.message-time');
            if (timeEl) {
                timeEl.textContent += ' (Failed)';
                timeEl.style.color = 'red';
            }
        }
    }
}

/**
 * Subscribe to realtime messages
 */
function subscribeToMessages() {
    if (!currentUser) return;

    if (messagesSubscription) {
        supabaseClient.removeChannel(messagesSubscription);
    }

    messagesSubscription = supabaseClient.channel('public:messages')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages'
        }, payload => {
            const newMsg = payload.new;

            // Check if message is for/from the current chat
            const isForCurrentChat = activeFriend && (
                (newMsg.sender_id === currentUser.id && newMsg.receiver_id === activeFriend.id) ||
                (newMsg.sender_id === activeFriend.id && newMsg.receiver_id === currentUser.id)
            );

            if (isForCurrentChat) {
                // To avoid duplicate visual for sender (optimistic vs realtime)
                if (newMsg.sender_id !== currentUser.id) {
                    // Only append if from the other person
                    // As we optimistically appended our own
                    appendMessage(newMsg);
                    scrollToBottom();
                }
            }

            // Notifications for any incoming message
            if (newMsg.receiver_id === currentUser.id) {
                if (typeof showNotification === 'function') {
                    // Determine sender name
                    const sender = friendList.find(f => f.id === newMsg.sender_id);
                    const senderName = sender ? sender.username : 'Someone';

                    // Always trigger if tab is not focused, or if message is from someone else not currently active
                    if (document.visibilityState !== 'visible' || (!activeFriend || activeFriend.id !== newMsg.sender_id)) {
                        showNotification(senderName, newMsg.message);
                    }
                }
            }

        })
        .subscribe();
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

    const timeInfo = new Date(msg.created_at);
    const timeStr = timeInfo.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const textNode = document.createTextNode(msg.message);
    const timeNode = document.createElement('span');
    timeNode.className = 'message-time';
    timeNode.textContent = timeStr;

    div.appendChild(textNode);
    div.appendChild(timeNode);

    container.appendChild(div);
}

function scrollToBottom() {
    const container = document.getElementById('messagesContainer');
    container.scrollTop = container.scrollHeight;
}
