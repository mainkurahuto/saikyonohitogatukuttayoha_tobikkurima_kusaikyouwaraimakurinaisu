// ================================================
// 保存・読み込み・書き出し
// ・自動保存（ブラウザの中に。閉じても、次に開いたら続きから）
// ・プロジェクトのファイル（.json）に保存する・開く
// ・WAV（音声ファイル）に書き出す
// ・MIDI（ほかの DAW に持っていけるファイル）に書き出す
// ================================================
const APP_ID = "zero-kara-8-shosetsu";
const SAVE_KEY = "zero8-project";       // 自動保存の中身
const SAMPLE_KEY = "zero8-samples";     // 自動保存：パッドに読み込んだ自分の音
let dirty = false;                       // 前に自動保存してから、何か変わったか

// ---------- 音のファイル ⇔ 文字 ----------
// ArrayBuffer → Base64 の文字（JSON に入れるため）
function toBase64(bytes) {
  const u8 = new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(text) {
  const bin = atob(text);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8.buffer;
}

// 読み込んだ音を SAMPLES に入れて、目印（sid）を返す
async function addSample(data, sid) {
  initAudio();
  const buffer = await audio.decodeAudioData(fromBase64(data));
  sid = sid || "s" + (nextSampleId++);
  SAMPLES[sid] = { buffer, data };
  return sid;
}

// 今のトラックで使っている、自分の音の一覧
function usedSamples() {
  const out = {};
  for (const t of state.tracks) {
    for (const pad in t.custom || {}) {
      const sid = t.custom[pad].sid;
      if (SAMPLES[sid]) out[sid] = SAMPLES[sid].data;
    }
  }
  return out;
}

// 保存するときの中身
const projectData = (withSamples) => Object.assign({ app: APP_ID, version: 1 }, songData(), withSamples ? { samples: usedSamples() } : {});

// ファイルの中の音を読み込んで、目印を付け直す（今ある音と目印がかぶらないように）
async function loadSamples(d) {
  const map = {};
  for (const sid in d.samples || {}) {
    try { map[sid] = await addSample(d.samples[sid]); } catch (err) { /* 読めない音は、元の音のまま */ }
  }
  for (const t of d.tracks) {
    for (const pad in t.custom || {}) {
      const c = t.custom[pad];
      if (map[c.sid]) c.sid = map[c.sid];
      else delete t.custom[pad];
    }
  }
}

// 中身がこのアプリのものか、ざっと確かめる
function validProject(d) {
  return d && Array.isArray(d.tracks) && d.tracks.length > 0 && d.tracks.length <= MAX_TRACKS &&
         d.tracks.every((t) => t && Array.isArray(t.notes) && ["inst", "drum", "fx"].includes(t.type));
}

// 読み込んだ中身にする（Ctrl＋Z で、読み込む前に戻せる）
async function openProject(d) {
  if (!validProject(d)) throw new Error("bad");
  await loadSamples(d);
  pushHistory();
  d.tracks.forEach((t) => { if (!t.id) t.id = "t" + (nextTrackId++); });
  // 同じ目印のトラックがあると混ざるので、ファイルから読んだトラックは目印を付け直す
  const ids = new Set();
  for (const t of d.tracks) { if (ids.has(t.id) || state.tracks.some((x) => x.id === t.id)) t.id = "t" + (nextTrackId++); ids.add(t.id); }
  applySong(d);
  commitHistory();
  if (state.playing) stopPlay();
  render();
}

// ---------- 自動保存 ----------
let lastSaved = "", lastSavedSamples = "";
function autosave() {
  if (!dirty && lastSaved) return;
  dirty = false;
  try {
    const text = JSON.stringify(Object.assign(projectData(false), { ui: { book: state.book, step: state.step } }));
    if (text !== lastSaved) { localStorage.setItem(SAVE_KEY, text); lastSaved = text; }
    const samples = JSON.stringify(usedSamples());
    if (samples !== lastSavedSamples) {
      lastSavedSamples = samples;
      try { localStorage.setItem(SAMPLE_KEY, samples); }
      catch (err) { localStorage.removeItem(SAMPLE_KEY); }   // 音が大きすぎて入らないときは、音だけあきらめる
    }
  } catch (err) { /* 保存できないブラウザ（プライベートモードなど）では何もしない */ }
}
setInterval(autosave, 1500);
window.addEventListener("pagehide", () => { dirty = true; autosave(); });
// 説明のページを変えたときも保存する
const markDirty = () => { dirty = true; };

// 開いたとき：前の続きがあれば戻す
async function loadAutosave() {
  let d = null, samples = {};
  try {
    d = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
    samples = JSON.parse(localStorage.getItem(SAMPLE_KEY) || "{}");
  } catch (err) { return; }
  if (!validProject(d)) return;
  const ui = d.ui;
  applySong(d);   // 音より先に、音符・設定だけ戻す
  if (ui && BOOKS[ui.book] && BOOKS[ui.book].steps.length) {
    if (ui.book !== state.book) switchBook(ui.book);
    state.step = Math.max(0, Math.min(order.length - 1, ui.step || 0));
  }
  committed = snapshot();
  lastSaved = "";
  // 自分の音は、読み込みに少し時間がかかる
  const sids = Object.keys(samples);
  if (sids.length) {
    for (const sid of sids) {
      try { await addSample(samples[sid], sid); } catch (err) { /* 読めない音は元の音のまま */ }
      nextSampleId = Math.max(nextSampleId, Number(sid.slice(1)) + 1 || 0);
    }
    render();
  }
}

// ---------- 「新しく作る」 ----------
function newProject() {
  pushHistory();
  if (state.playing) stopPlay();
  applySong({ bpm: 120, key: 0, scale: "major", tracks: firstTracks().map(trackData) });
  state.current = 0;
  commitHistory();
  render();
}

// ---------- ファイルとしてダウンロードさせる ----------
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
const fileStamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
};

function saveProjectFile() {
  download(new Blob([JSON.stringify(projectData(true))], { type: "application/json" }), "8小節-" + fileStamp() + ".json");
}

// ---------- WAV に書き出す ----------
// 音を鳴らす仕組みはそのままで、行き先だけ「スピーカー」から「ファイル用の箱（OfflineAudioContext）」に入れかえて、
// 8小節ぶんを一気に計算する
async function exportWav(btn) {
  initAudio();
  if (state.playing) stopPlay();
  const lead = 0.05, tail = 3;
  const length = lead + TOTAL * unitSec() + tail;
  const sr = 44100;
  const off = new OfflineAudioContext(2, Math.ceil(length * sr), sr);

  // 今の音の行き先を取っておいて、入れかえる
  const saved = { audio, master, reverbIn, buses, synthChains, voices: player.voices };
  audio = off;
  buses = new WeakMap();
  synthChains = new WeakMap();
  player.voices = [];
  try {
    setupOutput();
    master.gain.value = 0.35;
    for (const t of state.tracks) {   // シンセの列を先に作って、ウォブルを1小節目の頭にそろえる
      if (t.instrument === "synth" && t.synth && !isPadTrack(t) && isAudible(t)) {
        const ch = chainFor(t);
        if (t.synth.wobble.on && t.synth.fx.filter.on) setWobble(ch, t.synth.wobble, lead);
      }
    }
    for (let u = 0; u < TOTAL; u++) scheduleUnit(u, lead + u * unitSec());
  } finally {
    // すぐ元に戻す（計算している間も、ほかの操作で音が鳴るように）
    ({ audio, master, reverbIn, buses, synthChains } = saved);
    player.voices = saved.voices;
  }
  if (btn) { btn.disabled = true; btn.textContent = "書き出し中…"; }
  try {
    const buf = await off.startRendering();
    download(encodeWav(buf), "8小節-" + fileStamp() + ".wav");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "WAV で書き出す"; }
  }
}

// AudioBuffer → WAV ファイル（16bit）
function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); data.setUint32(4, 36 + len * ch * 2, true); str(8, "WAVE");
  str(12, "fmt "); data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, sr, true); data.setUint32(28, sr * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true);
  str(36, "data"); data.setUint32(40, len * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}

// ---------- MIDI に書き出す ----------
// ドラムは 10ch（General MIDI のドラムの番号）。FX トラックは MIDI にできないので入れない
const GM_DRUMS = [36, 38, 39, 42, 46, 49, 51, 45, 47, 50, 37, 56, 70, 54, 39, 35];   // パッドの番号 → GM の番号（スナップはクラップで代用）
const GM_PROGRAMS = { piano: 0, organ: 16, strings: 48, lead: 81, pluck: 45, bell: 14, chip: 80 };
function gmProgram(t) {
  if (t.instrument !== "synth" || !t.synth) return GM_PROGRAMS[t.instrument] || 0;
  return { bass: 38, subbass: 38, wobble: 38, pad: 89, pluck: 45, supersaw: 81, lead: 81 }[t.synth.preset] || 81;
}

function exportMidi() {
  const PPQ = 480, perUnit = PPQ / 12;   // 1拍 = 48分12個
  const vlq = (n) => { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
  const text = (type, s) => { const b = Array.from(new TextEncoder().encode(s)); return [0xff, type, ...vlq(b.length), ...b]; };
  const chunk = (id, bytes) => [...Array.from(id).map((c) => c.charCodeAt(0)), (bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255, ...bytes];
  // 出来事（[時刻, 中身]）を時刻順に並べて、トラック1つぶんのバイトにする
  const trackBytes = (events) => {
    events.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
    let last = 0, out = [];
    for (const [tick, bytes] of events) { out.push(...vlq(tick - last), ...bytes); last = tick; }
    return chunk("MTrk", [...out, 0, 0xff, 0x2f, 0]);
  };

  const tempo = Math.round(60000000 / state.bpm);
  const tracks = [trackBytes([[0, text(3, "ゼロから8小節"), 0], [0, [0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255], 0], [0, [0xff, 0x58, 4, 4, 2, 24, 8], 0]])];
  let ch = 0;
  for (const t of state.tracks) {
    if (isFx(t) || !isAudible(t) || !t.notes.length) continue;
    const drum = isDrum(t);
    const c = drum ? 9 : ch;
    if (!drum) { ch++; if (ch === 9) ch++; if (ch > 15) ch = 15; }
    const ev = [[0, text(3, t.name), 0]];
    if (!drum) ev.push([0, [0xc0 | c, gmProgram(t)], 0]);
    ev.push([0, [0xb0 | c, 7, Math.min(127, Math.round(t.volume * 1.27))], 0]);        // 音量
    ev.push([0, [0xb0 | c, 10, Math.round(((t.pan || 0) + 100) / 200 * 127)], 0]);     // パン
    for (const n of t.notes) {
      const note = drum ? GM_DRUMS[n.pitch] : n.pitch;
      if (note === undefined) continue;
      const on = n.start * perUnit, off = (n.start + n.length) * perUnit;
      ev.push([on, [0x90 | c, note, Math.max(1, Math.min(127, n.velocity))], 1]);
      ev.push([off, [0x80 | c, note, 0], 0]);   // 同じ時刻なら、止める方を先に
    }
    tracks.push(trackBytes(ev));
  }
  const header = chunk("MThd", [0, 1, 0, tracks.length, PPQ >> 8, PPQ & 255]);
  const bytes = new Uint8Array([...header, ...tracks.flat()]);
  download(new Blob([bytes], { type: "audio/midi" }), "8小節-" + fileStamp() + ".mid");
}

// ---------- ファイルのメニュー ----------
let newConfirm = null;
$("filemenu").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-file]");
  if (!b) return;
  const act = b.dataset.file;
  if (act === "save") saveProjectFile();
  if (act === "open") $("project-file").click();
  if (act === "wav") { exportWav(b).catch(() => alert("WAV の書き出しに失敗しました。")); return; }
  if (act === "midi") exportMidi();
  if (act === "new") {
    // 1回目は「本当に？」に変わるだけ（Ctrl＋Z でも戻せる）
    if (!newConfirm) {
      b.textContent = "本当に新しくする？（もう一度押す）";
      b.classList.add("sure");
      newConfirm = setTimeout(() => { newConfirm = null; b.textContent = "新しく作る"; b.classList.remove("sure"); }, 3000);
      return;
    }
    clearTimeout(newConfirm);
    newConfirm = null;
    b.textContent = "新しく作る";
    b.classList.remove("sure");
    newProject();
  }
  $("filemenu").open = false;
});
$("project-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== APP_ID) throw new Error("not ours");
    await openProject(d);
  } catch (err) {
    alert("このファイルは開けませんでした。「ファイル → 保存」で作った .json を選んでください。");
  }
});
// メニューの外を押したら閉じる
document.addEventListener("click", (e) => { if (!e.target.closest("#filemenu")) $("filemenu").open = false; });
