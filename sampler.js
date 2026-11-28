// sampler.js：ドラムのパッドサンプラー（Speedrum Lite 風）
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）
//
// パッド1つごとに：音の切り取り（Start／End）・高さ・逆再生・ワンショット・チョーク・
// フィルター・歪み・EQ・コンプ・音量・パン・プレイモード（Drum／Pitch／Slice）・テンポ合わせ
// トラックごとに：サイドチェインの合図（どのノートでほかのトラックを下げるか）

// ================================================
// 設定
// ================================================
function defaultPad(i) {
  return {
    note: 36 + i,            // このパッドを鳴らす MIDI ノート（パッド1 = 36 … パッド16 = 51）
    src: i,                  // 用意した音の何番を使うか（◀ ▶ で切り替え。自分の音を読み込んだらそっちが優先）
    pitch: 0,                // 半音（±24）
    start: 0, end: 1000,     // 音のどこからどこまで鳴らすか（0〜1000 = 頭〜おしり）
    attack: 0, release: 30,  // ms
    reverse: false, oneShot: true, mono: false, choke: "0",
    volume: 0, pan: 0,       // dB、左右
    lowCut: 0, highCut: 100, reso: 0,
    drive: 0, distMix: 100,
    eqLow: 0, eqMid: 0, eqMidFreq: 1000, eqHigh: 0,
    thresh: 0, ratio: 1, cAttack: 10, cRelease: 150, makeup: 0,
    mode: "drum",            // "drum"：1つのキー／"pitch"：鍵盤で音程／"slice"：切り分けてキーに並べる
    root: 60, low: 60, high: 84,
    firstKey: 60, slices: [], sens: 50, even: "8",
    sync: "off", sampleBpm: 0
  };
}
const defaultSidechain = () => ({ notes: [36, 51], signal: "pulse", length: 120, level: 85 });

// パッドの設定を取り出す（古いデータで足りない所は最初の値で埋める）
function padParams(track, i) {
  if (!track.pads) track.pads = [];
  if (!track.pads[i]) track.pads[i] = defaultPad(i);
  const d = defaultPad(i);
  for (const k in d) if (track.pads[i][k] === undefined) track.pads[i][k] = d[k];
  return track.pads[i];
}
// ドラムトラックに、パッド16個とサイドチェインの設定を全部そろえる
function fillDrumTrack(track) {
  for (let i = 0; i < 16; i++) padParams(track, i);
  sidechainOf(track);
}
function sidechainOf(track) {
  if (!track.sc) track.sc = defaultSidechain();
  return track.sc;
}

// ================================================
// 音のもと
// ================================================
const reversed = new WeakMap();
function reverseBuffer(buf) {
  let r = reversed.get(buf);
  if (!r) {
    r = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const a = buf.getChannelData(c), b = r.getChannelData(c);
      for (let k = 0; k < a.length; k++) b[k] = a[a.length - 1 - k];
    }
    reversed.set(buf, r);
  }
  return r;
}

// 音程を変えずに長さだけ変える（重ねて足していく、かんたんなタイムストレッチ）
const stretched = new WeakMap();
function stretchBuffer(buf, ratio) {
  let m = stretched.get(buf);
  if (!m) { m = new Map(); stretched.set(buf, m); }
  const key = ratio.toFixed(3);
  if (m.has(key)) return m.get(key);
  const N = 2048, Hs = 512, Ha = Hs / ratio;
  const outLen = Math.max(N, Math.round(buf.length * ratio));
  const out = new AudioBuffer({ length: outLen, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  const win = new Float32Array(N);
  for (let k = 0; k < N; k++) win[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / N);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const a = buf.getChannelData(c), b = out.getChannelData(c);
    const norm = new Float32Array(outLen);
    for (let f = 0; f * Hs < outLen; f++) {
      const so = f * Hs, ao = Math.round(f * Ha);
      for (let k = 0; k < N && so + k < outLen; k++) {
        const x = ao + k < a.length ? a[ao + k] : 0;
        b[so + k] += x * win[k];
        norm[so + k] += win[k];
      }
    }
    for (let k = 0; k < outLen; k++) if (norm[k] > 1e-3) b[k] /= norm[k];
  }
  m.set(key, out);
  return out;
}

// パッドの音（自分の音 → なければ用意した音）
function padSource(track, i) {
  const s = customSample(track, i);
  if (s) return s.buffer;
  const p = padParams(track, i);
  return DRUM_BUFFERS ? DRUM_BUFFERS[p.src] || DRUM_BUFFERS[i] : null;
}

// ================================================
// パッドごとのエフェクトの列（HPF → LPF → EQ → Distortion → Compressor → Volume/Pan）
// ================================================
let padChains = new WeakMap();   // トラック → 16個の列（WAV の書き出しのときは入れかえる）
const cutHz = (v) => 20 * Math.pow(1000, v / 100);   // 0〜100 → 20Hz〜20kHz
function padChain(track, i) {
  let list = padChains.get(track);
  if (!list) { list = []; padChains.set(track, list); }
  if (!list[i]) list[i] = makePadChain(track, padParams(track, i));
  return list[i];
}
function makePadChain(track, p) {
  const c = {
    input: audio.createGain(),
    hp: audio.createBiquadFilter(), lp: audio.createBiquadFilter(),
    lo: audio.createBiquadFilter(), mid: audio.createBiquadFilter(), hi: audio.createBiquadFilter(),
    dry: audio.createGain(), shaper: audio.createWaveShaper(), wet: audio.createGain(), sum: audio.createGain(),
    comp: audio.createDynamicsCompressor(), makeup: audio.createGain(), vol: audio.createGain(), pan: audio.createStereoPanner()
  };
  c.hp.type = "highpass"; c.lp.type = "lowpass";
  c.lo.type = "lowshelf"; c.lo.frequency.value = 120;
  c.mid.type = "peaking"; c.mid.Q.value = 0.9;
  c.hi.type = "highshelf"; c.hi.frequency.value = 8000;
  c.shaper.oversample = "2x";
  c.input.connect(c.hp).connect(c.lp).connect(c.lo).connect(c.mid).connect(c.hi);
  c.hi.connect(c.dry).connect(c.sum);
  c.hi.connect(c.shaper).connect(c.wet).connect(c.sum);
  c.sum.connect(c.comp).connect(c.makeup).connect(c.vol).connect(c.pan).connect(busFor(track));
  updatePadChain(c, p, true);
  return c;
}
function updatePadChain(c, p, now) {
  const t = audio.currentTime;
  const set = (param, v) => (now ? param.setValueAtTime(v, t) : param.setTargetAtTime(v, t, 0.02));
  const q = 0.7 + (p.reso / 100) * 11;
  set(c.hp.frequency, p.lowCut <= 0 ? 10 : cutHz(p.lowCut));
  set(c.lp.frequency, p.highCut >= 100 ? 22000 : cutHz(p.highCut));
  set(c.hp.Q, q); set(c.lp.Q, q);
  set(c.lo.gain, p.eqLow); set(c.mid.gain, p.eqMid); set(c.mid.frequency, p.eqMidFreq); set(c.hi.gain, p.eqHigh);
  if (c.lastDrive !== p.drive) {
    const k = 1 + p.drive * 0.3, n = 1024, curve = new Float32Array(n);
    for (let j = 0; j < n; j++) { const x = (j / (n - 1)) * 2 - 1; curve[j] = Math.tanh(k * x) / Math.tanh(k); }
    c.shaper.curve = curve;
    c.lastDrive = p.drive;
  }
  const mix = p.drive > 0 ? p.distMix / 100 : 0;
  set(c.dry.gain, 1 - mix); set(c.wet.gain, mix);
  const on = p.ratio > 1;   // Ratio 1:1 のときはコンプなし
  set(c.comp.threshold, on ? p.thresh : 0);
  set(c.comp.ratio, on ? p.ratio : 1);
  set(c.comp.attack, p.cAttack / 1000);
  set(c.comp.release, p.cRelease / 1000);
  set(c.makeup.gain, Math.pow(10, (on ? p.makeup : 0) / 20));
  set(c.vol.gain, Math.pow(10, p.volume / 20));
  set(c.pan.pan, p.pan / 100);
}
function refreshPadChain(track, i) {
  const list = audio && padChains.get(track);
  if (list && list[i]) updatePadChain(list[i], padParams(track, i));
}

// ================================================
// 鳴らす
// ================================================
// スライスの区切り（0〜1000）。Start と End の間にある線だけ使う
function sliceBounds(p) {
  const inner = p.slices.filter((x) => x > p.start && x < p.end).sort((a, b) => a - b);
  return [p.start, ...inner, p.end];
}

// 1回鳴らす。opt：{ semis：音程, slice：何番目のスライス, dur：伸ばす秒数（ワンショットでないとき）, note：鳴らしたノート }
function playPad(track, i, velocity, time, opt) {
  opt = opt || {};
  const p = padParams(track, i);
  let buf = padSource(track, i);
  if (!buf) return null;
  // テンポ合わせ
  let rate = Math.pow(2, (p.pitch + (opt.semis || 0)) / 12);
  if (p.sync !== "off" && p.sampleBpm > 0) {
    if (p.sync === "repitch") rate *= state.bpm / p.sampleBpm;
    else buf = stretchBuffer(buf, p.sampleBpm / state.bpm);
  }
  if (p.reverse) buf = reverseBuffer(buf);
  // 鳴らす範囲（逆再生のときは、うしろから数える）
  let a = p.start, b = p.end;
  if (opt.slice !== undefined) { const bd = sliceBounds(p); a = bd[opt.slice]; b = bd[opt.slice + 1]; }
  if (p.reverse) [a, b] = [1000 - b, 1000 - a];
  const offset = (a / 1000) * buf.duration;
  const len = Math.max(0.005, ((b - a) / 1000) * buf.duration);
  const playLen = len / rate;

  // チョーク・モノ：前の音を 5ms で止める（同じ瞬間に鳴った音どうしは止めない）
  const voices = padVoices(track);
  for (const v of voices) {
    if (v.start >= time - 0.001 || v.end <= time) continue;
    if ((p.mono && v.pad === i) || (p.choke !== "0" && v.choke === p.choke)) stopVoice(v, time);
  }

  const src = audio.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = audio.createGain();
  const peak = 0.9 * (velocity / 127);
  const A = p.attack / 1000, R = Math.max(0.003, p.release / 1000);
  g.gain.setValueAtTime(0, time);
  g.gain.linearRampToValueAtTime(peak, time + Math.max(0.001, A));
  // ワンショット：最後まで鳴らす。オフ：ノートを離したらリリースへ
  const holdEnd = p.oneShot || opt.dur === undefined ? time + playLen : Math.min(time + playLen, time + Math.max(A + 0.005, opt.dur));
  g.gain.setValueAtTime(peak, Math.max(time + A, holdEnd - 0.001));
  g.gain.setTargetAtTime(0, holdEnd, R / 3);
  const end = Math.min(time + playLen, holdEnd + R * 3) + 0.02;
  src.connect(g).connect(padChain(track, i).input);
  src.start(time, offset, len);
  src.stop(end);
  const v = { g, oscs: [src], start: time, end, pad: i, choke: p.choke, oneShot: p.oneShot, rel: R };
  voices.push(v);
  player.voices.push(v);
  // サイドチェイン：決めたノートなら、ほかのトラックを下げる
  const note = opt.note !== undefined ? opt.note : p.note;
  if (sidechainOf(track).notes.includes(note)) duckAt(time, track, i, velocity);
  return v;
}
function stopVoice(v, time) {
  const g = v.g.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(time); else g.cancelScheduledValues(time);
  g.setTargetAtTime(0, time, 0.0017);   // 5ms でフェードアウト
  try { v.oscs[0].stop(time + 0.02); } catch (err) { /* もう止まっている */ }
  v.end = time + 0.02;
}
let voiceLists = new WeakMap();   // WAV の書き出しのときは入れかえる
function padVoices(track) {
  let list = voiceLists.get(track);
  if (!list) { list = []; voiceLists.set(track, list); }
  // 鳴り終わったものを片付ける
  if (audio && list.length > 64) list.splice(0, list.length, ...list.filter((v) => v.end > audio.currentTime));
  return list;
}

// MIDI ノートで鳴らす（ドラムモード → そのノートのパッド、ピッチモード → 鍵盤の範囲、スライス → 切った所）
function samplerNote(track, note, velocity, time, dur) {
  for (let i = 0; i < DRUM_PADS.length; i++) {
    const p = padParams(track, i);
    if (p.mode === "drum" && p.note === note) playPad(track, i, velocity, time, { dur, note });
    if (p.mode === "pitch" && note >= p.low && note <= p.high) playPad(track, i, velocity, time, { semis: note - p.root, dur, note });
    if (p.mode === "slice") {
      const k = note - p.firstKey;
      if (k >= 0 && k < sliceBounds(p).length - 1) playPad(track, i, velocity, time, { slice: k, dur, note });
    }
  }
}

// ピアノロールのドラムの行（= パッド）から鳴らす
function playDrum(track, pad, velocity, time, dur) {
  const p = padParams(track, pad);
  if (p.mode === "pitch") playPad(track, pad, velocity, time, { semis: 0, dur, note: p.root });
  else if (p.mode === "slice") playPad(track, pad, velocity, time, { slice: 0, dur, note: p.firstKey });
  else playPad(track, pad, velocity, time, { dur });
}

// ================================================
// サイドチェイン（キックなどが鳴った瞬間だけ、「キックで下げる」のトラックを下げる）
// Pulse：毎回同じ形　Pad sound：鳴ったパッドの音の大きさの形
// ================================================
const envCache = new WeakMap();
function bufferEnvelope(buf) {
  let e = envCache.get(buf);
  if (!e) {
    const step = Math.max(1, Math.floor(buf.sampleRate * 0.01)), d = buf.getChannelData(0);
    e = [];
    for (let k = 0; k < Math.min(d.length, buf.sampleRate * 0.8); k += step) {
      let m = 0;
      for (let j = k; j < Math.min(d.length, k + step); j++) m = Math.max(m, Math.abs(d[j]));
      e.push(m);
    }
    const peak = Math.max(...e, 1e-6);
    e = e.map((x) => x / peak);
    envCache.set(buf, e);
  }
  return e;
}
function duckAt(time, srcTrack, pad, velocity) {
  const sc = srcTrack ? sidechainOf(srcTrack) : defaultSidechain();
  const depth = (sc.level / 100) * 0.9;
  const env = sc.signal === "pad" && srcTrack ? bufferEnvelope(padSource(srcTrack, pad)) : null;
  for (const t of state.tracks) {
    const b = t.duck && t !== srcTrack && buses.get(t);
    if (!b) continue;
    const g = b.duck.gain;
    g.cancelScheduledValues(time);
    if (env) {
      const k = (velocity || 127) / 127;
      g.setValueAtTime(1 - depth * env[0] * k, time);
      for (let j = 1; j < env.length; j += 2) g.linearRampToValueAtTime(1 - depth * env[j] * k, time + j * 0.01);
      g.linearRampToValueAtTime(1, time + env.length * 0.01 + 0.02);
    } else {
      const L = sc.length / 1000;
      g.setTargetAtTime(1 - depth, time, 0.003);
      g.setTargetAtTime(1, time + L * 0.4, L / 3);
    }
  }
}

// ================================================
// 切り分け・テンポを見つける
// ================================================
// 音の出だし（急に大きくなった所）で切る。sens が大きいほど細かく切る
function autoSlice(buf, p) {
  const d = buf.getChannelData(0), sr = buf.sampleRate, hop = 256;
  const en = [];
  for (let k = 0; k + hop < d.length; k += hop) { let s = 0; for (let j = k; j < k + hop; j++) s += d[j] * d[j]; en.push(Math.sqrt(s / hop)); }
  const max = Math.max(...en, 1e-6);
  const ratio = 1.3 + ((100 - p.sens) / 100) * 4;      // どれだけ急に大きくなったら「出だし」か
  const floor = max * (0.02 + ((100 - p.sens) / 100) * 0.15);
  const gap = Math.round((0.06 * sr) / hop);           // 60ms より近い出だしは無視
  const out = [];
  let last = -gap;
  for (let k = 2; k < en.length; k++) {
    const before = (en[k - 1] + en[k - 2]) / 2 + 1e-6;
    if (en[k] > floor && en[k] / before > ratio && k - last >= gap) {
      const pos = Math.round(((k * hop) / d.length) * 1000);
      if (pos > 5 && pos < 995) out.push(pos);
      last = k;
    }
  }
  return out.slice(0, 63);
}
function splitEvenly(n) { const out = []; for (let k = 1; k < n; k++) out.push(Math.round((k / n) * 1000)); return out; }

// サンプルの BPM：ファイル名（loop_128bpm.wav）→ なければループの長さ（1秒以上）から
function guessBpm(name, buf) {
  const m = String(name || "").match(/(\d{2,3}(?:\.\d+)?)\s*bpm/i) || String(name || "").match(/(?:^|[_\- ])(\d{2,3})(?:[_\- .]|$)/);
  if (m && Number(m[1]) >= 50 && Number(m[1]) <= 250) return Number(m[1]);
  if (!buf || buf.duration < 1) return 0;
  let best = 0;
  for (const beats of [4, 8, 16, 32]) {
    const bpm = (60 * beats) / buf.duration;
    if (bpm >= 80 && bpm < 170) { best = Math.round(bpm * 10) / 10; break; }
  }
  return best;
}

// ================================================
// パッドの編集画面
// ================================================
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteLabel = (n) => n + "（" + NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1) + "）";
const CHOKES = { 0: "Off" }; for (let k = 1; k <= 8; k++) CHOKES[k] = String(k);
let padFileSets = {};   // ◀ ▶ 用：一緒に読み込んだファイルの一覧（"トラックid:パッド" → { files, index }）
let scLearn = false;    // サイドチェインの Learn 中か

function padEditTrack() {
  const t = state.tracks[state.current];
  return state.padEdit && isDrum(t) ? t : null;
}

function renderPadEdit() {
  const box = $("padedit");
  const track = padEditTrack();
  if (!track) { box.hidden = true; state.padEdit = false; return; }
  box.hidden = false;
  const i = state.pad, p = padParams(track, i), sc = sidechainOf(track);
  const modeCard = p.mode === "pitch"
    ? controls([["Root", "root", 0, 127, p.root], ["Low", "low", 0, 127, p.low], ["High", "high", 0, 127, p.high]]) +
      '<p class="syn-note">Root ＝ 元の高さになるキー。Low〜High のキーで音程を付けて弾ける</p>'
    : p.mode === "slice"
      ? controls([["First Key", "firstKey", 0, 127, p.firstKey], ["Sensitivity", "sens", 0, 100, p.sens]]) +
        '<div class="pe-row"><button data-pe="autoslice">Auto Slice</button>' + knobHtml("等分", "even", p.even, { 2: "2", 4: "4", 8: "8", 16: "16" }) + '<button data-pe="even">Split evenly</button></div>' +
        '<p class="syn-note">スライス ' + (sliceBounds(p).length - 1) + " 個：キー " + noteLabel(p.firstKey) + " から順番。波形のクリック＝試聴、線をドラッグ＝移動、ダブルクリック＝追加、右クリック＝削除</p>"
      : '<p class="syn-note">ノート ' + noteLabel(p.note) + " で鳴る（下の「ノート」で変えられる）</p>";
  let html = '<div class="syn-head"><b>パッド ' + (i + 1) + "：" + esc(padName(track, i)) + "</b>" +
    '<button data-pe="prev" title="同じフォルダ（一緒に読み込んだファイル）の前の音">◀</button><button data-pe="next" title="次の音">▶</button>' +
    '<button data-pe="load">Load</button><button data-pe="preview">▶ Preview</button><button data-pe="clear">Clear</button>' +
    '<label class="pe-note">ノート<input type="number" min="0" max="127" data-path="note" value="' + p.note + '"></label>' +
    '<div class="spacer"></div><button data-pe="close">閉じる</button></div>';
  html += '<canvas class="pe-wave" aria-label="波形。クリック・ドラッグで鳴らし始める所、右の線で終わる所"></canvas>';
  html += '<div class="syn-grid pe-grid">' +
    '<section class="syn-card"><div class="syn-title"><b>SAMPLE</b></div>' + controls([["Pitch", "pitch", -24, 24, p.pitch, "半音"], ["Start", "start", 0, 1000, p.start, "‰"], ["End", "end", 0, 1000, p.end, "‰"], ["Attack", "attack", 0, 1000, p.attack, "ms"], ["Release", "release", 0, 2000, p.release, "ms"]]) + "</section>" +
    '<section class="syn-card"><div class="syn-title"><b>TRIGGER</b></div>' +
      '<div class="pe-checks"><label class="sw"><input type="checkbox" data-path="reverse"' + (p.reverse ? " checked" : "") + "><span>Reverse</span></label>" +
      '<label class="sw"><input type="checkbox" data-path="oneShot"' + (p.oneShot ? " checked" : "") + "><span>One Shot</span></label>" +
      '<label class="sw"><input type="checkbox" data-path="mono"' + (p.mono ? " checked" : "") + "><span>Mono（前の音を止める）</span></label></div>" +
      knobHtml("Choke", "choke", p.choke, CHOKES) + "</section>" +
    '<section class="syn-card"><div class="syn-title"><b>AMP</b></div>' + controls([["Volume", "volume", -40, 6, p.volume, "dB"], ["Pan", "pan", -100, 100, p.pan]]) + "</section>" +
    '<section class="syn-card"><div class="syn-title"><b>FILTER</b></div>' + controls([["Low Cut", "lowCut", 0, 100, p.lowCut], ["High Cut", "highCut", 0, 100, p.highCut], ["Reso", "reso", 0, 100, p.reso]]) + "</section>" +
    '<section class="syn-card"><div class="syn-title"><b>DISTORTION</b></div>' + controls([["Drive", "drive", 0, 100, p.drive], ["Mix", "distMix", 0, 100, p.distMix]]) + "</section>" +
    '<section class="syn-card"><div class="syn-title"><b>EQ</b></div>' + controls([["Low", "eqLow", -12, 12, p.eqLow, "dB"], ["Mid", "eqMid", -12, 12, p.eqMid, "dB"], ["Mid Freq", "eqMidFreq", 200, 8000, p.eqMidFreq, "Hz"], ["High", "eqHigh", -12, 12, p.eqHigh, "dB"]]) + "</section>" +
    '<section class="syn-card"><div class="syn-title"><b>COMPRESSOR</b><span class="syn-sub">Ratio 1 でオフ</span></div>' + controls([["Thresh", "thresh", -60, 0, p.thresh, "dB"], ["Ratio", "ratio", 1, 20, p.ratio], ["Attack", "cAttack", 0, 100, p.cAttack, "ms"], ["Release", "cRelease", 10, 1000, p.cRelease, "ms"], ["Makeup", "makeup", 0, 24, p.makeup, "dB"]]) + "</section>" +
    '<section class="syn-card"><div class="syn-title"><b>PLAY MODE</b></div>' + knobHtml("Mode", "mode", p.mode, { drum: "Drum", pitch: "Pitch", slice: "Slice" }) + modeCard + "</section>" +
    '<section class="syn-card"><div class="syn-title"><b>TEMPO SYNC</b></div>' + knobHtml("Mode", "sync", p.sync, { off: "Off", repitch: "Repitch（音程も変わる）", stretch: "Stretch（音程はそのまま）" }) +
      '<div class="pe-row"><label class="pe-note">Sample BPM<input type="number" min="0" max="300" step="0.1" data-path="sampleBpm" value="' + p.sampleBpm + '"></label>' +
      '<button data-pe="half">/2</button><button data-pe="double">x2</button><button data-pe="detect">Detect</button></div></section>' +
    '<section class="syn-card wide"><div class="syn-title"><b>SIDECHAIN OUT</b><span class="syn-sub">このトラックのこのノートが鳴ったら、「キックで下げる」を ON にしたトラックを下げる</span></div>' +
      '<div class="pe-row"><label class="pe-note">Trigger notes<input type="text" data-sc="notes" value="' + sc.notes.join(", ") + '" placeholder="36, 38"></label>' +
      '<button data-pe="learn"' + (scLearn ? ' class="active"' : "") + ">" + (scLearn ? "Learn 中…パッドを鳴らす" : "Learn") + "</button>" +
      knobHtml("Signal", "sc.signal", sc.signal, { pulse: "Pulse（毎回同じ形）", pad: "Pad sound（パッドの音の形）" }) + "</div>" +
      controls([["Length", "sc.length", 10, 500, sc.length, "ms"], ["Level", "sc.level", 0, 100, sc.level]]) + "</section>";
  html += "</div>";
  box.innerHTML = html;
  drawPadWave();
}

// 波形を描く
function drawPadWave() {
  const track = padEditTrack();
  const cv = $("padedit").querySelector(".pe-wave");
  if (!track || !cv) return;
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr));
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = r.width, h = r.height, p = padParams(track, state.pad);
  g.fillStyle = "#17181c"; g.fillRect(0, 0, w, h);
  const buf = padSource(track, state.pad);
  if (buf) {
    const d = (p.reverse ? reverseBuffer(buf) : buf).getChannelData(0);
    g.fillStyle = "#5fd0c8";
    for (let x = 0; x < w; x++) {
      const a = Math.floor((x / w) * d.length), b = Math.max(a + 1, Math.floor(((x + 1) / w) * d.length));
      let mn = 0, mx = 0;
      for (let k = a; k < b; k += Math.max(1, Math.floor((b - a) / 64))) { mn = Math.min(mn, d[k]); mx = Math.max(mx, d[k]); }
      g.fillRect(x, h / 2 - mx * (h / 2 - 4), 1, Math.max(1, (mx - mn) * (h / 2 - 4)));
    }
  }
  // 鳴らさない所を暗く
  const xs = (v) => (v / 1000) * w;
  g.fillStyle = "rgba(0,0,0,0.6)";
  g.fillRect(0, 0, xs(p.start), h);
  g.fillRect(xs(p.end), 0, w - xs(p.end), h);
  g.fillStyle = "#f2a541";
  g.fillRect(xs(p.start) - 1, 0, 2, h);
  g.fillRect(xs(p.end) - 1, 0, 2, h);
  if (p.mode === "slice") {
    const bd = sliceBounds(p);
    g.font = "11px monospace";
    bd.forEach((v, k) => {
      if (k > 0 && k < bd.length - 1) { g.fillStyle = "#e8c547"; g.fillRect(xs(v) - 1, 0, 2, h); }
      if (k < bd.length - 1) { g.fillStyle = "#e8e8ea"; g.fillText(String(k + 1), xs(v) + 4, 13); }
    });
  }
}

// ---------- つまみ（シンセと同じ動かし方） ----------
function setPadValue(track, path, v) {
  if (path.startsWith("sc.")) { setPath(sidechainOf(track), path.slice(3), v); return; }
  const p = padParams(track, state.pad);
  setPath(p, path, v);
  if (path === "start" && p.start >= p.end) p.start = p.end - 1;
  if (path === "end" && p.end <= p.start) p.end = p.start + 1;
  if (path === "low" && p.low > p.high) p.high = p.low;
  if (path === "high" && p.high < p.low) p.low = p.high;
  initAudio();
  refreshPadChain(track, state.pad);
}
function initPadEdit() {
  const box = $("padedit");
  const turn = (dial, v) => {
    const t = padEditTrack();
    if (!t) return;
    const min = Number(dial.dataset.min), max = Number(dial.dataset.max);
    v = Math.round(Math.min(max, Math.max(min, v)));
    if (v === Number(dial.getAttribute("aria-valuenow"))) return;
    dial.setAttribute("aria-valuenow", v);
    dial.innerHTML = dialSvg(v, min, max);
    dial.nextElementSibling.innerHTML = v + (dial.dataset.unit ? "<small>" + dial.dataset.unit + "</small>" : "");
    setPadValue(t, dial.dataset.path, v);
    drawPadWave();
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
    turn(drag.dial, drag.v + ((drag.y - e.clientY) / (e.shiftKey ? 600 : 150)) * range);
  });
  const end = () => { if (drag) { drag = null; renderPadEdit(); } };
  box.addEventListener("pointerup", end);
  box.addEventListener("pointercancel", end);
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
    const path = dial.dataset.path;
    const def = path.startsWith("sc.") ? defaultSidechain()[path.slice(3)] : defaultPad(state.pad)[path];
    turn(dial, def);
  });
  box.addEventListener("keydown", (e) => {
    const dial = e.target.closest(".dial");
    if (!dial) return;
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    turn(dial, Number(dial.getAttribute("aria-valuenow")) + d * (e.shiftKey ? 10 : 1));
  });
  // チェック・選択欄・数字の欄
  box.addEventListener("change", (e) => {
    const t = padEditTrack();
    if (!t) return;
    const el = e.target;
    if (el.dataset.sc === "notes") {
      sidechainOf(t).notes = el.value.split(/[,、\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 127);
    } else if (el.dataset.path) {
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (el.type === "number") v = Math.max(Number(el.min), Math.min(Number(el.max), Number(v) || 0));
      setPadValue(t, el.dataset.path, v);
    }
    if (el.tagName === "SELECT" || el.type === "checkbox") el.blur();
    renderPadEdit();
    render();
  });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-pe]");
    const t = padEditTrack();
    if (!b || !t) return;
    const i = state.pad, p = padParams(t, i);
    const act = b.dataset.pe;
    if (act === "close") { state.padEdit = false; render(); return; }
    if (act === "preview") { preview(i); return; }
    if (act === "load") { $("pad-file").click(); return; }
    if (act === "clear") clearPad(t, i);
    if (act === "prev" || act === "next") { stepPadSound(t, i, act === "next" ? 1 : -1); return; }
    const buf = padSource(t, i);
    if (act === "autoslice" && buf) p.slices = autoSlice(buf, p);
    if (act === "even") p.slices = splitEvenly(Number(p.even));
    if (act === "half") p.sampleBpm = Math.round((p.sampleBpm / 2) * 10) / 10;
    if (act === "double") p.sampleBpm = Math.round(p.sampleBpm * 20) / 10;
    if (act === "detect") p.sampleBpm = guessBpm(padName(t, i), buf);
    if (act === "learn") scLearn = !scLearn;
    renderPadEdit();
  });

  // ---------- 波形の上の操作 ----------
  let wdrag = null;
  const pos = (e, cv) => { const r = cv.getBoundingClientRect(); return { v: Math.round(Math.max(0, Math.min(1000, ((e.clientX - r.left) / r.width) * 1000))), px: e.clientX - r.left, w: r.width }; };
  box.addEventListener("contextmenu", (e) => {
    const cv = e.target.closest(".pe-wave");
    const t = padEditTrack();
    if (!cv || !t) return;
    e.preventDefault();
    const p = padParams(t, state.pad);
    if (p.mode !== "slice") return;
    const m = pos(e, cv);
    const near = p.slices.findIndex((s) => Math.abs((s / 1000) * m.w - m.px) < 6);
    if (near >= 0) { p.slices.splice(near, 1); renderPadEdit(); commitSoon(0); }
  });
  box.addEventListener("pointerdown", (e) => {
    const cv = e.target.closest(".pe-wave");
    const t = padEditTrack();
    if (!cv || !t || e.button !== 0) return;
    const p = padParams(t, state.pad), m = pos(e, cv);
    cv.setPointerCapture(e.pointerId);
    if (p.mode === "slice") {
      const near = p.slices.findIndex((s) => Math.abs((s / 1000) * m.w - m.px) < 6);
      if (near >= 0) { wdrag = { kind: "slice", k: near, cv }; return; }
      // スライスを試聴
      const bd = sliceBounds(p);
      const k = bd.findIndex((v, j) => j < bd.length - 1 && m.v >= v && m.v < bd[j + 1]);
      if (k >= 0) { initAudio(); audio.resume(); playPad(t, state.pad, 110, audio.currentTime, { slice: k }); }
      return;
    }
    if (Math.abs((p.end / 1000) * m.w - m.px) < 8) wdrag = { kind: "end", cv };
    else { wdrag = { kind: "start", cv }; p.start = Math.min(m.v, p.end - 1); drawPadWave(); }
  });
  box.addEventListener("pointermove", (e) => {
    if (!wdrag) return;
    const t = padEditTrack();
    if (!t) return;
    const p = padParams(t, state.pad), m = pos(e, wdrag.cv);
    if (wdrag.kind === "start") p.start = Math.min(m.v, p.end - 1);
    if (wdrag.kind === "end") p.end = Math.max(m.v, p.start + 1);
    if (wdrag.kind === "slice") p.slices[wdrag.k] = Math.max(1, Math.min(999, m.v));
    drawPadWave();
  });
  const wend = () => {
    if (!wdrag) return;
    const kind = wdrag.kind;
    wdrag = null;
    renderPadEdit();
    if (kind !== "slice") preview(state.pad);   // 離すと鳴る
  };
  box.addEventListener("pointerup", wend);
  box.addEventListener("pointercancel", wend);
  box.addEventListener("dblclick", (e) => {   // スライスの線を足す
    const cv = e.target.closest(".pe-wave");
    const t = padEditTrack();
    if (!cv || !t) return;
    const p = padParams(t, state.pad);
    if (p.mode !== "slice") return;
    p.slices.push(pos(e, cv).v);
    renderPadEdit();
  });
  new ResizeObserver(() => drawPadWave()).observe(box);
}

// 元の音に戻す
function clearPad(track, i) {
  pushHistory();
  if (track.custom) delete track.custom[i];
  const p = padParams(track, i);
  p.src = i; p.slices = []; p.sampleBpm = 0;
  delete padFileSets[track.id + ":" + i];
  preview(i);
  render();
}

// ◀ ▶：一緒に読み込んだファイルの前後へ。なければ用意した音を順番に
async function stepPadSound(track, i, d) {
  const set = padFileSets[track.id + ":" + i];
  if (set && set.files.length > 1) {
    set.index = (set.index + d + set.files.length) % set.files.length;
    await loadPadFile(set.files[set.index], i, true);
    return;
  }
  pushHistory();
  if (track.custom) delete track.custom[i];
  const p = padParams(track, i);
  p.src = (p.src + d + DRUM_PADS.length) % DRUM_PADS.length;
  p.slices = [];
  preview(i);
  render();
}

// 読み込んだときに：スライスを自動で切って、BPM を見つけておく
function analyzePad(track, i, name) {
  const p = padParams(track, i);
  const buf = padSource(track, i);
  if (!buf) return;
  p.slices = autoSlice(buf, p);
  p.sampleBpm = guessBpm(name, buf);
  p.start = 0; p.end = 1000;
}
