// js/friends.js

let currentUser = null;
let currentProfile = null;
let friendList = [];

// Initialize friends system
document.addEventListener('DOMContentLoaded', async () => {
    const isChatPage = window.location.pathname.toLowerCase().endsWith('chat.html');

    // Only proceed if on chat.html
    if (!isChatPage) return;

    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error || !session) return;

        currentUser = session.user;

        await loadMyProfile();
        await loadFriendRequests();
        await loadFriends();

        setupSearch();
        setupMobileBackBtn();
        setupProfileSettings();
    } catch (err) {
        console.error('Error initializing friends:', err.message);
    }
});

/**
 * Load the current user's profile and display their info
 */
async function loadMyProfile() {
    try {
        const { data, error } = await supabaseClient
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

        // Show avatar image if exists, else initials
        const avatarEl = document.getElementById('myAvatar');
        if (data.avatar_url) {
            avatarEl.style.backgroundImage = `url('${data.avatar_url}')`;
            avatarEl.textContent = '';
        } else {
            avatarEl.style.backgroundImage = 'none';
            avatarEl.textContent = data.username.charAt(0).toUpperCase();
        }
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
        const { data, error } = await supabaseClient
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
        const { data: existing, error: checkError } = await supabaseClient
            .from('friend_requests')
            .select('*')
            .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${currentUser.id})`);

        if (checkError) throw checkError;

        if (existing && existing.length > 0) {
            btnElement.textContent = 'Already exists';
            return;
        }

        const { error } = await supabaseClient
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
        const { data, error } = await supabaseClient
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
        const { error: updateError } = await supabaseClient
            .from('friend_requests')
            .update({ status: 'accepted' })
            .eq('id', requestId);

        if (updateError) throw updateError;

        // 2. Insert into friends table
        const { error: insertError } = await supabaseClient
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
        const { error } = await supabaseClient
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
        const { data, error } = await supabaseClient
            .from('friends')
            .select(`
                user1_id,
                user2_id,
                user1:profiles!friends_user1_id_fkey(*),
                user2:profiles!friends_user2_id_fkey(*)
            `)
            .or(`user1_id.eq.${currentUser.id},user2_id.eq.${currentUser.id}`);

        if (error) throw error;

        // Fetch unread messages count
        const { data: unreadMsgData, error: unreadErr } = await supabaseClient
            .from('messages')
            .select('sender_id')
            .eq('receiver_id', currentUser.id)
            .eq('is_read', false);

        const unreadCounts = {};
        if (!unreadErr && unreadMsgData) {
            unreadMsgData.forEach(msg => {
                unreadCounts[msg.sender_id] = (unreadCounts[msg.sender_id] || 0) + 1;
            });
        }

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

            const unreadCount = unreadCounts[friend.id] || 0;
            const badgeDisplay = unreadCount > 0 ? 'inline-block' : 'none';
            const badgeHtml = `<span class="unread-badge" id="badge-${friend.id}" style="display: ${badgeDisplay}; background-color: var(--wa-green); color: white; border-radius: 50%; padding: 2px 6px; font-size: 11px; float: right;">${unreadCount}</span>`;

            let avatarHtml = `<div class="avatar">${friend.username.charAt(0).toUpperCase()}</div>`;
            if (friend.avatar_url) {
                avatarHtml = `<div class="avatar" style="background-image: url('${friend.avatar_url}'); font-size: 0; background-position: center;"></div>`;
            }

            item.innerHTML = `
                ${avatarHtml}
                <div class="user-info">
                    <span class="user-name">${friend.username} ${badgeHtml}</span>
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

/**
 * Handle Profile Settings Modal
 */
function setupProfileSettings() {
    const btn = document.getElementById('profileSettingsBtn');
    const modal = document.getElementById('profileModal');
    const closeBtn = document.getElementById('closeProfileBtn');
    const form = document.getElementById('profileForm');
    const avatarInput = document.getElementById('avatarInput');
    const preview = document.getElementById('modalAvatarPreview');

    if (!btn || !modal) return;

    // Open Modal
    btn.addEventListener('click', () => {
        document.getElementById('editUsername').value = currentProfile?.username || '';

        // Setup preview
        if (currentProfile?.avatar_url) {
            preview.style.backgroundImage = `url('${currentProfile.avatar_url}')`;
            preview.style.backgroundSize = 'cover';
            preview.style.backgroundPosition = 'center';
            preview.textContent = '';
        } else {
            preview.style.backgroundImage = 'none';
            preview.textContent = currentProfile?.username ? currentProfile.username.charAt(0).toUpperCase() : '?';
        }

        modal.style.display = 'flex';
    });

    // Close Modal
    closeBtn.addEventListener('click', () => {
        modal.style.display = 'none';
        avatarInput.value = ''; // clear file
    });

    // Handle Avatar Preview
    avatarInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                preview.style.backgroundImage = `url('${e.target.result}')`;
                preview.style.backgroundSize = 'cover';
                preview.style.backgroundPosition = 'center';
                preview.textContent = '';
            };
            reader.readAsDataURL(file);
        }
    });

    // Save Changes
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const saveBtn = document.getElementById('saveProfileBtn');
        const errDiv = document.getElementById('profileError');
        const sucDiv = document.getElementById('profileSuccess');
        const newName = document.getElementById('editUsername').value.trim();
        const file = avatarInput.files[0];

        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        errDiv.style.display = 'none';
        sucDiv.style.display = 'none';

        try {
            let avatarUrl = currentProfile?.avatar_url;

            // 1. Upload new image if selected
            if (file) {
                // Ensure 1:1 ratio hint (client side check is optional but good, here we just enforce image type)
                if (!file.type.startsWith('image/')) {
                    throw new Error('Please select a valid image file');
                }

                // Max size 5MB
                if (file.size > 5 * 1024 * 1024) {
                    throw new Error('Image must be under 5MB');
                }

                const fileExt = file.name.split('.').pop();
                // Store in folder UserID/timestamp.ext
                const fileName = `${currentUser.id}/${Date.now()}.${fileExt}`;

                const { error: uploadError } = await supabaseClient.storage
                    .from('avatars')
                    .upload(fileName, file, { upsert: true });

                if (uploadError) throw uploadError;

                // Get public URL
                const { data: { publicUrl } } = supabaseClient.storage
                    .from('avatars')
                    .getPublicUrl(fileName);

                avatarUrl = publicUrl;
            }

            // 2. Update Profile Table
            const { error: updateError } = await supabaseClient
                .from('profiles')
                .update({
                    username: newName,
                    avatar_url: avatarUrl
                })
                .eq('id', currentUser.id);

            if (updateError) {
                // Check if username conflict
                if (updateError.message.includes('unique constraint')) {
                    throw new Error('Username is already taken');
                }
                throw updateError;
            }

            // 3. Update User Auth Metadata (optional but keeps them in sync)
            await supabaseClient.auth.updateUser({
                data: { username: newName }
            });

            // Success
            sucDiv.textContent = 'Profile updated successfully!';
            sucDiv.style.display = 'block';

            // Reload UI
            await loadMyProfile();

            // Close after 1.5s
            setTimeout(() => {
                modal.style.display = 'none';
                sucDiv.style.display = 'none';
                avatarInput.value = '';
            }, 1500);

        } catch (err) {
            errDiv.textContent = err.message;
            errDiv.style.display = 'block';
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
        }
    });
}
