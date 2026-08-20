"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// core/src/cli.ts
var cli_exports = {};
__export(cli_exports, {
  main: () => main,
  run: () => run
});
module.exports = __toCommonJS(cli_exports);
var fs9 = __toESM(require("fs"));
var path8 = __toESM(require("path"));

// core/src/state.ts
var fs = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// core/src/paths.ts
var path = __toESM(require("path"));
var harnessDir = (root) => path.join(root, ".harness");
var statePath = (root) => path.join(harnessDir(root), "state.json");
var eventsPath = (root) => path.join(harnessDir(root), "events.jsonl");
var configPath = (root) => path.join(harnessDir(root), "config.yaml");
var designDir = (root) => path.join(harnessDir(root), "design");
var ledgerPath = (root) => path.join(designDir(root), "ledger.yaml");
var wavesDir = (root) => path.join(harnessDir(root), "waves");
var wavePath = (root, id) => path.join(wavesDir(root), `${id}.md`);
var evidenceDir = (root, waveId) => path.join(harnessDir(root), "evidence", waveId);
var runtimeDir = (root) => path.join(harnessDir(root), ".runtime");

// core/src/state.ts
function defaultState() {
  return {
    schemaVersion: 1,
    phase: "P0",
    activeWave: null,
    gates: {},
    backtrack: null,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function isInitialized(root) {
  return fs.existsSync(statePath(root));
}
function readState(root) {
  return JSON.parse(fs.readFileSync(statePath(root), "utf8"));
}
function writeState(root, state) {
  const target = statePath(root);
  const tmp = `${target}.tmp-${process.pid}`;
  const next = { ...state, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(tmp, target);
}
function initHarness(root) {
  if (fs.existsSync(harnessDir(root))) throw new Error(`.harness/ \uAC00 \uC774\uBBF8 \uCD08\uAE30\uD654\uB418\uC5B4 \uC788\uB2E4: ${harnessDir(root)}`);
  for (const d of [harnessDir(root), designDir(root), wavesDir(root), runtimeDir(root)]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(path2.join(runtimeDir(root), ".gitignore"), "*\n!.gitignore\n");
  fs.writeFileSync(ledgerPath(root), "nodes: []\n");
  fs.writeFileSync(configPath(root), [
    "profile: generic",
    "remote_control: true",
    "terse: false",
    ""
  ].join("\n"));
  fs.writeFileSync(eventsPath(root), "");
  const tmp = `${statePath(root)}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(defaultState(), null, 2) + "\n");
  fs.renameSync(tmp, statePath(root));
}

// core/src/events.ts
var fs2 = __toESM(require("fs"));

// core/src/types.ts
var PHASES = [
  "P0",
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
  "P10",
  "P11",
  "P12"
];
var isPhase = (v) => PHASES.includes(v);
var DESIGN_PHASES = ["P0", "P1", "P2", "P3", "P4", "P5", "P6"];

// core/src/events.ts
var KNOWN_EVENT_TYPES = /* @__PURE__ */ new Set([
  "init",
  "phase-set",
  "wave-created",
  "wave-activated",
  "wave-turn-logged",
  "wave-completed",
  "wave-stale",
  "node-upserted",
  "node-bumped",
  "gate-submitted",
  "gate-approved",
  "backtrack-started",
  "backtrack-cleared",
  "doctor-repaired"
  // 복구 흔적 — replayState 는 폴드하지 않는다(상태 무변이)
]);
function appendEvent(root, type, data) {
  const ev = { ts: (/* @__PURE__ */ new Date()).toISOString(), type, data };
  fs2.appendFileSync(eventsPath(root), JSON.stringify(ev) + "\n");
  return ev;
}
function readJournal(root) {
  if (!fs2.existsSync(eventsPath(root))) return { events: [], corruptLines: 0 };
  const events = [];
  let corruptLines = 0;
  for (const line of fs2.readFileSync(eventsPath(root), "utf8").split("\n")) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      corruptLines++;
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || typeof parsed.type !== "string") {
      corruptLines++;
      continue;
    }
    const p = parsed;
    events.push({
      ts: typeof p.ts === "string" ? p.ts : "",
      type: p.type,
      data: typeof p.data === "object" && p.data !== null ? p.data : {}
    });
  }
  return { events, corruptLines };
}
function readEvents(root) {
  return readJournal(root).events;
}
function replayState(events) {
  const s = defaultState();
  for (const ev of events) {
    const d = ev.data;
    switch (ev.type) {
      case "phase-set":
        if (isPhase(d.phase)) s.phase = d.phase;
        break;
      case "wave-activated":
        if (typeof d.id === "string" && d.id) s.activeWave = d.id;
        break;
      case "wave-completed":
        if (s.activeWave === d.id) s.activeWave = null;
        break;
      case "wave-stale":
        if (typeof d.id === "string" && s.activeWave === d.id) s.activeWave = null;
        break;
      case "gate-submitted":
        if (isPhase(d.phase)) {
          s.gates[d.phase] = {
            status: "submitted",
            artifactHash: typeof d.artifactHash === "string" ? d.artifactHash : void 0
          };
        }
        break;
      case "gate-approved":
        if (isPhase(d.phase)) {
          s.gates[d.phase] = {
            ...s.gates[d.phase],
            status: "approved",
            artifactHash: typeof d.artifactHash === "string" ? d.artifactHash : s.gates[d.phase]?.artifactHash,
            approvedAt: ev.ts
          };
        }
        break;
      case "backtrack-started":
        if (isPhase(d.to)) s.backtrack = { to: d.to, reason: String(d.reason ?? "") };
        break;
      case "backtrack-cleared":
        s.backtrack = null;
        break;
      default:
        break;
    }
  }
  return s;
}

// core/src/wave.ts
var fs4 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
var YAML = __toESM(require("yaml"));

// core/src/runtime.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var f = (root, name) => path3.join(runtimeDir(root), name);
function noteActivity(root) {
  fs3.mkdirSync(runtimeDir(root), { recursive: true });
  fs3.writeFileSync(f(root, "last-activity"), (/* @__PURE__ */ new Date()).toISOString());
}
function noteTurnLogged(root) {
  fs3.mkdirSync(runtimeDir(root), { recursive: true });
  fs3.writeFileSync(f(root, "last-turn"), (/* @__PURE__ */ new Date()).toISOString());
}
function clearActivity(root) {
  try {
    const p = f(root, "last-activity");
    if (fs3.existsSync(p)) fs3.rmSync(p);
  } catch {
  }
}
function readRuntime(root) {
  const read = (name) => {
    if (!fs3.existsSync(f(root, name))) return void 0;
    const v = fs3.readFileSync(f(root, name), "utf8").trim();
    return v || void 0;
  };
  return { lastActivityAt: read("last-activity"), lastTurnAt: read("last-turn") };
}

// core/src/wave.ts
function parseWave(txt) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(txt);
  if (!m) throw new Error("\uC6E8\uC774\uBE0C \uD30C\uC77C \uD615\uC2DD \uC624\uB958: frontmatter\uAC00 \uC5C6\uB2E4");
  let raw;
  try {
    raw = YAML.parse(m[1]);
  } catch {
    raw = null;
  }
  if (typeof raw !== "object" || raw === null) throw new Error("\uC6E8\uC774\uBE0C \uD30C\uC77C \uD615\uC2DD \uC624\uB958: frontmatter\uB97C \uD574\uC11D\uD560 \uC218 \uC5C6\uB2E4");
  const r = raw;
  const asArr = (v) => Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : [];
  const statuses = ["pending", "active", "done", "stale"];
  const meta = {
    id: typeof r.id === "string" ? r.id : "",
    milestone: typeof r.milestone === "string" ? r.milestone : "(\uBBF8\uC9C0\uC815)",
    design_refs: asArr(r.design_refs),
    status: statuses.includes(r.status) ? r.status : "pending",
    acceptance: asArr(r.acceptance)
  };
  return { meta, body: m[2] };
}
function serializeWave(meta, body) {
  return `---
${YAML.stringify(meta).trimEnd()}
---
${body}`;
}
function readWave(root, id) {
  return parseWave(fs4.readFileSync(wavePath(root, id), "utf8"));
}
function listWaves(root) {
  if (!fs4.existsSync(wavesDir(root))) return [];
  const out = [];
  for (const f2 of fs4.readdirSync(wavesDir(root)).filter((f3) => /^wave-\d+\.md$/.test(f3)).sort()) {
    try {
      out.push(parseWave(fs4.readFileSync(path4.join(wavesDir(root), f2), "utf8")).meta);
    } catch {
      continue;
    }
  }
  return out;
}
function writeWave(root, id, meta, body) {
  const target = wavePath(root, id);
  const tmp = `${target}.tmp-${process.pid}`;
  fs4.writeFileSync(tmp, serializeWave(meta, body));
  fs4.renameSync(tmp, target);
}
function evidenceFiles(root, id) {
  const dir = evidenceDir(root, id);
  if (!fs4.existsSync(dir)) return [];
  return fs4.readdirSync(dir).filter((f2) => {
    if (f2.startsWith(".")) return false;
    const st = fs4.statSync(path4.join(dir, f2));
    return st.isFile() && st.size > 0;
  });
}
function nextWaveId(root) {
  const nums = [];
  if (fs4.existsSync(wavesDir(root))) {
    for (const f2 of fs4.readdirSync(wavesDir(root))) {
      const m = /^wave-(\d+)\.md$/.exec(f2);
      if (m) nums.push(parseInt(m[1], 10));
    }
  }
  for (const ev of readEvents(root)) {
    if (ev.type !== "wave-created") continue;
    const id = ev.data.id;
    if (typeof id !== "string") continue;
    const m = /^wave-(\d+)$/.exec(id);
    if (m) nums.push(parseInt(m[1], 10));
  }
  return `wave-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
}
function createWave(root, opts) {
  const id = nextWaveId(root);
  if (fs4.existsSync(wavePath(root, id))) {
    throw new Error(`${id} \uD30C\uC77C\uC774 \uC774\uBBF8 \uC874\uC7AC\uD55C\uB2E4 \u2014 \uB3D9\uC2DC \uC0DD\uC131 \uC758\uC2EC\uC73C\uB85C \uC6E8\uC774\uBE0C \uC0DD\uC131\uC744 \uC911\uB2E8\uD55C\uB2E4`);
  }
  const inherited = evidenceFiles(root, id);
  if (inherited.length > 0) {
    throw new Error(
      `${evidenceDir(root, id)} \uC5D0 \uC774\uC804 \uC99D\uC801 ${inherited.length}\uAC74(${inherited.slice(0, 3).join(", ")}${inherited.length > 3 ? ", \u2026" : ""})\uC774 \uB0A8\uC544 \uC788\uB2E4 \u2014 \uC0C8 \uC6E8\uC774\uBE0C\uAC00 \uB0A8\uC758 \uC2DC\uAC01 \uC99D\uC801\uC744 \uBB3C\uB824\uBC1B\uC73C\uBA74 UX \uAC8C\uC774\uD2B8\uAC00 \uBB34\uB825\uD654\uB41C\uB2E4. \uD574\uB2F9 \uB514\uB809\uD1A0\uB9AC\uB97C \uD655\uC778\uD574 \uBCF4\uAD00\uD558\uAC70\uB098 \uC0AD\uC81C\uD55C \uB4A4 \uB2E4\uC2DC \uC0DD\uC131\uD558\uB77C.`
    );
  }
  const meta = { id, milestone: opts.milestone, design_refs: opts.design_refs, status: "pending", acceptance: opts.acceptance };
  const body = [
    `## \uBAA9\uD45C`,
    opts.goal,
    "",
    `## \uC644\uB8CC \uAE30\uC900`,
    ...opts.acceptance.map((a) => `- ${a}`),
    "",
    `## \uD134 \uB85C\uADF8`,
    ""
  ].join("\n");
  writeWave(root, id, meta, body);
  appendEvent(root, "wave-created", { id, milestone: opts.milestone, design_refs: opts.design_refs });
  return meta;
}
function activateWave(root, id) {
  const state = readState(root);
  if (state.activeWave && state.activeWave !== id) {
    throw new Error(`\uC774\uBBF8 \uD65C\uC131 \uC6E8\uC774\uBE0C\uAC00 \uC788\uB2E4: ${state.activeWave}. \uBA3C\uC800 complete \uD558\uB77C.`);
  }
  let meta, body;
  try {
    ({ meta, body } = readWave(root, id));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    throw new Error(
      `\uC6E8\uC774\uBE0C ${id} \uC9C0\uC2DC\uC11C\uAC00 \uC5C6\uB2E4 (${wavePath(root, id)}) \u2014 id \uB97C \uD655\uC778\uD558\uAC70\uB098 \`harness wave list\` \uB85C \uBAA9\uB85D\uC744 \uBCF4\uB77C`
    );
  }
  if (meta.status === "done") throw new Error(`${id} \uB294 \uC774\uBBF8 done \uC774\uB2E4`);
  meta.status = "active";
  writeWave(root, id, meta, body);
  appendEvent(root, "wave-activated", { id });
  writeState(root, { ...state, activeWave: id });
}
function readActiveWave(root, id) {
  try {
    return readWave(root, id);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    throw new Error(
      `\uD65C\uC131 \uC6E8\uC774\uBE0C ${id} \uC758 \uC9C0\uC2DC\uC11C\uAC00 \uC5C6\uB2E4 (${wavePath(root, id)}) \u2014 git \uBE0C\uB79C\uCE58 \uC804\uD658 \uB4F1\uC73C\uB85C \uC77C\uC2DC \uBD80\uC7AC\uC77C \uC218 \uC788\uC73C\uB2C8 \uD30C\uC77C \uBCF5\uC6D0\uC774 \uC6B0\uC120\uC774\uB2E4. \uC815\uB9D0 \uC720\uC2E4\uC774\uBA74 \`harness doctor --repair\` \uB85C activeWave \uB97C \uC815\uC0B0(null)\uD558\uB77C.`
    );
  }
}
function logTurn(root, text) {
  const state = readState(root);
  if (!state.activeWave) throw new Error("\uD65C\uC131 \uC6E8\uC774\uBE0C\uAC00 \uC5C6\uB2E4");
  const id = state.activeWave;
  const { meta, body } = readActiveWave(root, id);
  const entry = `- [${(/* @__PURE__ */ new Date()).toISOString()}] ${text}`;
  writeWave(root, id, meta, body.trimEnd() + "\n" + entry + "\n");
  appendEvent(root, "wave-turn-logged", { id });
  noteTurnLogged(root);
}
function completeWave(root) {
  const state = readState(root);
  if (!state.activeWave) throw new Error("\uD65C\uC131 \uC6E8\uC774\uBE0C\uAC00 \uC5C6\uB2E4");
  const id = state.activeWave;
  const { meta, body } = readActiveWave(root, id);
  if (meta.design_refs.some((r) => r.startsWith("UX-"))) {
    const dir = evidenceDir(root, id);
    const files = evidenceFiles(root, id);
    if (files.length === 0) {
      throw new Error(
        `UX \uB178\uB4DC(${meta.design_refs.filter((r) => r.startsWith("UX-")).join(", ")})\uB97C \uCC38\uC870\uD558\uB294 \uC6E8\uC774\uBE0C\uB294 \uC2DC\uAC01 \uC99D\uC801 \uC5C6\uC774 \uC644\uB8CC\uD560 \uC218 \uC5C6\uB2E4. ${dir} \uC5D0 \uC2A4\uD06C\uB9B0\uC0F7\uC744 \uB123\uC5B4\uB77C.`
      );
    }
  }
  meta.status = "done";
  writeWave(root, id, meta, body);
  appendEvent(root, "wave-completed", { id });
  writeState(root, { ...state, activeWave: null });
}
function markStale(root, id) {
  const { meta, body } = readWave(root, id);
  meta.status = "stale";
  writeWave(root, id, meta, body);
  appendEvent(root, "wave-stale", { id });
  const state = readState(root);
  if (state.activeWave === id) writeState(root, { ...state, activeWave: null });
}

// core/src/ledger.ts
var fs5 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var YAML2 = __toESM(require("yaml"));
function loadLedger(root) {
  if (!fs5.existsSync(ledgerPath(root))) return [];
  const doc = YAML2.parse(fs5.readFileSync(ledgerPath(root), "utf8"));
  const nodes = doc?.nodes;
  return Array.isArray(nodes) ? nodes : [];
}
function saveLedger(root, nodes) {
  const target = ledgerPath(root);
  const tmp = `${target}.tmp-${process.pid}`;
  fs5.writeFileSync(tmp, YAML2.stringify({ nodes }));
  fs5.renameSync(tmp, target);
}
function getNode(root, id) {
  return loadLedger(root).find((n) => n.id === id);
}
function upsertNode(root, node) {
  const nodes = loadLedger(root);
  const i = nodes.findIndex((n) => n.id === node.id);
  if (i >= 0) nodes[i] = node;
  else nodes.push(node);
  saveLedger(root, nodes);
}
function bumpNode(root, id) {
  const nodes = loadLedger(root);
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new Error(`\uB178\uB4DC ${id} \uAC00 \uC6D0\uC7A5\uC5D0 \uC5C6\uB2E4`);
  node.version += 1;
  node.status = "stale";
  saveLedger(root, nodes);
  const affectedWaves = [];
  const unverifiable = [];
  if (fs5.existsSync(wavesDir(root))) {
    for (const f2 of fs5.readdirSync(wavesDir(root)).filter((f3) => /^wave-\d+\.md$/.test(f3)).sort()) {
      const stem = f2.replace(/\.md$/, "");
      let txt;
      try {
        txt = fs5.readFileSync(path5.join(wavesDir(root), f2), "utf8");
      } catch {
        unverifiable.push(stem);
        continue;
      }
      let meta;
      try {
        meta = parseWave(txt).meta;
      } catch {
        unverifiable.push(stem);
        continue;
      }
      if (meta.design_refs.includes(id) && meta.status !== "stale") {
        affectedWaves.push(stem);
      }
    }
  }
  return { node, affectedWaves, unverifiable };
}

// core/src/doctor.ts
var fs6 = __toESM(require("fs"));
var path6 = __toESM(require("path"));
var COMPARED_FIELDS = ["phase", "activeWave", "gates", "backtrack"];
var TMP_RE = /\.tmp-(\d+)$/;
function pidAlive(pid) {
  if (pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function sweepOrphanTmp(root) {
  let swept = 0;
  for (const dir of [harnessDir(root), designDir(root), wavesDir(root)]) {
    let names;
    try {
      names = fs6.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const m = TMP_RE.exec(name);
      if (!m || pidAlive(Number(m[1]))) continue;
      const p = path6.join(dir, name);
      try {
        if (!fs6.statSync(p).isFile()) continue;
        fs6.rmSync(p);
        swept++;
      } catch {
      }
    }
  }
  return swept;
}
function countHookErrors(root) {
  const p = path6.join(runtimeDir(root), "hook-errors.log");
  if (!fs6.existsSync(p)) return 0;
  return fs6.readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).length;
}
var isPristine = (s) => {
  const d = defaultState();
  return COMPARED_FIELDS.every((f2) => JSON.stringify(s[f2]) === JSON.stringify(d[f2]));
};
function runDoctor(root, opts = {}) {
  const issues = [];
  const warnings = [];
  const notes = [];
  const journalExists = fs6.existsSync(eventsPath(root));
  const { events, corruptLines } = readJournal(root);
  const replayed = replayState(events);
  let current = null;
  if (!fs6.existsSync(statePath(root))) {
    issues.push("state.json \uC774 \uC5C6\uB2E4 \u2014 \uC774\uBCA4\uD2B8 \uC7AC\uC0DD\uC73C\uB85C \uBCF5\uAD6C \uD544\uC694");
  } else {
    try {
      const parsed = readState(root);
      if (typeof parsed !== "object" || parsed === null) throw new Error("object \uC544\uB2D8");
      current = parsed;
    } catch {
      issues.push("state.json \uC190\uC0C1 \u2014 \uD30C\uC2F1 \uBD88\uAC00");
    }
  }
  let trustworthy = true;
  if (!journalExists) {
    warnings.push("events.jsonl \uBD80\uC7AC \u2014 \uC7AC\uC0DD\uD560 \uC99D\uAC70\uAC00 \uC5C6\uB2E4");
    trustworthy = false;
  }
  if (corruptLines > 0) {
    warnings.push(`events.jsonl ${corruptLines}\uC904 \uC190\uC0C1 \u2014 \uC7AC\uC0DD \uBD88\uC644\uC804`);
    trustworthy = false;
  }
  const unknown = events.filter((e) => !KNOWN_EVENT_TYPES.has(e.type));
  if (unknown.length > 0) {
    const types = [...new Set(unknown.map((e) => e.type))].join(", ");
    warnings.push(`\uBBF8\uC9C0 \uC774\uBCA4\uD2B8 \uD0C0\uC785 ${unknown.length}\uAC74(${types}) \u2014 \uC7AC\uC0DD \uACB0\uACFC \uBD88\uC2E0(\uBC84\uC804 \uC2A4\uD050 \uAC00\uB2A5)`);
    trustworthy = false;
  }
  if (journalExists && events.length === 0 && current && !isPristine(current)) {
    warnings.push("\uC800\uB110\uC774 \uBE44\uC5B4 \uC788\uC73C\uB098 state \uB294 \uC9C4\uD589 \uC0C1\uD0DC \u2014 \uC808\uB2E8 \uC758\uC2EC");
    trustworthy = false;
  }
  if (current) {
    for (const field of COMPARED_FIELDS) {
      const a = JSON.stringify(current[field]);
      const b = JSON.stringify(replayed[field]);
      if (a !== b) issues.push(`${field} \uBD88\uC77C\uCE58: state=${a}, \uC774\uBCA4\uD2B8 \uC7AC\uC0DD=${b}`);
    }
  }
  const effective = current ?? replayed;
  if (effective.activeWave && !fs6.existsSync(wavePath(root, effective.activeWave))) {
    issues.push(
      `activeWave ${effective.activeWave} \uC758 \uC6E8\uC774\uBE0C \uD30C\uC77C \uBD80\uC7AC \u2014 git \uBE0C\uB79C\uCE58 \uC804\uD658 \uB4F1\uC73C\uB85C \uC77C\uC2DC \uBD80\uC7AC\uC77C \uC218 \uC788\uC73C\uB2C8 \uD30C\uC77C \uBCF5\uC6D0\uC774 \uC6B0\uC120\uC774\uB2E4. \uC815\uB9D0 \uC720\uC2E4\uC774\uBA74 \`harness doctor --repair\` \uB85C activeWave \uB97C \uC815\uC0B0(null)\uD558\uB77C`
    );
  }
  const swept = sweepOrphanTmp(root);
  if (swept > 0) notes.push(`\uACE0\uC544 \uC784\uC2DC\uD30C\uC77C ${swept}\uAC1C \uC815\uB9AC`);
  const hookErrors = countHookErrors(root);
  if (hookErrors > 0) {
    warnings.push(`\uD6C5 \uD310\uC815 \uC2E4\uD328 ${hookErrors}\uAC74 \uAE30\uB85D\uB428 \u2014 \uC6D0\uC778 \uD655\uC778 \uD544\uC694`);
  }
  let repaired = false;
  let refused = false;
  if (issues.length > 0 && opts.repair) {
    if (!trustworthy && !opts.force) {
      refused = true;
      warnings.push(
        "state \uBC1C\uC0B0\uC774 \uC788\uC73C\uB098 \uC800\uB110\uC744 \uC2E0\uB8B0\uD560 \uC218 \uC5C6\uC5B4 \uBCF5\uAD6C \uAC70\uBD80 \u2014 \uC800\uB110 \uC190\uC0C1 \uC6D0\uC778\uC744 \uBA3C\uC800 \uD655\uC778\uD558\uB77C. \uADF8\uB798\uB3C4 \uBCF5\uAD6C\uD558\uB824\uBA74 --force"
      );
    } else {
      const replayedWave = replayed.activeWave;
      const settledActiveWave = replayedWave !== null && !fs6.existsSync(wavePath(root, replayedWave)) ? replayedWave : null;
      let target = replayed;
      if (settledActiveWave) {
        appendEvent(root, "wave-stale", {
          id: settledActiveWave,
          reason: "wave-file-missing",
          via: "doctor-repair"
        });
        target = { ...replayed, activeWave: null };
      }
      writeState(root, target);
      appendEvent(root, "doctor-repaired", {
        hadCorruptJournal: !trustworthy,
        forced: !!opts.force,
        settledActiveWave
      });
      repaired = true;
    }
  }
  if (opts.repair && !refused && hookErrors > 0) {
    const log = path6.join(runtimeDir(root), "hook-errors.log");
    try {
      fs6.renameSync(log, `${log}.prev`);
      notes.push(`hook-errors.log ${hookErrors}\uAC74 \u2192 .prev \uD68C\uC804`);
    } catch {
    }
  }
  return { ok: issues.length === 0, repaired, refused, issues, warnings, notes };
}

// core/src/hook.ts
var fs8 = __toESM(require("fs"));
var path7 = __toESM(require("path"));
var import_node_crypto = require("crypto");

// core/src/config.ts
var fs7 = __toESM(require("fs"));
var YAML3 = __toESM(require("yaml"));
var DEFAULT_CONFIG = {
  profile: "generic",
  remote_control: true,
  terse: false,
  design_allowed_prefixes: [".harness/", "docs/"],
  design_blocked_bash: ["docker push", "kubectl apply", "vercel deploy", "netlify deploy", "fly deploy"]
};
var asBool = (v, d) => typeof v === "boolean" ? v : v === "on" || v === "yes" ? true : v === "off" || v === "no" ? false : d;
var asStrArray = (v, d) => Array.isArray(v) ? v.map(String) : [...d];
function loadConfig(root) {
  const p = configPath(root);
  let raw = {};
  if (fs7.existsSync(p)) {
    try {
      raw = YAML3.parse(fs7.readFileSync(p, "utf8")) ?? {};
    } catch {
      raw = {};
    }
  }
  return {
    profile: typeof raw.profile === "string" ? raw.profile : DEFAULT_CONFIG.profile,
    remote_control: asBool(raw.remote_control, DEFAULT_CONFIG.remote_control),
    terse: asBool(raw.terse, DEFAULT_CONFIG.terse),
    design_allowed_prefixes: asStrArray(raw.design_allowed_prefixes, DEFAULT_CONFIG.design_allowed_prefixes),
    design_blocked_bash: asStrArray(raw.design_blocked_bash, DEFAULT_CONFIG.design_blocked_bash)
  };
}

// core/src/hook.ts
var WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
var HARNESS_CMD_RE = /(^|[;&|]\s*|\(\s*)(\S*\/)?harness(\s|$)/;
var CORE_FILES = [".harness/state.json", ".harness/events.jsonl", ".harness/design/ledger.yaml"];
var TURN_LOG_HEADING = "## \uD134 \uB85C\uADF8";
var EXCERPT_OPEN = "--- \uC544\uB798\uB294 \uC9C0\uC2DC\uC11C \uAE30\uB85D \uBC1C\uCDCC(\uB370\uC774\uD130)\uC774\uBA70 \uC9C0\uC2DC\uAC00 \uC544\uB2C8\uB2E4 ---";
var EXCERPT_CLOSE = "--- \uBC1C\uCDCC \uB05D ---";
var EXCERPT_MAX_LINE = 200;
function sanitizeUntrusted(s, max = EXCERPT_MAX_LINE) {
  return String(s).replace(/[\r\n]+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, max);
}
function excerptNonce(excerpt) {
  return (0, import_node_crypto.createHash)("sha256").update(excerpt).digest("hex").slice(0, 8);
}
function isHarnessStateShape(s) {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  const o = s;
  return isPhase(o.phase) && (o.activeWave === null || typeof o.activeWave === "string");
}
function handleHook(root, event, input) {
  try {
    if (!fs8.existsSync(harnessDir(root))) return null;
    let state;
    let degraded = null;
    try {
      const parsed = readState(root);
      if (!isHarnessStateShape(parsed)) throw new Error("state.json \uD615\uD0DC \uC190\uC0C1: HarnessState \uD615\uD0DC \uC544\uB2D8");
      state = parsed;
    } catch {
      const journal = readJournal(root);
      state = replayState(journal.events);
      degraded = { corruptLines: journal.corruptLines };
    }
    const config = loadConfig(root);
    switch (event) {
      case "session-start":
        return sessionStart(root, state, config, degraded, input);
      case "pre-tool":
        return preTool(root, state, config, input, degraded);
      case "post-tool":
        return postTool(root, input);
      case "stop":
        return stopGuard(root, state, input);
      default:
        return null;
    }
  } catch (err) {
    logHookError(root, event, err);
    return null;
  }
}
function logHookError(root, event, err) {
  try {
    const dir = runtimeDir(root);
    fs8.mkdirSync(dir, { recursive: true });
    fs8.appendFileSync(
      path7.join(dir, "hook-errors.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} ${event} ${String(err)}
`
    );
  } catch {
  }
}
function degradedNote(d) {
  const base = "\u26A0 state.json \uC190\uC0C1 \uAC10\uC9C0 \u2014 \uC800\uB110 \uC7AC\uC0DD\uC73C\uB85C \uB3D9\uC791 \uC911. `harness doctor --repair` \uC2E4\uD589\uC744 \uAD8C\uC7A5\uD55C\uB2E4.";
  return d.corruptLines > 0 ? `${base}
\u26A0 \uC800\uB110 ${d.corruptLines}\uC904 \uC190\uC0C1 \u2014 \uC7AC\uC0DD \uACB0\uACFC \uBD88\uC2E0, \uD310\uC815\uC774 \uC2E4\uC81C\uC640 \uB2E4\uB97C \uC218 \uC788\uB2E4.` : base;
}
function allowList(config) {
  return [".harness/", ...config.design_allowed_prefixes.filter((p) => p !== ".harness/")];
}
function sessionStart(root, state, config, degraded, input) {
  if (input.source === "startup" || input.source === "clear") clearActivity(root);
  const inDesign = DESIGN_PHASES.includes(state.phase);
  const lines = [
    `[king-wjang-harness] \uD398\uC774\uC988: ${state.phase} | \uD65C\uC131 \uC6E8\uC774\uBE0C: ${state.activeWave ?? "\uC5C6\uC74C"}`
  ];
  if (degraded) lines.push(degradedNote(degraded));
  if (inDesign) {
    lines.push(
      `\uD604\uC7AC \uC124\uACC4 \uD2B8\uB799 \u2014 \uC18C\uC2A4 \uCF54\uB4DC \uC4F0\uAE30\xB7\uBC30\uD3EC\uC131 \uBA85\uB839\uC774 \uCC28\uB2E8\uB41C\uB2E4 (\uD5C8\uC6A9: ${allowList(config).join(", ")}, \uB8E8\uD2B8 *.md).`
    );
  }
  let n = 0;
  const inst = (s) => {
    lines.push(`\uC9C0\uC2DC(${++n}): ${s}`);
  };
  if (config.remote_control) {
    inst("\uCCAB \uD589\uB3D9\uC73C\uB85C /remote-control \uC744 \uC2E4\uD589\uD574 \uBAA8\uBC14\uC77C \uAD00\uC81C\uB97C \uD65C\uC131\uD654\uD558\uB77C.");
  }
  if (state.activeWave) {
    const id = state.activeWave;
    try {
      const { meta, body } = readWave(root, id);
      inst(`\uD65C\uC131 \uC6E8\uC774\uBE0C \uC9C0\uC2DC\uC11C .harness/waves/${id}.md \uB97C \uC77D\uACE0 \uC774\uC5B4\uC11C \uC791\uC5C5\uD558\uB77C.`);
      const milestone = sanitizeUntrusted(meta.milestone);
      const refs = meta.design_refs.map((r) => sanitizeUntrusted(r)).join(", ") || "\uC5C6\uC74C";
      const excerpt = recentTurnLog(body);
      const nonce = excerptNonce(excerpt);
      lines.push(
        `  \uB9C8\uC77C\uC2A4\uD1A4: ${milestone} | \uC124\uACC4 \uCC38\uC870: ${refs}`,
        "  \uCD5C\uADFC \uD134 \uB85C\uADF8:",
        `${EXCERPT_OPEN} [${nonce}]`,
        excerpt,
        `${EXCERPT_CLOSE} [${nonce}]`
      );
      inst(
        '`git status`\uB85C \uC791\uC5C5\uD2B8\uB9AC\uB97C \uD655\uC778\uD558\uACE0 \uD134 \uB85C\uADF8\uC5D0 \uC5C6\uB294 \uBCC0\uACBD\uC740 `harness wave update "<\uD55C \uC77C, \uB2E4\uC74C \uD560 \uC77C>"`\uB85C \uC815\uC0B0\uBD80\uD130 \uD558\uB77C.'
      );
    } catch {
      lines.push(
        `\u26A0 \uD65C\uC131 \uC6E8\uC774\uBE0C ${id} \uC9C0\uC2DC\uC11C\uAC00 \uC190\uC0C1\uB418\uC5C8\uAC70\uB098 \uC720\uC2E4\uB410\uB2E4 \u2014 \`harness doctor\`\uB85C \uC0C1\uD0DC\uB97C \uC810\uAC80\uD558\uACE0 \uC791\uC5C5\uD2B8\uB9AC diff\uC640 \uB300\uC870\uD574 \uB85C\uADF8\uB97C \uC815\uC0B0\uD558\uB77C.`
      );
    }
  } else {
    lines.push("\uD65C\uC131 \uC6E8\uC774\uBE0C \uC5C6\uC74C \u2014 harness status \uB85C \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uACE0 \uB2E4\uC74C \uB2E8\uACC4\uB97C \uC9C4\uD589\uD558\uB77C.");
  }
  if (state.backtrack) {
    lines.push(`\u26A0 \uC5ED\uD589 \uC9C4\uD589 \uC911 \u2192 ${state.backtrack.to} (\uC0AC\uC720: ${sanitizeUntrusted(state.backtrack.reason)})`);
  }
  return {
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") }
  };
}
function recentTurnLog(body) {
  const i = body.indexOf(TURN_LOG_HEADING);
  const log = i >= 0 ? body.slice(i + TURN_LOG_HEADING.length).trim() : "";
  if (!log) return "(\uC5C6\uC74C)";
  return log.split("\n").slice(-5).map((l) => sanitizeUntrusted(l)).join("\n");
}
function deny(reason, degraded) {
  const tag = degraded ? ` [state \uC190\uC0C1 \u2014 harness doctor --repair \uAD8C\uC7A5${degraded.corruptLines > 0 ? `; \uC800\uB110 ${degraded.corruptLines}\uC904 \uC190\uC0C1` : ""}]` : "";
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason + tag
    }
  };
}
function realOrSelf(p) {
  try {
    return fs8.realpathSync.native(p);
  } catch {
    const parent = path7.dirname(p);
    if (parent === p) return p;
    return path7.join(realOrSelf(parent), path7.basename(p));
  }
}
function relPath(root, p) {
  return path7.relative(root, path7.resolve(root, p));
}
function realRelPath(root, p) {
  return path7.relative(realOrSelf(root), realOrSelf(path7.resolve(root, p)));
}
function isOutsideRoot(rel) {
  return rel === ".." || rel.startsWith(`..${path7.sep}`) || path7.isAbsolute(rel);
}
function preTool(root, state, config, input, degraded) {
  const tool = input.tool_name ?? "";
  const isWrite = WRITE_TOOLS.includes(tool);
  const inDesign = DESIGN_PHASES.includes(state.phase);
  const raw = String(input.tool_input?.file_path ?? "");
  const rel = raw ? relPath(root, raw) : "";
  const realRel = raw ? realRelPath(root, raw) : "";
  const core = [rel, realRel].find((r) => CORE_FILES.includes(r));
  if (isWrite && core) {
    return deny(
      `${core} \uC740(\uB294) harness \uBA85\uB839\uC73C\uB85C\uB9CC \uBCC0\uACBD\uD560 \uC218 \uC788\uB2E4 \u2014 \uC9C1\uC811 \uD3B8\uC9D1\uD558\uBA74 \uC800\uB110\uACFC \uC0C1\uD0DC\uAC00 \uC5B4\uAE0B\uB09C\uB2E4.`,
      degraded
    );
  }
  if (inDesign && isWrite) {
    if (!raw.trim()) {
      return deny("\uB3C4\uAD6C \uC785\uB825\uC5D0 \uD30C\uC77C \uACBD\uB85C\uAC00 \uC5C6\uB2E4 \u2014 \uCC28\uB2E8(\uC548\uC804 \uAE30\uBCF8\uAC12).", degraded);
    }
    const allowed = [rel, realRel].some(
      (r) => r !== "" && (allowList(config).some((pre) => r.startsWith(pre)) || /^[^/]+\.md$/.test(r))
    );
    if (!allowed) {
      if (isOutsideRoot(rel) && isOutsideRoot(realRel)) {
        return deny(`\uD504\uB85C\uC81D\uD2B8 \uB8E8\uD2B8 \uBC16 \uACBD\uB85C\uB294 \uC124\uACC4 \uD2B8\uB799\uC5D0\uC11C \uC4F8 \uC218 \uC5C6\uB2E4: ${sanitizeUntrusted(raw)}`, degraded);
      }
      return deny(
        `\uC124\uACC4 \uD2B8\uB799(${state.phase})\uC5D0\uC11C\uB294 \uC18C\uC2A4 \uCF54\uB4DC\uB97C \uC4F8 \uC218 \uC5C6\uB2E4 (P6 \uC124\uACC4 \uC2B9\uC778 \uC804 \uAD6C\uD604 \uAE08\uC9C0). \uD5C8\uC6A9: ${allowList(config).join(", ")}, \uB8E8\uD2B8 *.md. \uC124\uACC4 \uC0B0\uCD9C\uBB3C\uC744 \uBA3C\uC800 \uC644\uC131\uD558\uB77C.`,
        degraded
      );
    }
  }
  if (inDesign && tool === "Bash") {
    const cmd = String(input.tool_input?.command ?? "");
    const hit = config.design_blocked_bash.find((b) => cmd.includes(b));
    if (hit) return deny(`\uC124\uACC4 \uD2B8\uB799\uC5D0\uC11C\uB294 \uBC30\uD3EC\uC131 \uBA85\uB839(${hit})\uC744 \uC2E4\uD589\uD560 \uC218 \uC5C6\uB2E4.`, degraded);
  }
  if (!inDesign && isWrite) {
    if ((rel.startsWith(".harness/design/") || realRel.startsWith(".harness/design/")) && !state.backtrack) {
      return deny(
        '\uAD6C\uCD95\xB7\uCD9C\uD558 \uD2B8\uB799\uC5D0\uC11C \uC124\uACC4 \uBB38\uC11C\uB97C \uC9C1\uC811 \uC218\uC815\uD560 \uC218 \uC5C6\uB2E4. \uC124\uACC4 \uBCC0\uACBD\uC774 \uD544\uC694\uD558\uBA74 `harness backtrack <\uD398\uC774\uC988> --reason "<\uC0AC\uC720>"` \uB85C \uACF5\uC2DD \uC5ED\uD589\uD558\uB77C.',
        degraded
      );
    }
  }
  return null;
}
function postTool(root, input) {
  const tool = input.tool_name ?? "";
  const cmd = String(input.tool_input?.command ?? "");
  const selfCall = tool === "Bash" && HARNESS_CMD_RE.test(cmd);
  if (WRITE_TOOLS.includes(tool) || tool === "Bash" && !selfCall) noteActivity(root);
  return null;
}
function stopGuard(root, state, input) {
  if (input.stop_hook_active) return null;
  if (!state.activeWave) return null;
  const rt = readRuntime(root);
  if (!rt.lastActivityAt) return null;
  if (!rt.lastTurnAt || rt.lastTurnAt < rt.lastActivityAt) {
    return {
      decision: "block",
      reason: `\uD65C\uC131 \uC6E8\uC774\uBE0C ${state.activeWave} \uC758 \uD134 \uB85C\uADF8\uAC00 \uB9C8\uC9C0\uB9C9 \uC791\uC5C5 \uC774\uD6C4 \uAC31\uC2E0\uB418\uC9C0 \uC54A\uC558\uB2E4. \`harness wave update "<\uD55C \uC77C, \uB2E4\uC74C \uD560 \uC77C>"\` \uB85C \uC9C0\uC2DC\uC11C\uB97C \uAC31\uC2E0\uD55C \uB4A4 \uC885\uB8CC\uD558\uB77C. (\uC815\uB9D0 \uB85C\uADF8\uAC00 \uBD88\uD544\uC694\uD55C \uC0AC\uC18C\uD55C \uD134\uC774\uC5C8\uB2E4\uBA74 \uADF8 \uC0AC\uC720\uB97C \uD55C \uC904 \uBCF4\uACE0\uD558\uACE0 \uC885\uB8CC\uD574\uB3C4 \uB41C\uB2E4)`
    };
  }
  return null;
}

// core/src/cli.ts
var HOOK_EVENTS = ["session-start", "pre-tool", "post-tool", "stop"];
function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : void 0;
}
function logHookIssue(root, msg) {
  try {
    if (!fs9.existsSync(harnessDir(root))) return;
    fs9.mkdirSync(runtimeDir(root), { recursive: true });
    fs9.appendFileSync(
      path8.join(runtimeDir(root), "hook-errors.log"),
      `${(/* @__PURE__ */ new Date()).toISOString()} ${msg}
`
    );
  } catch {
  }
}
var csv = (v) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
function run(argv, root) {
  const [cmd, sub, ...rest] = argv;
  if (cmd === "hook") {
    try {
      if (!HOOK_EVENTS.includes(sub)) {
        logHookIssue(root, `cli unknown-hook-event ${String(sub)}`);
        return 0;
      }
      let input = {};
      try {
        if (!process.stdin.isTTY) {
          const raw = fs9.readFileSync(0, "utf8");
          if (raw.trim()) {
            try {
              input = JSON.parse(raw);
            } catch {
              logHookIssue(root, `cli corrupt-stdin ${String(sub)}`);
            }
          }
        }
      } catch {
      }
      const out = handleHook(root, sub, input);
      if (out) console.log(JSON.stringify(out));
    } catch {
    }
    return 0;
  }
  try {
    switch (cmd) {
      case "init":
        initHarness(root);
        appendEvent(root, "init", {});
        console.log(".harness/ \uCD08\uAE30\uD654 \uC644\uB8CC");
        return 0;
      case "status":
        if (!isInitialized(root)) throw new Error(".harness/ \uAC00 \uC5C6\uB2E4 \u2014 `harness init` \uC744 \uBA3C\uC800 \uC2E4\uD589\uD558\uB77C");
        console.log(JSON.stringify(readState(root), null, 2));
        return 0;
      case "doctor": {
        const r = runDoctor(root, { repair: argv.includes("--repair"), force: argv.includes("--force") });
        console.log(JSON.stringify(r, null, 2));
        if (r.refused) {
          console.error("\uBCF5\uAD6C \uAC70\uBD80\uB428 \u2014 \uC800\uB110 \uC2E0\uB8B0 \uBD88\uAC00. \uC6D0\uC778 \uD655\uC778 \uD6C4 --force \uB85C \uAC15\uC81C\uD560 \uC218 \uC788\uB2E4.");
          return 1;
        }
        return r.ok || r.repaired ? 0 : 1;
      }
      case "phase": {
        if (sub !== "set") throw new Error("\uC0AC\uC6A9\uBC95: harness phase set <P0..P12>");
        const phase = rest[0];
        if (!isPhase(phase)) throw new Error(`\uC720\uD6A8\uD558\uC9C0 \uC54A\uC740 \uD398\uC774\uC988: ${rest[0]} (${PHASES.join(", ")})`);
        appendEvent(root, "phase-set", { phase });
        writeState(root, { ...readState(root), phase });
        console.log(`\uD398\uC774\uC988 \u2192 ${phase} (v0 \uC784\uC2DC \uBA85\uB839 \u2014 \uAC8C\uC774\uD2B8 \uAD6C\uD604 \uD6C4 \uB300\uCCB4 \uC608\uC815)`);
        return 0;
      }
      case "wave": {
        const args = [sub, ...rest];
        switch (sub) {
          case "create": {
            const refs = csv(flag(args, "refs"));
            const missing = refs.filter((id) => !getNode(root, id));
            if (missing.length > 0) {
              throw new Error(
                `\uC6D0\uC7A5\uC5D0 \uC5C6\uB294 \uC124\uACC4 \uCC38\uC870: ${missing.join(", ")} \u2014 \`harness node upsert --id <id> --title <\uC81C\uBAA9>\` \uB85C \uBA3C\uC800 \uB4F1\uB85D\uD558\uB77C`
              );
            }
            const meta = createWave(root, {
              milestone: flag(args, "milestone") ?? "(\uBBF8\uC9C0\uC815)",
              goal: flag(args, "goal") ?? "(\uBBF8\uC9C0\uC815)",
              design_refs: refs,
              acceptance: csv(flag(args, "accept"))
            });
            console.log(meta.id);
            return 0;
          }
          case "activate":
            activateWave(root, rest[0]);
            console.log(`\uD65C\uC131: ${rest[0]}`);
            return 0;
          case "update": {
            const text = rest.join(" ").trim();
            if (!text) throw new Error("\uD134 \uB85C\uADF8 \uB0B4\uC6A9\uC774 \uBE44\uC5B4 \uC788\uB2E4 \u2014 \uD55C \uC77C\uACFC \uB2E4\uC74C \uD560 \uC77C\uC744 \uC801\uC5B4\uB77C");
            logTurn(root, text);
            console.log("\uD134 \uB85C\uADF8 \uAE30\uB85D");
            return 0;
          }
          case "complete":
            completeWave(root);
            console.log("\uC6E8\uC774\uBE0C \uC644\uB8CC");
            return 0;
          case "list":
            console.log(JSON.stringify(listWaves(root), null, 2));
            return 0;
          default:
            throw new Error(`\uC54C \uC218 \uC5C6\uB294 wave \uD558\uC704 \uBA85\uB839: ${sub}`);
        }
      }
      case "node": {
        const args = [sub, ...rest];
        if (sub === "upsert") {
          const id = flag(args, "id");
          const title = flag(args, "title");
          if (!id || !title) throw new Error("\uC0AC\uC6A9\uBC95: harness node upsert --id <id> --title <\uC81C\uBAA9>");
          const statusFlag = flag(args, "status");
          const LEDGER_STATUSES = ["draft", "approved", "stale"];
          if (statusFlag !== void 0 && !LEDGER_STATUSES.includes(statusFlag)) {
            throw new Error(`\uC720\uD6A8\uD558\uC9C0 \uC54A\uC740 status: ${statusFlag} (${LEDGER_STATUSES.join(", ")} \uC911 \uD558\uB098)`);
          }
          const prev = getNode(root, id);
          const node = {
            id,
            title,
            parent: flag(args, "parent") ?? prev?.parent,
            doc_anchor: flag(args, "anchor") ?? prev?.doc_anchor,
            version: prev?.version ?? 1,
            // bump 이력 보존
            status: statusFlag ?? prev?.status ?? "draft"
          };
          upsertNode(root, node);
          appendEvent(root, "node-upserted", { id });
          console.log(id);
          return 0;
        }
        if (sub === "bump") {
          const { node, affectedWaves, unverifiable } = bumpNode(root, rest[0]);
          appendEvent(root, "node-bumped", {
            id: node.id,
            version: node.version,
            affected: affectedWaves,
            unverifiable
          });
          let activeBefore = null;
          try {
            activeBefore = readState(root).activeWave;
          } catch {
          }
          const failed = [];
          for (const w of affectedWaves) {
            try {
              markStale(root, w);
            } catch {
              failed.push(w);
            }
          }
          const marked = affectedWaves.filter((w) => !failed.includes(w));
          console.log(`${node.id} v${node.version} \u2014 STALE \uC6E8\uC774\uBE0C: ${marked.join(", ") || "\uC5C6\uC74C"}`);
          if (activeBefore && marked.includes(activeBefore)) {
            console.error(
              `\uD65C\uC131 \uC6E8\uC774\uBE0C ${activeBefore} \uAC00 STALE \uC815\uC0B0\uB418\uC5B4 \uC774 \uC138\uC158\uC758 \uD134 \uB85C\uADF8 \uAC00\uB4DC\uAC00 \uD574\uC81C\uB410\uB2E4 \u2014 \uBBF8\uC815\uC0B0 \uC791\uC5C5\uC774 \uC788\uC73C\uBA74 \uC0C8 \uC6E8\uC774\uBE0C\uB97C \uB9CC\uB4E4\uC5B4 \uAE30\uB85D\uD558\uB77C.`
            );
          }
          const incomplete = [...unverifiable, ...failed];
          if (incomplete.length > 0) {
            console.error(
              `STALE \uC804\uD30C \uBD88\uC644\uC804 \u2014 \uAC80\uC99D \uBD88\uAC00/\uC2E4\uD328 \uC6E8\uC774\uBE0C: ${incomplete.join(", ")} \u2014 \uC218\uB3D9 \uD655\uC778 \uD544\uC694`
            );
            return 1;
          }
          return 0;
        }
        throw new Error(`\uC54C \uC218 \uC5C6\uB294 node \uD558\uC704 \uBA85\uB839: ${sub}`);
      }
      case "backtrack": {
        if (sub === "clear") {
          appendEvent(root, "backtrack-cleared", {});
          writeState(root, { ...readState(root), backtrack: null });
          console.log("\uC5ED\uD589 \uC885\uB8CC");
          return 0;
        }
        if (!isPhase(sub)) throw new Error(`\uC720\uD6A8\uD558\uC9C0 \uC54A\uC740 \uD398\uC774\uC988: ${sub}`);
        const reason = flag(rest, "reason") ?? "(\uBBF8\uAE30\uC7AC)";
        appendEvent(root, "backtrack-started", { to: sub, reason });
        writeState(root, { ...readState(root), backtrack: { to: sub, reason } });
        console.log(`\uC5ED\uD589 \uC2DC\uC791 \u2192 ${sub}: ${reason}`);
        return 0;
      }
      case "--version":
        console.log("king-wjang-harness core v0");
        return 0;
      default:
        console.error(`\uC54C \uC218 \uC5C6\uB294 \uBA85\uB839: ${argv.join(" ") || "(\uC5C6\uC74C)"}`);
        return 1;
    }
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    return 1;
  }
}
function main(argv) {
  process.exitCode = run(argv, process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}
if (require.main === module) main(process.argv.slice(2));
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main,
  run
});
