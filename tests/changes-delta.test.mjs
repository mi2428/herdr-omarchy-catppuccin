import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/tabs-files/main.js", import.meta.url), "utf8")
  .replace(/^import .*$/gm, "").replace("export default class Tabs", "class Tabs");
let live = true, tick, pending, opened, closed = 0, killed = 0;
const Tabs = runInNewContext(`${source}\nTabs`, {
  View: class {}, props: () => ({}),
  spaces: () => [{ active: true, folder: "/repo", machine: null }],
  focused: () => ({ pane: null, cwd: "/repo", terminal: null }), panes: () => [],
  terminals: () => live ? [{ address: "t1", state: "live" }] : [],
  exec: async (cmd, args) => {
    assert.equal(cmd, "hc");
    assert.deepEqual(Array.from(args), ["run", "--json", "--bg", "--rm", "--cwd", "/repo", "--", "bash", "-c", 'exec bash "$HOME/.config/herdr-app/mods/tabs-files/changes-diff.sh"']);
    return { code: 0, stdout: '{"address":"t1"}' };
  },
  openOverlay: spec => { opened = spec; },
  closeOverlay: id => { assert.equal(id, "ov1"); closed++; },
  run: (name, args) => { assert.equal(name, "terminal.kill"); assert.equal(args.terminal, "t1"); killed++; },
  notify: error => { throw Error(JSON.stringify(error)); },
});

new Tabs().openChanges({ spawn: fn => { pending = fn(); } });
await pending;
assert.equal(opened.kind, "dialog");
assert.equal(opened.layout.background, "#1e1e2eeb");
assert.equal(opened.layout.children[0].size.px, 0);
assert.equal(opened.layout.children[1].content.terminal, "t1");

const viewer = new Tabs();
viewer.init({ terminal: "t1", overlay: "ov1" }, { timer: { every: (_ms, fn) => { tick = fn; } } });
tick(); assert.equal(closed, 0);
viewer.close(); assert.equal(killed, 1);
live = false;
tick(); assert.equal(closed, 1);
viewer.close(); assert.equal(killed, 1);
