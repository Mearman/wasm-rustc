import { Compiler } from "wasm-rustc";
import type { CompileResult } from "wasm-rustc";
import { createEditor } from "./editor.js";
import { setOutput, appendOutput, clearOutput } from "./output.js";

const editor = createEditor(document.getElementById("editor-container")!);
const compileBtn = document.getElementById("compile-btn") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;
const progressContainer = document.getElementById("progress-container")!;
const progressFill = document.getElementById("progress-fill")!;
const progressText = document.getElementById("progress-text")!;

const compiler = new Compiler();

async function init(): Promise<void> {
  try {
    progressContainer.style.display = "flex";
    await compiler.init({
      onProgress: (loaded: number, total: number) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
        progressFill.style.width = `${pct}%`;
        progressText.textContent = `${pct}%`;
      },
    });
    progressContainer.style.display = "none";
    compileBtn.disabled = false;
    statusEl.textContent = "ready";
    setOutput("Compiler ready. Write Rust code and click Compile (or Ctrl+Enter).", "info");
  } catch (error) {
    statusEl.textContent = "failed";
    setOutput(
      `Failed to initialise compiler: ${error instanceof Error ? error.message : String(error)}`,
      "stderr",
    );
  }
}

async function compile(): Promise<void> {
  const source = editor.state.doc.toString();
  compileBtn.disabled = true;
  statusEl.textContent = "compiling...";
  clearOutput();
  appendOutput("Compiling...", "info");

  try {
    const result: CompileResult = await compiler.compile(source);
    clearOutput();

    if (result.stdout) {
      appendOutput(result.stdout, "stdout");
    }
    if (result.stderr) {
      appendOutput(result.stderr, "stderr");
    }
    if (result.objects.size > 0) {
      appendOutput(`Generated ${result.objects.size} object file(s):`, "info");
      for (const [name] of result.objects) {
        appendOutput(`  ${name}`, "info");
      }
    }

    statusEl.textContent = result.success ? "success" : "errors";
  } catch (error) {
    setOutput(
      `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
      "stderr",
    );
    statusEl.textContent = "error";
  } finally {
    compileBtn.disabled = false;
  }
}

compileBtn.addEventListener("click", compile);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    compile();
  }
});

init();
