/**
 * Staff Directory Component
 * Handles rendering of the full-page staff thread, messages, and tasks.
 */

import { safeHtml } from './helpers.js';
import { AppConfig } from '../config.js';

/**
 * Render the Staff Directory Page
 */
export async function renderStaffDirectoryPage() {
    const currentUser = window.AppAuth.getUser();

    // Fetch data (using cache where possible)
    const allUsers = window.AppDB.getCached
        ? await window.AppDB.getCached(window.AppDB.getCacheKey('staffUsers', 'users', {}), (AppConfig?.READ_CACHE_TTLS?.users || 60000), () => window.AppDB.getAll('users'))
        : await window.AppDB.getAll('users');

    const messages = window.app_getMyMessages
        ? await window.app_getMyMessages()
        : await window.AppDB.getAll('staff_messages');

    const others = allUsers
        .filter(u => u.id !== currentUser.id && !AppConfig.isDemoUser(u))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (!window.app_staffThreadId && others.length > 0) {
        window.app_staffThreadId = others[0].id;
    }

    const selected = allUsers.find(u => u.id === window.app_staffThreadId);

    const linkify = (text) => safeHtml(text).replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    const conversation = messages
        .filter(m => (m.fromId === currentUser.id && m.toId === window.app_staffThreadId)
            || (m.fromId === window.app_staffThreadId && m.toId === currentUser.id))
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));

    const textMessages = conversation.filter(m => m.type === 'text');
    const taskMessages = conversation.filter(m => m.type === 'task');

    const unreadByUser = {};
    messages.forEach(m => {
        if (m.toId === currentUser.id && !m.read) {
            unreadByUser[m.fromId] = (unreadByUser[m.fromId] || 0) + 1;
        }
    });

    const staffList = others.map(u => {
        const unread = unreadByUser[u.id] || 0;
        const isActive = u.id === window.app_staffThreadId;
        return `
            <button class="staff-directory-item ${isActive ? 'active' : ''}" onclick="window.app_openStaffThread('${u.id}')">
                <div class="staff-directory-avatar">
                    <img src="${u.avatar}" alt="${safeHtml(u.name)}">
                </div>
                <div class="staff-directory-info">
                    <div class="staff-directory-name">${safeHtml(u.name)}</div>
                    <div class="staff-directory-role">${safeHtml(u.role || 'Staff')}</div>
                </div>
                ${unread ? `<span class="staff-directory-badge">${unread}</span>` : ''}
            </button>
        `;
    }).join('');

    const textHistoryHTML = selected ? (textMessages.length ? textMessages.map(m => `
        <div class="staff-message ${m.fromId === currentUser.id ? 'outgoing' : 'incoming'}">
            <div class="staff-message-meta">${safeHtml(m.fromName)} • ${new Date(m.createdAt).toLocaleString()}</div>
            <div class="staff-message-body">${linkify(m.message || '')}</div>
            ${m.link ? `<div class="staff-message-link"><a href="${m.link}" target="_blank" rel="noopener noreferrer">${m.link}</a></div>` : ''}
        </div>
    `).join('') : '<div class="staff-message-empty">No messages yet.</div>') : '<div class="staff-message-empty">Select a staff member to view messages.</div>';

    const taskHistoryHTML = selected ? (taskMessages.length ? taskMessages.map(m => `
        <div class="staff-task-card">
            <div class="staff-task-head">
                <div>
                    <div class="staff-task-title">${safeHtml(m.title || 'Task')}</div>
                    <div class="staff-task-meta">From ${safeHtml(m.fromName)} • Due ${m.dueDate || 'No date'}</div>
                </div>
                <span class="staff-task-status ${m.status || 'pending'}">${(m.status || 'pending').toUpperCase()}</span>
            </div>
            <div class="staff-task-desc">${safeHtml(m.description || '')}</div>
            ${m.status === 'pending' && m.toId === currentUser.id ? `
                <div class="staff-task-actions">
                    <button onclick="window.app_respondStaffTask('${m.id}', 'approved')" class="staff-task-btn approve">Approve</button>
                    <button onclick="window.app_respondStaffTask('${m.id}', 'rejected')" class="staff-task-btn reject">Reject</button>
                </div>
            ` : ''}
            ${m.rejectReason ? `<div class="staff-task-reason">Reason: ${safeHtml(m.rejectReason)}</div>` : ''}
        </div>
    `).join('') : '<div class="staff-message-empty">No tasks yet.</div>') : '<div class="staff-message-empty">Select a staff member to view tasks.</div>';

    return `
        <div class="staff-directory-page">
            <aside class="staff-directory-panel">
                <div class="staff-directory-panel-head">
                    <h3>Staff Directory</h3>
                    <span>Messages & tasks</span>
                </div>
                <div class="staff-directory-list">
                    ${staffList || '<div class="staff-message-empty">No staff found.</div>'}
                </div>
            </aside>
            <section class="staff-thread-panel">
                <div class="staff-thread-head">
                    <div>
                        <h3>${selected ? safeHtml(selected.name) : 'Select a staff member'}</h3>
                        <span>${selected ? safeHtml(selected.role || 'Staff') : ''}</span>
                    </div>
                    <div class="staff-thread-actions">
                        <button class="staff-thread-action-btn" ${selected ? '' : 'disabled'} onclick="window.app_openStaffMessageModal('${selected ? selected.id : ''}', '${selected ? safeHtml(selected.name) : ''}')">
                            <i class="fa-solid fa-message"></i> Send Message
                        </button>
                        <button class="staff-thread-action-btn secondary" ${selected ? '' : 'disabled'} onclick="window.app_openStaffTaskModal('${selected ? selected.id : ''}', '${selected ? safeHtml(selected.name) : ''}')">
                            <i class="fa-solid fa-list-check"></i> Send Task
                        </button>
                    </div>
                </div>
                <div class="staff-thread-columns">
                    <div class="staff-thread-column">
                        <div class="staff-thread-column-head">Text Messages</div>
                        <div class="staff-thread-history">
                            ${textHistoryHTML}
                        </div>
                    </div>
                    <div class="staff-thread-column">
                        <div class="staff-thread-column-head">Tasks</div>
                        <div class="staff-thread-history">
                            ${taskHistoryHTML}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    `;
}

