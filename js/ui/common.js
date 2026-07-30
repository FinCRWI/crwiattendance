/**
 * Common UI Components
 * Reusable UI patterns across different pages.
 */

import { normalizeTaskStatus } from '../utils/task-status.js';


/**
 * Render star rating display (1-5 stars)
 * @param {number} rating - Rating value (1-5)
 * @param {boolean} showNumber - Whether to show numeric rating
 * @returns {string} - HTML for star rating
 */
export function renderStarRating(rating, showNumber = true) {
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    const fullStars = Math.floor(r);
    const hasHalfStar = (r - fullStars) >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    let html = '<div class="star-rating-display">';
    for (let i = 0; i < fullStars; i++) {
        html += '<i class="fa-solid fa-star star-filled"></i>';
    }
    if (hasHalfStar) {
        html += '<i class="fa-solid fa-star-half-stroke star-filled"></i>';
    }
    for (let i = 0; i < emptyStars; i++) {
        html += '<i class="fa-regular fa-star star-empty"></i>';
    }
    if (showNumber) {
        html += `<span class="star-rating-number">${r.toFixed(1)}</span>`;
    }
    html += '</div>';
    return html;
}

/**
 * Render task status badge with color coding
 * @param {string} status - Task status
 * @param {boolean} showIcon - Whether to show status icon
 * @returns {string} - HTML for status badge
 */
export function renderTaskStatusBadge(status, showIcon = true) {
    const s = normalizeTaskStatus({ status }, '', null);
    let label = 'To Be Started';
    let icon = 'fa-circle-dot';
    let className = 'status-badge-to-be-started';

    if (s === 'in-process' || s === 'in-progress') {
        label = 'In Progress';
        icon = 'fa-spinner fa-spin';
        className = 'status-badge-in-process';
    } else if (s === 'completed') {
        label = 'Completed';
        icon = 'fa-circle-check';
        className = 'status-badge-completed';
    } else if (s === 'postponed') {
        label = 'Postponed';
        icon = 'fa-clock';
        className = 'status-badge-postponed';
    } else if (s === 'overdue') {
        label = 'Overdue';
        icon = 'fa-circle-exclamation';
        className = 'status-badge-overdue';
    } else if (s === 'not-completed' || s === 'cancelled') {
        label = 'Not Completed';
        icon = 'fa-circle-xmark';
        className = 'status-badge-not-completed';
    }

    return `
        <div class="status-badge ${className}">
            ${showIcon ? `<i class="fa-solid ${icon}"></i>` : ''}
            <span>${label}</span>
        </div>
    `;
}
