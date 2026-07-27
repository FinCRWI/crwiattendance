/**
 * Action Router — shared event delegation for `data-ts-action` attributes.
 *
 * Components register handlers for specific action names instead of
 * each registering their own `document` click listener. One listener
 * dispatches to all registered handlers.
 *
 * Usage:
 *   import { onAction } from '../utils/action-router.js';
 *   onAction('add-plan', () => window.app_quickAddPersonalPlan?.());
 *   onAction('edit-task', (el) => window.app_editDashboardActivity?.(...));
 */

/** @type {Map<string, (el: HTMLElement, event: MouseEvent) => void>} */
const handlers = new Map();
let bound = false;

function bootstrap() {
  if (bound) return;
  bound = true;
  document.addEventListener('click', (e) => {
    const el = e.target?.closest?.('[data-ts-action]');
    if (!el) return;
    const handler = handlers.get(el.dataset.tsAction);
    if (handler) handler(el, e);
  });
}

/**
 * Register a handler for a `data-ts-action` value.
 * The handler receives the matched element and the original click event.
 * @param {string} action  The value of data-ts-action to match
 * @param {(el: HTMLElement, event: MouseEvent) => void} fn
 */
export function onAction(action, fn) {
  bootstrap();
  handlers.set(action, fn);
}

/**
 * Unregister a handler.
 * @param {string} action
 */
export function offAction(action) {
  handlers.delete(action);
}
