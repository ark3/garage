import * as Y from "yjs";
import { openApp } from "@garage/sync";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { SCHEMA, body, createNote, deleteNote, listNotes, notesMap, title } from "./model";

const { doc, provider, actor, me, stale } = await openApp("notes", SCHEMA);

const notes = notesMap(doc);

// --- Identity: awareness user from the directory entry, so a person is the
// same name and color on every device. An unmapped actor shows as its raw
// identity string with no colors; y-codemirror.next then uses its own default.
function setAwarenessUser() {
  const m = me.current;
  provider.awareness.setLocalStateField(
    "user",
    m ? { name: m.name, color: m.fg, colorLight: m.bg } : { name: actor },
  );
}

setAwarenessUser();
me.observe(setAwarenessUser);

// --- DOM
const listEl = document.getElementById("list")!;
const editorEl = document.getElementById("editor")!;
const placeholderEl = document.getElementById("placeholder")!;
const newBtn = document.getElementById("new")!;

// A stale bundle has already disconnected and stopped persisting; say so plainly.
stale.then(() => {
  document.getElementById("stale")!.textContent = "this app is out of date, reload";
});

// --- Editor lifecycle: one EditorView, rebuilt when the selection changes.
let selectedId: string | null = null;
let view: EditorView | null = null;
let teardown: (() => void) | null = null;

function closeEditor() {
  if (teardown) teardown();
  teardown = null;
  if (view) view.destroy();
  view = null;
  selectedId = null;
  editorEl.replaceChildren(placeholderEl);
}

function selectNote(id: string) {
  if (id === selectedId) return;
  closeEditor();
  const note = notes.get(id);
  if (!note) return;
  selectedId = id;
  const ytext = body(note);

  // Debounced updatedAt: order the list without per-keystroke meta churn.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = (_e: Y.YTextEvent, txn: Y.Transaction) => {
    if (!txn.local) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (notes.get(id) === note) note.set("updatedAt", Date.now());
    }, 1500);
  };
  ytext.observe(observer);
  teardown = () => {
    clearTimeout(timer);
    ytext.unobserve(observer);
  };

  editorEl.replaceChildren();
  view = new EditorView({
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
        EditorView.lineWrapping,
        yCollab(ytext, provider.awareness, {
          undoManager: new Y.UndoManager(ytext),
        }),
      ],
    }),
    parent: editorEl,
  });
  view.focus();
  renderList();
}

// --- Note list
function renderList() {
  listEl.replaceChildren(
    ...listNotes(doc).map(([id, note]) => {
      const li = document.createElement("li");
      if (id === selectedId) li.classList.add("selected");
      const span = document.createElement("span");
      const t = title(note);
      span.className = t ? "title" : "title untitled";
      span.textContent = t || "New note";
      li.append(span);
      const del = document.createElement("button");
      del.className = "delete";
      del.textContent = "×";
      del.title = "Delete note";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteNote(doc, id);
      });
      li.append(del);
      li.addEventListener("click", () => selectNote(id));
      return li;
    }),
  );
}

// createdBy holds the handle when the actor is mapped, the raw identity
// otherwise, so a later migration can still map it.
newBtn.addEventListener("click", () =>
  selectNote(createNote(doc, me.current?.handle ?? actor)),
);

// Any change anywhere in the doc can move titles or ordering; the list is
// tiny, so just re-render. If the selected note vanished (remote delete),
// close the editor rather than wedging.
notes.observeDeep(() => {
  if (selectedId && !notes.has(selectedId)) closeEditor();
  renderList();
});

renderList();
