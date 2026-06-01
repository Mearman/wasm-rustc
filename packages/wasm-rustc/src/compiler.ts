/**
 * Public API for wasm-rustc.
 *
 * Usage:
 *   const compiler = new Compiler();
 *   await compiler.init({ onProgress: (l, t) => console.log(l/t) });
 *   const result = await compiler.compile('fn main() { println!("hi"); }');
 *   console.log(result.stdout);
 *   compiler.dispose();
 */

export interface CompilerInitOptions {
  /**
   * Release version tag. Defaults to "latest" which resolves to the
   * most recent release on GitHub.
   */
  release?: string;
  /**
   * Base URL for release artefacts. Defaults to this repo's GitHub
   * Releases URL.
   */
  baseUrl?: string;
  /**
   * Progress callback. Called periodically with cumulative bytes
   * downloaded and total expected bytes.
   */
  onProgress?: (loaded: number, total: number) => void;
}

export interface CompilerOptions {
  /** Compilation target. Default: "x86_64-unknown-linux-gnu" */
  target?: string;
  /** Crate type: "bin", "lib", etc. Default: "bin" */
  crateType?: string;
  /** Rust edition: "2021", "2024", etc. Default: "2021" */
  edition?: string;
  /** Optimisation level: "0", "1", "2", "3". Default: "0" */
  optLevel?: string;
  /** Source filename. Default: "main.rs" */
  filename?: string;
  /** Extra compiler flags. */
  extraArgs?: string[];
}

export interface Diagnostic {
  level: "error" | "warning" | "note";
  message: string;
  line?: number;
  column?: number;
}

export interface CompileResult {
  /** Whether rustc exited successfully (exit code 0). */
  success: boolean;
  /** Captured stdout from rustc. */
  stdout: string;
  /** Captured stderr from rustc (includes diagnostics). */
  stderr: string;
  /** Parsed diagnostics extracted from stderr. */
  diagnostics: Diagnostic[];
  /** Generated object files, keyed by filename. */
  objects: Map<string, Uint8Array>;
}

const DEFAULT_BASE_URL = "https://github.com/joegrip/wasm-rustc/releases/download";
const DEFAULT_TARGET = "x86_64-unknown-linux-gnu";

type WorkerResult = {
  type: "result";
  success: boolean;
  stdout: string;
  stderr: string;
  objects: [string, number[]][];
};

type WorkerReady = { type: "ready" };

type WorkerProgress = { type: "progress"; loaded: number; total: number };

type WorkerError = { type: "error"; message: string };

type WorkerResponse = WorkerResult | WorkerReady | WorkerProgress | WorkerError;

export class Compiler {
  private worker: Worker | undefined;
  private ready: Promise<void> | undefined;
  private resolveReady: (() => void) | undefined;

  /**
   * Download and cache the rustc WASM binary + sysroot.
   * Must be called before compile(). Resolves when the worker
   * reports readiness.
   */
  async init(options?: CompilerInitOptions): Promise<void> {
    const release = options?.release ?? "latest";
    const baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;

    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    this.worker = new Worker(
      new URL("./worker.ts", import.meta.url),
      { type: "module" },
    );

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      switch (data.type) {
        case "ready":
          this.resolveReady?.();
          break;
        case "progress":
          options?.onProgress?.(data.loaded, data.total);
          break;
        case "error":
          console.error("wasm-rustc worker error:", data.message);
          break;
      }
    };

    this.worker.onerror = (event) => {
      console.error("wasm-rustc worker error:", event.message);
    };

    this.worker.postMessage({
      type: "init",
      version: release,
      baseUrl,
    });

    await this.ready;
  }

  /**
   * Compile Rust source code.
   */
  async compile(source: string, options?: CompilerOptions): Promise<CompileResult> {
    if (this.worker === undefined) {
      throw new Error("Compiler not initialised — call init() first");
    }

    const args = buildArgs(options);
    const filename = options?.filename ?? "main.rs";

    return new Promise<CompileResult>((resolve, reject) => {
      const handler = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data;
        if (data.type === "result") {
          this.worker?.removeEventListener("message", handler);

          const objects = new Map<string, Uint8Array>();
          for (const [name, bytes] of data.objects) {
            objects.set(name, new Uint8Array(bytes));
          }

          resolve({
            success: data.success,
            stdout: data.stdout,
            stderr: data.stderr,
            diagnostics: parseDiagnostics(data.stderr),
            objects,
          });
        } else if (data.type === "error") {
          this.worker?.removeEventListener("message", handler);
          reject(new Error(data.message));
        }
      };

      this.worker!.addEventListener("message", handler);
      this.worker!.postMessage({
        type: "compile",
        source,
        filename,
        args,
        env: [],
      });
    });
  }

  /**
   * Terminate the worker and free resources.
   */
  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = undefined;
    this.resolveReady = undefined;
  }
}

/**
 * Build rustc command-line arguments from CompilerOptions.
 */
function buildArgs(options?: CompilerOptions): string[] {
  const target = options?.target ?? DEFAULT_TARGET;
  const crateType = options?.crateType ?? "bin";
  const edition = options?.edition ?? "2021";
  const optLevel = options?.optLevel ?? "0";

  const args = [
    "rustc",
    `/${options?.filename ?? "main.rs"}`,
    "--sysroot", "/sysroot",
    "--target", target,
    "--crate-type", crateType,
    "--edition", edition,
    `-Copt-level=${optLevel}`,
    "-Cpanic=abort",
    "-Ccodegen-units=1",
  ];

  if (options?.extraArgs) {
    args.push(...options.extraArgs);
  }

  return args;
}

/**
 * Best-effort parsing of rustc diagnostics from stderr output.
 * rustc outputs JSON diagnostics when --error-format=json is used,
 * but we're not using that flag so we parse the human-readable output
 * for basic level extraction.
 */
function parseDiagnostics(stderr: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = stderr.split("\n");
  const levelPattern = /^error(?:\[\w+\])?:|^warning:|^note:/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = line.match(levelPattern);
    if (match !== null) {
      let level: Diagnostic["level"] = "note";
      if (line.startsWith("error")) {
        level = "error";
      } else if (line.startsWith("warning")) {
        level = "warning";
      }
      diagnostics.push({
        level,
        message: line.replace(levelPattern, "").trim(),
      });
    }
  }

  return diagnostics;
}

// Re-export types
export type { Manifest, ManifestFile } from "./manifest.js";
