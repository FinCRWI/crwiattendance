/**
 * View Toggle Component
 * Reusable view switcher (Grid / Board / Calendar) for any list page.
 * Pure UI — no Firestore cost.
 */

const DEFAULT_VIEWS = [
    { key: 'grid', icon: 'fa-table-list', label: 'Grid' },
    { key: 'board', icon: 'fa-columns', label: 'Board' },
    { key: 'calendar', icon: 'fa-calendar', label: 'Calendar' }
];

/**
 * Render view toggle buttons
 * @param {string} currentView - Active view key ('grid', 'board', 'calendar')
 * @param {Array} views - Optional custom views array
 * @returns {string} HTML string
 */
export function renderViewToggle(currentView = 'grid', views = DEFAULT_VIEWS) {
    const buttons = views.map(v => {
        const isActive = v.key === currentView ? ' active' : '';
        return `<button class="view-toggle-btn${isActive}" data-view="${v.key}" title="${v.label}">
            <i class="fa-solid ${v.icon}"></i>
        </button>`;
    }).join('');

    return `<div class="view-toggle" role="tablist" aria-label="View switcher">${buttons}</div>`;
}

/**
 * Bind click events on view toggle buttons
 * @param {string} containerId - ID of the container holding the toggle
 * @param {Function} callback - Called with (viewKey) when a view is selected
 */
export function initViewToggle(containerId, callback) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.addEventListener('click', (e) => {
        const btn = e.target.closest('.view-toggle-btn');
        if (!btn) return;

        const viewKey = btn.dataset.view;
        if (!viewKey) return;

        // Update active state
        container.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (typeof callback === 'function') {
            callback(viewKey);
        }
    });
}

/**
 * Inject view toggle CSS (call once on app load)
 */
export function ensureViewToggleCSS() {
    if (document.getElementById('view-toggle-css')) return;
    const style = document.createElement('style');
    style.id = 'view-toggle-css';
    style.textContent = `
        .view-toggle {
            display: inline-flex;
            gap: 2px;
            background: #f3f4f6;
            border-radius: 0.5rem;
            padding: 3px;
        }
        .view-toggle-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 32px;
            height: 30px;
            border: none;
            border-radius: 0.375rem;
            background: transparent;
            color: #6b7a90;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
            font-size: 0.8rem;
        }
        .view-toggle-btn:hover {
            background: #e5e7eb;
            color: #374151;
        }
        .view-toggle-btn.active {
            background: #fff;
            color: var(--primary, #3f63a8);
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
            font-weight: 600;
        }
        @media (max-width: 480px) {
            .view-toggle-btn {
                width: 28px;
                height: 28px;
                font-size: 0.75rem;
            }
        }
    `;
    document.head.appendChild(style);
}
