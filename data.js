// data.js：曲のデータ・画面の部品
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）

// ================================================
// 1. データ（画面に出るものは全部ここから作る）
// ================================================
let nextTrackId = 1;   // 次に作るトラックの目印の番号
const state = {
  mode: "split",   // "split"（分割）か "tab"（タブ）
  book: "compose", // 説明の本："compose"（作曲編）か "arrange"（編曲編）
  tab: "daw",      // タブ表示のとき見せる方："explain" か "daw"
  step: 0,         // 今のステップ番号
  panel: "lesson", // 説明パネルに出すもの："lesson"（本文）／"toc"（目次）／"glossary"（用語）／"chart"（早見表）／"qol"（便利な機能）
  chartBass: true, // 早見表で、ベース音も一緒に鳴らす・入れるか
  highlight: "",   // ピアノロールで光らせるコード（"" なし／"track" コードトラックに合わせる／"C" などのコード名）
  answers: {},     // クイズの答え："ステップ番号-クイズ番号" → 選んだ選択肢の番号
  orderPick: {},   // 順番の選択：何個目の :::order か → 何番目の選択肢を選んだか（なければ最初）
  grid: 3,         // 1マスの長さ（48分単位。16分 = 3）
  noteLength: 3,   // 新しく置く音の長さ（最後に変えた長さを覚えておく）
  key: 0,          // キーの主音（0 = C, 1 = C#, … 11 = B）
  scale: "major",  // スケールの種類（SCALE_TYPES のキー）
  bpm: 120,
  playing: false,
  current: 0,      // 今編集しているトラックの番号
  tracks: [
    // notes の中身：{ pitch, start, length, velocity }（ドラムトラックの pitch は、パッドの番号 0〜15）
    // type：トラックの種類。"inst"（楽器）か "drum"（ドラム）
    // instrument：音色（INSTRUMENTS のキー）　volume：音量（0〜100）
    // role：最初からあるトラックの役目。"chord" のトラックは、早見表・コードを光らせる・ベースを作るが使う
    // pan：左右（-100〜100）　send：リバーブに送る量（0〜100）　duck：キックが鳴ったら下げる（サイドチェイン）
    // id：トラックの目印（元に戻すとき、同じトラックを探すのに使う）　custom：パッドに読み込んだ自分の音
    ...firstTracks()
  ],
  pad: 0,               // ドラムのパッド画面で選んでいるパッドの番号
  synthOpen: null,      // シンセの編集画面を開いているトラックの番号（閉じていれば null）
  confirmRemove: null,  // 「消す？」になっているトラックの番号
  renaming: null,       // 名前を変えているトラックの番号
  bassPattern: 0,       // 「ベースを入れる」のリズムの型
  chordSeq: [],         // コードパッドで選んだコードの並び（{ deg, seventh }）
  chord7: false,        // コードパッドを7thコードにするか
  rhythm: 0,            // コードのリズムの型（CHORD_RHYTHMS の番号）
  selected: new Set(),  // 選択中の音（編集中のトラックの音そのもの）
  metronome: false,     // メトロノームを鳴らすか
  loop: [0, 8]          // ループする範囲（小節。[0, 8] = 1〜8小節目の全部）
};

// 最初からある2つのトラック（「新しく作る」でもこれに戻す）
function firstTracks() {
  return [
    newTrack({ name: "メロディ", role: "melody", color: "#f2a541" }),
    newTrack({ name: "コード",   role: "chord",  color: "#7aa7e8" })
  ];
}
// トラックを1つ作る（書かなかった所は、最初の値）
function newTrack(props) {
  return Object.assign({ id: "t" + (nextTrackId++), name: "楽器", type: "inst", color: "#e86f6f", mute: false, solo: false,
                         volume: 80, pan: 0, send: 0, duck: false, instrument: "piano", notes: [], custom: {} }, props);
}

const MAX_TRACKS = 8;

// コードトラック（早見表などが使う）。消されていたら null
const chordTrack = () => state.tracks.find((t) => t.role === "chord") || null;
// コードトラックがなければ作る（早見表の「コードトラックに入れる」用）
function ensureChordTrack() {
  let t = chordTrack();
  if (!t && state.tracks.length < MAX_TRACKS) {
    addTrack("inst");
    t = state.tracks[state.tracks.length - 1];
    t.name = "コード";
    t.role = "chord";
  }
  return t;
}
const TRACK_COLORS = ["#e86f6f", "#9ad06a", "#c48be8", "#5fd0c8", "#e8c547", "#e89a5f"];

const liveKeys = new Set();                  // パソコン・MIDI のキーボードで今弾いている音（鍵盤を光らせる）
let clipboard = { notes: [], length: 0 };   // コピーした音（位置は先頭からの距離で持つ）
const history = { undo: [], redo: [] };     // 元に戻す・やり直し用の記録

// ピアノロールの「どこを見ているか」
const view = {
  x: 0,      // 左端の時間（48分単位）
  y: 0,      // 上からのスクロール量（px）
  unitW: 0   // 48分1つぶんの幅（px）。大きいほどアップ。0 = まだ決めていない
};


// スケールに入っている音（0 = ド, 1 = ド♯ … 11 = シ）
// スケールの種類：主音から何半音上の音を使うか
// chords：コードを作るときに使う7音のスケール（ペンタトニックなど7音でないものは、元になるスケールを使う）
const SCALE_TYPES = {
  major:      { name: "メジャー",               steps: [0, 2, 4, 5, 7, 9, 11] },
  minor:      { name: "マイナー（ナチュラル）", steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonic:   { name: "ハーモニックマイナー",   steps: [0, 2, 3, 5, 7, 8, 11] },
  melodic:    { name: "メロディックマイナー",   steps: [0, 2, 3, 5, 7, 9, 11] },
  dorian:     { name: "ドリアン",               steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian:   { name: "フリジアン",             steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian:     { name: "リディアン",             steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: "ミクソリディアン",       steps: [0, 2, 4, 5, 7, 9, 10] },
  locrian:    { name: "ロクリアン",             steps: [0, 1, 3, 5, 6, 8, 10] },
  majpenta:   { name: "メジャーペンタトニック", steps: [0, 2, 4, 7, 9], chords: "major" },
  minpenta:   { name: "マイナーペンタトニック", steps: [0, 3, 5, 7, 10], chords: "minor" },
  blues:      { name: "ブルース",               steps: [0, 3, 5, 6, 7, 10], chords: "minor" }
};
// 今のキーとスケールで使う音の種類（0〜11）
const scalePcs = () => SCALE_TYPES[state.scale].steps.map((i) => (state.key + i) % 12);
// コードを作るときの7音（主音からの半音の数）
const chordSteps = () => SCALE_TYPES[SCALE_TYPES[state.scale].chords || state.scale].steps;
const BLACK = [1, 3, 6, 8, 10];
const NAMES = ["ド", "ド♯", "レ", "レ♯", "ミ", "ファ", "ファ♯", "ソ", "ソ♯", "ラ", "ラ♯", "シ"];

const TOP = 96, BOTTOM = 36;   // 音域（MIDI番号）：C7 〜 C2
const ROW_H = 20;              // 1行の高さ(px)
const KEY_W = 80;              // 左の鍵盤の幅(px)。ドラムのときはパッドの名前が入る
const RULER_H = 24;            // 上の小節番号の高さ(px)
const LANE_H = 70;             // 下の「音の強さ（ベロシティ）」の欄の高さ(px)
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
