// edit.js：編集の道具（元に戻す・トラックの追加や並べかえ・コピペ）
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）

// ================================================
// 4. 編集の道具（選択・コピペ・元に戻す）
// ================================================
const currentNotes = () => state.tracks[state.current].notes;

// ---------- 元に戻す・やり直し ----------
// 曲の中身（トラック・音・シンセ・音量など全部）を文字にして記録する。
// 操作が終わるたび（クリック・ドラッグが終わった・選択欄を変えた…）に今の中身と比べて、
// 変わっていたら、変わる前の中身を「元に戻す」の記録に足す
const TRACK_KEYS = ["id", "name", "type", "role", "color", "mute", "solo", "volume", "pan", "send", "duck", "instrument", "synth", "pads", "sc", "notes", "custom"];
function trackData(t) {
  const d = {};
  for (const k of TRACK_KEYS) if (t[k] !== undefined) d[k] = t[k];
  return d;
}
const songData = () => ({ bpm: state.bpm, key: state.key, scale: state.scale, tracks: state.tracks.map(trackData) });
const snapshot = () => JSON.stringify(songData());

let committed = null;   // 最後に記録した中身
function commitHistory() {
  const now = snapshot();
  if (committed !== null && now !== committed) {
    history.undo.push(committed);
    if (history.undo.length > 100) history.undo.shift();
    history.redo = [];
    dirty = true;
  }
  committed = now;
}
// 何かを変える前に呼ぶ：それまでの変更を、1つの区切りとして記録しておく
const pushHistory = commitHistory;

// 操作が1つ終わったら記録する（ほかの処理が全部終わってから見る）
let commitTimer = null;
function commitSoon(delay) {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    if (drag || envDrag || eqDrag) return;   // ドラッグの途中なら、離したときに記録する
    commitHistory();
    updateTryChecks();
  }, delay || 0);
}
for (const type of ["pointerup", "change", "click", "keyup", "drop"]) window.addEventListener(type, () => commitSoon(0));
// 次の操作を始める直前にも、それまでの変更を区切っておく（素早く続けて操作しても、1回ずつ戻せるように）
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, () => { if (!drag && !envDrag && !eqDrag) commitHistory(); }, true);
window.addEventListener("wheel", () => commitSoon(500), { passive: true });   // ホイールでつまみを回したときは、止まってから

// 記録した中身に戻す。トラックは id で探して、同じものの中身だけ入れかえる（音の通り道を作り直さないため）
function applySong(d) {
  const old = new Map(state.tracks.map((t) => [t.id, t]));
  const currentId = state.tracks[state.current] && state.tracks[state.current].id;
  state.tracks = d.tracks.map((td) => {
    const t = old.get(td.id) || {};
    old.delete(td.id);
    for (const k of TRACK_KEYS) delete t[k];
    Object.assign(t, newTrack({}), JSON.parse(JSON.stringify(td)));
    if (t.type === "drum") fillDrumTrack(t);   // 古いデータでも、パッドの設定をそろえておく
    else { delete t.pads; delete t.sc; }
    return t;
  });
  for (const t of old.values()) disconnectBus(t);
  nextTrackId = Math.max(nextTrackId, ...state.tracks.map((t) => Number(String(t.id).slice(1)) + 1 || 0));
  state.bpm = d.bpm || 120;
  state.key = d.key || 0;
  state.scale = SCALE_TYPES[d.scale] ? d.scale : "major";
  $("bpm").value = state.bpm;
  $("key").value = state.key;
  $("scale").value = state.scale;
  const i = state.tracks.findIndex((t) => t.id === currentId);
  state.current = i >= 0 ? i : Math.min(state.current, state.tracks.length - 1);
  if (state.synthOpen !== null && (!state.tracks[state.synthOpen] || state.tracks[state.synthOpen].instrument !== "synth")) state.synthOpen = null;
  state.confirmRemove = null;
  state.renaming = null;
  state.selected.clear();   // 中身が作り直されるので選択は外す
  if (audio) {
    for (const t of state.tracks) {
      updateBus(t);
      if (t.synth && synthChains.has(t)) chainFor(t).update(t.synth, true);
    }
  }
}
const restore = (text) => applySong(JSON.parse(text));

function undo() {
  commitHistory();
  if (history.undo.length === 0) return;
  history.redo.push(committed);
  committed = history.undo.pop();
  restore(committed);
  dirty = true;
  render();
}

function redo() {
  commitHistory();
  if (history.redo.length === 0) return;
  history.undo.push(committed);
  committed = history.redo.pop();
  restore(committed);
  dirty = true;
  render();
}

// ---------- トラックを増やす・消す・並べかえる・複製する ----------
function freeColor() {
  const used = state.tracks.map((t) => t.color);
  return TRACK_COLORS.find((c) => !used.includes(c)) || TRACK_COLORS[state.tracks.length % TRACK_COLORS.length];
}
function freeName(base) {
  let name = base, k = 2;
  while (state.tracks.some((t) => t.name === name)) name = base + (k++);
  return name;
}
function addTrack(type) {
  if (state.tracks.length >= MAX_TRACKS) return;
  pushHistory();
  const synth = type === "synth";
  const name = freeName({ drum: "ドラム", fx: "FX", synth: "シンセ" }[type] || "楽器");
  state.tracks.push(newTrack({ name, type: synth ? "inst" : type, color: freeColor(),
                               instrument: synth ? "synth" : "piano", synth: synth ? defaultSynth() : undefined }));
  selectTrack(state.tracks.length - 1);
  if (synth) { state.synthOpen = state.tracks.length - 1; render(); }
}

function removeTrack(i) {
  const t = state.tracks[i];
  if (!t || state.tracks.length <= 1) return;   // 最後の1つは消さない
  pushHistory();
  disconnectBus(t);
  const beforeType = state.tracks[state.current].type;
  state.tracks.splice(i, 1);
  // 消したトラックより後ろを編集していたら、番号が1つずれる
  if (i < state.current || state.current >= state.tracks.length) state.current--;
  else if (i === state.current) state.current = Math.min(i, state.tracks.length - 1);
  const afterType = state.tracks[state.current].type;
  if (beforeType !== afterType) { view["y_" + beforeType] = view.y; view.y = view["y_" + afterType] || 0; }
  state.selected.clear();
  state.synthOpen = null;
  state.confirmRemove = null;
  render();
}

// 上下に動かす（d = -1 で上、1 で下）
function moveTrack(i, d) {
  const j = i + d;
  if (j < 0 || j >= state.tracks.length) return;
  pushHistory();
  const [t] = state.tracks.splice(i, 1);
  state.tracks.splice(j, 0, t);
  if (state.current === i) state.current = j;
  else if (state.current === j) state.current = i;
  if (state.synthOpen === i) state.synthOpen = j;
  else if (state.synthOpen === j) state.synthOpen = i;
  render();
}

// 同じ中身のトラックをすぐ下に作る（音・音色・シンセ・読み込んだ音もそのまま）
function duplicateTrack(i) {
  if (state.tracks.length >= MAX_TRACKS) return;
  pushHistory();
  const d = JSON.parse(JSON.stringify(trackData(state.tracks[i])));
  delete d.id;
  delete d.role;   // 「コードトラック」は1つだけ
  d.name = freeName(d.name.replace(/\d+$/, "") || "楽器");
  d.color = freeColor();
  state.tracks.splice(i + 1, 0, newTrack(d));
  if (state.synthOpen !== null && state.synthOpen > i) state.synthOpen++;
  selectTrack(i + 1);
}

// 編集するトラックを変える。楽器 ⇔ ドラムで行の並びが変わるので、縦のスクロール位置はそれぞれ覚えておく
function selectTrack(i) {
  const before = state.tracks[state.current] ? state.tracks[state.current].type : "inst";
  if (state.current !== i) state.selected.clear();   // 選択は編集中のトラックの音だけ
  state.current = i;
  const after = state.tracks[i].type;
  if (before !== after) {
    view["y_" + before] = view.y;
    view.y = view["y_" + after] || 0;
  }
  if (state.synthOpen !== null && state.synthOpen !== i) state.synthOpen = state.tracks[i].instrument === "synth" && !isPadTrack(state.tracks[i]) ? i : null;
  render();
}

function copySelected() {
  const sel = [...state.selected];
  if (sel.length === 0) return;
  const first = Math.min(...sel.map((n) => n.start));
  const last = Math.max(...sel.map((n) => n.start + n.length));
  clipboard = {
    notes: sel.map((n) => ({ pitch: n.pitch, start: n.start - first, length: n.length, velocity: n.velocity })),
    from: first,
    length: last - first
  };
}

function deleteSelected() {
  if (state.selected.size === 0) return;
  pushHistory();
  state.tracks[state.current].notes = currentNotes().filter((n) => !state.selected.has(n));
  state.selected.clear();
}

// 貼り付け：マウスがピアノロールの上ならその位置、なければコピーした範囲のすぐ後ろ
function paste() {
  if (clipboard.notes.length === 0) return;
  let at;
  if (mouse && mouse.x >= KEY_W && mouse.y >= RULER_H) {
    at = snapFloor(unitAt(mouse.x));
  } else {
    at = clipboard.from + clipboard.length;
  }
  if (at >= TOTAL) return;
  pushHistory();
  state.selected.clear();
  const [lo, hi] = pitchRange();
  for (const c of clipboard.notes) {
    const start = at + c.start;
    if (start >= TOTAL) continue;   // 8小節からはみ出す音は捨てる
    if (c.pitch < lo || c.pitch > hi) continue;   // 楽器 ⇔ ドラムで、行がない音も捨てる
    const n = { pitch: c.pitch, start: start, length: Math.min(c.length, TOTAL - start), velocity: c.velocity };
    currentNotes().push(n);
    state.selected.add(n);           // 貼り付けた音を選択しておく（そのまま動かせる）
  }
  clipboard.from = at;               // もう一度貼ると、さらに後ろに続く
}
