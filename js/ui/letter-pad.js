import { Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, AlignmentType, convertMillimetersToTwip } from 'https://esm.sh/docx@8.5.0';
import { jsPDF } from 'https://esm.sh/jspdf@2.5.1';
import html2canvas from 'https://esm.sh/html2canvas@1.4.1';
import { safeHtml, safeAttr, safeUrl } from './helpers.js';

const DEFAULT_PROFILE = Object.freeze({
    name: 'Default Letter Pad',
    headerImageUrl: '',
    footerImageUrl: '',
    people: [],
    seals: [],
    activePersonId: '',
    activeSealId: '',
    watermarkImageUrl: '',
    margins: { top: 28, right: 22, bottom: 28, left: 22 },
    headerHeight: 82,
    footerHeight: 64,
    watermarkEnabled: false
});

const FONT_OPTIONS = ['Arial', 'Calibri', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana'];
const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24];
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const CSS_PX_PER_MM = 96 / 25.4;
const DEFAULT_EDITOR_HTML = '<p>Date: </p><p>To,</p><p><br></p><p>Subject: </p><p><br></p><p>Dear Sir/Madam,</p><p><br></p><p>Yours faithfully,</p>';
const OFFICE_TEMPLATE = () => {
    const date = new Date().toLocaleDateString('en-GB');
    const year = new Date().getFullYear();
    return `<div style="text-align:right">Date: ${date}</div>
<p>Ref: OFF/LP/${year}/____</p>
<p><br></p>
<p><strong>To,</strong><br>The Director,<br>[Organization Name]<br>[Address]</p>
<p><br></p>
<p><strong>Subject: _________________________________________</strong></p>
<p><br></p>
<p>Dear Sir/Madam,</p>
<p>This is to bring to your kind notice that...</p>
<p><br></p>
<p><br></p>
<p>Yours faithfully,</p>
<p><br></p>
<p><strong>For Your Office Name</strong></p>`;
};

const getUser = () => window.AppAuth?.getUser?.() || null;
const getProfiles = () => window._letterPadState?.profiles || [];
const getActiveProfile = () => getProfiles().find(p => p.id === window._letterPadState?.activeProfileId) || getProfiles()[0] || null;
const nowIso = () => new Date().toISOString();
const makeId = () => `lp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const pxToMm = (px) => Number(px || 0) / CSS_PX_PER_MM;
const pxToEmu = (px) => Math.round(Number(px || 0) * 9525);
const localAssetsKey = (profileId = '') => {
    const user = getUser();
    return `letter_pad_assets:${user?.id || 'anon'}:${profileId || 'none'}`;
};
const loadLocalAssets = (profileId = '') => {
    try {
        const raw = JSON.parse(localStorage.getItem(localAssetsKey(profileId)) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
};
const saveLocalAssets = (profileId = '', assets = {}) => {
    localStorage.setItem(localAssetsKey(profileId), JSON.stringify(assets && typeof assets === 'object' ? assets : {}));
};
const getLocalAsset = (profileId = '', key = '') => String(loadLocalAssets(profileId)[key] || '');
const setLocalAsset = (profileId = '', key = '', value = '') => {
    if (!key) return '';
    const assets = loadLocalAssets(profileId);
    assets[key] = String(value || '');
    saveLocalAssets(profileId, assets);
    return assets[key];
};
const removeLocalAsset = (profileId = '', key = '') => {
    if (!key) return;
    const assets = loadLocalAssets(profileId);
    delete assets[key];
    saveLocalAssets(profileId, assets);
};
const resolveProfileAssetUrl = (profile, key, fallback = '') => {
    const profileId = profile?.id || '';
    return getLocalAsset(profileId, key) || String(fallback || '');
};
const isDataUrl = (value) => String(value || '').startsWith('data:');

const normalizePeopleItems = (items = [], legacyUrl = '', legacyLabel = 'Person') => {
    const normalized = (Array.isArray(items) ? items : [])
        .map((item, index) => ({
            id: String(item.id || `item_${index}_${Date.now()}`),
            name: String(item.name || `${legacyLabel} ${index + 1}`),
            signatureUrl: String(item.signatureUrl || item.url || ''),
            signatureAssetKey: String(item.signatureAssetKey || item.assetKey || ''),
            signatureSize: Number(item.signatureSize || 120)
        }));
    if (legacyUrl && !normalized.some(item => item.url === legacyUrl)) {
        normalized.unshift({
            id: `legacy_${legacyLabel.toLowerCase().replace(/\s+/g, '_')}`,
            name: `${legacyLabel} 1`,
            signatureUrl: legacyUrl,
            signatureAssetKey: '',
            signatureSize: 120
        });
    }
    return normalized;
};

const normalizeSealItems = (items = [], legacyUrl = '', legacyLabel = 'Seal') => {
    const normalized = (Array.isArray(items) ? items : [])
        .map((item, index) => ({
            id: String(item.id || `item_${index}_${Date.now()}`),
            name: String(item.name || `${legacyLabel} ${index + 1}`),
            url: String(item.url || item.sealUrl || ''),
            sealAssetKey: String(item.sealAssetKey || item.assetKey || ''),
            sealSize: Number(item.sealSize || 92)
        }));
    if (legacyUrl && !normalized.some(item => item.url === legacyUrl)) {
        normalized.unshift({
            id: `legacy_${legacyLabel.toLowerCase().replace(/\s+/g, '_')}`,
            name: `${legacyLabel} 1`,
            url: legacyUrl,
            sealAssetKey: '',
            sealSize: 92
        });
    }
    return normalized;
};

const normalizeDraftObject = (object = {}) => ({
    id: String(object.id || makeId()),
    kind: object.kind === 'seal' ? 'seal' : 'signature',
    assetId: String(object.assetId || ''),
    name: String(object.name || ''),
    url: String(object.url || ''),
    x: Number.isFinite(Number(object.x)) ? Number(object.x) : 0,
    y: Number.isFinite(Number(object.y)) ? Number(object.y) : 0,
    width: Number.isFinite(Number(object.width)) ? Number(object.width) : 120,
    height: Number.isFinite(Number(object.height)) ? Number(object.height) : 60,
    ratio: Number.isFinite(Number(object.ratio)) ? Number(object.ratio) : 0,
    zIndex: Number.isFinite(Number(object.zIndex)) ? Number(object.zIndex) : 4
});

const normalizeDraftState = (draft = {}) => {
    const payload = draft && typeof draft === 'object' ? draft : {};
    return {
        profileId: String(payload.profileId || ''),
        html: String(payload.html || ''),
        objects: Array.isArray(payload.objects) ? payload.objects.map(normalizeDraftObject) : [],
        savedAt: String(payload.savedAt || nowIso())
    };
};

const normalizeProfile = (profile = {}) => {
    const people = normalizePeopleItems(profile.people || profile.signatures, profile.signatureImageUrl, 'Person');
    const seals = normalizeSealItems(profile.seals, profile.sealImageUrl, 'Seal');
    return {
        ...DEFAULT_PROFILE,
        ...profile,
        people,
        seals,
        activePersonId: profile.activePersonId || profile.activeSignatureId || people[0]?.id || '',
        activeSealId: profile.activeSealId || seals[0]?.id || '',
        margins: {
            ...DEFAULT_PROFILE.margins,
            ...(profile.margins || {})
        },
        headerHeight: Number(profile.headerHeight || DEFAULT_PROFILE.headerHeight),
        footerHeight: Number(profile.footerHeight || DEFAULT_PROFILE.footerHeight),
        watermarkEnabled: profile.watermarkEnabled === true
    };
};

const sanitizeProfileForSave = (profile = {}) => {
    const normalized = normalizeProfile(profile);
    return {
        ...normalized,
        headerImageUrl: isDataUrl(normalized.headerImageUrl) ? '' : String(normalized.headerImageUrl || ''),
        footerImageUrl: isDataUrl(normalized.footerImageUrl) ? '' : String(normalized.footerImageUrl || ''),
        watermarkImageUrl: isDataUrl(normalized.watermarkImageUrl) ? '' : String(normalized.watermarkImageUrl || ''),
        people: (normalized.people || []).map(person => ({
            ...person,
            signatureUrl: isDataUrl(person.signatureUrl) ? '' : String(person.signatureUrl || ''),
            signatureAssetKey: String(person.signatureAssetKey || '')
        })),
        seals: (normalized.seals || []).map(seal => ({
            ...seal,
            url: isDataUrl(seal.url) ? '' : String(seal.url || ''),
            sealAssetKey: String(seal.sealAssetKey || '')
        }))
    };
};

const draftKey = (profileId = '') => {
    const user = getUser();
    return `letter_pad_draft:${user?.id || 'anon'}:${profileId || 'none'}`;
};

const localProfilesKey = () => {
    const user = getUser();
    return `letter_pad_profiles:${user?.id || 'anon'}`;
};

const loadLocalProfiles = () => {
    try {
        const rows = JSON.parse(localStorage.getItem(localProfilesKey()) || '[]');
        return Array.isArray(rows) ? rows.map(p => normalizeProfile({ ...p, _localOnly: true })) : [];
    } catch {
        return [];
    }
};

const loadMigratedProfiles = async () => {
    const user = getUser();
    if (!window.AppDB?.getAll) return [];
    try {
        const rows = await window.AppDB.getAll('letter_pad_profiles', { silentPermissionDenied: true });
        if (!Array.isArray(rows) || !rows.length) return [];
        const filtered = rows.filter((row) => {
            const owner = String(row?.ownerId || row?.userId || row?.createdById || '').trim();
            return !owner || !user?.id || owner === String(user.id);
        });
        return filtered.length ? filtered : rows;
    } catch {
        return [];
    }
};

const saveLocalProfiles = (profiles = []) => {
    localStorage.setItem(localProfilesKey(), JSON.stringify((profiles || []).map(p => ({
        ...normalizeProfile(p),
        _localOnly: true
    }))));
};

const upsertLocalProfile = (profile) => {
    const payload = normalizeProfile({
        ...profile,
        id: profile.id || makeId(),
        _localOnly: true,
        updatedAt: nowIso(),
        createdAt: profile.createdAt || nowIso()
    });
    const profiles = loadLocalProfiles();
    const idx = profiles.findIndex(p => p.id === payload.id);
    if (idx >= 0) profiles[idx] = payload;
    else profiles.push(payload);
    saveLocalProfiles(profiles);
    return payload;
};

const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
};

const toast = (message) => {
    if (window.app_showSyncToast) window.app_showSyncToast(message);
    else console.log(message);
};

const loadProfiles = async () => {
    const local = loadLocalProfiles();
    const hasMeaningfulLocal = local.some((profile) => (
        String(profile.id || '') !== 'local_default'
        || (Array.isArray(profile.people) && profile.people.length > 0)
        || (Array.isArray(profile.seals) && profile.seals.length > 0)
        || String(profile.headerImageUrl || '').trim()
        || String(profile.footerImageUrl || '').trim()
        || String(profile.watermarkImageUrl || '').trim()
    ));
    if (local.length && hasMeaningfulLocal) {
        return local
            .map(normalizeProfile)
            .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true) || String(a.name).localeCompare(String(b.name)));
    }

    const migrated = await loadMigratedProfiles();
    if (migrated.length) {
        const nextProfiles = migrated.map((profile) => normalizeProfile({ ...profile, _localOnly: true }));
        saveLocalProfiles(nextProfiles);
        return nextProfiles
            .map(normalizeProfile)
            .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true) || String(a.name).localeCompare(String(b.name)));
    }

    return local
        .map(normalizeProfile)
        .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true) || String(a.name).localeCompare(String(b.name)));
};

const saveProfile = async (profile) => {
    const payload = sanitizeProfileForSave({
        ...profile,
        id: profile.id || makeId(),
        updatedAt: nowIso(),
        createdAt: profile.createdAt || nowIso()
    });
    return upsertLocalProfile({ ...payload, _localOnly: true });
};

const refreshPage = async () => {
    const page = document.getElementById('page-content');
    if (!page) return;
    page.innerHTML = await renderLetterPad();
};

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Unable to read image.'));
    reader.readAsDataURL(file);
});

const measureImageDimensions = (src) => new Promise((resolve) => {
    if (!src) {
        resolve({ width: 0, height: 0 });
        return;
    }
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
});

const uploadProfileImage = async (file) => {
    if (!file) return '';
    if (!/^image\//.test(file.type || '')) throw new Error('Please upload an image file.');
    if (file.size > 3 * 1024 * 1024) throw new Error('Please keep images under 3 MB.');

    return readFileAsDataUrl(file);
};

const applyCommand = (command, value = null) => {
    const editor = document.getElementById('letter-pad-editor');
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    window.app_letterPadSaveDraft?.({ silent: true });
};

const insertHtml = (html) => {
    const editor = document.getElementById('letter-pad-editor');
    if (!editor) return;
    editor.focus();
    document.execCommand('insertHTML', false, html);
    window.app_letterPadSaveDraft?.({ silent: true });
};

const activeProfileCss = (profile) => {
    const p = normalizeProfile(profile || {});
    return [
        `--lp-margin-top:${p.margins.top}mm`,
        `--lp-margin-right:${p.margins.right}mm`,
        `--lp-margin-bottom:${p.margins.bottom}mm`,
        `--lp-margin-left:${p.margins.left}mm`,
        `--lp-header-height:${p.headerHeight}px`,
        `--lp-footer-height:${p.footerHeight}px`,
        `--lp-render-header-height:${p.headerHeight}px`,
        `--lp-render-footer-height:${p.footerHeight}px`
    ].join(';');
};

const renderImageSlot = (profile, slot, label, urlKey) => `
    <label class="letter-profile-upload">
        <span>${label}</span>
        <input type="file" accept="image/*" ${slot === 'signature' || slot === 'seal' ? 'multiple' : ''} onchange="window.app_letterPadUploadImage('${safeAttr(profile.id)}', '${slot}', this)">
        <em>${getSlotImageUrl(profile, slot) || profile[urlKey] ? 'Uploaded' : 'Not set'}</em>
    </label>
`;

const isSidebarSectionOpen = (key, fallback = false) => {
    const sections = window._letterPadState?.sectionOpen || {};
    return typeof sections[key] === 'boolean' ? sections[key] : fallback;
};

const renderSidebarSection = (key, title, iconClass, body, fallbackOpen = false) => {
    const open = isSidebarSectionOpen(key, fallbackOpen);
    return `
        <section class="letter-sidebar-card ${open ? 'is-open' : 'is-closed'}">
            <button type="button" class="letter-sidebar-header" onclick="window.app_letterPadToggleSection('${safeAttr(key)}')" aria-expanded="${open ? 'true' : 'false'}">
                <span class="letter-sidebar-title"><i class="fa-solid ${safeAttr(iconClass)}"></i>${safeHtml(title)}</span>
                <i class="fa-solid ${open ? 'fa-chevron-up' : 'fa-chevron-down'}"></i>
            </button>
            ${open ? `<div class="letter-sidebar-body">${body}</div>` : ''}
        </section>
    `;
};

const getActivePerson = (profile) => {
    const people = profile?.people || [];
    const activeId = profile?.activePersonId || '';
    return people.find(item => item.id === activeId) || people[0] || null;
};

const getActiveSeal = (profile) => {
    const seals = profile?.seals || [];
    const activeId = profile?.activeSealId || '';
    return seals.find(item => item.id === activeId) || seals[0] || null;
};

const getPersonSignatureUrl = (profile, person) => resolveProfileAssetUrl(profile, person?.signatureAssetKey || `person:${person?.id || ''}`, person?.signatureUrl);
const getSealImageUrl = (profile, seal) => resolveProfileAssetUrl(profile, seal?.sealAssetKey || `seal:${seal?.id || ''}`, seal?.url);
const getSlotImageUrl = (profile, slot) => {
    if (slot === 'header') return resolveProfileAssetUrl(profile, 'header', profile?.headerImageUrl);
    if (slot === 'footer') return resolveProfileAssetUrl(profile, 'footer', profile?.footerImageUrl);
    if (slot === 'watermark') return resolveProfileAssetUrl(profile, 'watermark', profile?.watermarkImageUrl);
    return '';
};

const getDraftState = () => normalizeDraftState(window._letterPadState?.draft || {});

const renderPeopleManager = (profile) => {
    const people = profile.people || [];
    const activeId = profile.activePersonId || people[0]?.id || '';
    return `
            <div class="letter-picker-row">
                <select class="letter-profile-select" onchange="window.app_letterPadSelectAsset('person', this.value)">
                    ${people.map(person => {
                        const signatureUrl = getPersonSignatureUrl(profile, person);
                        return `<option value="${safeAttr(person.id)}" ${person.id === activeId ? 'selected' : ''}>${safeHtml(person.name)}${signatureUrl ? '' : ' (No signature)'}</option>`;
                    }).join('')}
                </select>
                <button type="button" class="letter-mini-btn" onclick="window.app_letterPadAddPerson()">+</button>
            </div>
            <div class="letter-asset-list">
                ${people.length ? people.map(person => {
                    const signatureUrl = getPersonSignatureUrl(profile, person);
                    return `
                    <div class="letter-asset-row ${person.id === activeId ? 'active' : ''}">
                        <input type="text" value="${safeAttr(person.name)}" oninput="window.app_letterPadUpdatePersonField('${safeAttr(person.id)}', 'name', this.value)" placeholder="Person name">
                        <label class="letter-size-field">
                            <span>Signature size</span>
                            <input type="number" min="40" max="220" value="${Math.round(person.signatureSize || 120)}" oninput="window.app_letterPadUpdatePersonField('${safeAttr(person.id)}', 'signatureSize', this.value)">
                        </label>
                        <label class="letter-profile-upload letter-inline-upload">
                            <span>Signature</span>
                            <input type="file" accept="image/*" onchange="window.app_letterPadUploadPersonSignature('${safeAttr(profile.id)}', '${safeAttr(person.id)}', this)">
                            <em>${signatureUrl ? 'Set' : 'Upload'}</em>
                        </label>
                        <button type="button" class="letter-mini-btn" onclick="window.app_letterPadSelectAsset('person', '${safeAttr(person.id)}')">Place</button>
                        <button type="button" class="letter-mini-btn danger" onclick="window.app_letterPadDeletePerson('${safeAttr(person.id)}')">Remove</button>
                    </div>
                `;
                }).join('') : '<div class="letter-empty-note">No people added yet.</div>'}
            </div>
    `;
};

const renderSealsManager = (profile) => {
    const seals = profile.seals || [];
    const activeId = profile.activeSealId || seals[0]?.id || '';
    return `
        <div class="letter-inline-actions">
            <button type="button" class="letter-mini-btn" onclick="window.app_letterPadAddSeal()">+ Add Seal</button>
        </div>
        <div class="letter-asset-list">
                ${seals.length ? seals.map(seal => {
                    const sealUrl = getSealImageUrl(profile, seal);
                    return `
                    <div class="letter-asset-row ${seal.id === activeId ? 'active' : ''}">
                        <input type="text" value="${safeAttr(seal.name)}" oninput="window.app_letterPadUpdateSealField('${safeAttr(seal.id)}', 'name', this.value)" placeholder="Seal name">
                        <label class="letter-size-field">
                            <span>Seal size</span>
                            <input type="number" min="32" max="220" value="${Math.round(seal.sealSize || 92)}" oninput="window.app_letterPadUpdateSealField('${safeAttr(seal.id)}', 'sealSize', this.value)">
                        </label>
                        <label class="letter-profile-upload letter-inline-upload">
                            <span>Seal image</span>
                            <input type="file" accept="image/*" onchange="window.app_letterPadUploadSealImage('${safeAttr(profile.id)}', '${safeAttr(seal.id)}', this)">
                            <em>${sealUrl ? 'Set' : 'Upload'}</em>
                        </label>
                        <button type="button" class="letter-mini-btn" onclick="window.app_letterPadPlaceSeal('${safeAttr(seal.id)}')">Place</button>
                        <button type="button" class="letter-mini-btn danger" onclick="window.app_letterPadDeleteSeal('${safeAttr(seal.id)}')">Remove</button>
                    </div>
                `;
                }).join('') : '<div class="letter-empty-note">No seals added yet.</div>'}
        </div>
    `;
};

const renderPlacedObjects = (draft) => {
    const objects = Array.isArray(draft?.objects) ? draft.objects : [];
    return `
        <div class="letter-asset-section" data-letter-panel="placed">
            <div class="letter-section-head">
                <span>Placed Items</span>
            </div>
            <div class="letter-placed-list">
                ${objects.length ? objects.map(object => `
                    <div class="letter-placed-row">
                        <div class="letter-placed-title">${safeHtml(object.kind === 'signature' ? `Signature: ${object.name || 'Person'}` : `Seal: ${object.name || 'Seal'}`)}</div>
                        <label>W <input type="number" min="20" value="${Math.round(object.width)}" onchange="window.app_letterPadResizeObject('${safeAttr(object.id)}', 'width', this.value)"></label>
                        <label>H <input type="number" min="20" value="${Math.round(object.height)}" onchange="window.app_letterPadResizeObject('${safeAttr(object.id)}', 'height', this.value)"></label>
                        <button type="button" class="letter-mini-btn danger" onclick="window.app_letterPadDeleteObject('${safeAttr(object.id)}')">Remove</button>
                    </div>
                `).join('') : '<div class="letter-empty-note">Nothing placed on the sheet yet.</div>'}
            </div>
        </div>
    `;
};

const renderPlacedObjectsPanel = (draft) => {
    const panel = document.querySelector('[data-letter-panel="placed"]');
    if (!panel) return;
    panel.outerHTML = renderPlacedObjects(draft);
};

const renderPlacedObjectsLayer = (draft) => {
    const layer = document.querySelector('.letter-object-layer');
    if (!layer) return;
    layer.innerHTML = renderLetterPadObjects(draft);
};

const profilePreviewImage = (url, label) => url
    ? `<img src="${safeUrl(url, '')}" alt="${safeAttr(label)}" onload="window.app_letterPadSyncPreviewSizing?.()">`
    : `<div class="letter-pad-empty-asset">${safeHtml(label)}</div>`;

const getImageFieldForSlot = (slot) => ({
    header: 'headerImageUrl',
    footer: 'footerImageUrl',
    watermark: 'watermarkImageUrl'
})[slot] || '';

const getActiveImageItem = (profile, type) => {
    const items = type === 'signature' ? profile?.people || [] : profile?.seals || [];
    const activeId = type === 'signature' ? profile?.activePersonId : profile?.activeSealId;
    return items.find(item => item.id === activeId) || items[0] || null;
};

const updateProfileInMemory = (profile) => {
    if (!profile?.id || !window._letterPadState?.profiles) return;
    window._letterPadState.profiles = window._letterPadState.profiles.map(p => (
        p.id === profile.id ? normalizeProfile({ ...p, ...profile }) : p
    ));
};

const updatePreviewImage = (slot, url) => {
    if (!url) return;
    if (slot === 'header') {
        const header = document.querySelector('.letter-page-header');
        if (header) {
            header.innerHTML = profilePreviewImage(url, 'Header');
            setTimeout(() => window.app_letterPadSyncPreviewSizing?.(), 0);
        }
    } else if (slot === 'footer') {
        const footer = document.querySelector('.letter-page-footer');
        if (footer) {
            footer.innerHTML = profilePreviewImage(url, 'Footer');
            setTimeout(() => window.app_letterPadSyncPreviewSizing?.(), 0);
        }
    } else if (slot === 'watermark') {
        const page = document.querySelector('.letter-page');
        const active = getActiveProfile();
        if (page && active?.watermarkEnabled) {
            let watermark = page.querySelector('.letter-watermark');
            if (!watermark) {
                watermark = document.createElement('img');
                watermark.className = 'letter-watermark';
                watermark.alt = '';
                const body = page.querySelector('.letter-page-body');
                page.insertBefore(watermark, body || null);
            }
            watermark.src = url;
        }
    }
};

const syncLetterPageSizing = (page) => {
    if (!page) return;
    const pageWidth = page.clientWidth || Math.round(A4_WIDTH_MM * CSS_PX_PER_MM);
    const syncRegion = (selector, storedVar, renderVar) => {
        const region = page.querySelector(selector);
        const img = region?.querySelector('img');
        const storedHeight = Number.parseFloat(getComputedStyle(page).getPropertyValue(storedVar)) || 0;
        if (!region) return;
        if (!img || !img.naturalWidth || !img.naturalHeight || !pageWidth) {
            page.style.setProperty(renderVar, `${storedHeight}px`);
            return;
        }
        const fittedHeight = Math.round((pageWidth * img.naturalHeight) / img.naturalWidth);
        page.style.setProperty(renderVar, `${Math.max(storedHeight, fittedHeight)}px`);
    };
    syncRegion('.letter-page-header', '--lp-header-height', '--lp-render-header-height');
    syncRegion('.letter-page-footer', '--lp-footer-height', '--lp-render-footer-height');
};

const waitForImages = async (root) => {
    const images = Array.from(root?.querySelectorAll?.('img') || []);
    await Promise.all(images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        });
    }));
};

const getCssVariablePx = (element, name, fallback = 0) => {
    const value = Number.parseFloat(getComputedStyle(element).getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
};

const getDocxImageSizing = (image, fallbackHeightPx) => {
    if (!image) return null;
    const width = Math.round(A4_WIDTH_MM * CSS_PX_PER_MM);
    const ratioHeight = image.width && image.height
        ? Math.round((width * image.height) / image.width)
        : 0;
    return {
        width,
        height: Math.max(Math.round(fallbackHeightPx || 0), ratioHeight || Math.round(fallbackHeightPx || 0))
    };
};

const makeLetterheadParagraph = (image, sizing, profile) => new Paragraph({
    alignment: AlignmentType.CENTER,
    indent: { left: -convertMillimetersToTwip(Number(profile?.margins?.left || 0)) },
    spacing: { before: 0, after: 0 },
    children: [new ImageRun({
        type: image.type,
        data: image.data,
        transformation: sizing
    })]
});

const createFloatingImageParagraph = (image, object) => new Paragraph({
    children: [new ImageRun({
        type: image.type,
        data: image.data,
        transformation: {
            width: Math.max(1, Math.round(object.width)),
            height: Math.max(1, Math.round(object.height))
        },
        floating: {
            horizontalPosition: { relative: 'page', offset: pxToEmu(object.x) },
            verticalPosition: { relative: 'page', offset: pxToEmu(object.y) },
            allowOverlap: true,
            behindDocument: false,
            lockAnchor: true,
            layoutInCell: true,
            zIndex: Math.max(1, Math.round(object.zIndex || 4))
        }
    })]
});

const parseDocxStylePx = (value) => {
    const parsed = Number.parseFloat(String(value || ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const getDocxImageSizingFromNode = (image, node) => {
    if (!image) return null;
    const naturalRatio = image.width && image.height ? image.height / image.width : 0;
    const inlineWidth = parseDocxStylePx(node?.style?.width || node?.getAttribute?.('width'));
    const maxWidth = parseDocxStylePx(node?.style?.maxWidth);
    const width = Math.max(
        32,
        Math.round(inlineWidth || maxWidth || Math.min(image.width || 0, 240) || 120)
    );
    const height = Math.max(
        16,
        Math.round(width * (naturalRatio || 0.5))
    );
    return { width, height };
};

const getLetterPadDocxImageUrl = (profile, object) => {
    if (object?.kind === 'signature') {
        const person = (profile?.people || []).find(item => item.id === object.assetId) || null;
        return getPersonSignatureUrl(profile, person) || object?.url || '';
    }
    if (object?.kind === 'seal') {
        const seal = (profile?.seals || []).find(item => item.id === object.assetId) || null;
        return getSealImageUrl(profile, seal) || object?.url || '';
    }
    return object?.url || '';
};

const getDraftPayload = () => {
    const profile = getActiveProfile();
    const editor = document.getElementById('letter-pad-editor');
    const draft = getDraftState();
    return {
        profileId: profile?.id || '',
        html: editor?.innerHTML || '',
        objects: draft.objects || [],
        savedAt: nowIso()
    };
};

const contentTypeToDocxImageType = (contentType = '') => {
    const lower = String(contentType || '').toLowerCase();
    if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
    if (lower.includes('gif')) return 'gif';
    if (lower.includes('bmp')) return 'bmp';
    return 'png';
};

const urlToImageData = async (url) => {
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load image (${response.status}).`);
    const blob = await response.blob();
    const dimensions = await new Promise(resolve => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(blob);
        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve({ width: 0, height: 0 });
        };
        img.src = objectUrl;
    });
    return {
        data: await blob.arrayBuffer(),
        type: contentTypeToDocxImageType(response.headers.get('content-type') || url),
        ...dimensions
    };
};

const htmlToDocxParagraphs = async (html = '') => {
    const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    const paragraphs = [];

    const normalizeText = (text) => String(text || '').replace(/\s+/g, ' ');
    const blockTags = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    const paragraphTags = new Set(['P', 'LI', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

    const collectRuns = async (node, style = {}) => {
        if (!node) return [];
        if (node.nodeType === Node.TEXT_NODE) {
            const text = normalizeText(node.nodeValue);
            return text.trim() ? [new TextRun({ text, bold: !!style.bold, italics: !!style.italics, strike: !!style.strike, size: style.size, font: style.font })] : [];
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return [];

        const tag = node.tagName;
        if (tag === 'BR') {
            return [new TextRun({ break: 1 })];
        }
        if (tag === 'IMG') {
            const image = await urlToImageData(node.getAttribute('src') || '').catch(() => null);
            if (!image) return [];
            const sizing = getDocxImageSizingFromNode(image, node);
            return sizing ? [new ImageRun({ type: image.type, data: image.data, transformation: sizing })] : [];
        }

        const nextStyle = {
            bold: style.bold || tag === 'B' || tag === 'STRONG' || Number.parseInt(node.style?.fontWeight || '', 10) >= 600,
            italics: style.italics || tag === 'I' || tag === 'EM' || String(node.style?.fontStyle || '').toLowerCase() === 'italic',
            strike: style.strike || tag === 'S' || tag === 'DEL' || String(node.style?.textDecoration || '').toLowerCase().includes('line-through'),
            size: style.size || (parseDocxStylePx(node.style?.fontSize) ? Math.max(8, Math.round(parseDocxStylePx(node.style?.fontSize) * 1.5)) : undefined),
            font: style.font || (node.style?.fontFamily ? String(node.style.fontFamily).split(',')[0].replace(/['"]/g, '').trim() : undefined)
        };

        const runs = [];
        for (const child of Array.from(node.childNodes || [])) {
            runs.push(...await collectRuns(child, nextStyle));
        }
        return runs;
    };

    const buildParagraph = async (node, options = {}) => {
        const runs = [];
        for (const child of Array.from(node.childNodes || [])) {
            runs.push(...await collectRuns(child));
        }
        const align = {
            center: AlignmentType.CENTER,
            right: AlignmentType.RIGHT,
            justify: AlignmentType.JUSTIFIED
        }[String(node.style?.textAlign || '').toLowerCase()] || options.align || AlignmentType.LEFT;
        paragraphs.push(new Paragraph({
            alignment: align,
            bullet: options.bullet,
            numbering: options.numbering,
            children: runs.length ? runs : [new TextRun(' ')]
        }));
    };

    const walk = async (node) => {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
            const text = normalizeText(node.nodeValue).trim();
            if (text) paragraphs.push(new Paragraph({ children: [new TextRun(text)] }));
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.tagName;
        if (tag === 'UL' || tag === 'OL') {
            for (const li of Array.from(node.querySelectorAll(':scope > li'))) {
                await buildParagraph(li, {
                    bullet: tag === 'UL' ? { level: 0 } : undefined,
                    numbering: tag === 'OL' ? { reference: 'letter-numbering', level: 0 } : undefined
                });
            }
            return;
        }
        const hasNestedBlockChildren = Array.from(node.children || []).some(child => blockTags.has(child.tagName) && !paragraphTags.has(child.tagName));
        if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'BLOCKQUOTE') {
            if (hasNestedBlockChildren) {
                for (const child of Array.from(node.childNodes || [])) {
                    await walk(child);
                }
                return;
            }
        }
        if (paragraphTags.has(tag) || node === root) {
            await buildParagraph(node);
            return;
        }
        const runs = await collectRuns(node);
        if (runs.length) paragraphs.push(new Paragraph({ children: runs }));
    };

    for (const child of Array.from(root?.childNodes || [])) {
        await walk(child);
    }

    return paragraphs.length ? paragraphs : [new Paragraph('')];
};

const getPageDimensions = () => {
    const page = document.querySelector('.letter-page');
    if (!page) {
        return {
            width: Math.round(A4_WIDTH_MM * CSS_PX_PER_MM),
            height: Math.round(A4_HEIGHT_MM * CSS_PX_PER_MM)
        };
    }
    const rect = page.getBoundingClientRect();
    return {
        width: rect.width || Math.round(A4_WIDTH_MM * CSS_PX_PER_MM),
        height: rect.height || Math.round(A4_HEIGHT_MM * CSS_PX_PER_MM)
    };
};

const getDefaultObjectPosition = (kind, size) => {
    const { width: pageWidth, height: pageHeight } = getPageDimensions();
    const width = Number(size?.width || 120);
    const height = Number(size?.height || 60);
    if (kind === 'seal') {
        return {
            x: Math.max(16, pageWidth * 0.08),
            y: Math.max(24, pageHeight * 0.58)
        };
    }
    return {
        x: Math.max(16, pageWidth - width - 54),
        y: Math.max(24, pageHeight - height - 150)
    };
};

const renderLetterPadObjects = (draft) => {
    const objects = Array.isArray(draft?.objects) ? draft.objects : [];
    return objects.map(object => `
        <div class="letter-object ${object.kind === 'seal' ? 'is-seal' : 'is-signature'}${window._letterPadState?.selectedObjectId === object.id ? ' is-selected' : ''}"
             data-object-id="${safeAttr(object.id)}"
             data-kind="${safeAttr(object.kind)}"
             data-ratio="${safeAttr(object.ratio || 0)}"
             style="left:${Number(object.x)}px; top:${Number(object.y)}px; width:${Number(object.width)}px; height:${Number(object.height)}px; z-index:${Number(object.zIndex || 4)};">
            <div class="letter-object-toolbar">
                <button type="button" class="letter-object-handle" data-drag-handle="1" title="Drag">⋮⋮</button>
                <button type="button" class="letter-object-delete" onclick="window.app_letterPadDeleteObject('${safeAttr(object.id)}')" title="Remove">×</button>
            </div>
            <img src="${safeUrl(object.url, '')}" alt="${safeAttr(object.name)}" draggable="false">
        </div>
    `).join('');
};

const registerHandlers = () => {
    window.app_letterPadExec = applyCommand;
    window.app_letterPadInsertDate = () => insertHtml(new Date().toLocaleDateString());
    window.app_letterPadInsertRecipient = () => insertHtml('<p>To,<br>Recipient Name<br>Designation / Address</p><p>Subject: </p>');
    window.app_letterPadApplyTemplate = () => {
        const editor = document.getElementById('letter-pad-editor');
        if (!editor) return;
        editor.innerHTML = OFFICE_TEMPLATE();
        const profile = getActiveProfile();
        if (profile) {
            window._letterPadState.draft = normalizeDraftState({
                ...(window._letterPadState.draft || {}),
                profileId: profile.id,
                html: editor.innerHTML,
                objects: Array.isArray(window._letterPadState.draft?.objects) ? window._letterPadState.draft.objects : []
            });
        }
        window.app_letterPadSaveDraft?.({ silent: true });
    };
    window.app_letterPadInsertSignature = () => {
        const profile = getActiveProfile();
        const item = getActiveImageItem(profile, 'signature');
        const url = getPersonSignatureUrl(profile, item);
        if (!url) {
            alert('Upload a signature in this profile first.');
            return;
        }
        insertHtml(`<p><img src="${safeAttr(url)}" alt="Signature" style="max-width:${Number(item.signatureSize || 120)}px; height:auto;"></p>`);
    };
    window.app_letterPadInsertSeal = () => {
        const profile = getActiveProfile();
        const item = getActiveImageItem(profile, 'seal');
        const url = getSealImageUrl(profile, item);
        if (!url) {
            alert('Upload a seal in this profile first.');
            return;
        }
        insertHtml(`<p><img src="${safeAttr(url)}" alt="Seal" style="max-width:${Number(item.sealSize || 92)}px; height:auto;"></p>`);
    };
    window.app_letterPadSetLineSpacing = (value) => {
        document.getElementById('letter-pad-editor')?.style.setProperty('line-height', String(value || '1.5'));
        window.app_letterPadSaveDraft?.({ silent: true });
    };
    window.app_letterPadSyncPreviewSizing = () => {
        syncLetterPageSizing(document.querySelector('.letter-page'));
    };
    window.app_letterPadSelectProfile = async (profileId) => {
        window._letterPadState.activeProfileId = String(profileId || '');
        await refreshPage();
    };
    window.app_letterPadToggleSection = async (section) => {
        const current = window._letterPadState?.sectionOpen || {};
        window._letterPadState.sectionOpen = {
            ...current,
            [section]: !(current[section] !== false)
        };
        await refreshPage();
    };
    window.app_letterPadCreateProfile = async () => {
        const name = await window.appPrompt?.('Profile name', 'New Letter Pad Profile', { title: 'Create Profile', confirmText: 'Create' })
            ?? prompt('Profile name', 'New Letter Pad Profile');
        const clean = String(name || '').trim();
        if (!clean) return;
        const profiles = getProfiles();
        const profile = await saveProfile({ ...DEFAULT_PROFILE, id: makeId(), name: clean, isDefault: profiles.length === 0 });
        window._letterPadState.activeProfileId = profile.id;
        await refreshPage();
    };
    window.app_letterPadRenameProfile = async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        const name = await window.appPrompt?.('Profile name', profile.name, { title: 'Rename Profile', confirmText: 'Save' })
            ?? prompt('Profile name', profile.name);
        const clean = String(name || '').trim();
        if (!clean) return;
        await saveProfile({ ...profile, name: clean });
        await refreshPage();
    };
    window.app_letterPadDeleteProfile = async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        const ok = await window.appConfirm?.(`Delete "${profile.name}"? Draft text on this device will remain until cleared.`, 'Delete Profile')
            ?? confirm(`Delete "${profile.name}"?`);
        if (!ok) return;
        saveLocalProfiles(loadLocalProfiles().filter(p => p.id !== profile.id));
        localStorage.removeItem(localAssetsKey(profile.id));
        localStorage.removeItem(draftKey(profile.id));
        const remaining = loadLocalProfiles();
        const nextActiveId = remaining.find(p => p.isDefault)?.id || remaining[0]?.id || '';
        if (!remaining.length) {
            const fallback = upsertLocalProfile({ ...DEFAULT_PROFILE, id: makeId(), isDefault: true, _localOnly: true });
            window._letterPadState.activeProfileId = fallback.id;
        } else {
            window._letterPadState.activeProfileId = nextActiveId;
        }
        await refreshPage();
    };
    window.app_letterPadSetDefault = async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        await Promise.all(getProfiles().map(p => saveProfile({ ...p, isDefault: p.id === profile.id })));
        await refreshPage();
    };
    window.app_letterPadSaveProfile = async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        await saveProfile(profile);
        toast('Profile saved locally on this device.');
        await refreshPage();
    };
    window.app_letterPadSelectImageItem = async (type, itemId) => {
        const profile = getActiveProfile();
        if (!profile) return;
        const key = type === 'signature' ? 'activeSignatureId' : 'activeSealId';
        const next = normalizeProfile({ ...profile, [key]: itemId });
        updateProfileInMemory(next);
        await saveProfile(next);
        await refreshPage();
    };
    window.app_letterPadUpdateSetting = async (key, value) => {
        const profile = getActiveProfile();
        if (!profile) return;
        const next = { ...profile };
        if (key.startsWith('margin.')) {
            const marginKey = key.split('.')[1];
            next.margins = { ...(next.margins || {}), [marginKey]: Number(value || DEFAULT_PROFILE.margins[marginKey]) };
        } else if (key === 'watermarkEnabled') {
            next.watermarkEnabled = !!value;
        } else {
            next[key] = Number(value || DEFAULT_PROFILE[key] || 0);
        }
        await saveProfile(next);
        await refreshPage();
    };
    window.app_letterPadUploadImage = async (profileId, slot, input) => {
        const profile = getProfiles().find(p => p.id === profileId);
        const files = Array.from(input?.files || []);
        const file = files[0];
        if (!profile || !file) return;
        const field = getImageFieldForSlot(slot);
        const isReusableImage = slot === 'signature' || slot === 'seal';
        try {
            let previewProfile = normalizeProfile(profile);
            if (isReusableImage) {
                const collectionKey = slot === 'signature' ? 'signatures' : 'seals';
                const activeKey = slot === 'signature' ? 'activeSignatureId' : 'activeSealId';
                const label = slot === 'signature' ? 'Signature' : 'Seal';
                const additions = await Promise.all(files.map(async (itemFile, index) => ({
                    id: `${slot}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
                    name: itemFile.name || `${label} ${previewProfile[collectionKey].length + index + 1}`,
                    url: await readFileAsDataUrl(itemFile),
                    file: itemFile
                })));
                previewProfile = normalizeProfile({
                    ...previewProfile,
                    [collectionKey]: [...previewProfile[collectionKey], ...additions.map(({ file: _file, ...item }) => ({
                        ...item,
                        ...(slot === 'signature' ? { signatureAssetKey: `person:${item.id}` } : { sealAssetKey: `seal:${item.id}` })
                    }))],
                    [activeKey]: additions[0]?.id || previewProfile[activeKey]
                });
                updateProfileInMemory(previewProfile);
            } else {
                if (!field) return;
                const localPreviewUrl = await readFileAsDataUrl(file);
                previewProfile = normalizeProfile({ ...profile, [field]: '', [`${slot}AssetKey`]: slot });
                updateProfileInMemory(previewProfile);
                updatePreviewImage(slot, localPreviewUrl);
            }
            if (input.closest('.letter-profile-upload')?.querySelector('em')) {
                input.closest('.letter-profile-upload').querySelector('em').textContent = 'Selected';
            }
            toast('Image selected. Saving profile image...');
            let savedCandidate = previewProfile;
            if (isReusableImage) {
                const collectionKey = slot === 'signature' ? 'signatures' : 'seals';
                const savedItems = [];
                for (const item of previewProfile[collectionKey]) {
                    const sourceFile = files.find(f => item.name === (f.name || item.name));
                    if (sourceFile && item.url.startsWith('data:')) {
                        const url = await uploadProfileImage(sourceFile);
                        const assetKey = slot === 'signature' ? `person:${item.id}` : `seal:${item.id}`;
                        setLocalAsset(profile.id, assetKey, url || item.url);
                        savedItems.push({
                            ...item,
                            url: '',
                            ...(slot === 'signature' ? { signatureAssetKey: assetKey } : { sealAssetKey: assetKey })
                        });
                    } else {
                        savedItems.push(item);
                    }
                }
                savedCandidate = normalizeProfile({ ...previewProfile, [collectionKey]: savedItems });
            } else {
                const url = await uploadProfileImage(file);
                setLocalAsset(profile.id, slot, url);
                savedCandidate = normalizeProfile({ ...previewProfile, [field]: '', [`${slot}AssetKey`]: slot });
            }
            const savedProfile = await saveProfile(savedCandidate);
            updateProfileInMemory(savedProfile);
            if (!isReusableImage) updatePreviewImage(slot, savedProfile[field]);
            toast('Profile image saved.');
            await refreshPage();
        } catch (err) {
            alert(err.message || 'Image upload failed.');
        }
    };
    window.app_letterPadSaveDraft = ({ silent = false } = {}) => {
        const profile = getActiveProfile();
        if (!profile) return;
        localStorage.setItem(draftKey(profile.id), JSON.stringify(getDraftPayload()));
        if (!silent) toast('Draft saved on this device.');
    };
    window.app_letterPadLoadDraft = async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        const raw = localStorage.getItem(draftKey(profile.id));
        if (!raw) {
            alert('No saved draft found for this profile.');
            return;
        }
        let payload;
        try {
            payload = normalizeDraftState(JSON.parse(raw));
        } catch {
            payload = normalizeDraftState({ profileId: profile.id, html: DEFAULT_EDITOR_HTML, objects: [] });
        }
        window._letterPadState.draft = payload;
        const editor = document.getElementById('letter-pad-editor');
        if (editor) editor.innerHTML = payload.html || DEFAULT_EDITOR_HTML;
        renderPlacedObjectsLayer(payload);
        renderPlacedObjectsPanel(payload);
        toast('Draft loaded.');
    };
    window.app_letterPadClearDraft = async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        localStorage.removeItem(draftKey(profile.id));
        window._letterPadState.draft = normalizeDraftState({ profileId: profile.id, html: DEFAULT_EDITOR_HTML, objects: [] });
        const editor = document.getElementById('letter-pad-editor');
        if (editor) editor.innerHTML = DEFAULT_EDITOR_HTML;
        renderPlacedObjectsLayer(window._letterPadState.draft);
        renderPlacedObjectsPanel(window._letterPadState.draft);
        toast('Draft cleared.');
    };
    window.app_letterPadExportPdf = async () => {
        const profile = getActiveProfile();
        const page = document.querySelector('.letter-page');
        if (!profile || !page) return;
        const clone = page.cloneNode(true);
        clone.classList.add('letter-page-export');
        const wrap = document.createElement('div');
        wrap.className = 'letter-export-stage';
        wrap.appendChild(clone);
        document.body.appendChild(wrap);
        try {
            await waitForImages(clone);
            syncLetterPageSizing(clone);
            const canvas = await html2canvas(clone, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
            const pdf = new jsPDF('p', 'mm', 'a4');
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
            pdf.save(`letter-pad-${new Date().toISOString().slice(0, 10)}.pdf`);
        } finally {
            wrap.remove();
        }
    };
    window.app_letterPadExportDocx = async () => {
        const profile = getActiveProfile();
        const html = document.getElementById('letter-pad-editor')?.innerHTML || '';
        if (!profile) return;
        const [headerImage, footerImage] = await Promise.all([
            urlToImageData(getSlotImageUrl(profile, 'header')).catch(() => null),
            urlToImageData(getSlotImageUrl(profile, 'footer')).catch(() => null)
        ]);
        const page = document.querySelector('.letter-page');
        if (page) syncLetterPageSizing(page);
        const headerHeightPx = page ? getCssVariablePx(page, '--lp-render-header-height', profile.headerHeight) : profile.headerHeight;
        const footerHeightPx = page ? getCssVariablePx(page, '--lp-render-footer-height', profile.footerHeight) : profile.footerHeight;
        const headerSizing = getDocxImageSizing(headerImage, headerHeightPx);
        const footerSizing = getDocxImageSizing(footerImage, footerHeightPx);
        const children = await htmlToDocxParagraphs(html);
        const doc = new Document({
            numbering: {
                config: [{ reference: 'letter-numbering', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }] }]
            },
            sections: [{
                properties: {
                    page: {
                        size: {
                            width: convertMillimetersToTwip(A4_WIDTH_MM),
                            height: convertMillimetersToTwip(A4_HEIGHT_MM)
                        },
                        margin: {
                            top: convertMillimetersToTwip(Number(profile.margins?.top || 0) + pxToMm(headerHeightPx)),
                            right: convertMillimetersToTwip(Number(profile.margins?.right || 0)),
                            bottom: convertMillimetersToTwip(Number(profile.margins?.bottom || 0) + pxToMm(footerHeightPx)),
                            left: convertMillimetersToTwip(Number(profile.margins?.left || 0)),
                            header: 0,
                            footer: 0
                        }
                    }
                },
                headers: headerImage && headerSizing ? {
                    default: new Header({ children: [makeLetterheadParagraph(headerImage, headerSizing, profile)] })
                } : undefined,
                footers: footerImage && footerSizing ? {
                    default: new Footer({ children: [makeLetterheadParagraph(footerImage, footerSizing, profile)] })
                } : undefined,
                children
            }]
        });
        const blob = await Packer.toBlob(doc);
        downloadBlob(blob, `letter-pad-${new Date().toISOString().slice(0, 10)}.docx`);
    };
};

const registerLetterPadPeopleHandlers = () => {
    window._letterPadState = window._letterPadState || {};
    if (window._letterPadState.peopleHandlersBound) return;
    window._letterPadState.peopleHandlersBound = true;

    const saveDraftState = ({ silent = false } = {}) => {
        const profile = getActiveProfile();
        if (!profile) return;
        const editor = document.getElementById('letter-pad-editor');
        const draft = normalizeDraftState({
            ...(window._letterPadState.draft || {}),
            profileId: profile.id,
            html: editor?.innerHTML || '',
            objects: Array.isArray(window._letterPadState.draft?.objects) ? window._letterPadState.draft.objects : []
        });
        window._letterPadState.draft = draft;
        localStorage.setItem(draftKey(profile.id), JSON.stringify(draft));
        if (!silent) toast('Draft saved on this device.');
    };

    const syncObjectDom = (objectId) => {
        const object = window._letterPadState.draft?.objects?.find(item => item.id === objectId);
        const node = document.querySelector(`.letter-object[data-object-id="${CSS.escape(objectId)}"]`);
        if (!object || !node) return;
        node.style.left = `${Math.round(object.x)}px`;
        node.style.top = `${Math.round(object.y)}px`;
        node.style.width = `${Math.round(object.width)}px`;
        node.style.height = `${Math.round(object.height)}px`;
    };

    const removeDraftObject = (objectId) => {
        const draft = normalizeDraftState(window._letterPadState.draft || {});
        draft.objects = draft.objects.filter(item => item.id !== objectId);
        window._letterPadState.draft = draft;
    };

const placeSignatureForPerson = async (person) => {
        const profile = getActiveProfile();
        const signatureUrl = getPersonSignatureUrl(profile, person);
        if (!signatureUrl) {
            alert('Upload a signature for this person first.');
            return null;
        }
        const dims = await measureImageDimensions(signatureUrl);
        const ratio = dims.width && dims.height ? (dims.height / dims.width) : 0.45;
        const width = Math.max(60, Math.round(person.signatureSize || 120));
        const height = Math.max(24, Math.round(width * ratio));
        const draft = normalizeDraftState(window._letterPadState.draft || {});
        const existing = draft.objects.find(item => item.kind === 'signature');
        const position = existing ? { x: existing.x, y: existing.y } : getDefaultObjectPosition('signature', { width, height });
        const object = normalizeDraftObject({
            id: existing?.id || makeId(),
            kind: 'signature',
            assetId: person.id,
            name: person.name,
            url: signatureUrl,
            x: position.x,
            y: position.y,
            width,
            height,
            ratio,
            zIndex: existing?.zIndex || 8
        });
        draft.objects = [...draft.objects.filter(item => item.kind !== 'signature'), object];
        draft.selectedObjectId = object.id;
        window._letterPadState.draft = draft;
        saveDraftState({ silent: true });
        renderPlacedObjectsLayer(draft);
        renderPlacedObjectsPanel(draft);
        return object;
    };

    const placeSealForCurrent = async (seal) => {
        const profile = getActiveProfile();
        const sealUrl = getSealImageUrl(profile, seal);
        if (!sealUrl) {
            alert('Upload a seal image for this seal first.');
            return null;
        }
        const dims = await measureImageDimensions(sealUrl);
        const ratio = dims.width && dims.height ? (dims.height / dims.width) : 0.45;
        const width = Math.max(44, Math.round(seal.sealSize || 92));
        const height = Math.max(24, Math.round(width * ratio));
        const draft = normalizeDraftState(window._letterPadState.draft || {});
        const count = draft.objects.filter(item => item.kind === 'seal').length;
        const page = getPageDimensions();
        const object = normalizeDraftObject({
            id: makeId(),
            kind: 'seal',
            assetId: seal.id,
            name: seal.name,
            url: sealUrl,
            x: Math.max(16, Math.round(page.width * 0.08 + count * 16)),
            y: Math.max(24, Math.round(page.height * 0.58 + count * (height + 12))),
            width,
            height,
            ratio,
            zIndex: 7
        });
        draft.objects.push(object);
        draft.selectedObjectId = object.id;
        window._letterPadState.draft = draft;
        saveDraftState({ silent: true });
        renderPlacedObjectsLayer(draft);
        renderPlacedObjectsPanel(draft);
        return object;
    };

    const bindDragging = () => {
        if (window._letterPadState.dragBound) return;
        window._letterPadState.dragBound = true;
        let drag = null;

        document.addEventListener('pointerdown', (event) => {
            const handle = event.target.closest('.letter-object-handle');
            if (!handle) return;
            const object = handle.closest('.letter-object');
            const page = document.querySelector('.letter-page');
            if (!object || !page) return;
            const objectId = object.dataset.objectId;
            const draft = normalizeDraftState(window._letterPadState.draft || {});
            const item = draft.objects.find(entry => entry.id === objectId);
            if (!item) return;
            const objectRect = object.getBoundingClientRect();
            const pageRect = page.getBoundingClientRect();
            drag = {
                objectId,
                offsetX: event.clientX - objectRect.left,
                offsetY: event.clientY - objectRect.top,
                pageRect
            };
            window._letterPadState.selectedObjectId = objectId;
            event.preventDefault();
        });

        document.addEventListener('pointermove', (event) => {
            if (!drag) return;
            const page = document.querySelector('.letter-page');
            if (!page) return;
            const draft = normalizeDraftState(window._letterPadState.draft || {});
            const item = draft.objects.find(entry => entry.id === drag.objectId);
            if (!item) return;
            const pageRect = page.getBoundingClientRect();
            const maxX = Math.max(0, pageRect.width - item.width);
            const maxY = Math.max(0, pageRect.height - item.height);
            item.x = Math.max(0, Math.min(maxX, event.clientX - pageRect.left - drag.offsetX));
            item.y = Math.max(0, Math.min(maxY, event.clientY - pageRect.top - drag.offsetY));
            window._letterPadState.draft = draft;
            syncObjectDom(item.id);
        });

        const finish = () => {
            if (!drag) return;
            drag = null;
            saveDraftState({ silent: true });
        };

        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', finish);
    };

    window.app_letterPadInsertSignature = async () => {
        const profile = getActiveProfile();
        const person = getActivePerson(profile);
        if (!person) {
            alert('Add a person and signature first.');
            return;
        }
        await placeSignatureForPerson(person);
        renderPlacedObjectsLayer(window._letterPadState.draft);
        renderPlacedObjectsPanel(window._letterPadState.draft);
    };
    window.app_letterPadInsertSeal = async () => {
        const profile = getActiveProfile();
        const seal = getActiveSeal(profile);
        if (!seal) {
            alert('Add a seal first.');
            return;
        }
        await placeSealForCurrent(seal);
        renderPlacedObjectsLayer(window._letterPadState.draft);
        renderPlacedObjectsPanel(window._letterPadState.draft);
    };
    window.app_letterPadSelectAsset = async (type, itemId) => {
        const profile = getActiveProfile();
        if (!profile) return;
        if (type === 'person') {
            const person = (profile.people || []).find(item => item.id === itemId);
            if (!person) return;
            const nextProfile = normalizeProfile({ ...profile, activePersonId: person.id });
            updateProfileInMemory(nextProfile);
            await saveProfile(nextProfile);
            await placeSignatureForPerson(person);
        } else {
            const seal = (profile.seals || []).find(item => item.id === itemId);
            if (!seal) return;
            const nextProfile = normalizeProfile({ ...profile, activeSealId: seal.id });
            updateProfileInMemory(nextProfile);
            await saveProfile(nextProfile);
            await placeSealForCurrent(seal);
        }
        renderPlacedObjectsLayer(window._letterPadState.draft);
        renderPlacedObjectsPanel(window._letterPadState.draft);
    };
    window.app_letterPadAddPerson = async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        const name = await window.appPrompt?.('Person name', 'New Person', { title: 'Add Person', confirmText: 'Add' })
            ?? prompt('Person name', 'New Person');
        const clean = String(name || '').trim();
        if (!clean) return;
        const nextPeople = [...(profile.people || []), { id: makeId(), name: clean, signatureUrl: '', signatureSize: 120 }];
        const nextProfile = normalizeProfile({ ...profile, people: nextPeople });
        updateProfileInMemory(nextProfile);
        await saveProfile(nextProfile);
        await refreshPage();
    };
    window.app_letterPadUpdatePersonField = async (personId, field, value) => {
            const profile = getActiveProfile();
            if (!profile) return;
            const cleanValue = String(value || '');
            const nextPeople = (profile.people || []).map(person => person.id === personId ? { ...person, [field]: cleanValue } : person);
            const nextProfile = normalizeProfile({ ...profile, people: nextPeople });
        const draft = normalizeDraftState(window._letterPadState.draft || {});
        draft.objects = draft.objects.map(object => object.kind === 'signature' && object.assetId === personId ? { ...object, name: cleanValue } : object);
        window._letterPadState.draft = draft;
        updateProfileInMemory(nextProfile);
        await saveProfile(nextProfile);
        saveDraftState({ silent: true });
    };
    window.app_letterPadDeletePerson = async (personId) => {
        const profile = getActiveProfile();
        if (!profile) return;
        const nextPeople = (profile.people || []).filter(person => person.id !== personId);
        const nextProfile = normalizeProfile({
            ...profile,
            people: nextPeople,
            activePersonId: profile.activePersonId === personId ? (nextPeople[0]?.id || '') : profile.activePersonId
        });
        const draft = normalizeDraftState(window._letterPadState.draft || {});
        draft.objects = draft.objects.filter(object => !(object.kind === 'signature' && object.assetId === personId));
        window._letterPadState.draft = draft;
        removeLocalAsset(profile.id, `person:${personId}`);
        updateProfileInMemory(nextProfile);
        await saveProfile(nextProfile);
        saveDraftState({ silent: true });
        await refreshPage();
    };
    window.app_letterPadUploadPersonSignature = async (profileId, personId, input) => {
        const profile = getProfiles().find(item => item.id === profileId);
        const files = Array.from(input?.files || []);
        const file = files[0];
        if (!profile || !file) return;
        try {
            const dataUrl = await readFileAsDataUrl(file);
            const signatureUrl = await uploadProfileImage(file);
            const signatureAssetKey = `person:${personId}`;
            setLocalAsset(profile.id, signatureAssetKey, signatureUrl || dataUrl);
            const nextPeople = (profile.people || []).map(person => person.id === personId ? { ...person, signatureUrl: '', signatureAssetKey } : person);
            const nextProfile = normalizeProfile({ ...profile, people: nextPeople });
            updateProfileInMemory(nextProfile);
            await saveProfile(nextProfile);
            const person = nextProfile.people.find(item => item.id === personId);
            if (person && nextProfile.activePersonId === personId) {
                await placeSignatureForPerson(person);
            } else {
                const draft = normalizeDraftState(window._letterPadState.draft || {});
                draft.objects = draft.objects.map(object => object.kind === 'signature' && object.assetId === personId ? { ...object, url: signatureUrl || dataUrl } : object);
                window._letterPadState.draft = draft;
            }
            const em = input.closest('.letter-profile-upload')?.querySelector('em');
            if (em) em.textContent = 'Uploaded';
            saveDraftState({ silent: true });
            await refreshPage();
        } catch (err) {
            alert(err.message || 'Signature upload failed.');
        }
    };
    window.app_letterPadAddSeal = async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        const name = await window.appPrompt?.('Seal name', 'New Seal', { title: 'Add Seal', confirmText: 'Add' })
            ?? prompt('Seal name', 'New Seal');
        const clean = String(name || '').trim();
        if (!clean) return;
        const nextSeals = [...(profile.seals || []), { id: makeId(), name: clean, url: '', sealSize: 92 }];
        const nextProfile = normalizeProfile({ ...profile, seals: nextSeals });
        updateProfileInMemory(nextProfile);
        await saveProfile(nextProfile);
        await refreshPage();
    };
    window.app_letterPadUpdateSealField = async (sealId, field, value) => {
        const profile = getActiveProfile();
        if (!profile) return;
        const cleanValue = String(value || '');
        const nextSeals = (profile.seals || []).map(seal => seal.id === sealId ? { ...seal, [field]: cleanValue } : seal);
        const nextProfile = normalizeProfile({ ...profile, seals: nextSeals });
        const draft = normalizeDraftState(window._letterPadState.draft || {});
        draft.objects = draft.objects.map(object => object.kind === 'seal' && object.assetId === sealId ? { ...object, name: cleanValue } : object);
        window._letterPadState.draft = draft;
        updateProfileInMemory(nextProfile);
        await saveProfile(nextProfile);
        saveDraftState({ silent: true });
    };
    window.app_letterPadDeleteSeal = async (sealId) => {
        const profile = getActiveProfile();
        if (!profile) return;
        const nextSeals = (profile.seals || []).filter(seal => seal.id !== sealId);
        const nextProfile = normalizeProfile({
            ...profile,
            seals: nextSeals,
            activeSealId: profile.activeSealId === sealId ? (nextSeals[0]?.id || '') : profile.activeSealId
        });
        const draft = normalizeDraftState(window._letterPadState.draft || {});
        draft.objects = draft.objects.filter(object => !(object.kind === 'seal' && object.assetId === sealId));
        window._letterPadState.draft = draft;
        removeLocalAsset(profile.id, `seal:${sealId}`);
        updateProfileInMemory(nextProfile);
        await saveProfile(nextProfile);
        saveDraftState({ silent: true });
        await refreshPage();
    };
    window.app_letterPadUploadSealImage = async (profileId, sealId, input) => {
        const profile = getProfiles().find(item => item.id === profileId);
        const files = Array.from(input?.files || []);
        const file = files[0];
        if (!profile || !file) return;
        try {
            const dataUrl = await readFileAsDataUrl(file);
            const url = await uploadProfileImage(file);
            const sealAssetKey = `seal:${sealId}`;
            setLocalAsset(profile.id, sealAssetKey, url || dataUrl);
            const nextSeals = (profile.seals || []).map(seal => seal.id === sealId ? { ...seal, url: '', sealAssetKey } : seal);
            const nextProfile = normalizeProfile({ ...profile, seals: nextSeals });
            updateProfileInMemory(nextProfile);
            await saveProfile(nextProfile);
            const draft = normalizeDraftState(window._letterPadState.draft || {});
            draft.objects = draft.objects.map(object => object.kind === 'seal' && object.assetId === sealId ? { ...object, url } : object);
            window._letterPadState.draft = draft;
            const em = input.closest('.letter-profile-upload')?.querySelector('em');
            if (em) em.textContent = 'Uploaded';
            saveDraftState({ silent: true });
            await refreshPage();
        } catch (err) {
            alert(err.message || 'Seal upload failed.');
        }
    };
    window.app_letterPadPlaceSeal = async (sealId) => {
        const profile = getActiveProfile();
        if (!profile) return;
        const seal = (profile.seals || []).find(item => item.id === sealId);
        if (!getSealImageUrl(profile, seal)) {
            alert('Upload a seal image for this seal first.');
            return;
        }
        await placeSealForCurrent(seal);
        renderPlacedObjectsLayer(window._letterPadState.draft);
        renderPlacedObjectsPanel(window._letterPadState.draft);
    };
    window.app_letterPadResizeObject = async (objectId, dimension, value) => {
        const draft = normalizeDraftState(window._letterPadState.draft || {});
        const object = draft.objects.find(item => item.id === objectId);
        if (!object) return;
        const nextValue = Math.max(20, Number(value) || 20);
        if (dimension === 'width') {
            object.width = nextValue;
            if (object.ratio) object.height = Math.max(20, Math.round(object.width * object.ratio));
        } else {
            object.height = nextValue;
            if (object.ratio) object.width = Math.max(20, Math.round(object.height / object.ratio));
        }
        window._letterPadState.draft = draft;
        syncObjectDom(objectId);
        saveDraftState({ silent: true });
    };
    window.app_letterPadDeleteObject = async (objectId) => {
        removeDraftObject(objectId);
        saveDraftState({ silent: true });
        await refreshPage();
    };
    window.app_letterPadSaveDraft = ({ silent = false } = {}) => saveDraftState({ silent });
    window.app_letterPadLoadDraft = () => {
        const profile = getActiveProfile();
        if (!profile) return;
        const raw = localStorage.getItem(draftKey(profile.id));
        if (!raw) {
            alert('No saved draft found for this profile.');
            return;
        }
        const payload = normalizeDraftState(JSON.parse(raw));
        window._letterPadState.draft = payload;
        const editor = document.getElementById('letter-pad-editor');
        if (editor) editor.innerHTML = payload.html || '';
        refreshPage();
        toast('Draft loaded.');
    };
    window.app_letterPadClearDraft = () => {
        const profile = getActiveProfile();
        if (!profile) return;
        localStorage.removeItem(draftKey(profile.id));
        window._letterPadState.draft = normalizeDraftState({ profileId: profile.id, html: '', objects: [] });
        const editor = document.getElementById('letter-pad-editor');
        if (editor) editor.innerHTML = '<p></p>';
        saveDraftState({ silent: true });
        refreshPage();
        toast('Draft cleared.');
    };
    window.app_letterPadExportDocx = async () => {
        const profile = getActiveProfile();
        if (!profile) return;
        const html = document.getElementById('letter-pad-editor')?.innerHTML || '';
        const draft = normalizeDraftState(window._letterPadState.draft || {});
        const [headerImage, footerImage] = await Promise.all([
            urlToImageData(getSlotImageUrl(profile, 'header')).catch(() => null),
            urlToImageData(getSlotImageUrl(profile, 'footer')).catch(() => null)
        ]);
        const page = document.querySelector('.letter-page');
        if (page) syncLetterPageSizing(page);
        const headerHeightPx = page ? getCssVariablePx(page, '--lp-render-header-height', profile.headerHeight) : profile.headerHeight;
        const footerHeightPx = page ? getCssVariablePx(page, '--lp-render-footer-height', profile.footerHeight) : profile.footerHeight;
        const headerSizing = getDocxImageSizing(headerImage, headerHeightPx);
        const footerSizing = getDocxImageSizing(footerImage, footerHeightPx);
        const floatingObjects = await Promise.all(draft.objects.map(async (object) => {
            const imageUrl = getLetterPadDocxImageUrl(profile, object);
            if (!imageUrl) return null;
            const image = await urlToImageData(imageUrl).catch(() => null);
            return image ? { object, image } : null;
        }));
        const children = await htmlToDocxParagraphs(html);
        const doc = new Document({
            numbering: {
                config: [{ reference: 'letter-numbering', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT }] }]
            },
            sections: [{
                properties: {
                    page: {
                        size: {
                            width: convertMillimetersToTwip(A4_WIDTH_MM),
                            height: convertMillimetersToTwip(A4_HEIGHT_MM)
                        },
                        margin: {
                            top: convertMillimetersToTwip(Number(profile.margins?.top || 0) + pxToMm(headerHeightPx)),
                            right: convertMillimetersToTwip(Number(profile.margins?.right || 0)),
                            bottom: convertMillimetersToTwip(Number(profile.margins?.bottom || 0) + pxToMm(footerHeightPx)),
                            left: convertMillimetersToTwip(Number(profile.margins?.left || 0)),
                            header: 0,
                            footer: 0
                        }
                    }
                },
                headers: headerImage && headerSizing ? {
                    default: new Header({ children: [makeLetterheadParagraph(headerImage, headerSizing, profile)] })
                } : undefined,
                footers: footerImage && footerSizing ? {
                    default: new Footer({ children: [makeLetterheadParagraph(footerImage, footerSizing, profile)] })
                } : undefined,
                children: [
                    ...children,
                    ...floatingObjects.filter(Boolean).map(({ object, image }) => createFloatingImageParagraph(image, object))
                ]
            }]
        });
        const blob = await Packer.toBlob(doc);
        downloadBlob(blob, `letter-pad-${new Date().toISOString().slice(0, 10)}.docx`);
    };
    bindDragging();
};

export async function renderLetterPad() {
    const user = getUser();
    if (!user) return '<div class="card">Please sign in to use Letter Pad.</div>';

    registerHandlers();

    let profiles = await loadProfiles();
    if (!profiles.length) {
        const local = upsertLocalProfile({ ...DEFAULT_PROFILE, id: 'local_default', isDefault: true, _localOnly: true });
        profiles = [local];
    }

    const previousSectionOpen = window._letterPadState?.sectionOpen || {};
    const shouldRestoreSectionOpen = window._letterPadState?.sectionOpenInitialized === true;
    window._letterPadState = {
        ...(window._letterPadState || {}),
        profiles,
        activeProfileId: window._letterPadState?.activeProfileId && profiles.some(p => p.id === window._letterPadState.activeProfileId)
            ? window._letterPadState.activeProfileId
            : (profiles.find(p => p.isDefault)?.id || profiles[0]?.id || ''),
        sectionOpenInitialized: true,
        sectionOpen: shouldRestoreSectionOpen ? {
            profile: false,
            letterhead: false,
            signatories: false,
            seals: false,
            settings: false,
            ...previousSectionOpen
        } : {
            profile: false,
            letterhead: false,
            signatories: false,
            seals: false,
            settings: false
        }
    };

    registerLetterPadPeopleHandlers();

    const active = getActiveProfile();
    const draft = active ? normalizeDraftState(JSON.parse(localStorage.getItem(draftKey(active.id)) || 'null')) : normalizeDraftState({ profileId: active?.id || '' });
    window._letterPadState.draft = draft;
    const editorHtml = draft?.html || DEFAULT_EDITOR_HTML;
    setTimeout(() => window.app_letterPadSyncPreviewSizing?.(), 0);

    return `
        <section class="letter-pad-page">
            <div class="letter-pad-topbar">
                <div>
                    <h1>Letter Pad</h1>
                    <p>Create formal letters with local browser storage.</p>
                </div>
                <div class="letter-pad-actions">
                    <button type="button" class="action-btn secondary" onclick="window.app_letterPadApplyTemplate()"><i class="fa-solid fa-file-lines"></i> Template</button>
                    <button type="button" class="action-btn secondary" onclick="window.app_letterPadSaveDraft()"><i class="fa-solid fa-floppy-disk"></i> Save Draft</button>
                    <button type="button" class="action-btn secondary" onclick="window.app_letterPadExportDocx()"><i class="fa-solid fa-file-word"></i> DOCX</button>
                    <button type="button" class="action-btn" onclick="window.app_letterPadExportPdf()"><i class="fa-solid fa-file-pdf"></i> PDF</button>
                </div>
            </div>

            <div class="letter-workspace">
                <aside class="letter-profile-panel">
                    ${renderSidebarSection('profile', 'Profile', 'fa-id-card', `
                        <select class="letter-profile-select" onchange="window.app_letterPadSelectProfile(this.value)">
                            ${profiles.map(p => `<option value="${safeAttr(p.id)}" ${p.id === active?.id ? 'selected' : ''}>${safeHtml(p.name)}${p.isDefault ? ' ★' : ''}</option>`).join('')}
                        </select>
                        <div class="letter-profile-buttons">
                            <button type="button" onclick="window.app_letterPadCreateProfile()"><i class="fa-solid fa-plus"></i> New</button>
                            <button type="button" onclick="window.app_letterPadRenameProfile()"><i class="fa-solid fa-pen"></i> Rename</button>
                            <button type="button" onclick="window.app_letterPadSetDefault()"><i class="fa-regular fa-star"></i> Default</button>
                            <button type="button" class="danger" onclick="window.app_letterPadDeleteProfile()"><i class="fa-solid fa-trash"></i> Delete</button>
                        </div>
                        <button type="button" class="letter-save-profile-btn" onclick="window.app_letterPadSaveProfile()">
                            <i class="fa-solid fa-cloud-arrow-up"></i> Profile auto-saved locally
                        </button>
                    `)}
                    ${active ? `
                        ${renderSidebarSection('letterhead', 'Letterhead', 'fa-image', `
                            ${renderImageSlot(active, 'header', 'Header image', 'headerImageUrl')}
                            ${renderImageSlot(active, 'footer', 'Footer image', 'footerImageUrl')}
                            ${renderImageSlot(active, 'watermark', 'Watermark', 'watermarkImageUrl')}
                            <label class="letter-toggle"><input type="checkbox" ${active.watermarkEnabled ? 'checked' : ''} onchange="window.app_letterPadUpdateSetting('watermarkEnabled', this.checked)"> Show watermark</label>
                        `)}
                        ${renderSidebarSection('signatories', 'Signatories', 'fa-pen-nib', `
                            ${renderPeopleManager(active, draft)}
                        `)}
                        ${renderSidebarSection('seals', 'Office Seals', 'fa-stamp', `
                            ${renderSealsManager(active)}
                        `)}
                        ${renderSidebarSection('settings', 'Page Settings', 'fa-sliders', `
                            <div class="letter-settings-grid">
                                <label>Margin top (mm) <input type="number" value="${active.margins.top}" onchange="window.app_letterPadUpdateSetting('margin.top', this.value)"></label>
                                <label>Margin bottom (mm) <input type="number" value="${active.margins.bottom}" onchange="window.app_letterPadUpdateSetting('margin.bottom', this.value)"></label>
                                <label>Margin left (mm) <input type="number" value="${active.margins.left}" onchange="window.app_letterPadUpdateSetting('margin.left', this.value)"></label>
                                <label>Margin right (mm) <input type="number" value="${active.margins.right}" onchange="window.app_letterPadUpdateSetting('margin.right', this.value)"></label>
                                <label class="letter-range-setting">Header height <span>${active.headerHeight}px</span><input type="range" min="60" max="220" value="${active.headerHeight}" oninput="this.previousElementSibling.textContent=this.value + 'px'; window.app_letterPadUpdateSetting('headerHeight', this.value)"><input type="number" min="60" max="220" value="${active.headerHeight}" onchange="window.app_letterPadUpdateSetting('headerHeight', this.value)"></label>
                                <label class="letter-range-setting">Footer height <span>${active.footerHeight}px</span><input type="range" min="45" max="180" value="${active.footerHeight}" oninput="this.previousElementSibling.textContent=this.value + 'px'; window.app_letterPadUpdateSetting('footerHeight', this.value)"><input type="number" min="45" max="180" value="${active.footerHeight}" onchange="window.app_letterPadUpdateSetting('footerHeight', this.value)"></label>
                            </div>
                        `)}
                    ` : ''}
                </aside>

                <main class="letter-editor-shell">
                    <div class="letter-ribbon">
                        <select onchange="window.app_letterPadExec('fontName', this.value)">${FONT_OPTIONS.map(f => `<option value="${safeAttr(f)}">${safeHtml(f)}</option>`).join('')}</select>
                        <select onchange="window.app_letterPadExec('fontSize', this.value)">${FONT_SIZES.map((s, i) => `<option value="${i + 1}" ${s === 12 ? 'selected' : ''}>${s}</option>`).join('')}</select>
                        <input type="color" value="#111827" onchange="window.app_letterPadExec('foreColor', this.value)" title="Font color">
                        <button type="button" onclick="window.app_letterPadExec('bold')" title="Bold"><i class="fa-solid fa-bold"></i></button>
                        <button type="button" onclick="window.app_letterPadExec('italic')" title="Italic"><i class="fa-solid fa-italic"></i></button>
                        <button type="button" onclick="window.app_letterPadExec('underline')" title="Underline"><i class="fa-solid fa-underline"></i></button>
                        <button type="button" onclick="window.app_letterPadExec('justifyLeft')" title="Align left"><i class="fa-solid fa-align-left"></i></button>
                        <button type="button" onclick="window.app_letterPadExec('justifyCenter')" title="Align center"><i class="fa-solid fa-align-center"></i></button>
                        <button type="button" onclick="window.app_letterPadExec('justifyRight')" title="Align right"><i class="fa-solid fa-align-right"></i></button>
                        <button type="button" onclick="window.app_letterPadExec('justifyFull')" title="Justify"><i class="fa-solid fa-align-justify"></i></button>
                        <button type="button" onclick="window.app_letterPadExec('insertUnorderedList')" title="Bullets"><i class="fa-solid fa-list-ul"></i></button>
                        <button type="button" onclick="window.app_letterPadExec('insertOrderedList')" title="Numbering"><i class="fa-solid fa-list-ol"></i></button>
                        <button type="button" onclick="window.app_letterPadExec('outdent')" title="Outdent"><i class="fa-solid fa-outdent"></i></button>
                        <button type="button" onclick="window.app_letterPadExec('indent')" title="Indent"><i class="fa-solid fa-indent"></i></button>
                        <select onchange="window.app_letterPadSetLineSpacing(this.value)" title="Line spacing">
                            <option value="1.2">1.2</option>
                            <option value="1.5" selected>1.5</option>
                            <option value="1.8">1.8</option>
                            <option value="2">2.0</option>
                        </select>
                        <button type="button" onclick="window.app_letterPadInsertDate()" title="Insert date"><i class="fa-solid fa-calendar-day"></i></button>
                        <button type="button" onclick="window.app_letterPadInsertRecipient()" title="Recipient"><i class="fa-solid fa-address-card"></i></button>
                        <button type="button" onclick="window.app_letterPadLoadDraft()" title="Load draft"><i class="fa-solid fa-folder-open"></i></button>
                        <button type="button" onclick="window.app_letterPadClearDraft()" title="Clear draft"><i class="fa-solid fa-eraser"></i></button>
                    </div>

                    <div class="letter-preview-scroll">
                        <article class="letter-page" style="${safeAttr(activeProfileCss(active))}">
                            <header class="letter-page-header">${profilePreviewImage(getSlotImageUrl(active, 'header'), 'Header')}</header>
                            ${active?.watermarkEnabled && getSlotImageUrl(active, 'watermark') ? `<img class="letter-watermark" src="${safeUrl(getSlotImageUrl(active, 'watermark'), '')}" alt="">` : ''}
                            <div id="letter-pad-editor" class="letter-page-body" contenteditable="true" spellcheck="true" oninput="window.app_letterPadSaveDraft({ silent: true })">${editorHtml}</div>
                            <footer class="letter-page-footer">${profilePreviewImage(getSlotImageUrl(active, 'footer'), 'Footer')}</footer>
                            <div class="letter-object-layer">${renderLetterPadObjects(draft)}</div>
                        </article>
                    </div>
                </main>
            </div>
        </section>
    `;
}
