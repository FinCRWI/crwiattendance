/**
 * Check-out form modal rendering.
 *
 * Submit handlers, location capture, and attendance persistence stay in app.js
 * and modules/attendance.js. This file owns only the checkout form UI markup
 * and its small visibility observer.
 */

export function renderCheckoutModal(budgetSelectHtml = '<option value="UNALLOCATED">Unallocated / To Be Mapped</option>') {
    return `
        <!-- Check-Out Modal -->
        <div id="checkout-modal" class="modal-overlay checkout-main-modal" style="display: none;">
            <div class="modal-content checkout-main-content">
                <div class="checkout-modal-header">
                    <div>
                        <h3 class="checkout-modal-title">Check Out</h3>
                        <p class="checkout-modal-subtitle">Update task outcomes, add notes, and close today’s attendance.</p>
                    </div>
                    <span class="checkout-modal-badge">Attendance</span>
                </div>
                <form id="checkout-form" novalidate>
                    <div id="checkout-extra-time-banner" class="checkout-extra-time-banner" style="display:none;">
                        <i class="fa-solid fa-clock"></i>
                        <span id="checkout-extra-time-banner-text">You worked extra time today — please review the confirmation section below.</span>
                        <button type="button" class="checkout-extra-time-banner-close" onclick="document.getElementById('checkout-extra-time-banner').style.display='none'">&times;</button>
                    </div>
                    <div class="checkout-form-grid">
                        <section class="checkout-form-panel checkout-summary-panel">
                            <label class="checkout-section-label">Work Summary</label>
                            <textarea name="description" class="checkout-summary-input" placeholder="- Completed monthly report&#10;- Fixed login bug..."></textarea>
                        </section>

                        <section class="checkout-form-panel checkout-tomorrow-panel">
                            <label>Tomorrow Goal (Optional)</label>
                            <textarea name="tomorrowGoal" placeholder="e.g., Finalize the project report..."></textarea>
                            <div class="checkout-budget-field">
                                <label>Tomorrow Goal Budget Head</label>
                                <select name="tomorrowBudgetHeadId">
                                    ${budgetSelectHtml}
                                </select>
                            </div>
                        </section>

                        <section id="checkout-extra-time-section" class="checkout-form-panel checkout-extra-time-panel" style="display:none;">
                            <div class="checkout-extra-time-header">
                                <label class="checkout-section-label">Extra Time Confirmation</label>
                                <span id="checkout-extra-time-badge" class="checkout-extra-time-badge">> 2 hours</span>
                            </div>
                            <p id="checkout-extra-time-hint" class="checkout-extra-time-hint">You worked beyond 2 hours extra. Please confirm how much time was actually spent working.</p>
                            
                            <div class="checkout-extra-time-options">
                                <label class="checkout-extra-time-option">
                                    <input type="radio" name="extraTimeMode" value="full" onchange="window.app_handleExtraTimeModeChange('full')">
                                    <span>Full Extra Time</span>
                                </label>
                                <label class="checkout-extra-time-option">
                                    <input type="radio" name="extraTimeMode" value="partial" checked onchange="window.app_handleExtraTimeModeChange('partial')">
                                    <span>Partial Extra Time</span>
                                </label>
                            </div>

                            <div id="checkout-partial-time-container" class="checkout-partial-time-container" style="display:none;">
                                <label class="checkout-partial-time-label">Select actual hours worked:</label>
                                <div class="checkout-slider-wrapper">
                                    <input type="range" id="checkout-extra-time-slider" class="checkout-extra-time-slider" min="0" max="120" value="120" oninput="window.app_updateExtraTimeDisplay(this.value)">
                                    <div class="checkout-slider-display">
                                        <span id="checkout-extra-time-display">2h 0m</span>
                                        <span class="checkout-slider-max">Max: <span id="checkout-extra-time-max">2h 0m</span></span>
                                    </div>
                                </div>
                            </div>

                            <div class="checkout-extra-time-justification">
                                <label class="checkout-extra-time-justification-label">What was done during this extra time?</label>
                                <div id="checkout-extra-time-entries" class="checkout-extra-time-entries">
                                    <div class="checkout-extra-time-entry-row">
                                        <textarea id="checkout-extra-time-justification" name="extraTimeJustification" class="checkout-extra-time-justification-input" placeholder="e.g., Prepared AGM reports, Handled urgent client call..."></textarea>
                                        <button type="button" class="checkout-extra-time-entry-remove" style="display:none;" tabindex="-1"><i class="fa-solid fa-xmark"></i></button>
                                    </div>
                                </div>
                                <button type="button" class="checkout-extra-time-add-btn" onclick="window.app_addExtraTimeEntry()">+ Add more</button>
                            </div>
                        </section>
                    </div>

                    <section id="checkout-plan-ref" class="checkout-plan-ref" style="display:none;">
                        <div class="checkout-plan-ref-head">
                            <label>Today’s Work Plan</label>
                            <button type="button" onclick="window.app_useWorkPlan()">Use This</button>
                        </div>
                        <div id="checkout-plan-text" class="checkout-plan-text"></div>
                    </section>

                    <section id="checkout-task-checklist" class="checkout-task-checklist">
                        <label class="checkout-section-label">Today's Task Status</label>
                        <div id="checkout-task-list" class="checkout-task-list">
                            <!-- Populated by JS -->
                        </div>
                    </section>

                    <section id="checkout-action-preview" class="checkout-action-preview" style="display: none;">
                        <label class="checkout-section-label">Action Preview</label>
                        <div id="checkout-action-preview-list" class="checkout-action-preview-list">
                            <!-- Populated by JS -->
                        </div>
                    </section>

                    <section id="delegate-panel" class="checkout-delegate-panel" style="display:none;">
                        <h4 id="delegate-selected-task"></h4>
                        <label>Choose staff member:</label>
                        <div id="delegate-list" class="checkout-delegate-list">
                            <!-- Populated by JS -->
                        </div>
                        <div class="checkout-delegate-actions">
                            <button type="button" onclick="window.app_handleChecklistAction(null, null, null)" class="action-btn secondary">Cancel Delegation</button>
                        </div>
                    </section>

                    <div id="checkout-location-loading" class="checkout-location-loading" style="display:none;">
                         <span><i class="fa-solid fa-spinner fa-spin"></i> <span id="checkout-location-message">Capturing location</span></span>
                         <span id="checkout-location-timer" class="checkout-location-timer">00:00</span>
                    </div>
                    <div id="checkout-location-mismatch" class="checkout-location-mismatch" style="display:none;">
                         <div class="checkout-location-mismatch-title">
                            <i class="fa-solid fa-triangle-exclamation"></i> Location Mismatch
                         </div>
                         <p>You are checking out from a different location than where you checked in. Please explain:</p>
                         <textarea name="locationExplanation" placeholder="e.g. Field visit, Client site..."></textarea>
                    </div>

                    <div class="checkout-actions">
                        <button type="button" class="checkout-cancel-btn" onclick="document.getElementById('checkout-modal').style.display = 'none'; window.app_resetCheckoutLocationSession?.();">Cancel</button>
                        <button type="submit" class="action-btn checkout checkout-submit-btn">Complete Check-Out</button>
                    </div>
                </form>
            </div>
        </div>`;
}

export function initCheckoutObserver() {
    if (typeof window === 'undefined') return;

    const checkoutObserver = new MutationObserver((mutations) => {
        mutations.forEach(() => {
            const modal = document.getElementById('checkout-modal');
            const introPanel = document.getElementById('checkout-intro-panel');

            if (modal && introPanel && modal.style.display !== 'none') {
                const introSeen = localStorage.getItem('checkoutIntroSeen');
                if (!introSeen) {
                    introPanel.style.display = 'block';
                }
            }
        });
    });

    const startObserving = () => {
        const modalContainer = document.body;
        if (modalContainer) {
            checkoutObserver.observe(modalContainer, {
                attributes: true,
                subtree: true,
                attributeFilter: ['style']
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startObserving);
    } else {
        startObserving();
    }
}

if (typeof window !== 'undefined') {
    initCheckoutObserver();
}
