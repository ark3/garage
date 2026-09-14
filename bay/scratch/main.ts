import { openApp, openPersistedDoc } from "@garage/sync";

const { doc, actor, me, stale } = await openApp("scratch", 1);
const items = doc.getArray<{ text: string; ts: number }>("items");

const list = document.getElementById("list")!;
const input = document.getElementById("text") as HTMLInputElement;
const form = document.getElementById("form")!;

document.getElementById("actor")!.textContent = actor;
document.getElementById("build")!.textContent = GARAGE_BUILD;
stale.then(() => {
  document.getElementById("stale")!.textContent = "this app is out of date, reload";
});

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

// A second doc, opened the way an app opens one beside its app doc. Each load
// appends its own timestamp (an array append merges from anywhere, so no read
// before the local copy has arrived), and the line below is the human check
// that IndexedDB is attached: with the server stopped, a reload still shows
// the earlier loads.
const extra = openPersistedDoc("scratch-extra");
const loads = extra.doc.getArray<number>("loads");
const loadsEl = document.getElementById("loads")!;
function renderLoads() {
  const all = loads.toArray();
  const last = all[all.length - 1];
  loadsEl.textContent = `${all.length} loads, last ${new Date(last).toLocaleTimeString()}`;
}
loads.observe(renderLoads);
loads.push([Date.now()]);
