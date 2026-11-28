// events.js：ボタンやキーボードの操作
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）

// ================================================
// 6. イベント（操作されたら データを変えて render）
// ================================================
$("btn-split").addEventListener("click", () => { state.mode = "split"; render(); });
$("btn-tab").addEventListener("click", () => { state.mode = "tab"; render(); });
$("tab-explain").addEventListener("click", () => { state.tab = "explain"; render(); });
$("tab-daw").addEventListener("click", () => { state.tab = "daw"; render(); });

$("prev").addEventListener("click", () => { if (state.step > 0) goToStep(state.step - 1); });
$("next").addEventListener("click", () => { if (state.step < order.length - 1) goToStep(state.step + 1); });

// 順番を選ぶボタン（本文でも目次でも）
document.addEventListener("click", (e) => {
  const b = e.target.closest(".order-opt");
  if (b) setOrder(Number(b.dataset.order), Number(b.dataset.opt));
});

// 目次ボタン
// 目次・用語ボタン：もう一度押すと本文に戻る
$("toc-btn").addEventListener("click", () => { state.panel = state.panel === "toc" ? "lesson" : "toc"; renderExplain(); });
$("glossary-btn").addEventListener("click", () => { state.panel = state.panel === "glossary" ? "lesson" : "glossary"; renderExplain(); });
$("chart-btn").addEventListener("click", () => { state.panel = state.panel === "chart" ? "lesson" : "chart"; renderExplain(); });
$("qol-btn").addEventListener("click", () => { state.panel = state.panel === "qol" ? "lesson" : "qol"; renderExplain(); });

// 早見表の中の操作
$("chart").addEventListener("change", (e) => {
  if (e.target.id === "chart-bass") { state.chartBass = e.target.checked; renderExplain(); }
});
$("chart").addEventListener("click", (e) => {
  const b = e.target.closest("[data-insert]");
  if (!b) return;
  insertProgression(Number(b.dataset.insert));
  b.textContent = "入れました！（Ctrl＋Z で戻せます）";
  setTimeout(() => { if (b.isConnected) b.textContent = "コードトラックに入れる"; }, 2500);
});

// 説明の中の ▶ ボタン（本文でも用語の一覧でも）
document.addEventListener("click", (e) => {
  const b = e.target.closest(".play-btn");
  if (b) playSpec(b.dataset.play);
  const s = e.target.closest(".sound-btn");
  if (s) toggleSound(s);
  // 「光らせる」ボタン：同じボタンをもう一度押すと消える。off なら消す
  const h = e.target.closest(".hl-btn");
  if (h) {
    const v = h.dataset.hl;
    setHighlight(v === "off" || v === state.highlight ? "" : v);
  }
});

// シークバー付きのプレーヤーを流したら、ボタンの音声は止める（2つ同時に鳴らないように）
document.addEventListener("play", (e) => {
  if (e.target.tagName !== "AUDIO") return;
  if (currentSound && currentSound.audio !== e.target) stopSound();
  document.querySelectorAll("audio").forEach((a) => { if (a !== e.target) a.pause(); });
}, true);

// 目次の中のクリック：そのステップ（と見出し）へ飛ぶ
$("toc").addEventListener("click", (e) => {
  const b = e.target.closest("[data-goto]");
  if (b) goToStep(Number(b.dataset.goto), b.dataset.anchor);
});

// クイズの選択肢・もう一度ボタン（本文は作り直されるので、外側の箱で受け取る）
function onQuizClick(e) {
  const b = e.target.closest("button[data-quiz]");
  if (!b) return;
  const key = ansKey(b.dataset.step, b.dataset.quiz);
  if (b.dataset.retry) delete state.answers[key];
  else state.answers[key] = Number(b.dataset.choice);
  renderExplain();
}
$("lesson").addEventListener("click", onQuizClick);

$("grid").addEventListener("change", (e) => {
  state.grid = Number(e.target.value);
  state.noteLength = state.grid;   // グリッドを変えたら、置く音の長さもそれに合わせる
  e.target.blur();                 // スペースキーが選択欄に取られないように
  render();
});
$("hl").addEventListener("change", (e) => { e.target.blur(); setHighlight(e.target.value); });
// キー・スケールを変えたら、ピアノロールの色・コードを光らせる・早見表・コードパッドを全部作り直す
function onKeyChange(e) {
  if (e.target.id === "key") state.key = Number(e.target.value);
  else state.scale = e.target.value;
  e.target.blur();
  render();
  if (state.panel === "chart") renderExplain();
}
$("key").addEventListener("change", onKeyChange);
$("scale").addEventListener("change", onKeyChange);
$("clear").addEventListener("click", () => {
  pushHistory();
  state.tracks[state.current].notes = [];
  state.selected.clear();
  render();
});

// 再生・停止
$("play").addEventListener("click", () => { if (!state.playing) startPlay(); });
$("stop").addEventListener("click", () => stopPlay());

// BPM：再生中に変えても、今の位置から続くように合わせ直す
$("bpm").addEventListener("change", (e) => {
  const bpm = Math.min(240, Math.max(40, Number(e.target.value) || 120));
  e.target.value = bpm;
  if (state.playing) {
    const pos = player.nextUnit;
    const nextTime = player.startTime + pos * unitSec();
    state.bpm = bpm;
    player.startTime = nextTime - pos * unitSec();
  } else {
    state.bpm = bpm;
  }
  if (audio) for (const t of state.tracks) { if (t.synth && synthChains.has(t)) chainFor(t).update(t.synth); updateBus(t); }   // ディレイの間隔・ウォブルの速さもテンポに合わせる
});

// トラック一覧：ボタンが毎回作り直されるので、外側の箱で1回だけ受け取る
$("tracks").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  const item = e.target.closest(".track");
  if (!btn || !item) return;
  const i = Number(item.dataset.index);
  const t = state.tracks[i];
  const action = btn.dataset.action;
  if (action === "remove") {
    // 1回目は「消す」に変わるだけ。もう一度押すと消える（3秒たつと元に戻る）
    if (state.confirmRemove === i) { removeTrack(i); return; }
    state.confirmRemove = i;
    clearTimeout(removeTimer);
    removeTimer = setTimeout(() => { state.confirmRemove = null; renderTracks(); }, 3000);
    renderTracks();
    return;
  }
  if (action === "synth") { state.fxEdit = null; state.synthOpen = state.synthOpen === i ? null : i; if (state.current !== i) selectTrack(i); else render(); return; }
  if (action === "select") {
    // 2回続けて押したら名前を変える（1回目で一覧が作り直されるので、dblclick ではなく回数で見る）
    if (e.detail === 2) {
      state.renaming = i;
      renderTracks();
      const input = $("tracks").querySelector(".rename");
      input.focus();
      input.select();
    } else {
      selectTrack(i);
    }
    return;
  }
  if (action === "mute") t.mute = !t.mute;
  if (action === "solo") t.solo = !t.solo;
  if (action === "duck") t.duck = !t.duck;
  if (action === "up") { moveTrack(i, -1); return; }
  if (action === "down") { moveTrack(i, 1); return; }
  if (action === "dup") { duplicateTrack(i); return; }
  if (action === "fx") { state.fxEdit = state.fxEdit === t.id ? null : t.id; state.synthOpen = null; state.padEdit = false; render(); return; }
  render();
});

let removeTimer = null;

// 名前の入力：Enter か、ほかの所を押したら決定。Esc でやめる
function finishRename(commit) {
  const input = $("tracks").querySelector(".rename");
  const t = state.tracks[state.renaming];
  if (commit && input && t && input.value.trim()) t.name = input.value.trim().slice(0, 12);
  state.renaming = null;
  render();
}
$("tracks").addEventListener("keydown", (e) => {
  if (!e.target.classList.contains("rename")) return;
  if (e.key === "Enter") finishRename(true);
  if (e.key === "Escape") finishRename(false);
});
$("tracks").addEventListener("focusout", (e) => { if (e.target.classList.contains("rename") && state.renaming !== null) finishRename(true); });

// 音量のつまみ：動かしている間は作り直さず、数字と音量だけ変える
$("tracks").addEventListener("input", (e) => {
  if (!e.target.classList.contains("vol-range")) return;
  const t = state.tracks[Number(e.target.closest(".track").dataset.index)];
  const prop = e.target.dataset.prop, v = Number(e.target.value);
  t[prop] = v;
  updateBus(t);
  e.target.nextElementSibling.textContent = prop === "pan" ? (v === 0 ? "C" : (v < 0 ? "L" : "R") + Math.abs(v)) : v;
});
// パンはダブルクリックで真ん中に戻す
$("tracks").addEventListener("dblclick", (e) => {
  if (e.target.dataset.prop !== "pan") return;
  const t = state.tracks[Number(e.target.closest(".track").dataset.index)];
  t.pan = 0;
  updateBus(t);
  renderTracks();
  commitSoon(0);
});

// 音色を変えたら、その音色で試しに鳴らす（メロディは1音、コードは和音）
$("tracks").addEventListener("change", (e) => {
  if (e.target.classList.contains("vol-range")) { e.target.blur(); return; }
  if (!e.target.classList.contains("inst")) return;
  const i = Number(e.target.closest(".track").dataset.index);
  const t = state.tracks[i];
  pushHistory();
  t.instrument = e.target.value;
  if (t.instrument === "synth") {   // シンセを選んだら、編集画面を開く
    if (!t.synth) t.synth = defaultSynth();
    state.synthOpen = i;
    if (state.current !== i) selectTrack(i);
  } else if (state.synthOpen === i) {
    state.synthOpen = null;
  }
  initAudio();
  audio.resume();
  const now = audio.currentTime + 0.02;
  const pitches = t.role === "melody" ? [72] : [60, 64, 67];
  for (const p of pitches) playTrackNote(t, p, 0, 100, now, 0.6);
  e.target.blur();   // スペースキーで再生できるように、選択欄から外す
  render();
});

$("add-inst").addEventListener("click", () => addTrack("inst"));
$("add-synth").addEventListener("click", () => addTrack("synth"));
$("add-drum").addEventListener("click", () => addTrack("drum"));
$("add-fx").addEventListener("click", () => addTrack("fx"));

// ---------- パッド ----------
// パッドを押す：鳴らして、そのパッドを選ぶ（ピアノロールの行も光る）
$("pads").addEventListener("click", (e) => {
  const track = state.tracks[state.current];
  const pad = e.target.closest(".pad");
  if (pad) {
    state.pad = Number(pad.dataset.pad);
    preview(state.pad);
    learnPad(track, state.pad);
    if (e.detail === 2 && isDrum(track)) { state.padEdit = true; state.synthOpen = null; state.fxEdit = null; }   // ダブルクリックで編集画面
    render();
    return;
  }
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.action === "edit") { state.padEdit = !state.padEdit; state.synthOpen = null; state.fxEdit = null; render(); }
  if (btn.dataset.action === "load") $("pad-file").click();
  if (btn.dataset.action === "reset") clearPad(track, state.pad);
  if (btn.dataset.action === "pattern") insertDrumPattern(lastPattern);
});
// サイドチェインの Learn 中に鳴らしたパッドのノートを、合図のノートに足す
function learnPad(track, i) {
  if (!scLearn || !isDrum(track)) return;
  const sc = sidechainOf(track), n = padParams(track, i).note;
  if (!sc.notes.includes(n)) sc.notes.push(n);
  scLearn = false;
  commitSoon(0);
}
// パッドの右クリック：Load／Preview／Clear のメニュー
$("pads").addEventListener("contextmenu", (e) => {
  const pad = e.target.closest(".pad");
  const track = state.tracks[state.current];
  if (!pad || !isDrum(track)) return;
  e.preventDefault();
  state.pad = Number(pad.dataset.pad);
  render();
  const menu = $("pad-menu");
  menu.hidden = false;
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";
});
$("pad-menu").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  $("pad-menu").hidden = true;
  if (!b) return;
  const track = state.tracks[state.current];
  if (b.dataset.menu === "load") $("pad-file").click();
  if (b.dataset.menu === "preview") preview(state.pad);
  if (b.dataset.menu === "clear") clearPad(track, state.pad);
  if (b.dataset.menu === "edit") { state.padEdit = true; render(); }
});
document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#pad-menu")) $("pad-menu").hidden = true; });
$("pads").addEventListener("change", (e) => {
  if (e.target.id === "pattern") { lastPattern = Number(e.target.value); e.target.blur(); }
});

// ---------- コードパッド ----------
// コードを鳴らす（編集中のトラックの音色で）
function playChord(c) {
  initAudio();
  audio.resume();
  const track = state.tracks[state.current];
  const now = audio.currentTime + 0.02;
  const pitches = state.chartBass ? [c.bass, ...c.notes] : c.notes;
  for (const p of pitches) playTrackNote(track, p, 0, 100, now, 0.8);
}

$("chordpads").addEventListener("click", (e) => {
  const track = chordPadTrack();
  if (!track) return;
  const pad = e.target.closest(".chord-pad");
  if (pad) {
    const deg = Number(pad.dataset.deg);
    playChord(chordInKey(deg, undefined, state.chord7));
    if (state.chordSeq.length < 8) state.chordSeq.push({ deg, seventh: state.chord7 });
    renderChordPads();
    return;
  }
  const chip = e.target.closest(".seq-chip");
  if (chip) { state.chordSeq.splice(Number(chip.dataset.seq), 1); renderChordPads(); return; }
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.action === "seq-insert") putChords(track, state.chordSeq.map((x) => chordInKey(x.deg, undefined, x.seventh)));
  if (btn.dataset.action === "seq-clear") { state.chordSeq = []; renderChordPads(); }
  if (btn.dataset.action === "rhythm") applyRhythm(track);
  if (btn.dataset.action === "bass") insertBass(track);
});
$("chordpads").addEventListener("change", (e) => {
  if (e.target.id === "chord7") state.chord7 = e.target.checked;
  if (e.target.id === "chord-bass") { state.chartBass = e.target.checked; if (state.panel === "chart") renderExplain(); }
  if (e.target.id === "rhythm") state.rhythm = Number(e.target.value);
  if (e.target.id === "bass-pattern") state.bassPattern = Number(e.target.value);
  e.target.blur();
  renderChordPads();
});

// ---------- 外の音をパッドに読み込む ----------
// 音声ファイルを AudioBuffer にして、選んだパッドに入れる
// quiet：◀ ▶ で切り替えたとき（エラーを出さない）
async function loadPadFile(file, pad, quiet) {
  const track = state.tracks[state.current];
  if (!isDrum(track) || !file) return false;
  initAudio();
  try {
    const bytes = await file.arrayBuffer();
    const sid = await addSample(toBase64(bytes));
    commitHistory();   // 読み込む前の状態を区切っておく
    if (!track.custom) track.custom = {};
    const name = file.name.replace(/\.[^.]+$/, "");
    track.custom[pad] = { sid, name: name.slice(0, 20) };
    analyzePad(track, pad, name);   // スライスを自動で切る・BPM を見つける
    commitHistory();
    state.pad = pad;
    preview(pad);
    render();
    return true;
  } catch (err) {
    if (!quiet) alert("「" + file.name + "」は読み込めませんでした。wav・mp3・ogg・flac などの音声ファイルを選んでください。");
    return false;
  }
}
// 何個かまとめて：選んだパッドから順番に入れる。◀ ▶ 用に、名前順の一覧も覚えておく
async function loadPadFiles(fileList, first) {
  const track = state.tracks[state.current];
  const files = [...fileList].filter((f) => f.type.startsWith("audio/") || /\.(wav|aiff?|flac|ogg|mp3|m4a)$/i.test(f.name));
  if (!files.length) return;
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true }));
  for (let k = 0; k < files.length && first + k < DRUM_PADS.length; k++) {
    if (await loadPadFile(files[k], first + k)) padFileSets[track.id + ":" + (first + k)] = { files: sorted, index: sorted.indexOf(files[k]) };
  }
  state.pad = first;
  render();
}

// パッドの上に音声ファイルをドラッグ＆ドロップしても読み込める
$("pads").addEventListener("dragover", (e) => {
  const pad = e.target.closest(".pad");
  if (!pad) return;
  e.preventDefault();
  document.querySelectorAll(".pad.drop").forEach((x) => x.classList.remove("drop"));
  pad.classList.add("drop");
});
$("pads").addEventListener("dragleave", (e) => { const pad = e.target.closest(".pad"); if (pad) pad.classList.remove("drop"); });
$("pads").addEventListener("drop", (e) => {
  const pad = e.target.closest(".pad");
  if (!pad) return;
  e.preventDefault();
  pad.classList.remove("drop");
  loadPadFiles(e.dataTransfer.files, Number(pad.dataset.pad));
});

// 自分の音（wav・mp3 など）を、選んだパッドに読み込む
$("pad-file").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";   // 同じファイルをもう一度選んでも読み込めるように
  loadPadFiles(files, state.pad);
});

// キーボード操作
window.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT"].includes(e.target.tagName)) return;   // 入力中は無視
  const ctrl = e.ctrlKey || e.metaKey;   // Mac の Command キーも同じ扱い
  const k = e.key.toLowerCase();

  if (e.code === "Space") {
    state.playing ? stopPlay() : startPlay();
  } else if (ctrl && k === "c") {
    copySelected();
  } else if (ctrl && k === "x") {
    copySelected();
    deleteSelected();
  } else if (ctrl && k === "v") {
    paste();
  } else if (ctrl && k === "a") {
    state.selected = new Set(currentNotes());
  } else if (ctrl && k === "z" && !e.shiftKey) {
    undo();
  } else if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) {
    redo();
  } else if (k === "delete" || k === "backspace") {
    deleteSelected();
  } else if (k === "escape") {
    state.selected.clear();
  } else {
    return;   // 関係ないキーはブラウザに任せる
  }
  e.preventDefault();   // ブラウザ自体のコピー・全選択・スクロールなどを止める
  render();
});


$("book-compose").addEventListener("click", () => switchBook("compose"));
$("book-arrange").addEventListener("click", () => switchBook("arrange"));

// ---------- ループ・メトロノーム ----------
function setLoop(a, b) {
  a = Math.max(0, Math.min(7, a));
  b = Math.max(a + 1, Math.min(8, b));
  state.loop = [a, b];
  renderLoopSelects();
  drawRoll();
}
function renderLoopSelects() {
  const opts = (from, to, sel) => { let h = ""; for (let k = from; k <= to; k++) h += '<option value="' + k + '"' + (k === sel ? " selected" : "") + ">" + k + "</option>"; return h; };
  $("loop-from").innerHTML = opts(1, 8, state.loop[0] + 1);
  $("loop-to").innerHTML = opts(1, 8, state.loop[1]);
}
$("loop-from").addEventListener("change", (e) => { const a = Number(e.target.value) - 1; setLoop(a, Math.max(state.loop[1], a + 1)); e.target.blur(); });
$("loop-to").addEventListener("change", (e) => { const b = Number(e.target.value); setLoop(Math.min(state.loop[0], b - 1), b); e.target.blur(); });
$("metronome").addEventListener("click", (e) => {
  state.metronome = !state.metronome;
  e.target.classList.toggle("active", state.metronome);
  e.target.setAttribute("aria-pressed", state.metronome);
  e.target.blur();
});
