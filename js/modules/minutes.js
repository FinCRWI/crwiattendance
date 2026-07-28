/**
 * Meeting Minutes Module
 * Handles storage and retrieval of meeting minutes.
 */

const COLLECTION = 'minutes';

function getCurrentUser() {
    const user = window.AppAuth.getUser();
    if (!user || !user.id) throw new Error('User not authenticated');
    return user;
}

function isMinutesAdmin(user) {
    return !!(window.app_hasPerm && window.app_hasPerm('minutes', 'admin', user));
}

function canUpdateMinute(existing, user, auditAction, options = {}) {
    const isOwner = existing && existing.createdBy === user.id;
    const isAdmin = isMinutesAdmin(user);
    const allowNonOwner = options && options.allowNonOwner === true;

    if (!isOwner && !isAdmin && !allowNonOwner) {
        throw new Error('You do not have permission to edit these minutes.');
    }

    // Locked minutes are immutable except for attendee/action workflows.
    if (existing && existing.locked && !(options && options.allowOnLocked === true)) {
        throw new Error('This record is locked.');
    }

    // Retained for audit readability in calling sites.
    if (!auditAction || !String(auditAction).trim()) {
        return 'Updated minutes';
    }
    return String(auditAction).trim();
}

/**
 * Get all minutes
 */
export async function getMinutes(options = {}) {
    try {
        const limit = options.limit || 150;
        if (window.AppDB?.queryMany) {
            return await window.AppDB.queryMany(
                COLLECTION,
                [],
                { orderBy: [{ field: 'date', direction: 'desc' }], limit }
            );
        }
        if (window.AppDB?.getAll) {
            const all = await window.AppDB.getAll(COLLECTION);
            return all
                .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
                .slice(0, limit);
        }
        const snapshot = await window.AppFirestore.collection(COLLECTION).orderBy('date', 'desc').limit(limit).get();
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('Error fetching minutes:', error);
        throw error;
    }
}

/**
 * Add a new minute entry
 */
export async function addMinute(data) {
    try {
        const user = getCurrentUser();
        const nowIso = new Date().toISOString();
        const creatorName = user.name || user.username || 'Unknown';

        const entry = {
            ...data,
            createdBy: user.id,
            createdByName: creatorName,
            createdAt: nowIso,
            lastEditedBy: user.id,
            lastEditedByName: creatorName,
            lastEditedAt: nowIso,
            auditLog: [{
                userId: user.id,
                userName: creatorName,
                timestamp: nowIso,
                action: 'Created meeting minutes'
            }],
            approvals: {},
            locked: false,
            restrictedFrom: [],
            allowedViewers: [],
            accessRequests: []
        };

        if (window.AppDB) {
            return await window.AppDB.add(COLLECTION, entry);
        }
        const docRef = await window.AppFirestore.collection(COLLECTION).add(entry);
        return docRef.id;
    } catch (error) {
        console.error('Error adding minute:', error);
        throw error;
    }
}

/**
 * Update an existing minute entry
 */
export async function updateMinute(id, updates, auditAction, options = {}) {
    try {
        const user = getCurrentUser();
        const existing = await (window.AppDB
            ? window.AppDB.get(COLLECTION, id)
            : window.AppFirestore.collection(COLLECTION).doc(id).get().then(d => d.data()));

        if (!existing) throw new Error('Minute not found');

        const resolvedAction = canUpdateMinute(existing, user, auditAction, options);
        const nowIso = new Date().toISOString();
        const editorName = user.name || user.username || 'Unknown';

        const auditEntry = {
            userId: user.id,
            userName: editorName,
            timestamp: nowIso,
            action: resolvedAction
        };

        const updatedData = {
            ...existing,
            ...updates,
            id,
            lastEditedBy: user.id,
            lastEditedByName: editorName,
            lastEditedAt: nowIso,
            auditLog: [...(existing.auditLog || []), auditEntry]
        };

        if (window.AppDB) {
            await window.AppDB.put(COLLECTION, updatedData);
        } else {
            await window.AppFirestore.collection(COLLECTION).doc(id).update(updatedData);
        }
        return true;
    } catch (error) {
        console.error('Error updating minute:', error);
        throw error;
    }
}

/**
 * Request access to minutes
 */
export async function requestAccess(id) {
    try {
        const user = getCurrentUser();
        const existing = await (window.AppDB
            ? window.AppDB.get(COLLECTION, id)
            : window.AppFirestore.collection(COLLECTION).doc(id).get().then(d => d.data()));
        if (!existing) throw new Error('Minute not found');

        const requests = existing.accessRequests || [];
        if (requests.some(r => r.userId === user.id)) return true;

        requests.push({
            userId: user.id,
            userName: user.name || user.username || 'Unknown',
            status: 'pending',
            requestedAt: new Date().toISOString()
        });

        return await updateMinute(id, { accessRequests: requests }, `Requested access for ${user.name || user.username}`, {
            allowNonOwner: true,
            allowOnLocked: true
        });
    } catch (error) {
        console.error('Error requesting access:', error);
        throw error;
    }
}

/**
 * Handle access request
 */
export async function handleAccessRequest(id, userId, status) {
    try {
        const user = getCurrentUser();
        const existing = await (window.AppDB
            ? window.AppDB.get(COLLECTION, id)
            : window.AppFirestore.collection(COLLECTION).doc(id).get().then(d => d.data()));
        if (!existing) throw new Error('Minute not found');

        const isOwner = existing.createdBy === user.id;
        const isAdmin = isMinutesAdmin(user);
        if (!isOwner && !isAdmin) {
            throw new Error('Only owner or admin can review access requests.');
        }

        const requests = existing.accessRequests || [];
        const req = requests.find(r => r.userId === userId);
        if (!req) return true;

        req.status = status;
        const allowedViewers = existing.allowedViewers || [];
        if (status === 'approved' && !allowedViewers.includes(userId)) {
            allowedViewers.push(userId);
        }

        return await updateMinute(
            id,
            { accessRequests: requests, allowedViewers },
            `${String(status || '').toUpperCase()} access request for userId: ${userId}`,
            { allowOnLocked: true }
        );
    } catch (error) {
        console.error('Error handling access request:', error);
        throw error;
    }
}

/**
 * Update Action Item Status
 */
export async function updateActionItemStatus(id, taskIndex, status) {
    try {
        const user = getCurrentUser();
        const existing = await (window.AppDB
            ? window.AppDB.get(COLLECTION, id)
            : window.AppFirestore.collection(COLLECTION).doc(id).get().then(d => d.data()));
        if (!existing || !existing.actionItems) throw new Error('Minute or tasks not found');

        const task = existing.actionItems[taskIndex];
        if (!task) throw new Error('Task not found');

        const isOwner = existing.createdBy === user.id;
        const isAdmin = isMinutesAdmin(user);
        const isAssignee = task.assignedTo === user.id;
        if (!isOwner && !isAdmin && !isAssignee) {
            throw new Error('Only owner, admin, or assignee can update this task.');
        }

        task.status = status;
        if (status === 'completed') task.completedAt = new Date().toISOString();

        return await updateMinute(
            id,
            { actionItems: existing.actionItems },
            `Updated Task: ${task.task} to ${status}`,
            { allowNonOwner: true, allowOnLocked: true }
        );
    } catch (error) {
        console.error('Error updating action item:', error);
        throw error;
    }
}

/**
 * Approve meeting minutes
 */
export async function approveMinute(id) {
    try {
        const user = getCurrentUser();
        const existing = await (window.AppDB
            ? window.AppDB.get(COLLECTION, id)
            : window.AppFirestore.collection(COLLECTION).doc(id).get().then(d => d.data()));

        if (!existing) throw new Error('Minute not found');

        const attendeeIds = existing.attendeeIds || [];
        const isAttendee = attendeeIds.includes(user.id);
        const isOwner = existing.createdBy === user.id;
        const isAdmin = isMinutesAdmin(user);

        if (!isAttendee && !isOwner && !isAdmin) {
            throw new Error('Only attendees, owner, or admin can approve minutes.');
        }

        const approvals = existing.approvals || {};
        approvals[user.id] = new Date().toISOString();

        const allApproved = attendeeIds.length > 0 && attendeeIds.every(uid => approvals[uid]);

        const updates = { approvals };
        if (allApproved) updates.locked = true;

        return await updateMinute(
            id,
            updates,
            `${allApproved ? 'FINAL APPROVAL & LOCK' : 'Signed'} by ${user.name || user.username}`,
            { allowNonOwner: true, allowOnLocked: true }
        );
    } catch (error) {
        console.error('Error approving minute:', error);
        throw error;
    }
}

/**
 * Delete a minute entry
 */
export async function deleteMinute(id) {
    try {
        const user = getCurrentUser();
        const existing = await (window.AppDB
            ? window.AppDB.get(COLLECTION, id)
            : window.AppFirestore.collection(COLLECTION).doc(id).get().then(d => d.data()));
        if (!existing) throw new Error('Minute not found');

        const isOwner = existing.createdBy === user.id;
        const isAdmin = isMinutesAdmin(user);
        if (!isOwner && !isAdmin) {
            throw new Error('Only owner or admin can delete minutes.');
        }

        if (window.AppDB) {
            return await window.AppDB.delete(COLLECTION, id);
        }
        await window.AppFirestore.collection(COLLECTION).doc(id).delete();
        return true;
    } catch (error) {
        console.error('Error deleting minute:', error);
        throw error;
    }
}

let _isMinutesDirty = false;

function isMinutesDirtyState() {
    return _isMinutesDirty;
}

function setMinutesDirtyState(dirty) {
    _isMinutesDirty = !!dirty;
}

const AppMinutes = {
    getMinutes,
    addMinute,
    updateMinute,
    approveMinute,
    deleteMinute,
    requestAccess,
    handleAccessRequest,
    updateActionItemStatus,
    isMinutesDirtyState,
    setMinutesDirtyState
};

if (typeof window !== 'undefined') {
    window.AppMinutes = AppMinutes;
}

export default AppMinutes;
