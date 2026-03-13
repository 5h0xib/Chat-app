// js/auth.js

// Check auth state on page load and redirect
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data: { session }, error } = await supabaseClient.auth.getSession();
        if (error) throw error;

        const path = window.location.pathname.toLowerCase();
        const isLoginPage = path.endsWith('login.html');
        const isSignupPage = path.endsWith('signup.html');
        const isChatPage = path.endsWith('chat.html');

        // Auth guard
        if (session) {
            if (!isChatPage) {
                window.location.href = 'chat.html';
            }
        } else {
            if (!isLoginPage && !isSignupPage) {
                window.location.href = 'login.html';
            }
        }
    } catch (err) {
        console.error("Auth initialization error:", err);
        const path = window.location.pathname.toLowerCase();
        const isLoginPage = path.endsWith('login.html');
        const isSignupPage = path.endsWith('signup.html');

        // Show proper error if stuck on index page or try to fallback
        if (!isLoginPage && !isSignupPage) {
            const h3 = document.querySelector('h3');
            if (h3 && h3.textContent.includes('Loading')) {
                h3.textContent = 'Connection Error: Please run this app via a local server (e.g. npx serve) or check network.';
                h3.style.color = 'red';
            } else {
                window.location.href = 'login.html';
            }
        }
    }

    // Bind forms if they exist
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await login();
        });
    }

    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await signUp();
        });
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await logout();
        });
    }
});

/**
 * Handle user signup
 */
async function signUp() {
    const signupBtn = document.getElementById('signupBtn');
    const errorDiv = document.getElementById('signupError');
    const successDiv = document.getElementById('signupSuccess');

    // Get values
    const username = document.getElementById('username').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!username || !email || !password) {
        showError(errorDiv, 'Please fill in all fields.');
        return;
    }

    setLoading(signupBtn, true);
    errorDiv.style.display = 'none';
    successDiv.style.display = 'none';

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: {
                    username: username // Save username in metadata
                }
            }
        });

        if (error) throw error;

        successDiv.textContent = 'Signup successful! Please confirm your email before logging in, or log in if confirmation is turned off.';
        successDiv.style.display = 'block';
        document.getElementById('signupForm').reset();
    } catch (error) {
        showError(errorDiv, error.message);
    } finally {
        setLoading(signupBtn, false);
    }
}

/**
 * Handle user login
 */
async function login() {
    const loginBtn = document.getElementById('loginBtn');
    const errorDiv = document.getElementById('loginError');

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
        showError(errorDiv, 'Please fill in all fields.');
        return;
    }

    setLoading(loginBtn, true);
    errorDiv.style.display = 'none';

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        // After successful login, ensure profile exists
        if (data.user) {
            await createProfile(data.user);
        }

        window.location.href = 'chat.html';
    } catch (error) {
        showError(errorDiv, error.message);
    } finally {
        setLoading(loginBtn, false);
    }
}

/**
 * Handle user logout
 */
async function logout() {
    try {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw error;
        window.location.href = 'login.html';
    } catch (error) {
        console.error('Error logging out:', error.message);
        alert('Error logging out!');
    }
}

/**
 * Create user profile if it doesn't exist
 * Called after login since RLS prevents inserting before authentication
 */
async function createProfile(user) {
    try {
        // Check if profile exists
        const { data: existingProfile, error: fetchError } = await supabaseClient
            .from('profiles')
            .select('id')
            .eq('id', user.id)
            .single();

        // If not exists (or error because 0 rows returned), try inserting
        if (!existingProfile) {
            const username = user.user_metadata?.username || user.email.split('@')[0];

            const { error: insertError } = await supabaseClient
                .from('profiles')
                .insert([
                    {
                        id: user.id,
                        email: user.email,
                        username: username
                    }
                ]);

            if (insertError) {
                console.error('Error creating profile:', insertError.message);
            }
        }
    } catch (err) {
        console.error('Profile check error:', err.message);
    }
}

// Utility functions
function showError(element, message) {
    element.textContent = message;
    element.style.display = 'block';
}

function setLoading(button, isLoading) {
    if (isLoading) {
        button.dataset.originalText = button.textContent;
        button.textContent = 'Loading...';
        button.disabled = true;
    } else {
        button.textContent = button.dataset.originalText || 'Submit';
        button.disabled = false;
    }
}
