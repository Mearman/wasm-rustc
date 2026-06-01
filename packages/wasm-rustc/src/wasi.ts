import {
  Fd,
  File,
  Directory,
  PreopenDirectory,
  WASI,
  strace,
} from "@bjorn3/browser_wasi_shim";
import type { Inode } from "@bjorn3/browser_wasi_shim";

/**
 * Buffered stdio file descriptor that collects output into a byte array.
 */
class BufferedStdio extends Fd {
  private readonly chunks: Uint8Array[] = [];

  fd_write(data: Uint8Array): { ret: number; nwritten: number } {
    this.chunks.push(new Uint8Array(data));
    return { ret: 0, nwritten: data.byteLength };
  }

  /** Collect all written chunks into a single string. */
  text(): string {
    const decoder = new TextDecoder("utf-8");
    let result = "";
    for (const chunk of this.chunks) {
      result += decoder.decode(chunk);
    }
    return result;
  }

  /** Reset the buffer for reuse across compilations. */
  clear(): void {
    this.chunks.length = 0;
  }
}

export interface WasiConfig {
  /** Source code to compile. */
  source: string;
  /** Source filename (e.g. "main.rs"). */
  filename: string;
  /**
   * Map from relative path (within sysroot) to file content.
   * Typically loaded from the release cache — keys like
   * "lib/rustlib/x86_64-unknown-linux-gnu/lib/libcore-HASH.rlib".
   */
  sysrootFiles: Map<string, ArrayBuffer>;
  /** Compiler arguments (default: ["rustc", "/main.rs", ...]). */
  args: string[];
  /** Environment variables. */
  env: string[];
}

export interface WasiEnvironment {
  wasi: WASI;
  imports: WebAssembly.Imports;
  stdout: () => string;
  stderr: () => string;
  outputFiles: () => Map<string, Uint8Array>;
  setInstanceExports: (exports: WebAssembly.Exports) => void;
}

/**
 * Set up the WASI environment for a single compilation run.
 * Returns the WASI instance, the import object for WebAssembly.instantiate,
 * and accessors for stdout/stderr/output files.
 */
export function createWasiEnvironment(config: WasiConfig): WasiEnvironment {
  const stdin = new BufferedStdio();
  const stdout = new BufferedStdio();
  const stderr = new BufferedStdio();

  // Build the sysroot directory structure from the cached rlib files
  const sysroot = buildSysroot(config.sysrootFiles);
  const tmp = new PreopenDirectory("/tmp", new Map());

  // Root directory holds the source file
  const rootContents = new Map<string, Inode>();
  rootContents.set(
    config.filename,
    new File(new TextEncoder().encode(config.source)),
  );

  const root = new PreopenDirectory("/", rootContents);

  const fds: Fd[] = [
    stdin,   // 0: stdin
    stdout,  // 1: stdout
    stderr,  // 2: stderr
    tmp,     // 3: /tmp
    sysroot, // 4: /sysroot
    root,    // 5: /
  ];

  const args = config.args.length > 0
    ? config.args
    : [
        "rustc",
        `/${config.filename}`,
        "--sysroot", "/sysroot",
        "--target", "x86_64-unknown-linux-gnu",
        "-Cpanic=abort",
        "-Ccodegen-units=1",
      ];

  const wasi = new WASI(args, config.env, fds, { debug: false });
  let nextThreadId = 1;

  // Reference to instance exports, set after instantiation
  let instanceExports: WebAssembly.Exports | undefined;

  const imports: WebAssembly.Imports = {
    env: {
      memory: new WebAssembly.Memory({
        initial: 256,
        maximum: 16384,
        shared: true,
      }),
    },
    wasi: {
      "thread-spawn": (startArg: number): number => {
        const threadId = nextThreadId++;
        const threadStart = instanceExports?.["wasi_thread_start"];
        if (typeof threadStart !== "function") {
          throw new Error("wasi_thread_start export not found");
        }
        (threadStart as (tid: number, arg: number) => void)(threadId, startArg);
        return threadId;
      },
    },
    wasi_snapshot_preview1: strace(wasi.wasiImport, ["fd_prestat_get"]),
  };

  return {
    wasi,
    imports,
    stdout: () => stdout.text(),
    stderr: () => stderr.text(),
    outputFiles: () => collectOutputFiles(root),
    setInstanceExports: (exports: WebAssembly.Exports) => {
      instanceExports = exports;
    },
  };
}

/**
 * Build the sysroot PreopenDirectory from cached rlib files.
 *
 * The sysroot structure mirrors a standard rustc installation:
 *   /sysroot/lib/rustlib/x86_64-unknown-linux-gnu/lib/*.rlib
 */
function buildSysroot(
  files: Map<string, ArrayBuffer>,
): PreopenDirectory {
  // Collect rlib files into a Map for the x86_64 lib directory
  const x86LibEntries = new Map<string, Inode>();
  for (const [relativePath, buffer] of files) {
    // Only include files under lib/rustlib/x86_64-unknown-linux-gnu/lib/
    if (relativePath.startsWith("lib/rustlib/x86_64-unknown-linux-gnu/lib/")) {
      const parts = relativePath.split("/");
      const filename = parts[parts.length - 1]!;
      x86LibEntries.set(filename, new File(new Uint8Array(buffer)));
    }
  }

  const sysrootContents = new Map<string, Inode>();
  sysrootContents.set("lib", new Directory(
    new Map([
      ["rustlib", new Directory(
        new Map([
          ["wasm32-wasi", new Directory(
            new Map([["lib", new Directory(new Map())]]),
          )],
          ["x86_64-unknown-linux-gnu", new Directory(
            new Map([["lib", new Directory(x86LibEntries)]]),
          )],
        ]),
      )],
    ]),
  ));

  return new PreopenDirectory("/sysroot", sysrootContents);
}

/**
 * Collect all non-source files from the root directory as output artefacts.
 */
function collectOutputFiles(root: PreopenDirectory): Map<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  const dir = root.dir;
  for (const [name, inode] of dir.contents) {
    // Skip source files — everything else is output
    if (name.endsWith(".rs")) {
      continue;
    }
    if (inode instanceof File) {
      result.set(name, new Uint8Array(inode.data));
    }
  }
  return result;
}
