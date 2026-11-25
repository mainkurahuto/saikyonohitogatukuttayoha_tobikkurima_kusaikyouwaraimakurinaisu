// ================================================
// シンセ（Vital をまねた、かんたんなシンセサイザー）
// オシレーター3つ ＋ ノイズ → ADSR → エフェクト9個（並びは固定） → トラックの音量
// main.js より先に読み込む。中で使っている audio・busFor・state などは main.js にある
// ================================================

const WAVES = { sine: "サイン", triangle: "三角", sawtooth: "ノコギリ", square: "矩形" };
const WOBBLE_RATES = { "1/2": 2, "1/4": 1, "1/8": 0.5, "1/8T": 1 / 3, "1/16": 0.25 };   // 何拍で1回揺れるか
const DELAY_TIMES = { "1/16": 0.25, "1/8": 0.5, "付点1/8": 0.75, "1/4": 1 };              // 何拍あとに返ってくるか
const FX_ORDER = ["chorus", "compressor", "delay", "distortion", "eq", "filter", "flanger", "phaser", "reverb"];
const FX_NAMES = {
  chorus: "Chorus", compressor: "Compressor", delay: "Delay", distortion: "Distortion", eq: "EQ",
  filter: "Filter", flanger: "Flanger", phaser: "Phaser", reverb: "Reverb"
};

// 新しいシンセの最初の設定（ノコギリ波1つだけ）
function defaultSynth() {
  const osc = (on, wave, level) => ({ on, wave, pitch: 0, fine: 0, level, unison: 1, detune: 20, pan: 0 });
  return {
    preset: "init",
    osc: [osc(true, "sawtooth", 70), osc(false, "square", 50), osc(false, "sine", 50)],
    noise: { on: false, level: 20 },
    env: { a: 10, d: 300, s: 70, r: 200 },   // a・d・r はミリ秒、s は 0〜100
    volume: 80,
    wobble: { on: false, rate: "1/8", depth: 60, shape: "sine" },
    fx: {
      chorus:     { on: false, depth: 50, mix: 50 },
      compressor: { on: false, amount: 50, gain: 30 },
      delay:      { on: false, time: "付点1/8", feedback: 35, mix: 30 },
      distortion: { on: false, drive: 40, mix: 60 },
      eq:         { on: false, low: 0, mid: 0, high: 0 },
      filter:     { on: false, type: "lowpass", cutoff: 70, reso: 20 },
      flanger:    { on: false, depth: 50, rate: 30, mix: 50 },
      phaser:     { on: false, depth: 60, rate: 30, mix: 50 },
      reverb:     { on: false, size: 50, mix: 30 }
    }
  };
}

// プリセット：最初の設定から変えるところだけ書く
const SYNTH_PRESETS = {
  init: { name: "最初の音（ノコギリ波1つ）", set: () => {} },
  supersaw: { name: "スーパーソー", set: (p) => {
    Object.assign(p.osc[0], { wave: "sawtooth", unison: 7, detune: 35, level: 70 });
    Object.assign(p.osc[1], { on: true, wave: "sawtooth", pitch: 12, unison: 5, detune: 30, level: 35 });
    Object.assign(p.env, { a: 10, d: 400, s: 80, r: 300 });
    Object.assign(p.fx.reverb, { on: true, size: 55, mix: 25 });
    Object.assign(p.fx.chorus, { on: true, depth: 40, mix: 30 });
  } },
  pad: { name: "パッド", set: (p) => {
    Object.assign(p.osc[0], { wave: "sawtooth", unison: 4, detune: 25, level: 55 });
    Object.assign(p.osc[1], { on: true, wave: "triangle", pitch: 12, level: 40 });
    Object.assign(p.env, { a: 600, d: 800, s: 80, r: 900 });
    Object.assign(p.fx.filter, { on: true, cutoff: 55, reso: 10 });
    Object.assign(p.fx.reverb, { on: true, size: 80, mix: 45 });
  } },
  pluck: { name: "プラック", set: (p) => {
    Object.assign(p.osc[0], { wave: "sawtooth", unison: 3, detune: 15, level: 70 });
    Object.assign(p.osc[1], { on: true, wave: "square", pitch: 12, level: 25 });
    Object.assign(p.env, { a: 2, d: 220, s: 0, r: 150 });
    Object.assign(p.fx.filter, { on: true, cutoff: 62, reso: 15 });
    Object.assign(p.fx.delay, { on: true, time: "付点1/8", feedback: 30, mix: 25 });
    Object.assign(p.fx.reverb, { on: true, size: 45, mix: 20 });
  } },
  lead: { name: "リード", set: (p) => {
    Object.assign(p.osc[0], { wave: "sawtooth", unison: 2, detune: 12, level: 65 });
    Object.assign(p.osc[1], { on: true, wave: "square", fine: 8, level: 40 });
    Object.assign(p.env, { a: 8, d: 200, s: 75, r: 120 });
    Object.assign(p.fx.filter, { on: true, cutoff: 80, reso: 15 });
    Object.assign(p.fx.delay, { on: true, time: "1/8", feedback: 25, mix: 20 });
  } },
  bass: { name: "ベース", set: (p) => {
    Object.assign(p.osc[0], { wave: "sawtooth", level: 60 });
    Object.assign(p.osc[1], { on: true, wave: "square", pitch: -12, level: 35 });
    Object.assign(p.env, { a: 5, d: 250, s: 70, r: 80 });
    Object.assign(p.fx.filter, { on: true, cutoff: 45, reso: 15 });
  } },
  subbass: { name: "ベース＋サブベース", set: (p) => {
    Object.assign(p.osc[0], { wave: "sawtooth", level: 50 });
    Object.assign(p.osc[2], { on: true, wave: "sine", pitch: -12, level: 80 });
    Object.assign(p.env, { a: 5, d: 250, s: 80, r: 80 });
    Object.assign(p.fx.filter, { on: true, cutoff: 50, reso: 10 });
  } },
  wobble: { name: "ウォブルベース", set: (p) => {
    Object.assign(p.osc[0], { wave: "sawtooth", unison: 3, detune: 20, level: 45 });
    Object.assign(p.osc[1], { on: true, wave: "square", pitch: -12, level: 35 });
    Object.assign(p.osc[2], { on: true, wave: "sine", pitch: -12, level: 50 });
    Object.assign(p.env, { a: 5, d: 300, s: 90, r: 80 });
    Object.assign(p.fx.filter, { on: true, cutoff: 15, reso: 45 });
    Object.assign(p.wobble, { on: true, rate: "1/8", depth: 70, shape: "sine" });
    Object.assign(p.fx.distortion, { on: true, drive: 35, mix: 40 });
  } }
};

function applyPreset(track, key) {
  const p = defaultSynth();
  SYNTH_PRESETS[key].set(p);
  p.preset = key;
  track.synth = p;
  const ch = synthChains.get(track);
  if (ch) ch.update(p, true);
}

// ---------- 数字の変換 ----------
const cutoffHz = (v) => 30 * Math.pow(18000 / 30, v / 100);   // 0〜100 → 30Hz〜18kHz（耳の感じ方に合わせて、指数で変える）
const beatSec = () => 60 / state.bpm;

// ---------- エフェクト1つぶんの箱 ----------
// in → (dry) → out と、in → 中身 → (wet) → out の2本。ON/OFF と混ぜる量は dry・wet の大きさで決める
function fxBox(build) {
  const box = { in: audio.createGain(), out: audio.createGain(), dry: audio.createGain(), wet: audio.createGain() };
  box.in.connect(box.dry).connect(box.out);
  const inner = build(box.in);
  inner.connect(box.wet).connect(box.out);
  box.mix = (on, amount) => {
    const t = audio.currentTime;
    box.dry.gain.setTargetAtTime(on ? 1 - amount : 1, t, 0.02);
    box.wet.gain.setTargetAtTime(on ? amount : 0, t, 0.02);
  };
  box.mix(false, 0);
  return box;
}

// ゆっくり揺らす波（LFO）
function lfo(freq, amount, target) {
  const o = audio.createOscillator();
  o.frequency.value = freq;
  const g = audio.createGain();
  g.gain.value = amount;
  o.connect(g).connect(target);
  o.start();
  return { o, g };
}

// リバーブの響き（ノイズがだんだん消えていく音）を作る
function makeImpulse(seconds) {
  const sr = audio.sampleRate;
  const len = Math.max(1, Math.floor(seconds * sr));
  const buf = audio.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

// 歪みのカーブ（大きい音ほどつぶれる）
const distK = (drive) => 1 + drive * 0.4;
function distCurve(drive) {
  const k = distK(drive);
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x); }
  return c;
}

// ---------- トラック1つぶんのエフェクトの列 ----------
const synthChains = new WeakMap();

function chainFor(track) {
  let ch = synthChains.get(track);
  if (!ch) { ch = makeChain(track); synthChains.set(track, ch); }
  return ch;
}

function makeChain(track) {
  const ch = { input: audio.createGain(), boxes: {}, vol: audio.createGain() };
  const B = ch.boxes;

  B.chorus = fxBox((input) => {
    const d = audio.createDelay(0.1);
    d.delayTime.value = 0.025;
    input.connect(d);
    ch.chorusLfo = lfo(0.8, 0.004, d.delayTime);
    return d;
  });
  B.compressor = fxBox((input) => {
    const c = audio.createDynamicsCompressor();
    const g = audio.createGain();
    input.connect(c).connect(g);
    ch.comp = c; ch.compGain = g;
    return g;
  });
  B.delay = fxBox((input) => {
    const d = audio.createDelay(3);
    const fb = audio.createGain();
    input.connect(d);
    d.connect(fb).connect(d);   // 返ってきた音を、もう一度入れる（くり返し）
    ch.delay = d; ch.delayFb = fb;
    return d;
  });
  B.distortion = fxBox((input) => {
    const ws = audio.createWaveShaper();
    ws.oversample = "2x";
    const g = audio.createGain();
    input.connect(ws).connect(g);
    ch.shaper = ws;
    ch.distGain = g;   // 歪ませると音が大きくなるので、その分を下げる
    return g;
  });
  B.eq = fxBox((input) => {
    const lo = audio.createBiquadFilter(), mid = audio.createBiquadFilter(), hi = audio.createBiquadFilter();
    lo.type = "lowshelf"; lo.frequency.value = 250;
    mid.type = "peaking"; mid.frequency.value = 1200; mid.Q.value = 0.9;
    hi.type = "highshelf"; hi.frequency.value = 5000;
    input.connect(lo).connect(mid).connect(hi);
    ch.eq = { lo, mid, hi };
    return hi;
  });
  B.filter = fxBox((input) => {
    const f = audio.createBiquadFilter();
    input.connect(f);
    ch.filter = f;
    ch.wobGain = audio.createGain();   // ウォブル：LFO → この大きさ → カットオフ
    ch.wobGain.gain.value = 0;
    ch.wobGain.connect(f.frequency);
    return f;
  });
  B.flanger = fxBox((input) => {
    const d = audio.createDelay(0.05);
    d.delayTime.value = 0.004;
    const fb = audio.createGain();
    fb.gain.value = 0.55;
    input.connect(d);
    d.connect(fb).connect(d);
    ch.flangerLfo = lfo(0.3, 0.002, d.delayTime);
    return d;
  });
  B.phaser = fxBox((input) => {
    let node = input;
    ch.phaserLfo = { o: audio.createOscillator(), g: audio.createGain() };
    ch.phaserLfo.o.connect(ch.phaserLfo.g);
    for (let i = 0; i < 4; i++) {
      const ap = audio.createBiquadFilter();
      ap.type = "allpass";
      ap.frequency.value = 900 + i * 300;
      ch.phaserLfo.g.connect(ap.frequency);
      node.connect(ap);
      node = ap;
    }
    ch.phaserLfo.o.start();
    return node;
  });
  B.reverb = fxBox((input) => {
    const cv = audio.createConvolver();
    input.connect(cv);
    ch.convolver = cv;
    return cv;
  });

  // 画像と同じ並びでつなぐ：入口 → Chorus → … → Reverb → シンセの音量 → トラックの音量
  let node = ch.input;
  for (const k of FX_ORDER) { node.connect(B[k].in); node = B[k].out; }
  node.connect(ch.vol).connect(busFor(track));

  ch.reverbSize = -1;
  ch.update = (p, force) => updateChain(ch, p, force);
  ch.update(track.synth, true);
  return ch;
}

// 設定の数字を、音の部品に反映する
function updateChain(ch, p, force) {
  const t = audio.currentTime;
  const set = (param, v) => param.setTargetAtTime(v, t, 0.02);
  const fx = p.fx;
  const B = ch.boxes;
  set(ch.vol.gain, p.volume / 80);

  B.chorus.mix(fx.chorus.on, fx.chorus.mix / 100);
  set(ch.chorusLfo.g.gain, 0.0005 + (fx.chorus.depth / 100) * 0.008);

  B.compressor.mix(fx.compressor.on, 1);
  set(ch.comp.threshold, -fx.compressor.amount * 0.5);    // 強いほど小さい音から押さえる
  set(ch.comp.ratio, 2 + fx.compressor.amount * 0.14);
  set(ch.compGain.gain, Math.pow(10, (fx.compressor.gain * 0.18) / 20));   // 押さえた分を持ち上げる（0〜18dB）

  B.delay.mix(fx.delay.on, fx.delay.mix / 100);
  set(ch.delay.delayTime, DELAY_TIMES[fx.delay.time] * beatSec());
  set(ch.delayFb.gain, (fx.delay.feedback / 100) * 0.85);

  B.distortion.mix(fx.distortion.on, fx.distortion.mix / 100);
  if (force || ch.lastDrive !== fx.distortion.drive) { ch.shaper.curve = distCurve(fx.distortion.drive); ch.lastDrive = fx.distortion.drive; }
  set(ch.distGain.gain, 1 / Math.pow(distK(fx.distortion.drive), 0.8));

  B.eq.mix(fx.eq.on, 1);
  set(ch.eq.lo.gain, fx.eq.low);
  set(ch.eq.mid.gain, fx.eq.mid);
  set(ch.eq.hi.gain, fx.eq.high);

  // フィルター（ウォブルが ON なら、カットオフをテンポに合わせて揺らす）
  B.filter.mix(fx.filter.on, 1);
  ch.filter.type = fx.filter.type;
  const base = cutoffHz(fx.filter.cutoff);
  const w = p.wobble;
  if (w.on && fx.filter.on) {
    const range = Math.min(16000, base * (1 + (w.depth / 100) * 15));   // 一番開いたときのカットオフ
    set(ch.filter.frequency, (base + range) / 2);
    set(ch.wobGain.gain, ((range - base) / 2) * (w.shape === "saw" ? -1 : 1));   // ノコギリは「開いてからガクッと閉じる」向きにする
    setWobble(ch, w);
  } else {
    set(ch.filter.frequency, base);
    set(ch.wobGain.gain, 0);
  }
  set(ch.filter.Q, 0.5 + (fx.filter.reso / 100) * 18);

  B.flanger.mix(fx.flanger.on, fx.flanger.mix / 100);
  set(ch.flangerLfo.o.frequency, 0.05 + (fx.flanger.rate / 100) * 2);
  set(ch.flangerLfo.g.gain, (fx.flanger.depth / 100) * 0.0035);

  B.phaser.mix(fx.phaser.on, fx.phaser.mix / 100);
  set(ch.phaserLfo.o.frequency, 0.05 + (fx.phaser.rate / 100) * 3);
  set(ch.phaserLfo.g.gain, (fx.phaser.depth / 100) * 800);

  B.reverb.mix(fx.reverb.on, fx.reverb.mix / 100);
  if (force || ch.reverbSize !== fx.reverb.size) {   // 響きを作り直すのは、広さが変わったときだけ
    ch.convolver.buffer = makeImpulse(0.3 + (fx.reverb.size / 100) * 3.7);
    ch.reverbSize = fx.reverb.size;
  }
}

// ウォブルの LFO（形・速さが変わったら作り直す）
function setWobble(ch, w, startAt) {
  const freq = 1 / (WOBBLE_RATES[w.rate] * beatSec());
  const type = w.shape === "saw" ? "sawtooth" : "sine";
  if (!ch.wob || ch.wob.type !== type || startAt !== undefined) {
    if (ch.wob) ch.wob.stop();
    ch.wob = audio.createOscillator();
    ch.wob.type = type;
    ch.wob.connect(ch.wobGain);
    ch.wob.start(startAt || 0);
  }
  ch.wob.frequency.setTargetAtTime(freq, audio.currentTime, 0.01);
}

// 再生の頭で、ウォブルの揺れを小節の頭にそろえる
function resyncSynths(time) {
  for (const t of state.tracks) {
    const ch = synthChains.get(t);
    if (ch && t.synth) {
      ch.update(t.synth);
      if (t.synth.wobble.on && t.synth.fx.filter.on) setWobble(ch, t.synth.wobble, time);
    }
  }
}

// ---------- 1音を鳴らす ----------
let noiseBuf = null;
function playSynth(track, pitch, lengthUnits, velocity, time, durSec) {
  const p = track.synth;
  const ch = chainFor(track);
  const e = p.env;
  const A = Math.max(0.002, e.a / 1000), D = Math.max(0.005, e.d / 1000), S = e.s / 100, R = Math.max(0.01, e.r / 1000);
  const dur = Math.max(A + 0.01, durSec !== undefined ? durSec : lengthUnits * unitSec());
  const peak = 0.8 * (velocity / 127);

  const g = audio.createGain();   // ADSR
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + A);
  g.gain.setTargetAtTime(peak * S, time + A, D / 3);
  g.gain.setTargetAtTime(0, time + dur, R / 3);
  g.connect(ch.input);
  const end = time + dur + R * 3 + 0.05;

  const srcs = [];
  for (const o of p.osc) {
    if (!o.on || o.level <= 0) continue;
    const n = Math.max(1, Math.min(8, o.unison));
    const f = midiToFreq(pitch + o.pitch);
    for (let u = 0; u < n; u++) {
      const spread = n === 1 ? 0 : u / (n - 1) - 0.5;   // -0.5 〜 0.5
      const osc = audio.createOscillator();
      osc.type = o.wave;
      osc.frequency.value = f;
      osc.detune.value = o.fine + spread * 2 * o.detune;
      const og = audio.createGain();
      og.gain.value = (o.level / 100) / Math.sqrt(n);
      const pan = audio.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, o.pan / 100 + spread * (n > 1 ? 1.2 : 0)));
      osc.connect(og).connect(pan).connect(g);
      osc.start(time);
      osc.stop(end);
      srcs.push(osc);
    }
  }
  if (p.noise.on && p.noise.level > 0) {
    if (!noiseBuf) {
      noiseBuf = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const ns = audio.createBufferSource();
    ns.buffer = noiseBuf;
    ns.loop = true;
    const ng = audio.createGain();
    ng.gain.value = (p.noise.level / 100) * 0.5;
    ns.connect(ng).connect(g);
    ns.start(time);
    ns.stop(end);
    srcs.push(ns);
  }
  player.voices.push({ g, oscs: srcs, end });
}

// ================================================
// シンセの編集画面
// ================================================
// 1つのつまみ：[ラベル, 設定の場所, 最小, 最大, 単位]
const OSC_KNOBS = [["Pitch", "pitch", -48, 48, "半音"], ["Fine", "fine", -100, 100, "セント"], ["Level", "level", 0, 100, ""],
                   ["Unison", "unison", 1, 8, "枚"], ["Detune", "detune", 0, 100, "セント"], ["Pan", "pan", -100, 100, ""]];
const FX_KNOBS = {
  chorus:     [["深さ", "depth", 0, 100], ["混ぜる量", "mix", 0, 100]],
  compressor: [["強さ", "amount", 0, 100], ["持ち上げ", "gain", 0, 100]],
  delay:      [["間隔", "time", DELAY_TIMES], ["くり返し", "feedback", 0, 100], ["混ぜる量", "mix", 0, 100]],
  distortion: [["歪み", "drive", 0, 100], ["混ぜる量", "mix", 0, 100]],
  eq:         [["低音", "low", -12, 12, "dB"], ["中音", "mid", -12, 12, "dB"], ["高音", "high", -12, 12, "dB"]],
  filter:     [["種類", "type", { lowpass: "ローパス（高い音を削る）", highpass: "ハイパス（低い音を削る）" }], ["カットオフ", "cutoff", 0, 100], ["レゾナンス", "reso", 0, 100]],
  flanger:    [["深さ", "depth", 0, 100], ["速さ", "rate", 0, 100], ["混ぜる量", "mix", 0, 100]],
  phaser:     [["深さ", "depth", 0, 100], ["速さ", "rate", 0, 100], ["混ぜる量", "mix", 0, 100]],
  reverb:     [["広さ", "size", 0, 100], ["混ぜる量", "mix", 0, 100]]
};

// つまみか選択欄の HTML。path は設定の場所（"osc.0.pitch" など）
// min が {…} なら選択欄、数字ならつまみ（上下にドラッグ・ホイールで回す。ダブルクリックで最初の値に戻る）
function knobHtml(label, path, value, min, max, unit) {
  if (typeof min === "object") {
    const opts = Object.keys(min).map((k) => '<option value="' + k + '"' + (k === value ? " selected" : "") + ">" + (typeof min[k] === "string" ? min[k] : k) + "</option>").join("");
    return '<label class="sel-row"><span>' + label + '</span><select data-path="' + path + '">' + opts + "</select></label>";
  }
  return '<div class="knob"><span class="knob-label">' + label + "</span>" +
    '<div class="dial" role="slider" tabindex="0" data-path="' + path + '" data-min="' + min + '" data-max="' + max + '" data-unit="' + (unit || "") + '"' +
    ' aria-label="' + label + '" aria-valuemin="' + min + '" aria-valuemax="' + max + '" aria-valuenow="' + value + '">' + dialSvg(value, min, max) + "</div>" +
    '<output>' + value + (unit ? "<small>" + unit + "</small>" : "") + "</output></div>";
}

// つまみの絵：下の左（-135°）から右（+135°）まで回る。マイナスがあるつまみは、真上（0）から色がつく
function dialSvg(value, min, max) {
  const ang = (v) => -135 + ((v - min) / (max - min)) * 270;
  const pt = (a, r) => [20 + r * Math.sin((a * Math.PI) / 180), 20 - r * Math.cos((a * Math.PI) / 180)];
  const arc = (a1, a2, r) => {
    const [x1, y1] = pt(a1, r), [x2, y2] = pt(a2, r);
    return "M" + x1.toFixed(2) + " " + y1.toFixed(2) + " A" + r + " " + r + " 0 " + (Math.abs(a2 - a1) > 180 ? 1 : 0) + " " + (a2 > a1 ? 1 : 0) + " " + x2.toFixed(2) + " " + y2.toFixed(2);
  };
  const a = ang(value);
  const from = min < 0 ? ang(0) : -135;
  const [px, py] = pt(a, 11);
  return '<svg viewBox="0 0 40 40" aria-hidden="true">' +
    '<path class="dial-track" d="' + arc(-135, 135, 16) + '"/>' +
    (Math.abs(a - from) > 0.5 ? '<path class="dial-val" d="' + arc(Math.min(from, a), Math.max(from, a), 16) + '"/>' : "") +
    '<circle class="dial-knob" cx="20" cy="20" r="12"/>' +
    '<line class="dial-pointer" x1="20" y1="20" x2="' + px.toFixed(2) + '" y2="' + py.toFixed(2) + '"/></svg>';
}

// 1枚のカードの中身：選択欄は上に並べ、つまみは横に並べる
function controls(items) {
  const sels = items.filter((x) => typeof x[2] === "object").map((x) => knobHtml(x[0], x[1], x[4], x[2]));
  const dials = items.filter((x) => typeof x[2] !== "object").map((x) => knobHtml(x[0], x[1], x[4], x[2], x[3], x[5]));
  return sels.join("") + (dials.length ? '<div class="dials">' + dials.join("") + "</div>" : "");
}

const onHtml = (path, on) => '<label class="sw"><input type="checkbox" data-path="' + path + '"' + (on ? " checked" : "") + "><span>ON</span></label>";

// 波の形の小さな絵
function waveSvg(wave) {
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const x = i / 40, ph = (x * 2) % 1;
    let y = 0;
    if (wave === "sine") y = Math.sin(ph * 2 * Math.PI);
    if (wave === "triangle") y = 1 - 4 * Math.abs(ph - 0.5);
    if (wave === "sawtooth") y = 1 - 2 * ph;
    if (wave === "square") y = ph < 0.5 ? 1 : -1;
    pts.push((x * 60).toFixed(1) + "," + (12 - y * 9).toFixed(1));
  }
  return '<svg class="wave" viewBox="0 0 60 24" aria-hidden="true"><polyline points="' + pts.join(" ") + '"/></svg>';
}

// ADSR の形の絵
function envSvg(e) {
  const total = e.a + e.d + 500 + e.r;
  const X = (ms) => (ms / total) * 200;
  const y = (v) => 48 - v * 42;
  const s = e.s / 100;
  const pts = [[0, y(0)], [X(e.a), y(1)], [X(e.a + e.d), y(s)], [X(e.a + e.d + 500), y(s)], [200, y(0)]];
  return '<svg class="env" viewBox="0 0 200 50" aria-hidden="true"><polyline points="' + pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ") + '"/></svg>';
}

function renderSynth() {
  const box = $("synth");
  const track = state.tracks[state.synthOpen];
  if (state.synthOpen === null || !track || track.instrument !== "synth") { box.hidden = true; state.synthOpen = null; return; }
  box.hidden = false;
  const p = track.synth;
  let html = '<div class="syn-head"><b>シンセ：' + esc(track.name) + "</b>" +
    '<label class="sel-row"><span>プリセット</span><select data-preset="1">' +
    Object.keys(SYNTH_PRESETS).map((k) => '<option value="' + k + '"' + (k === p.preset ? " selected" : "") + ">" + SYNTH_PRESETS[k].name + "</option>").join("") +
    "</select></label>" +
    '<button data-syn="test">▶ 試す</button>' +
    '<div class="dials">' + knobHtml("音量", "volume", p.volume, 0, 100) + "</div>" +
    '<div class="spacer"></div><button data-syn="close">閉じる</button></div>';

  html += '<div class="syn-grid">';
  p.osc.forEach((o, i) => {
    html += '<section class="syn-card' + (o.on ? "" : " off") + '"><div class="syn-title">' + onHtml("osc." + i + ".on", o.on) + "<b>OSC " + (i + 1) + "</b>" + waveSvg(o.wave) + "</div>" +
      controls([["波の形", "osc." + i + ".wave", WAVES, 0, o.wave], ...OSC_KNOBS.map(([l, k, mn, mx, u]) => [l, "osc." + i + "." + k, mn, mx, o[k], u])]) + "</section>";
  });
  html += '<section class="syn-card' + (p.noise.on ? "" : " off") + '"><div class="syn-title">' + onHtml("noise.on", p.noise.on) + "<b>NOISE</b></div>" +
    controls([["Level", "noise.level", 0, 100, p.noise.level]]) + '<p class="syn-note">ホワイトノイズ（「シャー」という音）</p></section>';
  html += '<section class="syn-card"><div class="syn-title"><b>ENVELOPE（ADSR）</b></div>' + envSvg(p.env) +
    controls([["Attack", "env.a", 0, 3000, p.env.a, "ms"], ["Decay", "env.d", 0, 3000, p.env.d, "ms"], ["Sustain", "env.s", 0, 100, p.env.s], ["Release", "env.r", 0, 3000, p.env.r, "ms"]]) + "</section>";
  html += '<section class="syn-card' + (p.wobble.on ? "" : " off") + '"><div class="syn-title">' + onHtml("wobble.on", p.wobble.on) + "<b>WOBBLE</b></div>" +
    controls([["速さ", "wobble.rate", WOBBLE_RATES, 0, p.wobble.rate], ["形", "wobble.shape", { sine: "なめらか（サイン）", saw: "ガクッと戻る（ノコギリ）" }, 0, p.wobble.shape], ["深さ", "wobble.depth", 0, 100, p.wobble.depth]]) +
    '<p class="syn-note">Filter のカットオフを、テンポに合わせて揺らします</p></section>';
  html += "</div>";

  html += '<p class="syn-h">EFFECTS<span>上から順番にかかります</span></p><div class="syn-fx">';
  for (const k of FX_ORDER) {
    const f = p.fx[k];
    html += '<section class="syn-card fx' + (f.on ? "" : " off") + '"><div class="syn-title">' + onHtml("fx." + k + ".on", f.on) + "<b>" + FX_NAMES[k] + "</b></div>" +
      controls(FX_KNOBS[k].map(([l, key, mn, mx, u]) => [l, "fx." + k + "." + key, mn, mx, f[key], u])) + "</section>";
  }
  html += "</div>";
  box.innerHTML = html;
}

// 設定の場所（"osc.0.pitch"）に値を書く
function setPath(obj, path, v) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  const last = keys[keys.length - 1];
  o[last] = typeof o[last] === "number" ? Number(v) : v;
}

function initSynthUI() {
  const box = $("synth");
  const track = () => state.tracks[state.synthOpen];
  // 値を設定に書いて、音に反映する
  const setValue = (path, v, t) => {
    setPath(t.synth, path, v);
    if (path === "wobble.on" && v) t.synth.fx.filter.on = true;   // ウォブルは Filter を使うので、一緒に ON にする
    initAudio();
    chainFor(t).update(t.synth);
  };

  // ---- つまみ ----
  // つまみの値を変えて、絵と数字だけ描き直す（全部作り直すとドラッグが切れるため）
  const turn = (dial, v) => {
    const t = track();
    if (!t) return;
    const min = Number(dial.dataset.min), max = Number(dial.dataset.max);
    v = Math.round(Math.min(max, Math.max(min, v)));
    if (v === Number(dial.getAttribute("aria-valuenow"))) return;
    dial.setAttribute("aria-valuenow", v);
    dial.innerHTML = dialSvg(v, min, max);
    const out = dial.nextElementSibling;
    out.innerHTML = v + (dial.dataset.unit ? "<small>" + dial.dataset.unit + "</small>" : "");
    setValue(dial.dataset.path, v, t);
    if (dial.dataset.path.startsWith("env.")) box.querySelector(".env").outerHTML = envSvg(t.synth.env);
  };
  let drag = null;
  box.addEventListener("pointerdown", (e) => {
    const dial = e.target.closest(".dial");
    if (!dial || e.button !== 0) return;
    e.preventDefault();
    dial.focus();
    dial.setPointerCapture(e.pointerId);
    drag = { dial, y: e.clientY, v: Number(dial.getAttribute("aria-valuenow")) };
  });
  box.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const range = Number(drag.dial.dataset.max) - Number(drag.dial.dataset.min);
    const px = e.shiftKey ? 600 : 150;   // 150px 動かすと端から端まで（Shift を押すと細かく）
    turn(drag.dial, drag.v + ((drag.y - e.clientY) / px) * range);
  });
  box.addEventListener("pointerup", () => { drag = null; });
  box.addEventListener("pointercancel", () => { drag = null; });
  box.addEventListener("wheel", (e) => {
    const dial = e.target.closest(".dial");
    if (!dial) return;
    e.preventDefault();
    const range = Number(dial.dataset.max) - Number(dial.dataset.min);
    const step = Math.max(1, Math.round(range / 100)) * (e.shiftKey ? 1 : 2);
    turn(dial, Number(dial.getAttribute("aria-valuenow")) + (e.deltaY < 0 ? step : -step));
  }, { passive: false });
  box.addEventListener("dblclick", (e) => {   // ダブルクリックで最初の値に戻す
    const dial = e.target.closest(".dial");
    if (!dial) return;
    const def = dial.dataset.path.split(".").reduce((o, k) => o[k], defaultSynth());
    turn(dial, def);
  });
  box.addEventListener("keydown", (e) => {   // 矢印キーで1ずつ（Shift で10ずつ）
    const dial = e.target.closest(".dial");
    if (!dial) return;
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    turn(dial, Number(dial.getAttribute("aria-valuenow")) + d * (e.shiftKey ? 10 : 1));
  });

  // ---- ON/OFF・選択欄・プリセット ----
  box.addEventListener("change", (e) => {
    const t = track();
    if (!t) return;
    initAudio();
    if (e.target.dataset.preset) { applyPreset(t, e.target.value); renderSynth(); testSynth(); return; }
    const path = e.target.dataset.path;
    if (!path) return;
    setValue(path, e.target.type === "checkbox" ? e.target.checked : e.target.value, t);
    renderSynth();
  });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-syn]");
    if (!b) return;
    if (b.dataset.syn === "close") { state.synthOpen = null; render(); }
    if (b.dataset.syn === "test") testSynth();
  });
}

// 試しに鳴らす（ベース系は低く、ほかはドミソ）
function testSynth() {
  const t = state.tracks[state.synthOpen];
  if (!t) return;
  initAudio();
  audio.resume();
  const now = audio.currentTime + 0.03;
  const low = ["bass", "subbass", "wobble"].includes(t.synth.preset);
  const pitches = low ? [36] : [60, 64, 67];
  for (const p of pitches) playSynth(t, p, 0, 100, now, low ? 1.6 : 1.0);
}
