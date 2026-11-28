// sound.js：音を鳴らす（楽器・ドラム・FX・ミキサー・再生）
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）

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
  openAudio();
  makeSounds();
}
// AudioContext だけ作る（音はまだ鳴らない。ブラウザの決まりで、最初のクリックの後に resume すると鳴る）
function openAudio() {
  if (audio) return;
  audio = new AudioContext();
  setupOutput();
  requestAnimationFrame(drawMeters);
}
// 全体の音量と、みんなで使うリバーブを作る（WAV の書き出しでも使う）
let reverbIn = null;   // 全部のトラックから送られてくるリバーブの入口
function setupOutput() {
  master = audio.createGain();
  master.gain.value = 0.35;
  master.connect(audio.destination);
  const cv = audio.createConvolver();
  cv.buffer = makeImpulse(2.4);
  reverbIn = audio.createGain();
  reverbIn.connect(cv).connect(master);
}
// ドラム・FX の音を作っておく（まだ作っていない分を全部。1回だけ）
let soundsReady = false;
const makePad = (i) => makeBuffer(DRUM_PADS[i].dur, DRUM_PADS[i].gen, DRUM_PADS[i].hp, DRUM_PADS[i].lp);
function makeSounds() {
  if (soundsReady) return;
  if (!DRUM_BUFFERS) DRUM_BUFFERS = [];
  while (DRUM_BUFFERS.length < DRUM_PADS.length) DRUM_BUFFERS.push(makePad(DRUM_BUFFERS.length));
  makeFxBuffers();
  soundsReady = true;
}
// ページを開いたあと、ひまなときに少しずつ作っておく（最初に ▶ を押したとき待たされないように）
function prepareSoundsIdle() {
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  idle(function step() {
    if (soundsReady) return;
    openAudio();
    if (!DRUM_BUFFERS) DRUM_BUFFERS = [];
    if (DRUM_BUFFERS.length < DRUM_PADS.length) { DRUM_BUFFERS.push(makePad(DRUM_BUFFERS.length)); idle(step); }
    else makeSounds();
  });
}

// ---------- トラックごとのミキサー ----------
// トラック1つにつき1列：音量 → ダッキング（キックで下げる）→ パン（左右）→ 全体の音量
//                                                         └→ リバーブに送る量 → みんなのリバーブ
let buses = new WeakMap();
const volToGain = (v) => v / 80;   // 音量 80 で、そのままの大きさ
function busFor(track) {
  let b = buses.get(track);
  if (!b) {
    b = { in: audio.createGain(), duck: audio.createGain(), pan: audio.createStereoPanner(), send: audio.createGain(), meter: audio.createAnalyser() };
    b.in.gain.value = volToGain(track.volume);
    b.pan.pan.value = (track.pan || 0) / 100;
    b.send.gain.value = (track.send || 0) / 100;
    b.meter.fftSize = 512;
    b.in.connect(b.duck).connect(b.pan).connect(master);
    b.pan.connect(b.send).connect(reverbIn);
    b.pan.connect(b.meter);
    buses.set(track, b);
  }
  return b.in;
}
// 音量・パン・リバーブの値を、音に反映する
function updateBus(track) {
  const b = audio && buses.get(track);
  if (!b) return;
  const t = audio.currentTime;
  b.in.gain.setTargetAtTime(volToGain(track.volume), t, 0.02);
  b.pan.pan.setTargetAtTime((track.pan || 0) / 100, t, 0.02);
  b.send.gain.setTargetAtTime((track.send || 0) / 100, t, 0.02);
}
function setVolume(track, v) {
  track.volume = v;
  updateBus(track);
}
// トラックを消したとき、音の通り道を外す
function disconnectBus(track) {
  const b = audio && buses.get(track);
  if (!b) return;
  b.in.disconnect();
  b.pan.disconnect();
  buses.delete(track);
}

// サイドチェイン（duckAt）は sampler.js。どのノートで下げるかはドラムトラックごとに決める

// トラックの音の大きさのメーター（毎フレーム、トラック一覧の棒の長さを変える）
const meterLevels = new WeakMap();
const meterBuf = new Float32Array(512);
function drawMeters() {
  const bars = $("tracks").querySelectorAll(".meter i");
  state.tracks.forEach((t, i) => {
    const b = buses.get(t);
    let peak = 0;
    if (b) {
      b.meter.getFloatTimeDomainData(meterBuf);
      for (let k = 0; k < meterBuf.length; k++) peak = Math.max(peak, Math.abs(meterBuf[k]));
    }
    const level = Math.max(peak * 0.35 * 2.5, (meterLevels.get(t) || 0) * 0.9);   // 下がるときはゆっくり
    meterLevels.set(t, level);
    if (bars[i]) {
      bars[i].style.width = Math.min(100, level * 100) + "%";
      bars[i].classList.toggle("hot", level > 0.95);
    }
  });
  requestAnimationFrame(drawMeters);
}
const isDrum = (track) => track && track.type === "drum";
const isFx = (track) => track && track.type === "fx";
const isPadTrack = (track) => isDrum(track) || isFx(track);   // 行が「パッドの名前」になるトラック

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
// out：音の出口（トラックの音量のつまみ）。書かなければ全体の音量へ直接
function playNote(pitch, lengthUnits, velocity, time, durSec, inst, out) {
  const ins = INSTRUMENTS[inst] || INSTRUMENTS.piano;
  const dur = Math.max(ins.attack + 0.01, durSec !== undefined ? durSec : lengthUnits * unitSec());
  const peak = 0.5 * (velocity / 127) * ins.gain;

  // 音量の変化（エンベロープ）
  const g = audio.createGain();
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + ins.attack);                           // 立ち上がり
  g.gain.setTargetAtTime(peak * ins.sustain, time + ins.attack, ins.decay / 3);      // だんだん弱く
  g.gain.setTargetAtTime(0, time + dur, ins.release / 3);                            // 離したら消える
  g.connect(out || master);

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

// ================================================
// ドラム（パッドサンプラー）
// ================================================
// パッド16個の音は、ファイルを読み込まずに、ここで計算して作る（著作権の心配がない）
// gen(t, i, sr)：t 秒目の音の大きさ（-1〜1）を返す。dur：音の長さ（秒）
// 作った音は「サンプル」として AudioBuffer にしまい、パッドを押すとそれを鳴らす（サンプラーのしくみ）
const noise = () => Math.random() * 2 - 1;
const sq = (f, t) => (Math.sin(2 * Math.PI * f * t) >= 0 ? 1 : -1);          // 矩形波
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];                          // シンバルの金属っぽさを作る高さ
const metal = (t, k) => METAL.reduce((s, f) => s + sq(f * k, t), 0) / METAL.length;

// 音の高さが下がっていくサイン波（キック・タム用）。位相は呼ぶ側で足していく
function sweep(state, t, f0, f1, time, sr) {
  const f = f1 + (f0 - f1) * Math.exp(-t / time);
  state.ph += (2 * Math.PI * f) / sr;
  return Math.sin(state.ph);
}

// 高い音だけ通す・低い音だけ通す（1段のかんたんなフィルター）
function highpass(data, cutoff, sr) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  let prevIn = 0, prevOut = 0;
  for (let i = 0; i < data.length; i++) {
    const out = a * (prevOut + data[i] - prevIn);
    prevIn = data[i];
    prevOut = out;
    data[i] = out;
  }
}
function lowpass(data, cutoff, sr) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sr);
  let acc = 0;
  for (let i = 0; i < data.length; i++) { acc = (1 - a) * data[i] + a * acc; data[i] = acc; }
}

const DRUM_PADS = [
  { name: "キック", dur: 0.45, gen: (s) => (t, i, sr) => Math.tanh(1.6 * sweep(s, t, 160, 48, 0.03, sr) * Math.exp(-t / 0.13)) + (t < 0.002 ? noise() * 0.3 : 0) },
  { name: "スネア", dur: 0.3, hp: 1200, gen: (s) => (t, i, sr) => Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t / 0.04) * 0.6 + noise() * Math.exp(-t / 0.08) },
  { name: "クラップ", dur: 0.35, hp: 900, lp: 3500, gen: () => (t) => {
      const burst = [0, 0.011, 0.022].reduce((s, b) => s + (t >= b ? Math.exp(-(t - b) / 0.005) : 0), 0);
      return noise() * (burst * 0.8 + (t >= 0.025 ? Math.exp(-(t - 0.025) / 0.09) : 0));
    } },
  { name: "HH閉", dur: 0.09, hp: 7000, gen: () => (t) => (noise() * 0.7 + metal(t, 1.7) * 0.5) * Math.exp(-t / 0.022) },
  { name: "HH開", dur: 0.5, hp: 6500, gen: () => (t) => (noise() * 0.7 + metal(t, 1.7) * 0.5) * Math.exp(-t / 0.2) },
  { name: "クラッシュ", dur: 2.0, hp: 4000, gen: () => (t) => (noise() * 0.8 + metal(t, 2.3) * 0.4) * Math.exp(-t / 0.65) * Math.min(1, t / 0.003) },
  { name: "ライド", dur: 1.4, hp: 3000, gen: () => (t) => (metal(t, 3.1) * 0.7 + noise() * 0.15 + Math.sin(2 * Math.PI * 3200 * t) * 0.2) * Math.exp(-t / 0.45) },
  { name: "タム低", dur: 0.6, gen: (s) => (t, i, sr) => sweep(s, t, 140, 82, 0.08, sr) * Math.exp(-t / 0.22) },
  { name: "タム中", dur: 0.5, gen: (s) => (t, i, sr) => sweep(s, t, 200, 120, 0.07, sr) * Math.exp(-t / 0.18) },
  { name: "タム高", dur: 0.45, gen: (s) => (t, i, sr) => sweep(s, t, 280, 175, 0.06, sr) * Math.exp(-t / 0.15) },
  { name: "リム", dur: 0.08, hp: 400, gen: () => (t) => (Math.sin(2 * Math.PI * 1700 * t) * 0.6 + Math.sin(2 * Math.PI * 520 * t) * 0.5 + noise() * 0.3) * Math.exp(-t / 0.012) },
  { name: "カウベル", dur: 0.4, hp: 350, lp: 5000, gen: () => (t) => (sq(540, t) + sq(800, t)) * 0.5 * (t < 0.01 ? 1 : Math.exp(-(t - 0.01) / 0.09)) },
  { name: "シェイカー", dur: 0.14, hp: 5000, gen: () => (t) => noise() * (t < 0.025 ? t / 0.025 : Math.exp(-(t - 0.025) / 0.03)) },
  { name: "タンバリン", dur: 0.35, hp: 6000, gen: () => (t) => noise() * (Math.exp(-t / 0.12) * (0.6 + 0.4 * Math.abs(Math.sin(2 * Math.PI * 38 * t)))) },
  { name: "スナップ", dur: 0.15, hp: 1500, gen: () => (t) => (noise() * 0.8 + Math.sin(2 * Math.PI * 2100 * t) * 0.4) * Math.exp(-t / 0.016) },
  { name: "808キック", dur: 1.3, gen: (s) => (t, i, sr) => Math.tanh(1.3 * sweep(s, t, 120, 46, 0.05, sr) * Math.exp(-t / 0.55)) }
];
let DRUM_BUFFERS = null;   // 作ったパッドの音（AudioBuffer）。最初に音を鳴らすときに作る

// 1つのパッドの音を作る：計算 → フィルター → 大きさをそろえる
function makeBuffer(dur, gen, hp, lp) {
  const sr = audio.sampleRate;
  const buf = audio.createBuffer(1, Math.ceil(dur * sr), sr);
  const data = buf.getChannelData(0);
  const f = gen({ ph: 0 });
  for (let i = 0; i < data.length; i++) data[i] = f(i / sr, i, sr);
  if (hp) highpass(data, hp, sr);
  if (lp) lowpass(data, lp, sr);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  const k = peak > 0 ? 0.9 / peak : 1;
  const fade = Math.min(data.length, Math.round(0.01 * sr));   // 最後をなめらかに消す（プツッとならないように）
  for (let i = 0; i < data.length; i++) {
    data[i] *= k;
    if (i >= data.length - fade) data[i] *= (data.length - i) / fade;
  }
  return buf;
}

// そのトラックのパッドの音（自分で読み込んだ音があればそちら）
// 読み込んだ自分の音：sid（目印）→ { buffer：音, data：元のファイル（文字にしたもの）, name }
// トラックには { sid, name } だけを書く（元に戻す・保存のときに、重い音そのものを何度も持たないため）
const SAMPLES = {};
let nextSampleId = 1;
const customSample = (track, pad) => (track.custom && track.custom[pad] && SAMPLES[track.custom[pad].sid]) || null;
const padName = (track, pad) => {
  if (isFx(track)) return FX_LIST[pad].name;
  if (customSample(track, pad)) return track.custom[pad].name;
  const src = track.pads && track.pads[pad] ? track.pads[pad].src : pad;   // ◀ ▶ でほかの用意した音にしたとき
  return (DRUM_PADS[src] || DRUM_PADS[pad]).name;
};

// ================================================
// FX（効果音）
// ================================================
// 置いた音の長さに合わせて鳴るもの（ライザーなど）と、決まった長さのもの（インパクトなど）がある
let FX_BUFFERS = {};
function makeFxBuffers() {
  FX_BUFFERS.impact = makeBuffer(2.6, (s) => (t, i, sr) =>
    Math.tanh(1.4 * sweep(s, t, 110, 34, 0.12, sr) * Math.exp(-t / 0.7)) * 0.9 + noise() * Math.exp(-t / 0.18) * 0.5, 0, 6000);
  FX_BUFFERS.subdrop = makeBuffer(2.2, (s) => (t, i, sr) => sweep(s, t, 95, 28, 0.5, sr) * Math.exp(-t / 0.9));
  // 逆再生シンバル：クラッシュの音を後ろから並べ直す
  const crash = DRUM_BUFFERS[5];
  const rev = audio.createBuffer(1, crash.length, crash.sampleRate);
  const a = crash.getChannelData(0), b = rev.getChannelData(0);
  for (let i = 0; i < a.length; i++) b[i] = a[a.length - 1 - i];
  FX_BUFFERS.reverse = rev;
  FX_BUFFERS.noise = makeBuffer(2, () => () => noise());
}

// バッファの音を鳴らす。endAt を渡すと、その時刻にちょうど鳴り終わるように始める（逆再生シンバル用）
function playBuffer(track, buf, velocity, time, endAt) {
  const src = audio.createBufferSource();
  src.buffer = buf;
  const g = audio.createGain();
  g.gain.value = 0.9 * (velocity / 127);
  src.connect(g).connect(busFor(track));
  if (endAt !== undefined) {
    const len = endAt - time;
    const offset = Math.max(0, buf.duration - len);
    src.start(time, offset);
  } else {
    src.start(time);
  }
  player.voices.push({ g, oscs: [src], end: time + buf.duration });
}

// 長さに合わせて鳴るノイズ（ライザー・ダウンリフター）
function playNoiseSweep(track, velocity, time, dur, up) {
  const src = audio.createBufferSource();
  src.buffer = FX_BUFFERS.noise;
  src.loop = true;
  const f = audio.createBiquadFilter();
  f.type = up ? "bandpass" : "lowpass";
  f.Q.value = up ? 1.2 : 0.7;
  f.frequency.setValueAtTime(up ? 300 : 12000, time);
  f.frequency.exponentialRampToValueAtTime(up ? 9000 : 250, time + dur);
  const g = audio.createGain();
  const v = 0.8 * (velocity / 127);
  g.gain.setValueAtTime(up ? 0.02 : v, time);
  g.gain.linearRampToValueAtTime(up ? v : 0.001, time + dur);
  g.gain.setTargetAtTime(0, time + dur, 0.02);
  src.connect(f).connect(g).connect(busFor(track));
  src.start(time);
  src.stop(time + dur + 0.2);
  player.voices.push({ g, oscs: [src], end: time + dur + 0.2 });
}

// 高さが上がっていくシンセ音（アップスウィープ）
function playSweep(track, velocity, time, dur) {
  const o = audio.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(150, time);
  o.frequency.exponentialRampToValueAtTime(2400, time + dur);
  const f = audio.createBiquadFilter();
  f.frequency.setValueAtTime(600, time);
  f.frequency.exponentialRampToValueAtTime(8000, time + dur);
  const g = audio.createGain();
  g.gain.setValueAtTime(0.01, time);
  g.gain.linearRampToValueAtTime(0.35 * (velocity / 127), time + dur);
  g.gain.setTargetAtTime(0, time + dur, 0.03);
  o.connect(f).connect(g).connect(busFor(track));
  o.start(time);
  o.stop(time + dur + 0.3);
  player.voices.push({ g, oscs: [o], end: time + dur + 0.3 });
}

// キラキラ：置いた長さの間、スケールの高い音を16分ごとにランダムに鳴らす
function playSparkle(track, velocity, time, dur) {
  const pcs = scalePcs();
  const step = unitSec() * 3;
  const count = Math.max(1, Math.min(48, Math.round(dur / step)));
  for (let k = 0; k < count; k++) {
    const t = time + k * step;
    const pitch = 84 + pcs[Math.floor(Math.random() * pcs.length)] + (Math.random() < 0.4 ? 12 : 0);
    const f = midiToFreq(pitch);
    const g = audio.createGain();
    const v = 0.18 * (velocity / 127) * (0.5 + Math.random() * 0.5);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, 0.12);
    const pan = audio.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    g.connect(pan).connect(busFor(track));
    const oscs = [1, 2.76].map((m, j) => {
      const o = audio.createOscillator();
      o.frequency.value = f * m;
      const og = audio.createGain();
      og.gain.value = j ? 0.3 : 1;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 0.8);
      return o;
    });
    player.voices.push({ g, oscs, end: t + 0.8 });
  }
}

// FX の一覧。fit：置いた音の長さに合わせて鳴るか
const FX_LIST = [
  { name: "インパクト", memo: "「ドーン」。サビやドロップの頭に", play: (tr, v, t) => playBuffer(tr, FX_BUFFERS.impact, v, t) },
  { name: "クラッシュ", memo: "「シャーン」。区切りの頭に", play: (tr, v, t) => playBuffer(tr, DRUM_BUFFERS[5], v, t) },
  { name: "逆シンバル", memo: "「フワァッ」と吸い込む。音の終わりが次の頭に来るように置く", fit: true, play: (tr, v, t, d) => playBuffer(tr, FX_BUFFERS.reverse, v, t, t + d) },
  { name: "ライザー", memo: "「シュワー」と上がる。盛り上がる前の1〜2小節に長く置く", fit: true, play: (tr, v, t, d) => playNoiseSweep(tr, v, t, d, true) },
  { name: "ダウンリフター", memo: "「シュー」と下がる。サビの頭から1〜2小節に長く置く", fit: true, play: (tr, v, t, d) => playNoiseSweep(tr, v, t, d, false) },
  { name: "アップスウィープ", memo: "「ヒューン」と高さが上がる。ライザーと重ねても", fit: true, play: (tr, v, t, d) => playSweep(tr, v, t, d) },
  { name: "キラキラ", memo: "置いた長さの間、高い音がキラキラ鳴る", fit: true, play: (tr, v, t, d) => playSparkle(tr, v, t, d) },
  { name: "サブドロップ", memo: "「ブゥーン」と低く沈む。ドロップの頭に", play: (tr, v, t) => playBuffer(tr, FX_BUFFERS.subdrop, v, t) }
];
function playFx(track, i, velocity, time, durSec) {
  const fx = FX_LIST[i];
  if (fx) fx.play(track, velocity, time, Math.max(0.1, durSec));
}

// パッドを鳴らす（playDrum・playPad）は sampler.js

// リズムの型（1小節分）。[パッドの番号, 位置（48分単位）] の並び。1拍 = 12、8分 = 6、16分 = 3
const BEATS = [];
for (let b = 0; b < 4; b++) BEATS.push(b * 12);
const DRUM_PATTERNS = [
  { name: "四つ打ち", hits: [...BEATS.map((t) => [0, t]), [2, 12], [2, 36], ...BEATS.map((t) => [4, t + 6])] },
  { name: "8ビート", hits: [[0, 0], [0, 24], [0, 30], [1, 12], [1, 36], ...[0, 6, 12, 18, 24, 30, 36, 42].map((t) => [3, t])] },
  { name: "16ビート", hits: [[0, 0], [0, 18], [0, 24], [1, 12], [1, 36], ...Array.from({ length: 16 }, (_, k) => [3, k * 3])] },
  { name: "ハーフタイム", hits: [[0, 0], [0, 30], [1, 24], ...[0, 6, 12, 18, 24, 30, 36, 42].map((t) => [3, t])] }
];

// 型を、編集中のドラムトラックの8小節全部に入れる（今ある音は置きかえる。Ctrl＋Z で戻せる）
function insertDrumPattern(k) {
  const track = state.tracks[state.current];
  if (!isDrum(track)) return;
  pushHistory();
  const notes = [];
  for (let bar = 0; bar < 8; bar++) {
    for (const [pad, t] of DRUM_PATTERNS[k].hits) notes.push({ pitch: pad, start: bar * BAR + t, length: 3, velocity: pad === 3 || pad === 4 ? 80 : 110 });
  }
  track.notes = notes;
  state.selected.clear();
  render();
}

// 音を置いたり動かしたりしたとき、その高さを、編集中のトラックの音色で短く鳴らして確かめる
function preview(pitch) {
  initAudio();
  audio.resume();
  const track = state.tracks[state.current];
  const now = audio.currentTime;
  if (isDrum(track)) playDrum(track, pitch, 110, now);
  else if (isFx(track)) playFx(track, pitch, 110, now, BAR * unitSec());
  else playTrackNote(track, pitch, 6, 100, now);
}

// 楽器トラックの1音（音色が「シンセ」なら自分で作った音、それ以外は用意した音色）
function playTrackNote(track, pitch, lengthUnits, velocity, time, durSec) {
  if (track.instrument === "synth" && track.synth) { playSynth(track, pitch, lengthUnits, velocity, time, durSec); return; }
  // 「サンプラー：ドラムの名前」：そのドラムトラックのパッドを、MIDI ノートとして鳴らす（Pitch・Slice のパッド向け）
  if (String(track.instrument).startsWith("pads:")) {
    const dt = state.tracks.find((t) => t.id === track.instrument.slice(5) && isDrum(t));
    if (dt) { samplerNote(dt, pitch, velocity, time, durSec !== undefined ? durSec : lengthUnits * unitSec()); return; }
  }
  playNote(pitch, lengthUnits, velocity, time, durSec, track.instrument, busFor(track));
}

// ループする範囲（48分単位）
const loopStart = () => state.loop[0] * BAR;
const loopEnd = () => state.loop[1] * BAR;

// 1つの位置（48分単位）に置いてある音を、time 秒に予約する
function scheduleUnit(unit, t) {
  for (const track of state.tracks) {
    if (!isAudible(track)) continue;
    for (const n of track.notes) {
      if (n.start !== unit) continue;
      if (isDrum(track)) playDrum(track, n.pitch, n.velocity, t, n.length * unitSec());
      else if (isFx(track)) playFx(track, n.pitch, n.velocity, t, n.length * unitSec());
      else playTrackNote(track, n.pitch, n.length, n.velocity, t);
    }
  }
}

// メトロノームの「カッ」。小節の頭は高く
function playClick(t, accent) {
  const o = audio.createOscillator();
  o.frequency.value = accent ? 1760 : 1100;
  const g = audio.createGain();
  g.gain.setValueAtTime(accent ? 0.5 : 0.3, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  o.connect(g).connect(audio.destination);   // トラックの音量・ミュートとは関係なく鳴らす
  o.start(t);
  o.stop(t + 0.06);
  player.voices.push({ g, oscs: [o], end: t + 0.06 });
}

// 少し先（0.1秒ぶん）までの音を予約しておく。25ミリ秒ごとに呼ばれる
function schedule() {
  const until = audio.currentTime + 0.1;
  while (true) {
    // ループの終わりまで来たら、ループの頭に戻る（範囲を変えて外に出たときも頭へ）
    if (player.nextUnit >= loopEnd() || player.nextUnit < loopStart()) {
      const next = player.startTime + player.nextUnit * unitSec();
      player.startTime = next - loopStart() * unitSec();
      player.nextUnit = loopStart();
    }
    const t = player.startTime + player.nextUnit * unitSec();
    if (t > until) break;
    scheduleUnit(player.nextUnit, t);
    if (state.metronome && player.nextUnit % 12 === 0) playClick(t, player.nextUnit % BAR === 0);
    player.nextUnit++;
  }
  player.voices = player.voices.filter((v) => v.end > audio.currentTime);   // 鳴り終わった音を片付ける
}

function startPlay() {
  initAudio();
  audio.resume();
  player.startTime = audio.currentTime + 0.05 - loopStart() * unitSec();
  player.nextUnit = loopStart();
  state.playing = true;
  resyncSynths(player.startTime + loopStart() * unitSec());   // ウォブルの揺れを小節の頭にそろえる
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
      v.oscs.forEach((o) => { try { o.stop(audio.currentTime + 0.1); } catch (err) { /* もう止まっている */ } });
    }
    for (const t of state.tracks) {         // ダッキングで下げたままにならないように戻す
      const b = buses.get(t);
      if (b) { b.duck.gain.cancelScheduledValues(audio.currentTime); b.duck.gain.setTargetAtTime(1, audio.currentTime, 0.02); }
    }
  }
  player.voices = [];
  render();
}

// 再生中、毎フレーム再生位置の線を動かす
function tick() {
  if (!state.playing) return;
  let pos = (audio.currentTime - player.startTime) / unitSec();
  if (pos < loopStart()) pos += loopEnd() - loopStart();   // ループで頭に戻った直後
  player.pos = Math.max(0, pos);
  // 線が画面の右に出たら追いかける（ドラッグ中は勝手に動かさない）
  const visible = (W - KEY_W) / view.unitW;
  if (!drag && (player.pos > view.x + visible || player.pos < view.x)) view.x = player.pos;
  clampView();
  drawRoll();
  requestAnimationFrame(tick);
}
