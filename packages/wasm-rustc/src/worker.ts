/**
 * Web Worker that owns the rustc WASM instantiation.
 *
 * Messages in:
 *   { type: "init", version: string, baseUrl: string }
 *   { type: "compile", source: string, filename?: string, args?: string[], env?: string[] }
 *
 * Messages out:
 *   { type: "ready" }
 *   { type: "progress", loaded: number, total: number }
 *   { type: "result", success: boolean, stdout: string, stderr: string, objects: [string, number[]][] }
 *   { type: "error", message: string }
 */
import { fetchManifest } from "./manifest.js";
import type { Manifest } from "./manifest.js";
import { ReleaseCache } from "./cache.js";
import { createWasiEnvironment } from "./wasi.js";
import { WASIProcExit } from "@bjorn3/browser_wasi_shim";

interface InitMessage {
  type: "init";
  version: string;
  baseUrl: string;
}

interface CompileMessage {
  type: "compile";
  source: string;
  filename?: string;
  args?: string[];
  env?: string[];
}

export type WorkerMessage = InitMessage | CompileMessage;

let wasmModule: WebAssembly.Module | undefined;
let cache: ReleaseCache | undefined;
let manifest: Manifest | undefined;

addEventListener("message", async (event: MessageEvent<WorkerMessage>) => {
  try {
    switch (event.data.type) {
      case "init":
        await handleInit(event.data);
        break;
      case "compile":
        await handleCompile(event.data);
        break;
    }
  } catch (error) {
    postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

async function handleInit(msg: InitMessage): Promise<void> {
  if (cache !== undefined && wasmModule !== undefined) {
    postMessage({ type: "ready" });
    return;
  }

  manifest = await fetchManifest(msg.baseUrl, msg.version);

  cache = new ReleaseCache(msg.version);
  await cache.init();

  await cache.downloadAll(manifest, msg.baseUrl, (loaded, total) => {
    postMessage({ type: "progress", loaded, total });
  });

  const allFiles = await cache.getAll(manifest);

  // Find and compile the WASM binary
  const wasmPath = manifest.files.find((f) => f.path === "bin/rustc.wasm");
  if (wasmPath === undefined) {
    throw new Error("Manifest does not contain bin/rustc.wasm");
  }
  const wasmBuffer = allFiles.get(wasmPath.path);
  if (wasmBuffer === undefined) {
    throw new Error("Failed to load rustc.wasm from cache");
  }

  wasmModule = await WebAssembly.compile(wasmBuffer);

  postMessage({ type: "ready" });
}

async function handleCompile(msg: CompileMessage): Promise<void> {
  if (wasmModule === undefined || cache === undefined || manifest === undefined) {
    throw new Error("Worker not initialised — send init message first");
  }

  const filename = msg.filename ?? "main.rs";

  // Collect sysroot files from cache
  const sysrootFiles = new Map<string, ArrayBuffer>();
  const allFiles = await cache.getAll(manifest);
  for (const [path, buffer] of allFiles) {
    if (path.startsWith("lib/")) {
      sysrootFiles.set(path, buffer);
    }
  }

  const env = createWasiEnvironment({
    source: msg.source,
    filename,
    sysrootFiles,
    args: msg.args ?? [],
    env: msg.env ?? [],
  });

  try {
    const instance = await WebAssembly.instantiate(wasmModule, env.imports);
    env.setInstanceExports(instance.exports);
    env.wasi.start(instance as Parameters<typeof env.wasi.start>[0]);
  } catch (error) {
    // WASIProcExit is normal — rustc calls proc_exit when done
    if (!(error instanceof WASIProcExit)) {
      throw error;
    }
  }

  const objects = env.outputFiles();
  const objectEntries: [string, number[]][] = [];
  for (const [name, data] of objects) {
    objectEntries.push([name, Array.from(data)]);
  }

  // Success if stderr has no "error:" lines
  const stderrText = env.stderr();
  const hasError = /^error/m.test(stderrText);

  postMessage({
    type: "result",
    success: !hasError,
    stdout: env.stdout(),
    stderr: stderrText,
    objects: objectEntries,
  });
}
