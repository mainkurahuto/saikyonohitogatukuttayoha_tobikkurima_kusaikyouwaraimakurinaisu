// ================================================
// 1. データ（画面に出るものは全部ここから作る）
// ================================================
const state = {
  mode: "split",   // "split"（分割）か "tab"（タブ）
  tab: "daw",      // タブ表示のとき見せる方："explain" か "daw"
  step: 0,         // 今のステップ番号
  panel: "lesson", // 説明パネルに出すもの："lesson"（本文）／"toc"（目次）／"glossary"（用語）／"chart"（早見表）／"qol"（便利な機能）
  chartBass: true, // 早見表で、ベース音も一緒に鳴らす・入れるか
  highlight: "",   // ピアノロールで光らせるコード（"" なし／"track" コードトラックに合わせる／"C" などのコード名）
  answers: {},     // クイズの答え："ステップ番号-クイズ番号" → 選んだ選択肢の番号
  orderPick: {},   // 順番の選択：何個目の :::order か → 何番目の選択肢を選んだか（なければ最初）
  grid: 3,         // 1マスの長さ（48分単位。16分 = 3）
  noteLength: 3,   // 新しく置く音の長さ（最後に変えた長さを覚えておく）
  scale: "C",
  bpm: 120,
  playing: false,
  current: 0,      // 今編集しているトラックの番号
  tracks: [
    // notes の中身：{ pitch, start, length, velocity }
    // instrument：音色（INSTRUMENTS のキー）
    { name: "メロディ", color: "#f2a541", mute: false, solo: false, instrument: "piano", notes: [] },
    { name: "コード",   color: "#7aa7e8", mute: false, solo: false, instrument: "piano", notes: [] }
  ],
  selected: new Set()   // 選択中の音（編集中のトラックの音そのもの）
};

let clipboard = { notes: [], length: 0 };   // コピーした音（位置は先頭からの距離で持つ）
const history = { undo: [], redo: [] };     // 元に戻す・やり直し用の記録

// ピアノロールの「どこを見ているか」
const view = {
  x: 0,      // 左端の時間（48分単位）
  y: 0,      // 上からのスクロール量（px）
  unitW: 0   // 48分1つぶんの幅（px）。大きいほどアップ。0 = まだ決めていない
};


// スケールに入っている音（0 = ド, 1 = ド♯ … 11 = シ）
const SCALES = { C: [0, 2, 4, 5, 7, 9, 11], G: [7, 9, 11, 0, 2, 4, 6] };
const BLACK = [1, 3, 6, 8, 10];
const NAMES = ["ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "ラ♯", "シ"];

const TOP = 96, BOTTOM = 36;   // 音域（MIDI番号）：C7 〜 C2
const ROW_H = 20;              // 1行の高さ(px)
const KEY_W = 64;              // 左の鍵盤の幅(px)
const RULER_H = 24;            // 上の小節番号の高さ(px)
const BAR = 48;                // 1小節 = 48
const TOTAL = BAR * 8;         // 8小節 = 384
const MAX_UNIT_W = 16;         // 一番アップしたときの幅

// ================================================
// 2. 画面の部品を取ってくる
// ================================================
const $ = (id) => document.getElementById(id);
const canvas = $("roll");
const ctx = canvas.getContext("2d");
let W = 0, H = 0;   // canvas の見た目の大きさ（CSSのpx）

// ================================================
// 3. 音を鳴らす（Web Audio API）
// ================================================
let audio = null;    // AudioContext。ブラウザの決まりで、最初のクリックの後に作る
let master = null;   // 全体の音量
const player = {
  startTime: 0,  // 1小節目の頭が鳴る時刻（audio.currentTime 基準の秒）
  nextUnit: 0,   // 次に予約する位置（48分単位）
  timer: null,
  pos: 0,        // 今の再生位置（線を描く用）
  voices: []     // 鳴っている音（停止のときに消すため）
};

function initAudio() {
  if (audio) return;
  audio = new AudioContext();
  master = audio.createGain();
  master.gain.value = 0.35;
  master.connect(audio.destination);
}

const unitSec = () => 60 / state.bpm / 12;          // 48分1つぶんの秒数（1拍 = 12）
const midiToFreq = (p) => 440 * Math.pow(2, (p - 69) / 12);

// ミュート・ソロを見て、このトラックが鳴るかどうか
function isAudible(track) {
  const anySolo = state.tracks.some((t) => t.solo);
  return anySolo ? track.solo : !track.mute;
}

// ---------- 音色（シンセサイザーのしくみで作っている） ----------
// oscs：鳴らす波 [波の形, 何倍の高さか, 大きさ, ずらす量(セント)]
// attack：鳴り始めの速さ　decay：弱くなる速さ　sustain：伸ばしている間の大きさ（0〜1）　release：離したあとの余韻（秒）
// filter：高い音を削る（数字ならその周波数で固定、{from, to, time} なら鳴り始めから時間をかけて削る）
// gain：音色ごとの音量の差をそろえる
const INSTRUMENTS = {
  piano:   { name: "ピアノ",       oscs: [["triangle", 1, 1], ["sine", 2, 0.3]], attack: 0.005, decay: 0.4, sustain: 0.3, release: 0.06, gain: 1 },
  organ:   { name: "オルガン",     oscs: [["sine", 1, 1], ["sine", 2, 0.5], ["sine", 3, 0.25]], attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.05, gain: 0.4 },
  strings: { name: "ストリングス", oscs: [["sawtooth", 1, 0.5, -7], ["sawtooth", 1, 0.5, 7]], attack: 0.15, decay: 0.3, sustain: 0.8, release: 0.35, filter: 1800, gain: 0.9 },
  lead:    { name: "シンセリード", oscs: [["sawtooth", 1, 0.6], ["square", 1, 0.3, 8]], attack: 0.01, decay: 0.15, sustain: 0.75, release: 0.08, filter: 3500, gain: 0.75 },
  pluck:   { name: "プラック",     oscs: [["sawtooth", 1, 0.8]], attack: 0.003, decay: 0.25, sustain: 0.05, release: 0.1, filter: { from: 5000, to: 500, time: 0.25 }, gain: 1.8 },
  bell:    { name: "ベル",         oscs: [["sine", 1, 1], ["sine", 2.76, 0.4], ["sine", 5.4, 0.15]], attack: 0.003, decay: 1.2, sustain: 0, release: 0.6, gain: 0.63 },
  chip:    { name: "8bit",         oscs: [["square", 1, 0.5]], attack: 0.002, decay: 0.02, sustain: 0.9, release: 0.03, gain: 0.46 }
};

// 「ベル」「bell」どちらの書き方でも音色を探せるようにする
function findInstrument(name) {
  if (INSTRUMENTS[name]) return name;
  return Object.keys(INSTRUMENTS).find((k) => INSTRUMENTS[k].name.toLowerCase() === String(name).toLowerCase()) || "piano";
}

// 1音を time 秒に予約する
// durSec を渡すと、BPMに関係なくその秒数だけ鳴らす（説明の中の ▶ ボタン用）
// inst：音色の名前（INSTRUMENTS のキー）。書かなければピアノ
function playNote(pitch, lengthUnits, velocity, time, durSec, inst) {
  const ins = INSTRUMENTS[inst] || INSTRUMENTS.piano;
  const dur = Math.max(ins.attack + 0.01, durSec !== undefined ? durSec : lengthUnits * unitSec());
  const peak = 0.5 * (velocity / 127) * ins.gain;

  // 音量の変化（エンベロープ）
  const g = audio.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + ins.attack);                           // 立ち上がり
  g.gain.setTargetAtTime(peak * ins.sustain, time + ins.attack, ins.decay / 3);      // だんだん弱く
  g.gain.setTargetAtTime(0, time + dur, ins.release / 3);                            // 離したら消える
  g.connect(master);

  // 高い音を削るフィルター
  let input = g;
  if (ins.filter) {
    const flt = audio.createBiquadFilter();
    flt.type = "lowpass";
    if (typeof ins.filter === "number") {
      flt.frequency.value = ins.filter;
    } else {
      flt.frequency.setValueAtTime(ins.filter.from, time);
      flt.frequency.exponentialRampToValueAtTime(ins.filter.to, time + ins.filter.time);
    }
    flt.connect(g);
    input = flt;
  }

  // 音のもとになる波（オシレーター）
  const f = midiToFreq(pitch);
  const end = time + dur + ins.release * 3 + 0.1;
  const oscs = ins.oscs.map(([type, mult, amp, cents]) => {
    const o = audio.createOscillator();
    o.type = type;
    o.frequency.value = f * mult;
    if (cents) o.detune.value = cents;
    const og = audio.createGain();
    og.gain.value = amp;
    o.connect(og).connect(input);
    o.start(time);
    o.stop(end);
    return o;
  });
  player.voices.push({ g, oscs, end });
}

// 音を置いたり動かしたりしたとき、その高さを、編集中のトラックの音色で短く鳴らして確かめる
function preview(pitch) {
  initAudio();
  audio.resume();
  playNote(pitch, 6, 100, audio.currentTime, undefined, state.tracks[state.current].instrument);
}

// 少し先（0.1秒ぶん）までの音を予約しておく。25ミリ秒ごとに呼ばれる
function schedule() {
  const until = audio.currentTime + 0.1;
  while (true) {
    if (player.nextUnit >= TOTAL) {          // 8小節の最後まで来たら頭に戻る（ループ）
      player.startTime += TOTAL * unitSec();
      player.nextUnit = 0;
    }
    const t = player.startTime + player.nextUnit * unitSec();
    if (t > until) break;
    for (const track of state.tracks) {
      if (!isAudible(track)) continue;
      for (const n of track.notes) {
        if (n.start === player.nextUnit) playNote(n.pitch, n.length, n.velocity, t, undefined, track.instrument);
      }
    }
    player.nextUnit++;
  }
  player.voices = player.voices.filter((v) => v.end > audio.currentTime);   // 鳴り終わった音を片付ける
}

function startPlay() {
  initAudio();
  audio.resume();
  player.startTime = audio.currentTime + 0.05;
  player.nextUnit = 0;
  state.playing = true;
  schedule();
  player.timer = setInterval(schedule, 25);
  requestAnimationFrame(tick);
  render();
}

function stopPlay() {
  clearInterval(player.timer);
  state.playing = false;
  player.pos = 0;
  if (audio) {
    for (const v of player.voices) {         // 鳴っている音・予約済みの音をすぐ消す
      v.g.gain.cancelScheduledValues(audio.currentTime);
      v.g.gain.setTargetAtTime(0, audio.currentTime, 0.02);
      v.oscs.forEach((o) => o.stop(audio.currentTime + 0.1));
    }
  }
  player.voices = [];
  render();
}

// 再生中、毎フレーム再生位置の線を動かす
function tick() {
  if (!state.playing) return;
  let pos = (audio.currentTime - player.startTime) / unitSec();
  if (pos < 0) pos += TOTAL;                 // ループで頭に戻った直後
  player.pos = Math.max(0, pos);
  // 線が画面の右に出たら追いかける（ドラッグ中は勝手に動かさない）
  const visible = (W - KEY_W) / view.unitW;
  if (!drag && (player.pos > view.x + visible || player.pos < view.x)) view.x = player.pos;
  clampView();
  drawRoll();
  requestAnimationFrame(tick);
}

// ================================================
// 4. 編集の道具（選択・コピペ・元に戻す）
// ================================================
const currentNotes = () => state.tracks[state.current].notes;

// 今の音を全部文字にして記録（元に戻す用）
const snapshot = () => JSON.stringify(state.tracks.map((t) => t.notes));

function pushHistory() {
  history.undo.push(snapshot());
  if (history.undo.length > 100) history.undo.shift();
  history.redo = [];
}

function restore(text) {
  JSON.parse(text).forEach((notes, i) => { state.tracks[i].notes = notes; });
  state.selected.clear();   // 中身が作り直されるので選択は外す
}

function undo() {
  if (history.undo.length === 0) return;
  history.redo.push(snapshot());
  restore(history.undo.pop());
}

function redo() {
  if (history.redo.length === 0) return;
  history.undo.push(snapshot());
  restore(history.redo.pop());
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
  for (const c of clipboard.notes) {
    const start = at + c.start;
    if (start >= TOTAL) continue;   // 8小節からはみ出す音は捨てる
    const n = { pitch: c.pitch, start: start, length: Math.min(c.length, TOTAL - start), velocity: c.velocity };
    currentNotes().push(n);
    state.selected.add(n);           // 貼り付けた音を選択しておく（そのまま動かせる）
  }
  clipboard.from = at;               // もう一度貼ると、さらに後ろに続く
}

// ================================================
// 説明（lessons.js の文章 → HTML、目次、クイズ）
// ================================================
const BOX_LABELS = { try: "やってみよう", tip: "コツ", note: "メモ" };
const ORDER_BLOCKS = [];   // :::order（順番を選ぶ）を読み込んだもの

// Unity と同じ書き方のタグ（<size=20> <color=red> <mark=yellow> <play=...>）を HTML に置き換える
// <b> <i> <u> <s> はもともと HTML にあるので、そのまま使える
// 行の先頭がこれなら「HTMLの行」ではなく普通の文として扱う
const RICH_TAG = /^[<＜]\s*\/?\s*(size|color|mark|play|sound|hl|strikethrough|underline|b|i|u|s)\b/i;

// Unity の別名 → HTML のタグ
const TAG_ALIAS = { strikethrough: "s", underline: "u" };

// 書き方のゆれをそろえる：全角の ＜ ＞ ＝ や数字、スペース、引用符があっても同じ意味にする
// 例：<size＝１０>  < size = 10 >  <size="10">  →  <size=10>　　＜s＞ < s >  →  <s>
function normalizeTags(text) {
  return text.replace(
    /[<＜]\s*(\/?)\s*(size|color|mark|play|sound|hl|strikethrough|underline|b|i|u|s)\s*(?:[=＝]\s*([^>＞]*?))?\s*[>＞]/gi,
    (_, slash, name, val) => {
      name = name.toLowerCase();
      name = TAG_ALIAS[name] || name;
      let v = "";
      if (val) {
        // ファイル名は全角のままにする（「曲１.mp3」のようなファイル名が変わってしまわないように）
        const n = name === "sound" ? val : val.normalize("NFKC");
        v = "=" + n.replace(/["'“”]/g, "").trim();
      }
      return "<" + slash + name + v + ">";
    }
  );
}

function richTags(text) {
  return normalizeTags(text)
    // \n で改行。日本語キーボードの ¥n や、全角の ＼ｎ ￥ｎ、本物の改行（glossary.js の "..." の中）も改行にする
    .replace(/[\\＼¥￥][nｎ]|\n/g, "<br>")
    // <sound=sounds/曲.mp3>ラベル</sound> → mp3 などの音声ファイルを流すボタン
    // <sound=sounds/曲.mp3 controls>ラベル</sound> → シークバー付きのプレーヤー
    .replace(/<sound=([^>]+)>(.*?)<\/sound>/gi, (_, v, label) => soundHtml(v, label))
    // <hl=C>Cを光らせる</hl> → 作曲画面でそのコードの音の行を光らせるボタン（track で小節ごと、off で消す）
    .replace(/<hl=([^>]+)>(.*?)<\/hl>/gi, (_, v, label) =>
      '<button class="hl-btn" data-hl="' + v.trim() + '"><span class="hl-dot"></span>' + (label || v) + "</button>")
    // <play=C4 E4 G4>ラベル</play> → 押すと鳴るボタン
    .replace(/<play=([^>]+)>(.*?)<\/play>/gi, (_, v, label) =>
      '<button class="play-btn" data-play="' + v + '">▶ ' + (label || "聴く") + "</button>")
    .replace(/<size=([^>]+)>/gi, (_, v) => {
      if (/^[\d.]+$/.test(v)) v += "px";                  // 数字だけなら px
      return '<span style="font-size:' + v + '; line-height:1.4">';
    })
    .replace(/<\/size>/gi, "</span>")
    .replace(/<color=([^>]+)>/gi, (_, v) => '<span style="color:' + v + '">')
    .replace(/<\/color>/gi, "</span>")
    .replace(/<mark=([^>]+)>/gi, (_, v) => '<mark style="background:' + v + '">');
}

// ---------- 説明の中の mp3 ボタン（<sound=...>）----------
// 値の中の controls（シークバーを出す）・loop（繰り返す）を取り出し、残りをファイルの場所にする
function soundHtml(value, label) {
  const parts = value.split(/\s+/);
  const opts = parts.filter((p) => /^(controls|loop)$/i.test(p)).map((p) => p.toLowerCase());
  const src = parts.filter((p) => !/^(controls|loop)$/i.test(p)).join(" ");
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  label = label || src.split("/").pop();   // ラベルがなければファイル名
  if (opts.includes("controls")) {
    return '<span class="sound-box"><span class="sound-label">' + label + "</span>" +
           '<audio controls preload="metadata"' + (opts.includes("loop") ? " loop" : "") + ' src="' + esc(src) + '"></audio></span>';
  }
  return '<button class="sound-btn" data-src="' + esc(src) + '"' + (opts.includes("loop") ? ' data-loop="1"' : "") +
         '><span class="sound-icon">▶</span> ' + label + "</button>";
}

let currentSound = null;   // 今流れている音声 { audio, src }

function soundButtons(src) {
  return [...document.querySelectorAll(".sound-btn")].filter((b) => b.dataset.src === src);
}

// ボタンの見た目を、今の再生状態に合わせる（説明を作り直したあとにも呼ぶ）
function syncSoundButtons() {
  document.querySelectorAll(".sound-btn").forEach((b) => {
    const on = currentSound && currentSound.src === b.dataset.src;
    b.classList.toggle("playing", !!on);
    b.querySelector(".sound-icon").textContent = on ? "■" : "▶";
    if (!on) b.style.removeProperty("--p");
  });
}

function stopSound() {
  if (!currentSound) return;
  currentSound.audio.pause();
  currentSound = null;
  syncSoundButtons();
}

function toggleSound(btn) {
  const src = btn.dataset.src;
  if (currentSound && currentSound.src === src) { stopSound(); return; }   // 流れている音をもう一度押したら止める
  stopSound();                                                              // ほかの音は止めてから流す
  document.querySelectorAll("audio").forEach((a) => a.pause());             // シークバー付きのプレーヤーも止める

  const audio = new Audio(src);
  audio.loop = !!btn.dataset.loop;
  currentSound = { audio, src };
  audio.addEventListener("ended", stopSound);
  audio.addEventListener("timeupdate", () => {   // ボタンの背景で、どこまで流れたかを見せる
    if (!audio.duration) return;
    const p = (audio.currentTime / audio.duration * 100).toFixed(1) + "%";
    soundButtons(src).forEach((b) => b.style.setProperty("--p", p));
  });
  audio.addEventListener("error", () => {         // ファイルが見つからないとき
    stopSound();
    soundButtons(src).forEach((b) => {
      b.classList.add("error");
      b.querySelector(".sound-icon").textContent = "⚠";
      b.title = "読み込めませんでした：" + src;
    });
    console.warn("音声ファイルを読み込めませんでした：" + src);
  });
  audio.play().catch(() => {});
  syncSoundButtons();
}

// ---------- 説明の中の ▶ ボタン（<play=...>）----------
// 書き方：音をスペースで区切ると順番に、＋でつなぐと同時に鳴る
//   C4 E4 G4      ド・ミ・ソを順番に（オクターブを省くと4）
//   C4+E4+G4      ド・ミ・ソを同時に
//   ド ミ ソ       カタカナでもOK。♯ や # や b も使える（F#4、シb など）
//   [C] [Am] [G7] コードネームで和音（m、7、maj7、m7、dim、sus4、aug、13）
//   :2            長さ（拍）。例 C4:2、[C]:4
//   -             休み。-:2 で2拍休み
//   bpm=90        速さ（書かなければ 100）
const SOLFEGE = { "ド": "C", "レ": "D", "ミ": "E", "ファ": "F", "ソ": "G", "ラ": "A", "シ": "B" };
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// ルート音から何半音上の音を重ねるか
const CHORD_TYPES = {
  "": [0, 4, 7], m: [0, 3, 7], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  dim: [0, 3, 6], sus4: [0, 5, 7], aug: [0, 4, 8],
  "13": [0, 4, 10, 14, 21]   // 13：ルート・3度・7度・9度・13度（5度と11度は抜く。11度は3度とぶつかるので、抜くのが普通）
};

// 「ファ#」「C4」「Bb3」などを MIDI番号にする（読めなければ null）
function parseRoot(s) {
  const m = s.match(/^(ファ|ド|レ|ミ|ソ|ラ|シ|[A-Ga-g])([#♯b♭]?)(.*)$/);
  if (!m) return null;
  const pc = PC[(SOLFEGE[m[1]] || m[1]).toUpperCase()];
  const acc = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0;
  return { pc: pc + acc, rest: m[3] };
}

function noteToMidi(s) {
  const r = parseRoot(s);
  if (!r || !/^-?\d?$/.test(r.rest)) return null;
  const oct = r.rest === "" ? 4 : Number(r.rest);
  return (oct + 1) * 12 + r.pc;
}

// [Am] などのコードネーム → 構成音の MIDI番号の並び
function chordToMidis(name) {
  const r = parseRoot(name);
  if (!r || !(r.rest in CHORD_TYPES)) return null;
  const root = ((r.pc % 12) + 12) % 12;
  const base = (root >= 7 ? 3 + 1 : 4 + 1) * 12 + root;   // ソより上の音は1つ下のオクターブにして、高くなりすぎないように
  return CHORD_TYPES[r.rest].map((i) => base + i);
}

function playSpec(spec) {
  initAudio();
  audio.resume();
  let bpm = 100;
  const tokens = spec.split(/\s+/).filter((x) => x);
  const bpmTok = tokens.find((x) => /^bpm=\d+$/i.test(x));
  if (bpmTok) bpm = Number(bpmTok.split("=")[1]);
  const beat = 60 / bpm;
  // 音色=ベル や inst=bell で音色を選べる（書かなければピアノ）
  const instTok = tokens.find((x) => /^(inst|音色)=/i.test(x));
  const inst = instTok ? findInstrument(instTok.split("=")[1]) : "piano";

  let t = audio.currentTime + 0.05;
  for (const tok of tokens) {
    if (/^(bpm|inst|音色)=/i.test(tok)) continue;
    const [body, len] = tok.split(":");
    const beats = len ? Number(len) || 1 : 1;
    if (body !== "-") {
      for (const part of body.split("+")) {
        const chord = part.match(/^\[(.+)\]$/);
        const midis = chord ? chordToMidis(chord[1]) : [noteToMidi(part)];
        if (!midis || midis.includes(null)) { console.warn("読めない音：" + part); continue; }
        for (const p of midis) playNote(p, 0, 100, t, beats * beat * 0.95, inst);
      }
    }
    t += beats * beat;
  }
}

// 1行の中の飾り：Unity風タグ・画像・リンク・太字
function inline(text) {
  return richTags(text)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>");   // ~~取り消し線~~
}

// 1ステップ分の文章を読む。「# タイトル」を取り出し、残りを HTML にする
function parseLesson(src, stepIndex) {
  const lines = src.replace(/\r/g, "").split("\n");
  let title = "（タイトルなし）";
  const t = lines.findIndex((l) => l.startsWith("# "));
  if (t >= 0) {
    title = lines[t].slice(2).trim();
    lines.splice(t, 1);
  }
  const step = { title: title, headings: [], quizzes: [], html: "" };
  step.html = parseBlocks(lines, step, stepIndex);
  return step;
}

// 行を上から順に見て HTML を組み立てる
// only：:::only の中を読んでいるときの、そのラベル（「メロ先」など）
function parseBlocks(lines, step, stepIndex, only) {
  let html = "";
  let para = [];      // 書きかけの段落
  let list = null;    // 書きかけの箇条書き { tag: "ul" か "ol", items: [] }
  let quote = [];     // 書きかけの引用

  // 書きかけのものを HTML にして閉じる
  const flush = () => {
    if (para.length) html += "<p>" + para.map(inline).join("<br>") + "</p>";
    if (list) html += "<" + list.tag + ">" + list.items.map((x) => "<li>" + inline(x) + "</li>").join("") + "</" + list.tag + ">";
    if (quote.length) html += "<blockquote>" + quote.map(inline).join("<br>") + "</blockquote>";
    para = []; list = null; quote = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    let m;

    if (t.startsWith(":::")) {
      // ::: から ::: までをまとめて取り出す
      flush();
      const kind = t.slice(3).trim();
      const inner = [];
      let depth = 0;   // 中に入れ子の ::: があっても、対応する ::: まで読む
      i++;
      while (i < lines.length) {
        const s = lines[i].trim();
        if (s === ":::") { if (depth === 0) break; depth--; }
        else if (s.startsWith(":::")) depth++;
        inner.push(lines[i]);
        i++;
      }
      // 「:::note ここに文」のように、同じ行に書いた文は中身の1行目として扱う
      const boxName = kind.split(/\s+/)[0];
      const sameLine = kind.slice(boxName.length).trim();
      if (boxName === "quiz") {
        const q = parseQuiz(sameLine ? [sameLine, ...inner] : inner);
        q.only = only;
        step.quizzes.push(q);
        html += '<div class="quiz" data-quiz="' + (step.quizzes.length - 1) + '"></div>';   // 中身は表示のときに入れる
      } else if (kind.startsWith("order")) {
        // :::order 質問文　→ 順番を選ぶボタン
        ORDER_BLOCKS.push(parseOrder(kind.slice(5).trim(), inner));
        html += '<div class="order-choice" data-order="' + (ORDER_BLOCKS.length - 1) + '"></div>';   // 中身は表示のときに入れる
      } else if (kind.startsWith("only")) {
        // :::only ラベル　→ その順番を選んだときだけ見える
        const label = kind.slice(4).trim();
        html += '<div class="only" data-only="' + label + '">' + parseBlocks(inner, step, stepIndex, label) + "</div>";
      } else {
        const body = sameLine ? [sameLine, ...inner] : inner;
        html += '<div class="box box-' + boxName + '"><p class="box-label">' + (BOX_LABELS[boxName] || boxName) + "</p>" +
                parseBlocks(body, step, stepIndex, only) + "</div>";
      }
    } else if (t === "") {
      flush();
    } else if ((m = t.match(/^(#{2,3}) (.+)$/))) {
      flush();
      if (m[1].length === 2) {
        const id = "s" + stepIndex + "-" + step.headings.length;   // 目次から飛ぶための目印
        step.headings.push({ id: id, text: m[2], only: only });
        html += '<h3 id="' + id + '">' + inline(m[2]) + "</h3>";
      } else {
        html += "<h4>" + inline(m[2]) + "</h4>";
      }
    } else if ((m = t.match(/^[-*] (.+)$/))) {
      if (!list || list.tag !== "ul") { flush(); list = { tag: "ul", items: [] }; }
      list.items.push(m[1]);
    } else if ((m = t.match(/^\d+\. (.+)$/))) {
      if (!list || list.tag !== "ol") { flush(); list = { tag: "ol", items: [] }; }
      list.items.push(m[1]);
    } else if (t.startsWith(">")) {
      if (para.length || list) flush();
      quote.push(t.replace(/^>\s?/, ""));
    } else if (t === "---") {
      flush();
      html += "<hr>";
    } else if (t.startsWith("<") && !RICH_TAG.test(t)) {
      flush();
      html += richTags(line);   // HTML はそのまま（中の <size> などだけ置き換える）
    } else {
      if (list || quote.length) flush();
      para.push(t);
    }
  }
  flush();
  return html;
}

// :::quiz の中身を読む
function parseQuiz(lines) {
  const q = { question: [], choices: [], explain: [] };
  for (const line of lines) {
    const t = line.trim();
    let m;
    if (!t) continue;
    if ((m = t.match(/^[-*] \[( |x|X)\] (.+)$/))) q.choices.push({ text: m[2], correct: m[1] !== " " });
    else if ((m = t.match(/^[-*] (.+)$/))) q.choices.push({ text: m[1], correct: false });
    else if (t.startsWith(">")) q.explain.push(t.replace(/^>\s?/, ""));
    else q.question.push(t);
  }
  return q;
}

// ---------- コード先・メロ先などの「順番を選ぶ」 ----------
// :::order の中身を読む。1行が1つの選択肢：「- ラベル：タイトル, タイトル」
function parseOrder(question, lines) {
  const block = { question: question || "どの順番で進める？", options: [] };
  for (const line of lines) {
    const m = line.trim().match(/^[-*]\s*(.+?)\s*[:：]\s*(.+)$/);
    if (m) block.options.push({ label: m[1], titles: m[2].split(/\s*[,、，]\s*/).filter((x) => x) });
  }
  return block;
}

// 今選ばれている選択肢のラベル（「コード先」など）の一覧
function pickedLabels() {
  return ORDER_BLOCKS.map((b, k) => b.options[state.orderPick[k] || 0].label);
}

// :::only の中身を見せるかどうか
const isVisible = (only) => !only || pickedLabels().includes(only);

// 選ばれた順番に合わせて、ステップの並び（steps の番号の並び）を作る
function computeOrder() {
  const order = steps.map((_, i) => i);
  ORDER_BLOCKS.forEach((b, k) => {
    const opt = b.options[state.orderPick[k] || 0];
    if (!opt) return;
    const wanted = opt.titles.map((t) => steps.findIndex((s) => s.title === t));
    if (wanted.includes(-1)) { console.warn("順番の指定に、見つからないタイトルがあります：" + opt.titles.join(", ")); return; }
    // そのステップたちが今いる場所（前から順）に、選んだ順番で入れ直す
    const slots = wanted.map((w) => order.indexOf(w)).sort((a, b2) => a - b2);
    slots.forEach((slot, j) => { order[slot] = wanted[j]; });
  });
  return order;
}

// 順番を選び直す。今読んでいるステップはそのまま見続けられるようにする
function setOrder(k, opt) {
  const current = order[state.step];
  state.orderPick[k] = opt;
  order = computeOrder();
  state.step = order.indexOf(current);
  renderExplain();
}

// 順番を選ぶボタンの HTML
function orderHtml(k) {
  const b = ORDER_BLOCKS[k];
  const pick = state.orderPick[k] || 0;
  let html = '<p class="order-q">' + inline(b.question) + '</p><div class="order-options">';
  b.options.forEach((o, oi) => {
    html += '<button class="order-opt' + (oi === pick ? " selected" : "") + '" data-order="' + k + '" data-opt="' + oi +
            '" aria-pressed="' + (oi === pick) + '"><strong>' + inline(o.label) + "</strong><span>" +
            o.titles.map(inline).join(" → ") + "</span></button>";
  });
  return html + "</div>";
}

// クイズ1つ分の HTML（答えたかどうかで見た目が変わる）
// stepIndex は steps の番号（並べ替えても変わらない番号）。答えもこの番号で覚える
function quizHtml(stepIndex, qi) {
  const q = steps[stepIndex].quizzes[qi];
  const ans = state.answers[stepIndex + "-" + qi];
  const answered = ans !== undefined;
  const attrs = ' data-step="' + stepIndex + '" data-quiz="' + qi + '"';

  let html = '<p class="quiz-label">クイズ</p><p class="quiz-q">' + q.question.map(inline).join("<br>") + "</p>";
  html += '<div class="quiz-choices">';
  q.choices.forEach((c, ci) => {
    let cls = "choice";
    if (answered && c.correct) cls += " correct";
    else if (answered && ci === ans) cls += " wrong";
    html += '<button class="' + cls + '"' + attrs + ' data-choice="' + ci + '"' + (answered ? " disabled" : "") + ">" + inline(c.text) + "</button>";
  });
  html += "</div>";

  if (answered) {
    const ok = q.choices[ans].correct;
    html += '<p class="quiz-result ' + (ok ? "ok" : "ng") + '">' + (ok ? "正解！" : "ざんねん…") + "</p>";
    if (q.explain.length) html += "<p>" + q.explain.map(inline).join("<br>") + "</p>";
    html += '<button class="retry"' + attrs + ' data-retry="1">もう一度</button>';
  }
  return html;
}

// そのステップの、今見えているクイズの数と正解した数
function quizCount(stepIndex) {
  let total = 0, ok = 0;
  steps[stepIndex].quizzes.forEach((q, qi) => {
    if (!isVisible(q.only)) return;
    total++;
    const a = state.answers[stepIndex + "-" + qi];
    if (a !== undefined && q.choices[a].correct) ok++;
  });
  return { total, ok };
}

// 目次の HTML（並べ替えた順番で出す。pos は何番目に出すか、i は steps の番号）
function tocHtml() {
  let total = 0, ok = 0;
  steps.forEach((s, i) => { const c = quizCount(i); total += c.total; ok += c.ok; });

  let html = '<p class="toc-title">目次</p>';
  if (total) html += '<p class="toc-score">クイズ　' + ok + " / " + total + " 問正解</p>";
  ORDER_BLOCKS.forEach((_, k) => { html += '<div class="order-choice compact">' + orderHtml(k) + "</div>"; });
  html += '<ol class="toc-list">';
  order.forEach((i, pos) => {
    const s = steps[i];
    const c = quizCount(i);
    html += '<li class="' + (pos === state.step ? "current" : "") + '">';
    html += '<button class="toc-step" data-goto="' + pos + '"><span class="toc-no">' + (pos + 1) + "</span>" + inline(s.title);
    if (c.total) html += '<span class="toc-quiz' + (c.ok === c.total ? " done" : "") + '">クイズ ' + c.ok + "/" + c.total + "</span>";
    html += "</button>";
    const heads = s.headings.filter((h) => isVisible(h.only));
    if (heads.length) {
      html += "<ul>";
      for (const h of heads) {
        html += '<li><button class="toc-sub" data-goto="' + pos + '" data-anchor="' + h.id + '">' + inline(h.text) + "</button></li>";
      }
      html += "</ul>";
    }
    html += "</li>";
  });
  return html + "</ol>";
}

// 説明パネルを作り直す（音を置くたびに作り直すとスクロールが戻るので、render とは分けてある）
function renderExplain() {
  const base = order[state.step];   // 今のステップの steps の番号
  const step = steps[base];
  $("step-no").textContent = "STEP " + (state.step + 1) + " / " + order.length;
  $("toc-btn").classList.toggle("active", state.panel === "toc");
  $("glossary-btn").classList.toggle("active", state.panel === "glossary");
  $("chart-btn").classList.toggle("active", state.panel === "chart");
  $("chart").hidden = state.panel !== "chart";
  $("qol-btn").classList.toggle("active", state.panel === "qol");
  $("qol").hidden = state.panel !== "qol";
  $("toc").hidden = state.panel !== "toc";
  $("glossary").hidden = state.panel !== "glossary";
  $("lesson").hidden = state.panel !== "lesson";
  hideTip();

  if (state.panel === "toc") {
    $("toc").innerHTML = tocHtml();
  } else if (state.panel === "glossary") {
    $("glossary").innerHTML = glossaryHtml();
    linkTerms($("glossary"));
  } else if (state.panel === "qol") {
    const box = $("qol");
    const scroll = box.scrollTop;
    box.innerHTML = "<h2>" + inline(QOL_PAGE.title) + "</h2>" + QOL_PAGE.html;
    linkTerms(box);
    box.scrollTop = scroll;
  } else if (state.panel === "chart") {
    const box = $("chart");
    const scroll = box.scrollTop;
    box.innerHTML = chartHtml();
    linkTerms(box);
    box.scrollTop = scroll;
  } else {
    const box = $("lesson");
    const scroll = box.scrollTop;   // 作り直してもスクロール位置がそのままになるように
    box.innerHTML = "<h2>" + inline(step.title) + "</h2>" + step.html;
    box.querySelectorAll(".quiz").forEach((el) => { el.innerHTML = quizHtml(base, Number(el.dataset.quiz)); });
    box.querySelectorAll(".order-choice").forEach((el) => { el.innerHTML = orderHtml(Number(el.dataset.order)); });
    box.querySelectorAll(".only").forEach((el) => { el.hidden = !isVisible(el.dataset.only); });
    linkTerms(box);                 // 用語辞典にある言葉に印を付ける
    box.scrollTop = scroll;
  }
  syncSoundButtons();   // 作り直したボタンにも、再生中の印を付け直す
  markHlButtons();

  const next = steps[order[state.step + 1]];
  $("prev").disabled = state.step === 0;
  $("next").disabled = !next;
  $("next").textContent = next ? "次へ →" : "おわり";
  $("next").title = next ? next.title : "";
}

// ステップを移動する。anchor があればその見出しまでスクロール
function goToStep(i, anchor) {
  if (i !== state.step) stopSound();   // 別のステップに移ったら、流れている音声は止める
  state.step = i;
  state.panel = "lesson";
  renderExplain();
  const box = $("lesson");
  box.scrollTop = 0;
  if (anchor) {
    const el = document.getElementById(anchor);
    if (el) box.scrollTop = el.offsetTop - 8;
  }
}

// ---------- 用語辞典（glossary.js） ----------
const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TERM_INDEX = {};   // 言葉 → GLOSSARY の何番目か
GLOSSARY.forEach((g, i) => g.names.forEach((n) => { TERM_INDEX[n] = i; }));
// 登録した言葉を全部探す正規表現。長い言葉を先に並べる（「コード進行」を「コード」より先に見つけるため）
const allNames = Object.keys(TERM_INDEX).sort((a, b) => b.length - a.length);
const TERM_REGEX = allNames.length ? new RegExp(allNames.map(escapeReg).join("|"), "g") : null;

// root の中の文字から登録した言葉を探して、<span class="term"> で囲む
function linkTerms(root) {
  if (!TERM_REGEX) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    // ボタン・リンク・タイトル・用語の見出しの中は印を付けない
    if (node.parentElement.closest("a, button, h2, dt, .term")) continue;
    const text = node.nodeValue;
    TERM_REGEX.lastIndex = 0;
    if (!TERM_REGEX.test(text)) continue;

    TERM_REGEX.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = TERM_REGEX.exec(text))) {
      frag.append(text.slice(last, m.index));
      const span = document.createElement("span");
      span.className = "term";
      span.tabIndex = 0;                       // キーボードでも選べるように
      span.dataset.term = TERM_INDEX[m[0]];
      span.textContent = m[0];
      frag.append(span);
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
}

// 用語の一覧（五十音順）
function glossaryHtml() {
  const list = GLOSSARY.map((g, i) => ({ g, i })).sort((a, b) => a.g.names[0].localeCompare(b.g.names[0], "ja"));
  let html = '<p class="toc-title">用語</p><dl class="glossary-list">';
  for (const { g } of list) {
    html += '<div class="gl-item"><dt>' + inline(g.names.join("／")) + "</dt><dd>" + inline(g.text) + "</dd></div>";
  }
  return html + "</dl>";
}

// マウスを乗せたとき（キーボードで選んだとき）に出る説明
const tip = $("tooltip");
function showTip(el) {
  const g = GLOSSARY[Number(el.dataset.term)];
  tip.innerHTML = "<strong>" + inline(g.names.join("／")) + "</strong><br>" + inline(g.text);
  tip.hidden = false;
  // 言葉のすぐ下に出す。画面からはみ出すなら左や上にずらす
  const r = el.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = Math.min(r.left, window.innerWidth - 8 - tr.width);
  let top = r.bottom + 6;
  if (top + tr.height > window.innerHeight - 8) top = r.top - 6 - tr.height;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = Math.max(8, top) + "px";
}
function hideTip() { tip.hidden = true; }

document.addEventListener("mouseover", (e) => {
  const el = e.target.closest(".term");
  el ? showTip(el) : hideTip();
});
document.addEventListener("focusin", (e) => { if (e.target.classList.contains("term")) showTip(e.target); });
document.addEventListener("focusout", hideTip);
$("lesson").addEventListener("scroll", hideTip);
$("glossary").addEventListener("scroll", hideTip);
$("chart").addEventListener("scroll", hideTip);
$("qol").addEventListener("scroll", hideTip);

// ---------- 早見表（コードの構成音・定番のコード進行） ----------
const EN_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KEY_NAMES = { C: "Cメジャー", G: "Gメジャー" };
const DEGREES = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];     // キーの何番目の音から作ったコードか
const DIATONIC_TYPES = ["", "m", "m", "", "", "m", "dim"];         // メジャーキーで自然にできるコードの種類

// 定番のコード進行。[キーの何番目(0から), コードの種類（書かなければ自然な種類）]
const PROGRESSIONS = [
  { name: "このソフトの定番", chords: [[0], [4], [5], [3]], memo: "明るくて王道。迷ったらまずこれ。" },
  { name: "王道進行", chords: [[3], [4], [2], [5]], memo: "J-POPのサビで大人気。切なくて前向き。" },
  { name: "小室進行", chords: [[5], [3], [4], [0]], memo: "切なくてかっこいい。90年代のヒット曲でよく使われた。" },
  { name: "カノン進行", chords: [[0], [4], [5], [2], [3], [0], [3], [4]], memo: "パッヘルベルの「カノン」でおなじみ。安定して美しい。8小節で一周。" },
  { name: "イチロクニーゴー", chords: [[0], [5], [1], [4]], memo: "昔のポップスやジャズのような、軽くておしゃれな感じ。" },
  { name: "丸サ進行（かんたん版）", chords: [[3], [2, "7"], [5], [0]], memo: "おしゃれで少し切ない。本来はコードに音を足した形でよく使われる。" },
  { name: "作者のお気に入り①", chords: [[0], [3], [5], [4, "7"]], memo: "明るく始まって少し切なくなり、最後の V7 で「最初に戻りたい！」感じになる。ループさせると気持ちいい。" },
  { name: "作者のお気に入り②", chords: [[0], [3], [2], [4, "13"]], memo: "最後の V13 がおしゃれでキラッとした響き。5度と11度を抜いて、音どうしがぶつからないようにしている。" }
];

const midiName = (m) => EN_NAMES[m % 12] + (Math.floor(m / 12) - 1);   // 60 → "C4"

// キーの何番目のコードか → { 名前, 度数, 構成音(MIDI), ベース音(MIDI) }
function chordInKey(key, deg, type) {
  const rootPc = SCALES[key][deg];
  const t = type !== undefined ? type : DIATONIC_TYPES[deg];
  const name = EN_NAMES[rootPc] + t;
  const notes = chordToMidis(name);
  let degree = DEGREES[deg];
  if (t === "7" || t === "13") degree = degree.toUpperCase().replace("°", "") + t;   // 例：iii に 7 を付けると III7、V に 13 で V13
  return { name, degree, notes, bass: notes[0] - 12 };
}

// <play=...> に渡す書き方を作る（ベース音を入れるなら「+ベース音」を足す）
function chordSpec(c, beats) {
  return "[" + c.name + "]" + (state.chartBass ? "+" + midiName(c.bass) : "") + ":" + beats;
}

function chartHtml() {
  const key = state.scale;
  let html = '<p class="toc-title">早見表</p>';
  html += '<p class="toc-score">キー：' + KEY_NAMES[key] + "（作曲画面の「スケール」を変えると、表も変わります）</p>";
  html += '<label class="chart-bass"><input type="checkbox" id="chart-bass"' + (state.chartBass ? " checked" : "") +
          "><span>ベース音（一番下の音の1オクターブ下）も一緒に</span></label>";

  // このキーで使えるコード
  html += '<h3 class="chart-h">このキーで使えるコード</h3>';
  html += '<table class="chart-table"><thead><tr><th>度数</th><th>コード</th><th>構成音</th><th></th></tr></thead><tbody>';
  for (let d = 0; d < 7; d++) {
    const c = chordInKey(key, d);
    const names = c.notes.map((m) => NAMES[m % 12]).join("・");
    const bass = state.chartBass ? '<span class="chart-basstext">＋ベース ' + NAMES[c.bass % 12] + "</span>" : "";
    html += "<tr><td class=\"chart-deg\">" + c.degree + '</td><td class="chart-name">' + c.name + "</td><td>" + names + bass +
            '</td><td class="chart-btns"><button class="play-btn" data-play="' + chordSpec(c, 2) + '" aria-label="' + c.name + 'を聴く">▶</button>' +
            '<button class="hl-btn small" data-hl="' + c.name + '" aria-label="' + c.name + 'の音を作曲画面で光らせる" title="作曲画面で光らせる"><span class="hl-dot"></span></button></td></tr>';
  }
  html += "</tbody></table>";
  html += '<p class="chart-note">I・IV・V（大文字）は明るいコード、ii・iii・vi（小文字）は暗いコードです。vii° は不安定なので、最初は使わなくて大丈夫。</p>';

  // 定番のコード進行
  html += '<h3 class="chart-h">定番のコード進行</h3>';
  PROGRESSIONS.forEach((p, i) => {
    const cs = p.chords.map(([d, t]) => chordInKey(key, d, t));
    const bars = cs.length === 4 ? "4小節（8小節なら2回）" : cs.length + "小節";
    html += '<div class="prog">';
    html += '<p class="prog-name">' + p.name + '<span class="prog-bars">' + bars + "</span></p>";
    html += '<p class="prog-chords">' + cs.map((c) => '<span class="prog-chord"><b>' + c.name + "</b><small>" + c.degree + "</small></span>").join('<span class="prog-arrow">→</span>') + "</p>";
    html += '<p class="prog-memo">' + p.memo + "</p>";
    html += '<div class="prog-buttons"><button class="play-btn" data-play="' + cs.map((c) => chordSpec(c, 2)).join(" ") + ' bpm=120">▶ 聴く</button>' +
            '<button class="prog-insert" data-insert="' + i + '">コードトラックに入れる</button></div>';
    html += "</div>";
  });
  return html;
}

// ---------- コードを光らせる ----------
// その小節で光らせる音 { pcs: 音の種類(0〜11)の集まり, root: ルート音 }。光らせないなら null
function highlightForBar(bar) {
  const h = state.highlight;
  if (!h) return null;
  if (h === "track") {
    // コードトラックで、その小節に鳴っている音を読み取る（一番低い音をルート音とみなす）
    const s = bar * BAR, e = s + BAR;
    const inBar = state.tracks[1].notes.filter((n) => n.start < e && n.start + n.length > s);
    if (inBar.length === 0) return null;
    const lowest = Math.min(...inBar.map((n) => n.pitch));
    return { pcs: new Set(inBar.map((n) => n.pitch % 12)), root: lowest % 12 };
  }
  const midis = chordToMidis(h);
  if (!midis) return null;
  return { pcs: new Set(midis.map((m) => m % 12)), root: midis[0] % 12 };
}

// 作曲画面の「コードを光らせる」の選択欄を作り直す（キーが変わると中身も変わる）
function renderHlSelect() {
  const names = [0, 1, 2, 3, 4, 5, 6].map((d) => chordInKey(state.scale, d).name);
  if (state.highlight && state.highlight !== "track" && !names.includes(state.highlight)) names.push(state.highlight);
  let html = '<option value="">なし</option><option value="track">コードトラックに合わせる</option>';
  for (const n of names) html += '<option value="' + n + '">' + n + "</option>";
  $("hl").innerHTML = html;
  $("hl").value = state.highlight;
}

// 説明や早見表の中の「光らせる」ボタンに、今光っているかの印を付ける
function markHlButtons() {
  document.querySelectorAll(".hl-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.hl === state.highlight && state.highlight !== "");
  });
}

function setHighlight(v) {
  if (v !== "" && v !== "track" && !chordToMidis(v)) { console.warn("光らせられないコード名です：" + v); return; }
  state.highlight = v;
  render();
  markHlButtons();
}

// コード進行をコードトラックに入れる（1小節に1コード。4つなら2回繰り返して8小節にする）
function insertProgression(i) {
  const cs = PROGRESSIONS[i].chords.map(([d, t]) => chordInKey(state.scale, d, t));
  pushHistory();
  const notes = [];
  for (let bar = 0; bar < 8; bar++) {
    const c = cs[bar % cs.length];
    const pitches = state.chartBass ? [c.bass, ...c.notes] : c.notes;
    for (const p of pitches) notes.push({ pitch: p, start: bar * BAR, length: BAR, velocity: 90 });
  }
  state.tracks[1].notes = notes;
  state.selected.clear();
  render();
}

// 説明のステップ：lessons.js に書いた文章を読み込んで作る
// （上の関数や決まりごとを全部書き終わってから実行する）
const steps = LESSON_SOURCES.map((src, i) => parseLesson(src, i));
let order = computeOrder();
// QOL（便利な機能）のページ：qol.js に書いた文章を、説明と同じ書き方で読み込む
const QOL_PAGE = parseLesson(QOL_SOURCES.join("\n"), "qol");   // 表示する順番（steps の番号の並び）。コード先・メロ先などで変わる

// ================================================
// 5. 描画（データを見て画面を全部作り直す）
// ================================================
function render() {
  // 分割／タブの切り替え：body のクラスを変えるだけ。隠す・出すは CSS がやる
  document.body.className = "mode-" + state.mode + " show-" + state.tab;
  $("btn-split").classList.toggle("active", state.mode === "split");
  $("btn-tab").classList.toggle("active", state.mode === "tab");
  $("tab-explain").classList.toggle("active", state.tab === "explain");
  $("tab-daw").classList.toggle("active", state.tab === "daw");
  $("play").classList.toggle("active", state.playing);

  renderTracks();
  renderHlSelect();
  drawRoll();
}

// トラック一覧を作り直す
function renderTracks() {
  let html = "";
  state.tracks.forEach((t, i) => {
    const cls = ["track"];
    if (i === state.current) cls.push("selected");
    if (!isAudible(t)) cls.push("silent");
    // 音色の選択欄
    let options = "";
    for (const key in INSTRUMENTS) {
      options += '<option value="' + key + '"' + (key === t.instrument ? " selected" : "") + ">" + INSTRUMENTS[key].name + "</option>";
    }
    html +=
      '<div class="' + cls.join(" ") + '" data-index="' + i + '">' +
        '<div class="track-row">' +
          '<span class="dot" style="background:' + t.color + '"></span>' +
          '<button class="name" data-action="select">' + t.name + '</button>' +
          '<button class="ms' + (t.mute ? " mute-on" : "") + '" data-action="mute" aria-label="' + t.name + 'をミュート" aria-pressed="' + t.mute + '">M</button>' +
          '<button class="ms' + (t.solo ? " solo-on" : "") + '" data-action="solo" aria-label="' + t.name + 'だけ再生" aria-pressed="' + t.solo + '">S</button>' +
        '</div>' +
        '<select class="inst" data-action="inst" aria-label="' + t.name + 'の音色">' + options + '</select>' +
      '</div>';
  });
  $("tracks").innerHTML = html;
}

// 画質対策：canvas の中身の画素数を「見た目の大きさ × 画面の細かさ」にそろえる
function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;   // 隠れているときは描かない
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(r.width * dpr), ph = Math.round(r.height * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 以降は見た目のpxで描ける
  W = r.width;
  H = r.height;

  if (view.unitW === 0) {                    // 最初の1回：8小節全体が入る大きさ、C4あたりを真ん中に
    view.unitW = minUnitW();
    view.y = (TOP - 66) * ROW_H - (H - RULER_H) / 2;
  }
  clampView();
  return true;
}

function minUnitW() { return (W - KEY_W) / TOTAL; }   // 8小節がちょうど入る幅

// はみ出さないようにする
function clampView() {
  view.unitW = Math.min(MAX_UNIT_W, Math.max(minUnitW(), view.unitW));
  const maxX = TOTAL - (W - KEY_W) / view.unitW;
  view.x = Math.min(Math.max(0, maxX), Math.max(0, view.x));
  const maxY = (TOP - BOTTOM + 1) * ROW_H - (H - RULER_H);
  view.y = Math.min(Math.max(0, maxY), Math.max(0, view.y));
}

// 時間・音の高さ ⇔ 画面の位置
const timeToX = (t) => KEY_W + (t - view.x) * view.unitW;
const pitchToY = (p) => RULER_H + (TOP - p) * ROW_H - view.y;
const unitAt = (x) => view.x + (x - KEY_W) / view.unitW;
const pitchAt = (y) => TOP - Math.floor((y - RULER_H + view.y) / ROW_H);
const snapFloor = (u) => Math.floor(u / state.grid) * state.grid;   // 左のグリッド線に合わせる
const snapRound = (u) => Math.round(u / state.grid) * state.grid;   // 近い方のグリッド線に合わせる

function drawNotes(track, alpha, isCurrent) {
  ctx.globalAlpha = alpha;
  for (const n of track.notes) {
    const x = timeToX(n.start) + 1;
    const y = pitchToY(n.pitch) + 1;
    const w = Math.max(2, n.length * view.unitW - 2);
    ctx.fillStyle = track.color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, ROW_H - 3, 3);
    ctx.fill();
    if (isCurrent && state.selected.has(n)) {   // 選択中の音は白い枠
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (w > 30 && isCurrent) {
      ctx.fillStyle = "#1a1408";
      ctx.fillText(NAMES[n.pitch % 12], x + 4, y + 13);
    }
  }
  ctx.globalAlpha = 1;
}

function drawRoll() {
  if (!resizeCanvas()) return;
  ctx.clearRect(0, 0, W, H);
  const scale = SCALES[state.scale];
  const firstRow = Math.floor(view.y / ROW_H);
  const lastRow = Math.ceil((view.y + H - RULER_H) / ROW_H);

  // ---- マス目（はみ出した分は切り取る） ----
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEY_W, RULER_H, W - KEY_W, H - RULER_H);
  ctx.clip();

  // 行：白鍵は少し明るく、スケールの音は青っぽく
  for (let row = firstRow; row <= lastRow; row++) {
    const p = TOP - row;
    if (p < BOTTOM) break;
    const pc = p % 12;
    const black = BLACK.includes(pc);
    const inScale = scale.includes(pc);
    ctx.fillStyle = inScale ? (black ? "#262c38" : "#313949") : (black ? "#1f2024" : "#2a2c31");
    ctx.fillRect(KEY_W, pitchToY(p), W - KEY_W, ROW_H - 1);
  }

  // コードの音の行を光らせる（ルート音は黄色、ほかの音は緑）
  if (state.highlight) {
    for (let bar = 0; bar < 8; bar++) {
      const hl = highlightForBar(bar);
      if (!hl) continue;
      const x1 = Math.max(KEY_W, timeToX(bar * BAR));
      const x2 = timeToX((bar + 1) * BAR);
      if (x2 <= KEY_W || x1 >= W) continue;
      for (let row = firstRow; row <= lastRow; row++) {
        const p = TOP - row;
        if (p < BOTTOM) break;
        const pc = p % 12;
        if (!hl.pcs.has(pc)) continue;
        ctx.fillStyle = pc === hl.root ? "rgba(240, 200, 60, 0.5)" : "rgba(92, 200, 120, 0.24)";   // ルート音は黄色、ほかは緑
        ctx.fillRect(x1, pitchToY(p), x2 - x1, ROW_H - 1);
      }
    }
  }

  // 縦線：見えている範囲だけ。細かすぎる線は省く
  const tStart = Math.floor(view.x / state.grid) * state.grid;
  const tEnd = view.x + (W - KEY_W) / view.unitW;
  for (let t = tStart; t <= Math.min(tEnd, TOTAL); t += state.grid) {
    const isBar = t % BAR === 0;
    const isBeat = t % 12 === 0;
    if (!isBeat && state.grid * view.unitW < 6) continue;
    if (!isBar && isBeat && 12 * view.unitW < 6) continue;
    ctx.fillStyle = isBar ? "rgba(255,255,255,0.35)" : isBeat ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.05)";
    ctx.fillRect(Math.round(timeToX(t)), RULER_H, 1, H - RULER_H);
  }

  // 音：ほかのトラックは薄く、編集中のトラックははっきり
  ctx.font = "11px sans-serif";
  state.tracks.forEach((t, i) => { if (i !== state.current) drawNotes(t, 0.3, false); });
  drawNotes(state.tracks[state.current], 1, true);

  // 範囲選択の四角
  if (drag && drag.mode === "select") {
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0), h = Math.abs(drag.y1 - drag.y0);
    ctx.fillStyle = "rgba(122,167,232,0.15)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#7aa7e8";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  }

  // 再生位置の線
  if (state.playing) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(Math.round(timeToX(player.pos)), RULER_H, 2, H - RULER_H);
  }
  ctx.restore();

  // ---- 左の鍵盤 ----
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_H, KEY_W, H - RULER_H);
  ctx.clip();
  for (let row = firstRow; row <= lastRow; row++) {
    const p = TOP - row;
    if (p < BOTTOM) break;
    const pc = p % 12;
    const black = BLACK.includes(pc);
    const y = pitchToY(p);
    ctx.fillStyle = black ? "#141518" : "#e6e6ea";
    ctx.fillRect(0, y, KEY_W - 1, ROW_H - 1);
    ctx.fillStyle = black ? "#a1a3aa" : "#2a2a2e";
    const label = pc === 0 ? "C" + (Math.floor(p / 12) - 1) + " ド" : NAMES[pc];
    ctx.fillText(label, 6, y + 14);
    // 1つのコードを光らせているときは、鍵盤の右はしにも緑の印を付ける
    const keyHl = state.highlight && state.highlight !== "track" ? highlightForBar(0) : null;
    if (keyHl && keyHl.pcs.has(pc)) {
      ctx.fillStyle = pc === keyHl.root ? "#f0c83c" : "#7fcf98";
      ctx.fillRect(KEY_W - 7, y + 2, 5, ROW_H - 5);
    }
  }
  ctx.restore();

  // ---- 上の小節番号 ----
  ctx.fillStyle = "#222328";
  ctx.fillRect(0, 0, W, RULER_H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEY_W, 0, W - KEY_W, RULER_H);
  ctx.clip();
  ctx.font = "12px monospace";
  for (let b = 0; b <= 8; b++) {
    const x = Math.round(timeToX(b * BAR));
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x, 0, 1, RULER_H);
    if (b < 8) {
      ctx.fillStyle = "#a1a3aa";
      ctx.fillText(String(b + 1), x + 5, 16);
    }
  }
  if (state.playing) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(Math.round(timeToX(player.pos)), 0, 2, RULER_H);
  }
  ctx.restore();
}

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
$("lesson").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-quiz]");
  if (!b) return;
  const key = b.dataset.step + "-" + b.dataset.quiz;
  if (b.dataset.retry) delete state.answers[key];
  else state.answers[key] = Number(b.dataset.choice);
  renderExplain();
});

$("grid").addEventListener("change", (e) => {
  state.grid = Number(e.target.value);
  state.noteLength = state.grid;   // グリッドを変えたら、置く音の長さもそれに合わせる
  e.target.blur();                 // スペースキーが選択欄に取られないように
  render();
});
$("hl").addEventListener("change", (e) => { e.target.blur(); setHighlight(e.target.value); });
$("scale").addEventListener("change", (e) => {
  state.scale = e.target.value;
  e.target.blur();
  render();
  if (state.panel === "chart") renderExplain();   // 早見表もキーに合わせて変える
});
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
});

// トラック一覧：ボタンが毎回作り直されるので、外側の箱で1回だけ受け取る
$("tracks").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  const item = e.target.closest(".track");
  if (!btn || !item) return;
  const i = Number(item.dataset.index);
  const t = state.tracks[i];
  if (btn.dataset.action === "mute") t.mute = !t.mute;
  if (btn.dataset.action === "solo") t.solo = !t.solo;
  if (btn.dataset.action === "select" && state.current !== i) {
    state.current = i;
    state.selected.clear();   // 選択は編集中のトラックの音だけ
  }
  render();
});

// 音色を変えたら、その音色で試しに鳴らす（メロディは1音、コードは和音）
$("tracks").addEventListener("change", (e) => {
  if (!e.target.classList.contains("inst")) return;
  const i = Number(e.target.closest(".track").dataset.index);
  const t = state.tracks[i];
  t.instrument = e.target.value;
  initAudio();
  audio.resume();
  const now = audio.currentTime + 0.02;
  const pitches = i === 0 ? [72] : [60, 64, 67];
  for (const p of pitches) playNote(p, 0, 100, now, 0.6, t.instrument);
  e.target.blur();   // スペースキーで再生できるように、選択欄から外す
  render();
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

// ---------- ピアノロールのマウス操作 ----------
let drag = null;    // ドラッグ中の情報（していないときは null）
let mouse = null;   // ピアノロール上のマウスの位置（貼り付け位置に使う）

function posFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// その位置にある、編集中トラックの音（上に描かれている方を優先）
function noteAt(x, y) {
  const p = pitchAt(y), u = unitAt(x);
  const notes = currentNotes();
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    if (n.pitch === p && n.start <= u && u < n.start + n.length) return n;
  }
  return null;
}

// 音の右端をつかんだか（音が小さいときは、つかめる幅も小さくする）
function nearRightEdge(n, x) {
  const w = n.length * view.unitW;
  return timeToX(n.start + n.length) - x <= Math.max(3, Math.min(8, w / 3));
}

// 右クリックのメニューを出さない（右ドラッグを範囲選択に使うため）
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("pointerdown", (e) => {
  const { x, y } = posFromEvent(e);
  if (x < KEY_W || y < RULER_H) return;   // 鍵盤と小節番号の上は無視
  canvas.setPointerCapture(e.pointerId);  // canvas の外に出てもドラッグを追いかける

  // 右ボタン：範囲選択を始める
  if (e.button === 2) {
    drag = { mode: "select", x0: x, y0: y, x1: x, y1: y, add: e.shiftKey };
    drawRoll();
    return;
  }
  if (e.button !== 0) return;

  const hit = noteAt(x, y);

  // Shift＋クリック：選択に足す・外す
  if (hit && e.shiftKey) {
    state.selected.has(hit) ? state.selected.delete(hit) : state.selected.add(hit);
    drawRoll();
    return;
  }

  const before = snapshot();
  if (hit) {
    // 音をつかむ：選択されていない音なら、それだけを選択し直す
    if (!state.selected.has(hit)) {
      state.selected.clear();
      state.selected.add(hit);
    }
    drag = { mode: nearRightEdge(hit, x) ? "resize" : "move", grab: hit };
  } else {
    // 空いた所：新しい音を置いて、そのままドラッグで長さを決められるようにする
    const p = pitchAt(y), u = unitAt(x);
    if (p < BOTTOM || u >= TOTAL) return;
    const start = snapFloor(u);
    const note = { pitch: p, start: start, length: Math.min(state.noteLength, TOTAL - start), velocity: 100 };
    currentNotes().push(note);
    state.selected.clear();
    state.selected.add(note);
    preview(p);
    drag = { mode: "resize", grab: note, moved: true, created: true };
  }
  drag.before = before;
  drag.x0 = x;
  drag.startUnit = unitAt(x);
  drag.startPitch = pitchAt(y);
  drag.moved = drag.moved || false;
  // ドラッグ前の位置を覚えておく（動かした量を毎回ここから計算する）
  drag.orig = [...state.selected].map((n) => ({ n: n, start: n.start, pitch: n.pitch, length: n.length }));
  drawRoll();
});

canvas.addEventListener("pointermove", (e) => {
  const { x, y } = posFromEvent(e);
  mouse = { x, y };

  // ドラッグしていないとき：場所に合わせてマウスカーソルの形を変える
  if (!drag) {
    const hit = x >= KEY_W && y >= RULER_H ? noteAt(x, y) : null;
    canvas.style.cursor = hit ? (nearRightEdge(hit, x) ? "ew-resize" : "move") : "default";
    return;
  }

  if (drag.mode === "select") {
    drag.x1 = x;
    drag.y1 = y;
    drawRoll();
    return;
  }

  const raw = unitAt(x) - drag.startUnit;   // マウスが動いた量（48分単位、まだグリッドに合わせていない）
  const g = drag.orig.find((o) => o.n === drag.grab);

  if (drag.mode === "resize") {
    // つかんだ音の終わりをグリッドに合わせ、その差を選択中の音全部に足す
    const origEnd = g.start + g.length;
    let dt = snapRound(origEnd + raw) - origEnd;
    if (drag.created) {
      // 置いたばかりの音：マウスのある所まで伸ばす（少し動かしただけなら元の長さのまま）
      if (Math.abs(x - drag.x0) < 4) return;
      dt = snapRound(unitAt(x)) - origEnd;
    }
    for (const o of drag.orig) {
      o.n.length = Math.max(state.grid, Math.min(TOTAL - o.start, o.length + dt));
    }
    state.noteLength = drag.grab.length;   // 次に置く音もこの長さにする
  } else {
    // 移動：つかんだ音の頭をグリッドに合わせる。ほんの少しの手ブレは無視
    let dt = Math.abs(x - drag.x0) < 4 ? 0 : snapRound(g.start + raw) - g.start;
    let dp = pitchAt(y) - drag.startPitch;
    // 選択中の音が1つも8小節・音域からはみ出さないように止める
    const minStart = Math.min(...drag.orig.map((o) => o.start));
    const maxEnd = Math.max(...drag.orig.map((o) => o.start + o.length));
    const minPitch = Math.min(...drag.orig.map((o) => o.pitch));
    const maxPitch = Math.max(...drag.orig.map((o) => o.pitch));
    dt = Math.max(-minStart, Math.min(TOTAL - maxEnd, dt));
    dp = Math.max(BOTTOM - minPitch, Math.min(TOP - maxPitch, dp));

    const oldPitch = drag.grab.pitch;
    for (const o of drag.orig) {
      o.n.start = o.start + dt;
      o.n.pitch = o.pitch + dp;
    }
    if (dt !== 0 || dp !== 0) drag.moved = true;
    if (drag.grab.pitch !== oldPitch) preview(drag.grab.pitch);   // 高さが変わったら鳴らす
  }
  drawRoll();
});

canvas.addEventListener("pointerup", (e) => {
  if (!drag) return;

  if (drag.mode === "select") {
    const x1 = Math.min(drag.x0, drag.x1), x2 = Math.max(drag.x0, drag.x1);
    const y1 = Math.min(drag.y0, drag.y1), y2 = Math.max(drag.y0, drag.y1);
    if (!drag.add) state.selected.clear();
    if (x2 - x1 > 3 || y2 - y1 > 3) {   // ただの右クリックなら、選択を外すだけ
      for (const n of currentNotes()) {
        const nx1 = timeToX(n.start), nx2 = timeToX(n.start + n.length);
        const ny1 = pitchToY(n.pitch), ny2 = ny1 + ROW_H;
        if (nx1 < x2 && nx2 > x1 && ny1 < y2 && ny2 > y1) state.selected.add(n);   // 四角に少しでもかかったら選択
      }
    }
  } else if (drag.mode === "move" && !drag.moved) {
    // 音を動かさずにクリックしただけ → その音を消す
    state.tracks[state.current].notes = currentNotes().filter((n) => n !== drag.grab);
    state.selected.delete(drag.grab);
  }

  // 何か変わっていたら「元に戻す」に記録
  if (drag.before && snapshot() !== drag.before) {
    history.undo.push(drag.before);
    history.redo = [];
  }
  drag = null;
  render();
});

canvas.addEventListener("pointercancel", () => { drag = null; drawRoll(); });
canvas.addEventListener("pointerleave", () => { if (!drag) mouse = null; });

// ホイール：そのまま = 上下、Shift = 左右、Ctrl = 拡大・縮小
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();   // ブラウザ自体のスクロール・拡大を止める
  let delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;   // Shift+ホイールは deltaX で来るブラウザもある
  if (e.deltaMode === 1) delta *= 16;                 // 行単位で来るブラウザ（Firefox）対策

  if (e.ctrlKey) {
    // マウスの下の位置がずれないように拡大・縮小する
    const mx = Math.max(0, e.offsetX - KEY_W);
    const mouseT = view.x + mx / view.unitW;
    const factor = delta < 0 ? 1.15 : 1 / 1.15;
    view.unitW = Math.min(MAX_UNIT_W, Math.max(minUnitW(), view.unitW * factor));
    view.x = mouseT - mx / view.unitW;
  } else if (e.shiftKey) {
    view.x += delta / view.unitW;
  } else {
    view.y += delta;
  }
  clampView();
  drawRoll();
}, { passive: false });

// 画面の大きさが変わったら描き直す（タブ切り替え・ウィンドウの大きさ・ブラウザの拡大率）
new ResizeObserver(() => drawRoll()).observe(canvas);
window.addEventListener("resize", () => drawRoll());

render();          // 最初の1回
renderExplain();
