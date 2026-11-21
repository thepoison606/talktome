# Optional web development guidance

Use [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance)
to look up browser APIs, accessibility, layout and UI patterns. This is a
development reference, not an application dependency or a release requirement.
The npm wrapper pins version 1.0.0 and disables its usage telemetry. The first
invocation downloads the tool through npm; later invocations can use npm's cache.

```sh
npm run web:guidance -- search "responsive data table"
npm run web:guidance -- retrieve <guide-id>
npm run web:guidance -- legacy-scan public --json
```

Scan the other web UIs in `bridge-client/src`, `server-app/src` and
`headless-client/src/web/assets` separately. Generated bundles such as
`public/mediasoup-client.js` and third-party code are not actionable findings.
For a reproducible review, scan a temporary copy containing only tracked,
first-party HTML, CSS and JavaScript from these directories.

The scanner finds a limited set of static patterns. Findings are review
suggestions, not errors or proof of a bug. Check surrounding code, existing
fallbacks and the guide's keep/drop rubric before proposing changes. Do not
automatically rewrite code or make this scan a blocking CI check.

## Browser policy

- Preserve functionality in Safari on iPhone/iPad and macOS, Firefox and
  Chromium browsers, plus the Tauri WebViews used by the desktop applications.
- Do not infer WebView support solely from the installed desktop browser.
- Prefer Baseline Widely Available features. Newer features require feature
  detection and a working fallback or a purely optional enhancement.
- `.mwgrc` leaves Origin Trial and volatile single-engine guidance disabled.
- Validate changes to press/release, touch, keyboard and pointer handling with
  special care: missing a release event can leave an intercom transmission on.
- Web guidance does not replace tests of WebRTC, native audio, React Native or
  the Rust clients.

## Coding-agent skill

The `modern-web-guidance` skill is installed locally in
`~/.codex/skills/modern-web-guidance`; it becomes available on the next turn.
Other developers can install that skill from
`GoogleChrome/modern-web-guidance`, path `skills/modern-web-guidance`.
The installed skill is a local developer setting and is not included in builds.

See [the initial review](web-guidance-review-2026-11-15.md) for verified proposals.
