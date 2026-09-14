import { openDoc } from "@garage/sync";

const { doc } = openDoc("scratch");
const items = doc.getArray<{ text: string; ts: number }>("items");

const list = document.getElementById("list")!;
const input = document.getElementById("text") as HTMLInputElement;
const form = document.getElementById("form")!;

document.getElementById("build")!.textContent = GARAGE_BUILD;

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
