// js/notifications.js

let hasNotificationPermission = false;

document.addEventListener('DOMContentLoaded', () => {
    // Check current permission
    if ('Notification' in window) {
        hasNotificationPermission = Notification.permission === 'granted';
    }
});

/**
 * Request permission for notifications target
 */
window.requestNotificationPermission = async function () {
    if (!('Notification' in window)) {
        console.log('This browser does not support desktop notification');
        return;
    }

    if (Notification.permission !== 'denied' && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        hasNotificationPermission = permission === 'granted';
    }

    // Also request if it was default
    if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        hasNotificationPermission = permission === 'granted';
    }
};

/**
 * Show a browser notification natively
 */
window.showNotification = function (sender, messageBody) {
    // Only show if we have permission
    if (!hasNotificationPermission) return;

    const title = `New message from ${sender}`;
    const options = {
        body: messageBody,
        icon: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg', // Simple icon
        tag: 'chat-new-message'
    };

    try {
        const notification = new Notification(title, options);

        notification.onclick = function () {
            window.focus();
            this.close();
        };
    } catch (err) {
        console.error('Error showing notification:', err.message);
    }
};
