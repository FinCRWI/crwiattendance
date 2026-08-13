- [x] Implement fix in js/modules/day-plan.js so day switching only fetches data for the selected date.
  - [x] Remove AppDB.queryMany('work_plans', [{field:'date', operator:'==', value: date}]) usage from openDayPlan() hydration (routed through loadDayPlanData).
  - [x] Remove AppDB.queryMany('work_plans', [{field:'date', operator:'==', value: safeDate}]) usage from prefetch logic (routed through loadDayPlanData).
  - [x] Add helper to fetch day plans by doc ids only (annual shared + per-user personal plans): AppDB.getDayPlansByIds in js/modules/db.js; loadDayPlanData uses it with the cached users list, with getDayPlansByDate retained as an error-only fallback.
  - [x] Validate that othersBlocks still render correctly from fetched plans (doc ids follow plan_{userId}_{date} / plan_annual_{date}; covered by tests/unit/day-plan-doc-ids.test.mjs).
- [x] Run app / quick smoke test: open multiple day clicks and confirm no full collection reads.


