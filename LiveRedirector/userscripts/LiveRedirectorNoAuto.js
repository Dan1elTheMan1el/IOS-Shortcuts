// ==UserScript==
// @name         LiveRedirectorNoAuto
// @namespace    https://github.com/Dan1elTheMan1el/LiveRedirect
// @description  Redirect specific URLs to LiveContainer
// @author       DanielTheManiel
// @version      2.0
// MATCHES HERE (MANAGED BY SHORTCUT)
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // MAP HERE (MANAGED BY SHORTCUT)
    const matchMap = {};

    function matchesPattern(pattern, hostname, pathname) {
        if (!pattern) return false;
        // Normalize and strip protocol leading slashes
        const p = pattern.trim().replace(/^https?:\/\//i, '').replace(/^\/+/, '');
        const slashIndex = p.indexOf('/');
        const domain = slashIndex === -1 ? p : p.slice(0, slashIndex);
        const path = slashIndex === -1 ? '' : p.slice(slashIndex + 1);

        // Host matches if equal or subdomain
        const hostMatch = (hostname === domain) || hostname.endsWith('.' + domain);
        if (!hostMatch) return false;

        if (!path) return true; // no path specified => domain match is enough

        const normalizedPath = '/' + path.replace(/^\/+/, '');
        return pathname.startsWith(normalizedPath);
    }

    // Determine LiveContainerNumber based on provided mapping (default 1)
    let LiveContainerNumber = 1;
    try {
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;
        for (const [pattern, num] of Object.entries(matchMap)) {
            if (matchesPattern(pattern, hostname, pathname)) {
                const n = parseInt(num, 10);
                if (n >= 1 && n <= 3) {
                    LiveContainerNumber = n;
                }
                break;
            }
        }
    } catch (e) {
        console.warn('LiveRedirector: error determining LiveContainerNumber', e);
    }

    // Function to redirect to LiveContainer
    function redirectToLiveContainer() {
        const currentUrl = window.location.href;
        const encodedUrl = btoa(currentUrl);
        const liveContainerUrl = `livecontainer${LiveContainerNumber > 1 ? LiveContainerNumber : ''}://open-web-page?url=${encodedUrl}`;
        window.location.href = liveContainerUrl;
    }

    // Add a floating, draggable button to trigger the redirect
    const button = document.createElement('button');

    // Add an icon to the button
    const icon = document.createElement('img');
    icon.src = `https://github.com/Dan1elTheMan1el/IOS-Shortcuts/raw/main/LiveRedirector/icons/livecontainer${LiveContainerNumber}.png`;
    icon.alt = 'LiveContainer Icon';
    icon.style.width = '28px';
    icon.style.height = '28px';
    icon.style.marginRight = '8px';
    icon.style.borderRadius = '6px';

    button.appendChild(icon);
    button.appendChild(document.createTextNode('Open'));

    button.style.position = 'fixed';
    button.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + 24px)';
    button.style.right = '16px';
    button.style.zIndex = '2147483647';
    button.style.padding = '8px 16px 8px 8px';
    button.style.background = LiveContainerNumber === 1 ? '#007aff' : '#acacacff';
    button.style.color = LiveContainerNumber === 1 ? '#fff' : '#000';
    button.style.border = 'none';
    button.style.borderRadius = '8px';
    button.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    button.style.cursor = 'grab';
    button.style.fontSize = '16px';
    button.style.userSelect = 'none';
    button.style.webkitUserSelect = 'none';
    button.style.webkitTouchCallout = 'none';
    button.style.touchAction = 'none';
    button.style.webkitTapHighlightColor = 'rgba(0,0,0,0)';
    button.style.display = 'flex';
    button.style.alignItems = 'center';

    // iOS touch-only drag/tap logic
    let isDragging = false, moved = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    const TAP_THRESHOLD_PX = 6;

    button.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        const t = e.touches[0];
        const rect = button.getBoundingClientRect();
        startX = t.clientX;
        startY = t.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        isDragging = true;
        moved = false;
        // Switch to left/top while keeping fixed positioning
        button.style.left = rect.left + 'px';
        button.style.top = rect.top + 'px';
        button.style.right = '';
        button.style.bottom = '';
        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging || !e.touches || e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.abs(dx) > TAP_THRESHOLD_PX || Math.abs(dy) > TAP_THRESHOLD_PX) moved = true;
        button.style.left = (startLeft + dx) + 'px';
        button.style.top = (startTop + dy) + 'px';
        e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;
        // Treat as tap if not moved significantly
        if (!moved) {
            redirectToLiveContainer();
        }
    });

    // Optional click handler (desktop or iPad with mouse)
    button.addEventListener('click', redirectToLiveContainer);

    document.body.appendChild(button);
})();