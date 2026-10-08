# Windows NDI crash investigation - issue #144

Local investigation on 2026-10-08 for [issue #144](https://github.com/thepoison606/talktome/issues/144).

## Confirmed local failure

The original `src-tauri/src/ndi.rs` from commit `5df0077` was compiled into a native diagnostic program. Surrounding application types were stubbed; all NDI calls used the actual repository code and installed runtime. Environment: Windows build 26200, NDI SDK WIN64 6.3.2.0. A separate process published eight-channel, 48 kHz audio.

The original program reproduced `0xc0000005` in `ntdll.dll`. LLDB captured the native call stack and a minidump. Relevant frames, from the application to the exception:

```text
ndi::audio_devices()                      baseline.rs:583
drop glue for NdiApi
libloading::os::windows::Library::drop()  libloading/mod.rs:330
KernelBase!FreeLibrary
ntdll!LdrUnloadDll
Processing.NDI.Lib.x64.dll teardown
ntdll!RtlEnterCriticalSection
0xc0000005: write to address 0x24
```

The faulting instruction was `incl 0x24(%rax)` with `rax == 0`. The local failure happens during DLL unloading at the end of a query.

A control build disabled channel probing completely and still crashed. Its stack ended in `ndi::status()` at the original line 604, followed by the same `FreeLibrary` path. The debugger log explicitly records both first-chance and unhandled second-chance `0xc0000005` events. Removing the automatic receiver probe does not fix this lifecycle failure.

The original code called `NDIlib_initialize()` for every query, then dropped the library without `NDIlib_destroy()`. These lifecycle functions are documented in [Startup and Shutdown](https://docs.ndi.video/all/developing-with-ndi/sdk/startup-and-shutdown). Matching private NDI symbols are unavailable, so the exact SDK destructor/internal defect is unidentified. The application lifecycle and native unload path are confirmed locally; the issue reporter's crash has no stack for direct comparison.

## Isolated comparisons

| Variant | Result |
| --- | --- |
| Original | Native access violation during DLL unloading |
| Channel probing disabled | Same unhandled exception after a status query |
| `NDIlib_destroy()` before unloading | 30 scans and exit code 0; no eight-channel detection in that run |
| Retain one initialized API | 30 scans and exit code 0; eight channels detected after the initial scan |
| Final minimal patch under LLDB | 100 scans and exit code 0; eight channels in 99/100 scans; no access violation or unhandled exception in the debugger log |

Retaining the initialized runtime avoids repeated native startup and preserves working automatic channel detection.

## DLL lifetime patch and validation

Only `src-tauri/src/ndi.rs` changes: retain one initialized `Arc<NdiApi>` for the process lifetime and share it between queries and audio streams. Failed loads remain retryable. A regression test verifies that dropping temporary query handles does not unload the runtime.

The earlier experimental subprocess, fallback, UI and server changes were removed from the working patch. Discovery and probing keep their existing behavior, including the existing stereo fallback when no frame arrives within the probe window. The first of the 100 scans used that fallback; the remaining 99 detected eight channels.

- Full Bridge `cargo check --locked --tests` passed on Windows GNU. Local compilation excluded FFmpeg sidecar packaging through `TAURI_CONFIG`; no installer was built.
- Seven NDI tests passed in the native diagnostic harness.
- The existing cross-process NDI audio loopback passed.
- The final 100-scan run exited normally under LLDB, with no `0xc0000005` or second-chance exception recorded.

Local artifacts are in the ignored `.cache/ndi-diagnostics/` directory:

- `debugger-baseline-dump.log`, `baseline-crash.dmp`: original live stacks and stack minidump; retain the original executable and runtime for dump analysis.
- `no-probe-crash-stack.log`, `no-probe-events.log`: disabled-probe control and unhandled exception evidence.
- `minimal-fix-debugger.log`, `minimal-fix-events.log`: final debugger validation.
- `minimal-fix-cargo-check.log`, `minimal-fix-tests.log`, `minimal-fix-loopback.log`: checks.
- `experimental-fix/`: backup of the discarded broader patch.

## Follow-up: persistent backend timeout

During interactive testing, the Bridge continued showing the session-disabled NDI message after no NDI query worker remained in the live debugger thread stacks. The original timeout flag was permanent, including when a slow worker subsequently completed. Empty discovery also repeated the two-second initial wait, and the supposedly lightweight inventory watcher ran full receiver/channel probes.

The backend now permits one outstanding query at a time, retains the last known devices while it is busy, and releases the query guard on completion or Rust unwinding. It never retries over a still-running native worker. Completed slow queries can be followed by Refresh without restarting the Bridge. NDI's initial discovery wait applies only to the first discovery, concurrent discovery returns cached sources instead of waiting for the lock, and periodic snapshots omit NDI channel probing.

Validation: 14 Rust tests passed in the native backend harness, including timeout recovery, refusal to overlap an unfinished worker, cached device retention and nonblocking concurrent discovery. A concurrent native scan/status run ended with NDI available and no error. Full Bridge compilation checks and three UI regression tests passed. Logs are `backend-tests.log`, `backend-concurrent.log` and `backend-cargo-check.log` under `.cache/run-tools/`.

Test senders were stopped after validation. Source changes remain uncommitted.
