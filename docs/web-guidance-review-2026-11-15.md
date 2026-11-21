# Initial web guidance review — 2026-11-15

Source baseline: `6e4e045` (v1.6.4 draft). Application code was not changed by
this review. The optional tooling setup is a separate, uncommitted change.

## Scope and method

- Modern Web Guidance npm CLI **1.0.0**, telemetry disabled, Origin Trial and
  volatile feature guidance disabled.
- Scanned **36 tracked, first-party HTML/CSS/JavaScript files** from `public`,
  `bridge-client/src`, `server-app/src`, and `headless-client/src/web/assets`.
- Staged these files in a temporary directory to exclude dependencies, build
  output, `public/mediasoup-client.js`, native code and test fixtures.
- The completed directory scan checked **33 guides / 35 deterministic rules**
  and returned **one finding**. This is only a subset of the guidance corpus;
  zero findings elsewhere is not a general accessibility or performance pass.
- Checked the finding's keep/drop rubric against the source and reproduced
  the event-handling issue in a headless Chromium browser using the real
  Target Picker module and synthetic keyboard events.
- Additional per-file scans agreed on this finding; the separate per-file
  scan of `public/client.js` exceeded its 20-second limit. The completed
  directory scan above did include that file.

## Confirmed proposal: protect Target Picker Enter from IME confirmation

**Location:** `public/targetPicker.js:107`.

The search field's Enter handler calls Apply without checking whether the user
is confirming an IME character candidate. The current handler can therefore
close the picker and apply its current selection while the user is still
typing Chinese, Japanese or Korean text. This shared picker is used in the
admin and desktop Bridge interfaces.

The automated browser check dispatched these events on the real search input:

| Event | Current result | Desired result |
| --- | --- | --- |
| Enter, `isComposing: true` | Apply callback runs; picker closes | Keep picker open; do not apply |
| Enter, `keyCode: 229` | Apply callback runs; picker closes | Keep picker open; do not apply |
| Normal Enter, `keyCode: 13` | Apply callback runs; picker closes | Keep existing behavior |

**Suggested change:** gate the custom Enter action with both
`event.isComposing` and `event.keyCode === 229`, retaining the Safari workaround
described in the [IME-safe Enter guide](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/ime-safe-enter-submit.md).
Verify the guide's current URL with `npm run web:guidance -- retrieve
ime-safe-enter-submit` if the upstream guide is reorganized.

**Priority:** small correctness fix; limited impact for direct Latin keyboard
input. **Risk:** low if the change remains inside the search field's existing
Enter handler. It should not alter global talk shortcuts or press/release.

**Validation for implementation:** assert that both composition cases keep the
dialog open with no callback, ordinary Enter applies once, and Cancel/Escape
still discard changes. Also test a real IME on Safari/iOS or macOS; synthetic
Chromium events establish the missing guard but do not reproduce every OS
composition sequence. No fix has been applied in this review.

## Further proposals from source inspection, not scanner findings

1. **Consolidate modal behavior gradually.** `public/admin.html` contains
   custom `role="dialog"` overlays, while the shared Target Picker and feed
   camera picker use native `<dialog>`. The custom admin action dialog already
   has Tab trapping, Escape handling and focus restoration (`public/admin.js`);
   these are not missing wholesale. A future migration could reduce duplicate
   focus/scroll/overlay handling, but needs separate keyboard, screen-reader
   and Safari/WebView tests. Priority: maintenance improvement; medium risk.
2. **Review settings-popover positioning separately.**
   `public/index.html:2857` positions settings against `visualViewport`, including
   resize and scroll. Native popover/anchor positioning may simplify parts of
   this, but must preserve keyboard, on-screen keyboard, zoom, clipping and
   older WebView behavior. Keep the existing solution until a measured
   replacement works across supported browsers. Priority: optional; medium risk.

Neither proposal justifies a broad rewrite or a late release change.

## Existing safeguards worth preserving

- The shared Target Picker already uses native `<dialog>`, has an accessible
  search name, a visible Cancel action, native Escape handling and focus return.
- Admin autosave feedback already uses live status regions with Retry on failure.
- The client already uses `visualViewport` and `ResizeObserver` for important
  layout work. The presence of JavaScript sizing code alone is not a defect.
- PTT/talk controls need their own press/release tests; visual modernization
  must not leave transmission active when focus or pointer capture changes.

## Suggested order

The small IME fix was selected first (see follow-up below). Consider modal consolidation during a future
UI change that already touches those dialogs. Leave viewport and audio-related
logic intact until there is a concrete measured problem.

## Follow-up: approved IME fix implemented

Commit `ea054ab` guards the Target Picker's existing Enter handler with
`event.isComposing` and `event.keyCode === 229`. Composition events keep their
default browser behavior; ordinary Enter still prevents the default action
and applies the selection once.

A headless Chromium check against the real module verified both composition
cases, ordinary Enter, Escape, Cancel, the Apply button and focus restoration.
All 428 existing Node tests passed. Real OS IME testing on Safari remains a
useful additional check. The published v1.6.4 release was not modified.

Tool documentation: [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance).
This review is advisory and is not a release gate.
