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
    children: [],
    child(value) { this.children.push(value); return this; },
    when(condition, callback) { return condition ? callback(this) : this; },
  };
  return new Proxy(node, { get(target, key, receiver) {
    return key in target ? Reflect.get(target, key, receiver) : () => receiver;
  } });
}
const Files = runInNewContext(`${source.replace(/^import .*$/gm, "").replace("export default class Files", "class Files")}\nFiles`, {
  View: class {}, h_flex: element, div: element, svg: element,
});
const viewer = Object.create(Files.prototype);
viewer.root = "/repo";
viewer.entries = new Map([["", [{ name: "src", dir: true }]], ["src", [{ name: "a.js", dir: false }]]]);
viewer.folders = new Set(); viewer.marks = marks; viewer.counts = complete;
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join(" ");
assert.match(text(viewer.rows("", 0, [], {})[0]), /src.*\+15.*-4.*M/);
viewer.folders.add("src");
const [folder, file] = viewer.rows("", 0, [], {});
assert.doesNotMatch(text(folder), /\+15|M/);
assert.match(text(file), /a\.js.*\+12.*-4.*M/);
