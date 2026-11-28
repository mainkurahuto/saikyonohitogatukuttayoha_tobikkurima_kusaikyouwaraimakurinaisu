// ================================================
// パソコンのキーボード・MIDI キーボードで弾く
// 編集中のトラックの音色で鳴る（ピアノロールには入らない。試し弾き用）
// ================================================
// A S D F G H J K L ; が白い鍵盤、W E T Y U O P が黒い鍵盤（ピアノと同じ並び）
const KEY_TO_STEP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16 };
let keyOctave = 4;              // A のキーが C4（Z で1オクターブ下、X で1オクターブ上）
const held = new Map();         // 押している鍵盤 → 鳴らしている音

// 押した：伸ばしっぱなしで鳴らし始める
function liveOn(id, pitch, velocity, padIndex) {
  if (held.has(id)) return;
  initAudio();
  audio.resume();
  const track = state.tracks[state.current];
  const now = audio.currentTime + 0.005;
  if (isDrum(track)) { if (padIndex < DRUM_PADS.length) playDrum(track, padIndex, velocity, now); return; }
  if (isFx(track)) { if (padIndex < FX_LIST.length) playFx(track, padIndex, velocity, now, BAR * unitSec()); return; }
  if (pitch < 0 || pitch > 127) return;
  const before = player.voices.length;
  playTrackNote(track, pitch, 0, velocity, now, 30);   // 30秒ぶん予約して、離したら止める
  held.set(id, { voices: player.voices.slice(before), track });
  showLiveKey(pitch, true);
}

// 離した：その音色の余韻（リリース）で消す
function liveOff(id, pitch) {
  const h = held.get(id);
  if (!h) return;
  held.delete(id);
  showLiveKey(pitch, false);
  const t = h.track;
  const rel = t.instrument === "synth" && t.synth ? Math.max(0.01, t.synth.env.r / 1000) : (INSTRUMENTS[t.instrument] || INSTRUMENTS.piano).release;
  const now = audio.currentTime;
  for (const v of h.voices) {
    const g = v.g.gain;
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
    else { g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); }
    g.setTargetAtTime(0, now, rel / 3);
    for (const o of v.oscs) { try { o.stop(now + rel * 3 + 0.1); } catch (err) { /* もう止まっている */ } }
    v.end = now + rel * 3 + 0.1;
  }
}

// 弾いている音を、ピアノロールの鍵盤で光らせる（liveKeys は data.js）
function showLiveKey(pitch, on) {
  on ? liveKeys.add(pitch) : liveKeys.delete(pitch);
  drawRoll();
}

window.addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "z" || k === "x") {
    keyOctave = Math.max(1, Math.min(7, keyOctave + (k === "z" ? -1 : 1)));
    flashOctave();
    e.preventDefault();
    return;
  }
  if (!(k in KEY_TO_STEP)) return;
  e.preventDefault();
  if (e.repeat) return;
  const step = KEY_TO_STEP[k];
  liveOn("k" + e.code, (keyOctave + 1) * 12 + step, 100, step);
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (!(k in KEY_TO_STEP)) return;
  liveOff("k" + e.code, (keyOctave + 1) * 12 + KEY_TO_STEP[k]);
});
// ほかのウィンドウに移ったら、鳴りっぱなしにならないように全部離す
window.addEventListener("blur", () => { for (const id of [...held.keys()]) liveOff(id); liveKeys.clear(); drawRoll(); });

// オクターブを変えたら、下の説明に少しだけ出す
let octaveTimer = null;
function flashOctave() {
  const hint = document.querySelector(".hint");
  if (!hint.dataset.text) hint.dataset.text = hint.textContent;
  hint.textContent = "キーボードの A = C" + keyOctave + "（Z：1オクターブ下　X：1オクターブ上）";
  clearTimeout(octaveTimer);
  octaveTimer = setTimeout(() => { hint.textContent = hint.dataset.text; }, 1500);
}

// ---------- MIDI キーボード（Web MIDI） ----------
let midiAccess = null;
function onMidiMessage(e) {
  const [st, note, vel] = e.data;
  const type = st & 0xf0;
  // ドラム・FX のトラックでは、GM のドラムの番号をパッドに合わせる（なければ C2 から順番）
  const pad = GM_DRUMS.indexOf(note) >= 0 ? GM_DRUMS.indexOf(note) : ((note - 36) % 16 + 16) % 16;
  if (type === 0x90 && vel > 0) liveOn("m" + note, note, vel, pad);
  else if (type === 0x80 || (type === 0x90 && vel === 0)) liveOff("m" + note, note);
}
function connectMidiInputs() {
  let n = 0;
  midiAccess.inputs.forEach((input) => { input.onmidimessage = onMidiMessage; n++; });
  const b = $("midi-in");
  b.textContent = n ? "MIDI 鍵盤：" + n + "台" : "MIDI 鍵盤：なし";
  b.classList.toggle("active", n > 0);
}
$("midi-in").addEventListener("click", async (e) => {
  e.target.blur();
  if (!navigator.requestMIDIAccess) { alert("このブラウザは MIDI キーボードに対応していません。Chrome か Edge で開いてください。"); return; }
  try {
    midiAccess = midiAccess || await navigator.requestMIDIAccess();
    midiAccess.onstatechange = connectMidiInputs;   // あとから差しても使える
    connectMidiInputs();
  } catch (err) {
    alert("MIDI キーボードを使う許可がもらえませんでした。");
  }
});
