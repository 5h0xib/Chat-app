// js/friends.js

let currentUser = null;
let currentProfile = null;
let friendList = [];

// Initialize friends system
document.addEventListener('DOMContentLoaded', async () => {
    // Only proceed if on chat.html
    if (!window.location.pathname.endsWith('chat.html') && !window.location.pathname.includes('/Chat-app/') && window.location.pathname !== '/') return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return; // auth.js will redirect

    currentUser = session.user;

    await loadMyProfile();
    await loadFriendRequests();
    await loadFriends();

    setupSearch();
    setupMobileBackBtn();
});

/**
 * Load the current user's profile and display their info
 */
async function loadMyProfile() {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (error) {
            // Profile might not be created yet if just signed up
            console.warn('Profile not found yet');
            document.getElementById('myName').textContent = currentUser.email.split('@')[0];
            return;
        }

        currentProfile = data;
        document.getElementById('myName').textContent = data.username;
        document.getElementById('myAvatar').textContent = data.username.charAt(0).toUpperCase();
    } catch (err) {
        console.error('Error loading profile:', err.message);
    }
}

/**
 * Setup debounced search listener
 */
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    let timeout = null;

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            searchResults.style.display = 'none';
        }
    });

    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();

        clearTimeout(timeout);

        if (query.length < 2) {
            searchResults.style.display = 'none';
            return;
        }

        timeout = setTimeout(() => {
            searchUsers(query);
        }, 500); // 500ms debounce
    });

    // Show results again when focusing input if it has text
    searchInput.addEventListener('focus', (e) => {
        if (e.target.value.trim().length >= 2 && searchResults.innerHTML !== '') {
            searchResults.style.display = 'block';
        }
    });
}

/**
 * Search users by username or email
 */
async function searchUsers(query) {
    const searchResults = document.getElementById('searchResults');

    try {
        // Search profiles where username or email matches query, excluding self
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .not('id', 'eq', currentUser.id)
            .or(`username.ilike.%${query}%,email.ilike.%${query}%`)
            .limit(10);

        if (error) throw error;

        searchResults.innerHTML = '';

        if (data.length === 0) {
            searchResults.innerHTML = '<div class="user-item"><div class="user-info"><span class="user-name">No users found</span></div></div>';
        } else {
            data.forEach(user => {
                const isFriend = friendList.some(f => f.id === user.id);

                const item = document.createElement('div');
                item.className = 'user-item';

                // Avatar
                const avatar = document.createElement('div');
                avatar.className = 'avatar';
                avatar.textContent = user.username.charAt(0).toUpperCase();
                avatar.style.width = '35px';
                avatar.style.height = '35px';
                avatar.style.fontSize = '14px';

                // Info
                const info = document.createElement('div');
                info.className = 'user-info';

                const name = document.createElement('span');
                name.className = 'user-name';
                name.textContent = user.username;

                const email = document.createElement('span');
                email.className = 'user-email';
                email.textContent = user.email;

                info.appendChild(name);
                info.appendChild(email);

                item.appendChild(avatar);
                item.appendChild(info);

                // Action button
                if (isFriend) {
                    const status = document.createElement('span');
                    status.style.fontSize = '12px';
                    status.style.color = 'var(--wa-teal)';
                    status.style.marginLeft = 'auto';
                    status.textContent = 'Friend';
                    item.appendChild(status);
                } else {
                    const addBtn = document.createElement('button');
                    addBtn.className = 'action-btn';
                    addBtn.textContent = 'Add Friend';
                    addBtn.onclick = (e) => {
                        e.stopPropagation();
                        sendFriendRequest(user.id, addBtn);
                    };
                    item.appendChild(addBtn);
                }

                searchResults.appendChild(item);
            });
        }

        searchResults.style.display = 'block';
    } catch (err) {
        console.error('Search error:', err.message);
        searchResults.innerHTML = `<div class="user-item"><div class="user-info"><span class="user-email" style="color:red">Error searching</span></div></div>`;
        searchResults.style.display = 'block';
    }
}

/**
 * Send a friend request
 */
async function sendFriendRequest(receiverId, btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = 'Sending...';

    try {
        // Check if request already exists
        const { data: existing, error: checkError } = await supabase
            .from('friend_requests')
            .select('*')
            .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${currentUser.id})`);

        if (checkError) throw checkError;

        if (existing && existing.length > 0) {
            btnElement.textContent = 'Already exists';
            return;
        }

        const { error } = await supabase
            .from('friend_requests')
            .insert([
                { sender_id: currentUser.id, receiver_id: receiverId, status: 'pending' }
            ]);

        if (error) throw error;

        btnElement.textContent = 'Sent!';
        btnElement.style.backgroundColor = 'var(--wa-text-light)';
    } catch (err) {
        console.error('Error sending request:', err.message);
        btnElement.textContent = 'Error';
        btnElement.disabled = false;
    }
}

/**
 * Load incoming friend requests
 */
async function loadFriendRequests() {
    const panel = document.getElementById('friendRequestsPanel');
    const list = document.getElementById('requestsList');

    try {
        const { data, error } = await supabase
            .from('friend_requests')
            .select('*, sender:profiles!friend_requests_sender_id_fkey(*)')
            .eq('receiver_id', currentUser.id)
            .eq('status', 'pending');

        if (error) throw error;

        if (!data || data.length === 0) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'block';
        list.innerHTML = '';

        data.forEach(request => {
            const sender = request.sender;
            if (!sender) return; // safety check

            const li = document.createElement('li');
            li.className = 'user-item';

            li.innerHTML = `
                <div class="avatar" style="width: 35px; height: 35px; font-size: 14px;">${sender.username.charAt(0).toUpperCase()}</div>
                <div class="user-info">
                    <span class="user-name">${sender.username}</span>
                </div>
                <button class="action-btn" onclick="acceptRequest('${request.id}', '${sender.id}')">Accept</button>
                <button class="action-btn reject" onclick="rejectRequest('${request.id}')">Reject</button>
            `;

            list.appendChild(li);
        });

    } catch (err) {
        console.error('Error loading requests:', err.message);
    }
}

/**
 * Accept a friend request
 */
window.acceptRequest = async function (requestId, senderId) {
    try {
        // 1. Update request status
        const { error: updateError } = await supabase
            .from('friend_requests')
            .update({ status: 'accepted' })
            .eq('id', requestId);

        if (updateError) throw updateError;

        // 2. Insert into friends table
        const { error: insertError } = await supabase
            .from('friends')
            .insert([
                { user1_id: senderId, user2_id: currentUser.id }
            ]);

        // Ignore unique constraint error if they somehow are already friends
        if (insertError && !insertError.message.includes('unique constraint')) {
            throw insertError;
        }

        // 3. Reload UI
        await loadFriendRequests();
        await loadFriends();

    } catch (err) {
        console.error('Error accepting request:', err.message);
        alert('Error accepting request');
    }
};

/**
 * Reject a friend request
 */
window.rejectRequest = async function (requestId) {
    try {
        const { error } = await supabase
            .from('friend_requests')
            .update({ status: 'rejected' })
            .eq('id', requestId);

        if (error) throw error;

        await loadFriendRequests();
    } catch (err) {
        console.error('Error rejecting request:', err.message);
    }
};

/**
 * Load the user's friend list
 */
async function loadFriends() {
    const list = document.getElementById('friendsList');

    try {
        // Fetch friendships
        const { data, error } = await supabase
            .from('friends')
            .select(`
                user1_id,
                user2_id,
                user1:profiles!friends_user1_id_fkey(*),
                user2:profiles!friends_user2_id_fkey(*)
            `)
            .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`);

        if (error) throw error;

        list.innerHTML = '';
        friendList = [];

        if (!data || data.length === 0) {
            list.innerHTML = '<div class="empty-state-content" style="padding: 20px;"><p>No friends yet. Search for users to add them!</p></div>';
            return;
        }

        data.forEach(friendship => {
            // Determine which user is the friend (not current user)
            const friend = friendship.user1_id === currentUser.id ? friendship.user2 : friendship.user1;
            if (!friend) return;

            friendList.push(friend);

            const item = document.createElement('div');
            item.className = 'user-item';
            item.dataset.id = friend.id;

            item.innerHTML = `
                <div class="avatar">${friend.username.charAt(0).toUpperCase()}</div>
                <div class="user-info">
                    <span class="user-name">${friend.username}</span>
                    <span class="user-email">Tap to chat</span>
                </div>
            `;

            item.addEventListener('click', () => {
                // Remove active class from all
                document.querySelectorAll('.friends-list .user-item').forEach(el => el.classList.remove('active'));
                item.classList.add('active');

                // If on mobile, slide to chat area
                if (window.innerWidth <= 768) {
                    document.getElementById('chatArea').classList.add('active');
                }

                // Open chat (function in chat.js)
                if (typeof openChat === 'function') {
                    openChat(friend);
                }
            });

            list.appendChild(item);
        });

    } catch (err) {
        console.error('Error loading friends:', err.message);
        list.innerHTML = '<div class="loading-text" style="color:red">Error loading friends</div>';
    }
}

/**
 * Handle mobile back button from chat view
 */
function setupMobileBackBtn() {
    const backBtn = document.getElementById('backBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            document.getElementById('chatArea').classList.remove('active');
            // Remove active state from list items
            document.querySelectorAll('.friends-list .user-item').forEach(el => el.classList.remove('active'));
            // Optionally close chat
            if (typeof closeChat === 'function') {
                closeChat();
            }
        });
    }
}
