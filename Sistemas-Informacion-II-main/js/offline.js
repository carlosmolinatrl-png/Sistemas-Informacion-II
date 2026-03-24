const OFFLINE_STYLE_ID = "offline-status-style";
const OFFLINE_BANNER_ID = "offline-status-banner";

function ensureStyles() {
    if (document.getElementById(OFFLINE_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = OFFLINE_STYLE_ID;
    style.textContent = `
        #${OFFLINE_BANNER_ID} {
            position: fixed;
            top: 12px;
            right: 12px;
            z-index: 2000;
            padding: 0.45rem 0.8rem;
            border: 1px solid #c94c4c;
            background: rgba(8, 8, 8, 0.95);
            color: #f0ece4;
            font-family: 'DM Sans', sans-serif;
            font-size: 0.68rem;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            display: none;
        }
        #${OFFLINE_BANNER_ID}.visible {
            display: block;
        }
    `;

    document.head.appendChild(style);
}

function ensureBanner() {
    let banner = document.getElementById(OFFLINE_BANNER_ID);
    if (banner) return banner;

    banner = document.createElement("div");
    banner.id = OFFLINE_BANNER_ID;
    banner.textContent = "Sin conexion";
    document.body.appendChild(banner);
    return banner;
}

function renderStatus() {
    ensureStyles();
    const banner = ensureBanner();
    banner.classList.toggle("visible", !navigator.onLine);
}

export function isOnline() {
    return navigator.onLine;
}

export function initOfflineStatus(onChange) {
    const notify = () => {
        renderStatus();
        if (typeof onChange === "function") {
            onChange(navigator.onLine);
        }
    };

    notify();
    window.addEventListener("online", notify);
    window.addEventListener("offline", notify);

    return () => {
        window.removeEventListener("online", notify);
        window.removeEventListener("offline", notify);
    };
}