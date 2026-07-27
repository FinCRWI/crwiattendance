import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { appAlert, appConfirm, appPrompt, appRequestMandatoryRejectionReason } from '../../js/modules/system-dialog.js';

function createMockDocument() {
    const elementsById = new Map();

    function makeQuerySelector(scope) {
        return (sel) => {
            if (sel.startsWith('#')) {
                return elementsById.get(sel.slice(1)) || null;
            }
            const className = sel.startsWith('.') ? sel.slice(1) : sel;
            for (const child of scope.children) {
                if (child.classList?.has(className)) return child;
                const nested = child.querySelector?.(sel);
                if (nested) return nested;
            }
            return null;
        };
    }

    function createElement(tag) {
        const listeners = {};
        const el = {};
        el.tag = tag;
        el.id = '';
        el.className = '';
        el.children = [];
        el.style = {};
        el.dataset = {};
        el.attributes = {};
        el.textContent = '';
        el.innerHTML = '';
        el.value = '';
        el.addEventListener = (type, handler) => {
            listeners[type] = listeners[type] || [];
            listeners[type].push(handler);
        };
        el.remove = () => { elementsById.delete(el.id); };
        el.closest = () => null;
        el.focus = () => {};
        el.select = () => {};
        el.classList = {
            classes: new Set(),
            add: (c) => el.classList.classes.add(c),
            remove: (c) => el.classList.classes.delete(c),
            has: (c) => el.classList.classes.has(c),
            contains: (c) => el.classList.classes.has(c)
        };
        el._trigger = (type, detail) => {
            (listeners[type] || []).forEach((h) => h(detail));
        };
        el.querySelector = makeQuerySelector(el);
        return el;
    }

    const body = createElement('body');
    body.insertAdjacentHTML = (_position, html) => {
        const idMatch = html.match(/id="([^"]+)"/);
        if (!idMatch) return;
        const rootId = idMatch[1];
        const rootEl = createElement('div');
        rootEl.id = rootId;
        rootEl.innerHTML = html;
        elementsById.set(rootId, rootEl);

        const classNames = ['app-system-dialog-confirm', 'app-system-dialog-cancel', 'app-system-dialog-close', 'app-system-dialog-input'];
        classNames.forEach((cls) => {
            if (html.includes(cls)) {
                const child = createElement(cls === 'app-system-dialog-input' ? 'input' : 'button');
                child.classList.classes.add(cls);
                if (cls === 'app-system-dialog-input') {
                    const inputIdMatch = html.match(/id="([^"]+-input)"/);
                    if (inputIdMatch) {
                        child.id = inputIdMatch[1];
                        elementsById.set(child.id, child);
                    }
                }
                rootEl.children.push(child);
            }
        });

        body.children.push(rootEl);
    };

    return {
        body,
        getElementById: (id) => elementsById.get(id) || null,
        createElement: (tag) => createElement(tag)
    };
}

describe('system-dialog', () => {
    beforeEach(() => {
        global.window = {};
        global.document = createMockDocument();
    });

    it('appAlert renders a modal and resolves true on confirm', async () => {
        const promise = appAlert('Hello', 'Title');
        const modal = global.document.body.children[0];
        assert.ok(modal, 'modal should be rendered');

        const confirmBtn = modal.querySelector('.app-system-dialog-confirm');
        confirmBtn._trigger('click');

        const result = await promise;
        assert.equal(result, true);
    });

    it('appConfirm resolves false on cancel', async () => {
        const promise = appConfirm('Are you sure?');
        const modal = global.document.body.children[0];
        const cancelBtn = modal.querySelector('.app-system-dialog-cancel');
        cancelBtn._trigger('click');

        const result = await promise;
        assert.equal(result, false);
    });

    it('appPrompt returns input value on confirm', async () => {
        const promise = appPrompt('Enter name', 'default');
        const modal = global.document.body.children[0];
        const input = modal.querySelector('.app-system-dialog-input');
        input.value = 'Alice';
        const confirmBtn = modal.querySelector('.app-system-dialog-confirm');
        confirmBtn._trigger('click');

        const result = await promise;
        assert.equal(result, 'Alice');
    });

    it('appPrompt returns null on cancel', async () => {
        const promise = appPrompt('Enter name');
        const modal = global.document.body.children[0];
        const cancelBtn = modal.querySelector('.app-system-dialog-cancel');
        cancelBtn._trigger('click');

        const result = await promise;
        assert.equal(result, null);
    });

    it('renders escaped HTML in the dialog body', async () => {
        const promise = appAlert('<b>bold</b>', '<i>title</i>');
        const modal = global.document.body.children[0];
        assert.ok(modal.innerHTML.includes('&lt;b&gt;bold&lt;/b&gt;'));
        assert.ok(modal.innerHTML.includes('&lt;i&gt;title&lt;/i&gt;'));
        modal.querySelector('.app-system-dialog-confirm')._trigger('click');
        await promise;
    });

    it('appRequestMandatoryRejectionReason rejects empty input and accepts text', async () => {
        let promptCount = 0;
        global.window.appPrompt = async () => {
            promptCount += 1;
            return promptCount === 1 ? '   ' : 'valid reason';
        };
        global.window.appAlert = async () => {};

        const result = await appRequestMandatoryRejectionReason();
        assert.equal(result, 'valid reason');
        assert.equal(promptCount, 2);
    });
});
