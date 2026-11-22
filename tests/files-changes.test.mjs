import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../mods/files-square/main.js", import.meta.url), "utf8");
const start = source.indexOf("function changeCounts(");
const end = source.indexOf("async function directory(", start);
assert.ok(start >= 0 && end > start);
const changeCounts = runInNewContext(`${source.slice(start, end)}\nchangeCounts`);

const marks = {
  "/repo/src/a.js": "M", "/repo/src/deep/b.js": "A",
  "/repo/src/deep/binary.png": "M", "/repo/src/new.txt": "A",
  "/repo/elsewhere/x": "M",
};
const output = "12\t4\tsrc/a.js\0" + "3\t0\tsrc/deep/b.js\0" + "-\t-\tsrc/deep/binary.png\0";
const { files, folders } = changeCounts(output, "/repo", "/repo/src", marks);
assert.deepEqual(Array.from(files["/repo/src/a.js"]), [12, 4]);
assert.deepEqual(Array.from(files["/repo/src/deep/b.js"]), [3, 0]);
assert.equal(files["/repo/src/deep/binary.png"], undefined);
assert.deepEqual(Array.from(folders["/repo/src/deep"]), [3, 0, false]);
assert.equal(folders["/repo/src"], undefined);
assert.equal(folders["/repo/elsewhere"], undefined);

const complete = changeCounts("12\t4\tsrc/a.js\0" + "3\t0\tsrc/deep/b.js\0", "/repo", "/repo", {
  "/repo/src/a.js": "M", "/repo/src/deep/b.js": "A",
});
assert.deepEqual(Array.from(complete.folders["/repo/src"]), [15, 4, true]);
assert.deepEqual(Array.from(complete.folders["/repo/src/deep"]), [3, 0, true]);
assert.throws(() => changeCounts("bad\0", "/repo", "/repo", marks), /Invalid git numstat/);

function element() {
  const node = {
    nodes: [],
    child(value) { this.nodes.push(value); return this; },
    children(values) { this.nodes.push(...values); return this; },
    when(condition, callback) { return condition ? callback(this) : this; },
  };
  return new Proxy(node, { get(target, key, receiver) {
    return key in target ? Reflect.get(target, key, receiver) : () => receiver;
  } });
}
const Files = runInNewContext(`${source.replace(/^import .*$/gm, "").replace("export default class Files", "class Files")}\nFiles`, {
  View: class {}, h_flex: element, v_flex: element, div: element, svg: element,
});
const viewer = Object.create(Files.prototype);
viewer.root = "/repo";
viewer.entries = new Map([["", [{ name: "src", dir: true }]], ["src", [{ name: "a.js", dir: false }]]]);
viewer.folders = new Set(); viewer.marks = marks; viewer.counts = complete;
const text = node => typeof node === "string" ? node : (node.nodes ?? []).map(text).join(" ");
const palette = Object.fromEntries(["hover", "dim", "ansi1", "ansi2", "ansi3", "ansi4", "blocked", "muted"].map(key => [key, "#000000"]));
assert.match(text(viewer.rows("", 0, [], palette)[0]), /src.*\+15.*-4.*M/);
viewer.folders.add("src");
const [folder, file] = viewer.rows("", 0, [], palette);
assert.doesNotMatch(text(folder), /\+15|M/);
assert.match(text(file), /a\.js.*\+12.*-4.*M/);

let scenario = "rejected-git";
let propsConfig = {};
let liveTerminals = [];
const tasks = [], timers = [], events = [], closed = [];
const IntegrationFiles = runInNewContext(`${source.replace(/^import .*$/gm, "").replace("export default class Files", "class Files")}\nFiles`, {
  View: class {}, h_flex: element, v_flex: element, div: element, svg: element,
  props: () => propsConfig,
  spaces: () => [{ active: true, folder: "/repo", machine: null, id: "s1" }],
  focused: () => ({ pane: null, cwd: "/repo", terminal: null }), panes: () => [],
  window: () => ({ platform: "linux" }),
  theme: () => Object.fromEntries(["background", "foreground", "dim", "hover", "ansi1", "ansi2", "ansi4", "blocked", "muted"].map(key => [key, "#000000"])),
  terminals: () => liveTerminals, run: (...args) => events.push(args), closeOverlay: id => closed.push(id), openOverlay() {}, notify() {},
  watchFolder: () => new Promise(() => {}),
  exec: async (command, args) => {
    if (command === "sh") return { code: 0, stdout: "", stderr: "" };
    assert.equal(command, "git");
    if (args.includes("--show-toplevel")) {
      if (scenario === "rejected-git") throw Error("core unreachable");
      if (scenario === "not-repo") return { code: 128, stdout: "", stderr: "fatal: not a git repository" };
      return { code: 0, stdout: "/repo\n", stderr: "" };
    }
    if (args.includes("status")) return { code: 1, stdout: "", stderr: "status denied" };
    throw Error("Unexpected Git command");
  },
});
const cx = { timer: { every: (ms, fn) => timers.push([ms, fn]) }, notify() {}, spawn: fn => tasks.push(fn) };
const refresh = async () => {
  const files = new IntegrationFiles();
  files.init({}, cx);
  await tasks.shift()(cx);
  tasks.length = 0;
  return files;
};

const rejected = await refresh();
assert.match(rejected.error, /core unreachable/);
assert.match(text(rejected.render(cx)), /core unreachable/);
scenario = "not-repo";
const notRepo = await refresh();
assert.equal(notRepo.error, null);
assert.match(text(notRepo.render(cx)), /No files/);
scenario = "status-fail";
const badStatus = await refresh();
assert.match(badStatus.error, /status denied/);
assert.match(text(badStatus.render(cx)), /status denied/);

propsConfig = { terminal: "viewer1", fileViewer: "bat", overlay: "ov1" };
liveTerminals = [{ address: "viewer1", state: "live" }];
const inherited = new IntegrationFiles();
inherited.init({}, cx);
assert.equal(timers.at(-1)[0], 1000);
inherited.close();
assert.deepEqual(events.map(([action, args]) => [action, { ...args }]), [["terminal.kill", { terminal: "viewer1" }]]);
liveTerminals = [];
timers.at(-1)[1]();
assert.deepEqual(closed, ["ov1"]);
propsConfig = { fileViewer: 42 };
assert.throws(() => new IntegrationFiles().init({}, cx), /Unknown fileViewer: 42/);
