import { openApp } from "@garage/sync";

const { doc, actor, me } = await openApp("scratch", 1);
const items = doc.getArray<{ text: string; ts: number }>("items");

const list = document.getElementById("list")!;
const input = document.getElementById("text") as HTMLInputElement;
const form = document.getElementById("form")!;

document.getElementById("actor")!.textContent = actor;
document.getElementById("build")!.textContent = GARAGE_BUILD;

// `me` changes as the actors doc arrives (IndexedDB, then server); an
// unmapped identity shows plainly rather than being papered over.
const meEl = document.getElementById("me")!;
function renderMe() {
  meEl.textContent = me.current ? `${me.current.handle} (${me.current.name})` : "unmapped";
}
me.observe(renderMe);
renderMe();

function render() {
  list.replaceChildren(
    ...items.toArray().map((item) => {
      const li = document.createElement("li");
      li.textContent = item.text;
      return li;
    }),
  );
}

items.observe(render);
render();

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text) {
    items.push([{ text, ts: Date.now() }]);
    input.value = "";
  }
});
