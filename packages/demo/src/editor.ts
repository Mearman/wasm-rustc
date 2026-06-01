import { EditorView, basicSetup } from "codemirror";
import { rust } from "@codemirror/lang-rust";
import { oneDark } from "@codemirror/theme-one-dark";

export function createEditor(parent: HTMLElement): EditorView {
  return new EditorView({
    parent,
    extensions: [
      basicSetup,
      rust(),
      oneDark,
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": { overflow: "auto" },
      }),
    ],
    doc: `fn main() {
    println!("Hello from WASM rustc!");
}
`,
  });
}
