const outputEl = document.getElementById("output")!;

export function clearOutput(): void {
  outputEl.innerHTML = "";
}

export function appendOutput(text: string, cls: "stdout" | "stderr" | "info"): void {
  const span = document.createElement("span");
  span.className = cls;
  span.textContent = text + "\n";
  outputEl.appendChild(span);
  outputEl.scrollTop = outputEl.scrollHeight;
}

export function setOutput(text: string, cls: "stdout" | "stderr" | "info"): void {
  clearOutput();
  appendOutput(text, cls);
}
