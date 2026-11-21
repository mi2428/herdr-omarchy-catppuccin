import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/files-square/main.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "").replace("export default class Files", "class Files");
let live = true, tick, closed = 0, killed = 0;
let started, opened;
const Files = runInNewContext(`${source}\nFiles`, {
  View: class {},
  props: () => ({}),
  terminals: () => live ? [{ address: "t1", state: "live" }] : [],
  closeOverlay: id => { assert.equal(id, "ov1"); closed++; },
  run: (name, args) => { assert.equal(name, "terminal.kill"); assert.equal(args.terminal, "t1"); killed++; },
  exec: async (command, args) => { assert.equal(command, "hc"); started = Array.from(args); return { code: 0, stdout: '{"address":"t2"}' }; },
  openOverlay: spec => { opened = spec; },
  notify: error => { throw Error(JSON.stringify(error)); },
});

const viewer = new Files();
viewer.init({ terminal: "t1", overlay: "ov1" }, { timer: { every: (ms, fn) => { assert.equal(ms, 1000); tick = fn; } } });
tick();
assert.equal(closed, 0);
viewer.close();
assert.equal(killed, 1);

const layout = JSON.parse(readFileSync(new URL("../layouts/omarchy-catppuccin.json", import.meta.url), "utf8"));
const find = (node, id) => node.id === id ? node : node.children?.map(child => find(child, id)).find(Boolean);
assert.equal(find(layout, "files").content.props.fileViewer, "nvim");
for (const [option, command] of [
  [undefined, ["nvim", "-R", "--"]],
  ["nvim", ["nvim", "-R", "--"]],
  ["bat", ["bat", "--paging=always", "--"]],
  ["less", ["less", "-R", "--"]],
]) {
  const files = new Files();
  files.refresh = () => {};
  files.init({ fileViewer: option }, { timer: { every() {} } });
  files.root = "/repo"; files.on = "remote";
  let pending;
  files.show("a --file.txt", { spawn: fn => { pending = fn(); } });
  await pending;
  assert.deepEqual(started, ["run", "--json", "--bg", "--rm", "--cwd", "/repo", "--on", "remote", "--", ...command, "/repo/a --file.txt"]);
  assert.equal(opened.kind, "dialog");
  assert.equal(opened.layout.children[1].content.terminal, "t2");
}
const invalid = new Files();
invalid.refresh = () => {};
assert.throws(() => invalid.init({ fileViewer: "sh" }, { timer: { every() {} } }), /Unknown fileViewer: sh/);
live = false;
tick();
assert.equal(closed, 1);
viewer.close();
assert.equal(killed, 1);
