# wasm-rustc

A browser-side Rust compiler built from a recent rustc compiled to WASM.

## Why

Existing options:

- **Rust Playground API** (`play.rust-lang.org`) — always current, but requires network. The de-facto standard for learning tools.
- **`bjorn3/wasm-rustc`** — a pre-built `rustc.wasm` (~80MB) from a patched Rust nightly, last updated April 2024. Demonstrates feasibility but is stale and unmaintained as a binary distribution.

This project builds a current rustc for `wasm32-wasip1-threads` on a regular cadence so the WASM binary stays close to stable Rust.

## Architecture

```
rustc (patched) → wasm32-wasip1-threads → rustc.wasm
                                              ↓
                                    browser_wasi_shim (WASI runtime)
                                              ↓
                                    Web Worker + SharedArrayBuffer
                                              ↓
                                    Cache Storage (lazy-loaded, ~80MB)
```

- **WASM binary**: rustc compiled with the `wasm32-wasip1-threads` target, requiring `SharedArrayBuffer` (COOP/COEP headers).
- **WASI runtime**: to be determined — options include `@bjorn3/browser_wasi_shim`, a custom shim, or another WASI implementation. Must support whichever `wasm32-wasi*` target we compile rustc for.
- **Web Worker**: compilation runs off the main thread to avoid blocking the UI.
- **Lazy loading**: the WASM binary is not bundled. Users opt in to downloading it, after which it's cached in Cache Storage.

## Gotchas

- The WASM binary is large (~80MB). Lazy loading with Cache Storage is not optional — it's the only viable delivery strategy.
- `SharedArrayBuffer` requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. Sites without these headers cannot use this project.
- The `wasm32-wasip1-threads` target requires threads support in the WASM runtime.

## References

- [bjorn3/wasm-rustc](https://github.com/bjorn3/wasm-rustc) — original pre-built rustc.wasm
- [bjorn3/browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim) — WASI shim runtime (npm: `@bjorn3/browser_wasi_shim`)
- [bjorn3/rust `compile_rustc_for_wasm*` branches](https://github.com/bjorn3/rust) — patched rustc with WASM compilation support
- [Rust Playground API](https://play.rust-lang.org) — server-side compilation API, always current
- [rust-lang/miri#722](https://github.com/rust-lang/miri/issues/722) — original discussion on running rustc in WASM
