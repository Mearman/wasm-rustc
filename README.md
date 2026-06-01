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
                                    Cache Storage (lazy-loaded, ~224MB)
```

- **WASM binary**: rustc compiled with the `wasm32-wasip1-threads` target, requiring `SharedArrayBuffer` (COOP/COEP headers).
- **WASI runtime**: `@bjorn3/browser_wasi_shim` — pure JS WASI preview1 implementation with thread support.
- **Web Worker**: compilation runs off the main thread to avoid blocking the UI.
- **Lazy loading**: the WASM binary is not bundled. Users opt in to downloading it, after which it's cached in Cache Storage.

## Getting started

### Prerequisites

- Node.js 20+
- pnpm 10+

### Install

```bash
pnpm install
```

### Build

```bash
# Type-check all packages
pnnpm -r check

# Build the library
pnpm --filter wasm-rustc build
```

### Run the demo

```bash
pnpm --filter wasm-rustc-demo dev
```

The dev server sets COOP/COEP headers automatically. Open the URL shown in your terminal.

### Using the library

```typescript
import { Compiler } from "wasm-rustc";

const compiler = new Compiler();
await compiler.init({
  onProgress: (loaded, total) => console.log(`${Math.round(loaded / total * 100)}%`),
});

const result = await compiler.compile('fn main() { println!("hello"); }');
console.log(result.stdout);
compiler.dispose();
```

## Build pipeline

The `.github/workflows/build.yml` workflow:

1. Checks out `bjorn3/rust` at the `compile_rustc_for_wasm15` branch.
2. Installs wasi-sdk-20.
3. Builds rustc for `wasm32-wasip1-threads` via `x.py install`.
4. Generates a `manifest.json` listing all artefact files.
5. Publishes to GitHub Releases.

The build is triggered weekly or manually. Builds are cached — only a new upstream commit triggers a full rebuild.

### Build requirements

The CI build must run on Linux. Building locally also requires Linux with:
- GCC
- wasi-sdk-20
- ~32GB RAM recommended (rustc bootstrap is resource-intensive)

## Project structure

```
packages/wasm-rustc/     npm library (public API, worker, WASI runtime, cache layer)
packages/demo/           demo playground app (Vite + CodeMirror)
scripts/                 build tooling (manifest generator)
.github/workflows/       CI pipeline
```

## Gotchas

- **The WASM binary is large** (~80MB + ~144MB sysroot = ~224MB). Lazy loading with Cache Storage is the only viable delivery strategy. First load will be slow.
- **COOP/COEP headers are required.** `SharedArrayBuffer` needs `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Sites without these headers cannot use this project.
- **No linking (yet).** WASI doesn't support process spawning, so rustc cannot invoke an external linker. Compilation produces object files (`.o`). Full linking support is planned via migration to the `compile_rustc_for_wasm20` branch which integrates the wild linker.
- **Thread support is required.** The `wasm32-wasip1-threads` target needs a WASI runtime that supports `wasi/thread-spawn`.

## Conventions

- TypeScript strict mode with `noUncheckedIndexedAccess`.
- ES2022 modules throughout — no CommonJS.
- British English in all documentation and comments.
- Conventional commits for all changes.

## References

- [bjorn3/wasm-rustc](https://github.com/bjorn3/wasm-rustc) — original pre-built rustc.wasm
- [bjorn3/browser_wasi_shim](https://github.com/bjorn3/browser_wasi_shim) — WASI shim runtime (npm: `@bjorn3/browser_wasi_shim`)
- [bjorn3/rust `compile_rustc_for_wasm*` branches](https://github.com/bjorn3/rust) — patched rustc with WASM compilation support
- [LyonSyonII/rubri](https://github.com/LyonSyonII/rubri) — browser Miri wrapper, reference for caching and worker patterns
- [Rust Playground API](https://play.rust-lang.org) — server-side compilation API, always current
- [rust-lang/miri#722](https://github.com/rust-lang/miri/issues/722) — original discussion on running rustc in WASM
