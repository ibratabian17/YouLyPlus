// ==========================================================================
// UI Utilities - Shared UI interactions, ripple, snackbar, and form bindings
// ==========================================================================

import { updateSettings, saveSettings } from './settingsManager.js';

/**
 * Initialize Material 3 ripple effect on interactive elements.
 */
export function initRipple() {
    if (typeof document === 'undefined') return;

    document.addEventListener('click', function (e) {
        const target = e.target.closest('.m3-button, .nav-item, .draggable-source-item, .tab');
        if (!target) return;

        const ripple = document.createElement('span');
        const rect = target.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;

        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        ripple.classList.add('ripple');

        const existingRipple = target.querySelector('.ripple');
        if (existingRipple) {
            existingRipple.remove();
        }

        target.appendChild(ripple);

        ripple.addEventListener('animationend', () => {
            ripple.remove();
        });
    });
}

/**
 * Initialize accessible switch keyboard and click interactions for .m3-switch containers.
 */
export function initSwitches() {
    if (typeof document === 'undefined') return;

    document.querySelectorAll('.m3-switch').forEach(switchContainer => {
        // Only attach to non-label containers or ensure clean toggle
        if (switchContainer.tagName.toLowerCase() !== 'label') {
            switchContainer.addEventListener('click', function (e) {
                if (e.target.tagName.toLowerCase() === 'input') return;
                const checkbox = this.querySelector('input[type="checkbox"], .m3-switch-input');
                if (checkbox) {
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                }
            });
            switchContainer.addEventListener('keydown', function (event) {
                if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault();
                    const checkbox = this.querySelector('input[type="checkbox"], .m3-switch-input');
                    if (checkbox) {
                        checkbox.checked = !checkbox.checked;
                        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            });
            if (!switchContainer.hasAttribute('tabindex')) {
                switchContainer.setAttribute('tabindex', '0');
            }
        }
    });
}

let snackbarTimeout = null;

/**
 * Display a floating Material 3 snackbar notification.
 * @param {string} message 
 * @param {boolean|object} options - If boolean, represents isError. If object: { isError, duration, snackbarId }
 */
export function showSnackbar(message, options = {}) {
    if (typeof document === 'undefined') return;

    const isError = typeof options === 'boolean' ? options : !!options.isError;
    const duration = (typeof options === 'object' && options.duration) || 3500;
    const snackbarId = (typeof options === 'object' && options.snackbarId) || 'statusSnackbar';

    let snackbar = document.getElementById(snackbarId);
    if (!snackbar) {
        snackbar = document.querySelector('.m3-snackbar');
    }
    if (!snackbar) return;

    let snackbarText = snackbar.querySelector('.snackbar-text');
    if (!snackbarText) {
        snackbarText = snackbar;
    }

    if (snackbarTimeout) clearTimeout(snackbarTimeout);

    snackbarText.textContent = message;
    snackbar.style.backgroundColor = isError ? 'var(--md-sys-color-error-container)' : 'var(--md-sys-color-inverse-surface)';
    snackbar.style.color = isError ? 'var(--md-sys-color-on-error-container)' : 'var(--md-sys-color-inverse-on-surface)';

    snackbar.classList.add('show');
    snackbarTimeout = setTimeout(() => {
        snackbar.classList.remove('show');
    }, duration);
}

/**
 * SVG icon creation helper.
 * @param {string} pathD 
 * @returns {SVGElement}
 */
export function createSvgIcon(pathD) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon-svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
}

/**
 * Swap path in an existing SVG element.
 * @param {SVGElement} svgEl 
 * @param {string} newPathD 
 */
export function swapSvgIconPath(svgEl, newPathD) {
    if (!svgEl) return;
    const path = svgEl.querySelector('path');
    if (path) path.setAttribute('d', newPathD);
}

/**
 * Debounce helper function.
 * @param {Function} func 
 * @param {number} wait 
 * @returns {Function}
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Bind auto-save listeners to form inputs based on a configuration array.
 * @param {Array<{id: string, key: string, type: string, debounce?: number}>} controls 
 * @param {Function} onSaveCallback 
 */
export function bindAutoSave(controls, onSaveCallback) {
    if (typeof document === 'undefined') return;

    controls.forEach(control => {
        const element = document.getElementById(control.id);
        if (element) {
            const eventType = (control.type === 'checkbox' || element.tagName === 'SELECT') ? 'change' : 'input';
            const saveHandler = (e) => {
                const value = control.type === 'checkbox' ? e.target.checked : e.target.value;
                updateSettings({ [control.key]: value });
                saveSettings();
                if (onSaveCallback) {
                    onSaveCallback(control.key, value);
                }
            };

            if (control.debounce) {
                element.addEventListener(eventType, debounce(saveHandler, control.debounce));
            } else {
                element.addEventListener(eventType, saveHandler);
            }
        }
    });
}
