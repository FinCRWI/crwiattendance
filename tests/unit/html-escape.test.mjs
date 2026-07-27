import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, escapeJsSingleQuote, escapeDialogHtml, renderDialogMessage } from '../../js/utils/html-escape.js';

describe('html-escape', () => {
    describe('escapeHtml', () => {
        it('escapes HTML special characters', () => {
            assert.equal(escapeHtml('<script>alert("x")\'s</script>'), '&lt;script&gt;alert(&quot;x&quot;)&#39;s&lt;/script&gt;');
        });

        it('handles null and undefined', () => {
            assert.equal(escapeHtml(null), '');
            assert.equal(escapeHtml(undefined), '');
        });

        it('leaves plain text unchanged', () => {
            assert.equal(escapeHtml('hello world'), 'hello world');
        });
    });

    describe('escapeJsSingleQuote', () => {
        it('escapes backslashes and single quotes', () => {
            assert.equal(escapeJsSingleQuote("it's \\ fine"), "it\\'s \\\\ fine");
        });

        it('escapes newlines', () => {
            assert.equal(escapeJsSingleQuote('line1\nline2'), 'line1\\nline2');
        });
    });

    describe('escapeDialogHtml', () => {
        it('is an alias for escapeHtml', () => {
            assert.equal(escapeDialogHtml('<b>test</b>'), escapeHtml('<b>test</b>'));
        });
    });

    describe('renderDialogMessage', () => {
        it('escapes HTML and preserves line breaks', () => {
            assert.equal(renderDialogMessage('Hello\n<b>world</b>'), 'Hello<br>&lt;b&gt;world&lt;/b&gt;');
        });
    });
});
