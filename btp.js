// btp.js：BTP（Beyond The Peak）＝ OTT のパクリ
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）
//
// 音を 低（〜88Hz）・中・高（2.5kHz〜）の3つに分けて、それぞれ
//   ・大きい音は下げる（ダウンワード・コンプ）
//   ・小さい音は持ち上げる（アップワード・コンプ）
// してから足し戻す。Depth で元の音と混ぜる（Depth 25% くらいで適当に入れるだけでだいぶ変わる）
//
// 小さい音を持ち上げるのは Web Audio の部品だけではできないので、AudioWorklet（自分で書いた音の処理）を使う。
// 使えないブラウザでは、ふつうのコンプ（下げるだけ）で代わりにする

const BTP_WORKLET = `
class BTPBand extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "down", defaultValue: 1, minValue: 0, maxValue: 1 },   // 大きい音を下げる量
      { name: "up", defaultValue: 1, minValue: 0, maxValue: 1 },     // 小さい音を持ち上げる量
      { name: "time", defaultValue: 1, minValue: 0.1, maxValue: 4 }, // 反応の速さ（大きいほどゆっくり）
      { name: "makeup", defaultValue: 0, minValue: -24, maxValue: 24 }
    ];
  }
  constructor(opt) {
    super();
    const o = (opt && opt.processorOptions) || {};
    this.td = o.td !== undefined ? o.td : -26;   // ここより大きいと下げる（dB）
    this.tu = o.tu !== undefined ? o.tu : -38;   // ここより小さいと持ち上げる（dB）
    this.env = -120;
  }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const n = inp[0].length, time = p.time[0];
    const att = Math.exp(-1 / (sampleRate * 0.003 * time)), rel = Math.exp(-1 / (sampleRate * 0.08 * time));
    const down = p.down[0], up = p.up[0], mk = p.makeup[0];
    for (let i = 0; i < n; i++) {
      let peak = 0;
      for (let c = 0; c < inp.length; c++) { const v = Math.abs(inp[c][i]); if (v > peak) peak = v; }
      const db = peak > 1e-6 ? 20 * Math.log10(peak) : -120;
      const k = db > this.env ? att : rel;
      this.env = k * this.env + (1 - k) * db;
      const e = this.env;
      let g = 0;
      if (e > this.td) g -= (e - this.td) * (1 - 1 / 30) * down;                     // 30:1 で下げる
      else if (e < this.tu && e > -70) g += Math.min(12, (this.tu - e) * 0.75) * up;  // 4:1 で持ち上げる（とても小さい音＝無音は持ち上げない）
      const lin = Math.pow(10, (g + mk) / 20);
      for (let c = 0; c < out.length; c++) out[c][i] = (inp[c] || inp[0])[i] * lin;
    }
    return true;
  }
}
registerProcessor("btp-band", BTPBand);
`;

// AudioContext ごとに、1回だけ読み込む
const btpLoading = new WeakMap();
const btpReady = new WeakSet();
function loadBtp(ctx) {
  if (!ctx.audioWorklet) return Promise.resolve(false);
  if (!btpLoading.has(ctx)) {
    // index.html を直接開いたとき（file://）は blob: の URL が読めないので、data: の URL で渡す。だめなら blob: で
    const dataUrl = "data:application/javascript;charset=utf-8," + encodeURIComponent(BTP_WORKLET);
    const blobUrl = () => URL.createObjectURL(new Blob([BTP_WORKLET], { type: "application/javascript" }));
    btpLoading.set(ctx, ctx.audioWorklet.addModule(dataUrl)
      .catch(() => ctx.audioWorklet.addModule(blobUrl()))
      .then(() => { btpReady.add(ctx); return true; })
      .catch(() => false));
  }
  return btpLoading.get(ctx);
}

// 帯域の分け目（OTT と同じ 88Hz と 2.5kHz）
const BTP_BANDS = [
  { name: "low", td: -14, tu: -26, makeup: 3 },
  { name: "mid", td: -14, tu: -26, makeup: 3 },
  { name: "high", td: -18, tu: -30, makeup: 5 }
];
function btpFilter(type, freq) {
  const f = audio.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = 0.707;
  return f;
}

// BTP を1つ作る（入口 → 3つの帯域 → 足す → 出口）。中身だけで、元の音との混ぜ具合は外でやる
function makeBTP() {
  const b = { input: audio.createGain(), output: audio.createGain(), inGain: audio.createGain(), bands: [] };
  b.input.connect(b.inGain);
  const ready = btpReady.has(audio);
  // 帯域ごとに、フィルターを2つ重ねて分ける（急に切れるように）
  const chains = [
    [btpFilter("lowpass", 88), btpFilter("lowpass", 88)],
    [btpFilter("highpass", 88), btpFilter("highpass", 88), btpFilter("lowpass", 2500), btpFilter("lowpass", 2500)],
    [btpFilter("highpass", 2500), btpFilter("highpass", 2500)]
  ];
  chains.forEach((fs, k) => {
    let node = b.inGain;
    for (const f of fs) { node.connect(f); node = f; }
    const cfg = BTP_BANDS[k];
    let proc;
    if (ready) {
      proc = new AudioWorkletNode(audio, "btp-band", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { td: cfg.td, tu: cfg.tu } });
      proc.parameters.get("makeup").value = cfg.makeup;
    } else {   // 代わり：下げるだけのコンプ
      const c = audio.createDynamicsCompressor();
      c.threshold.value = cfg.td; c.ratio.value = 12; c.knee.value = 6;
      const g = audio.createGain();
      g.gain.value = Math.pow(10, -9 / 20);   // このコンプは勝手に音を大きくするので、その分を下げる
      c.connect(g);
      proc = { input: c, output: g, comp: c };
    }
    node.connect(proc.input || proc);
    (proc.output || proc).connect(b.output);
    b.bands.push(proc);
  });
  b.update = (s) => updateBTP(b, s);
  return b;
}

// s：{ down, up, time, inGain, outGain }（down・up・time は 0〜100、gain は dB）
function updateBTP(b, s) {
  const t = audio.currentTime;
  b.inGain.gain.setTargetAtTime(Math.pow(10, (s.inGain || 0) / 20), t, 0.02);
  b.output.gain.setTargetAtTime(Math.pow(10, (s.outGain || 0) / 20), t, 0.02);
  for (const p of b.bands) {
    if (p.parameters) {
      p.parameters.get("down").setTargetAtTime(s.down / 100, t, 0.02);
      p.parameters.get("up").setTargetAtTime(s.up / 100, t, 0.02);
      p.parameters.get("time").setTargetAtTime(0.1 + (s.time / 100) * 3.9, t, 0.02);
    } else if (p.comp) {
      p.comp.ratio.setTargetAtTime(1 + (s.down / 100) * 19, t, 0.02);
      p.comp.release.setTargetAtTime(0.02 + (s.time / 100) * 0.5, t, 0.02);
    }
  }
}

// トラックの BTP（トラック一覧の「BTP」）：Depth だけ決める。ほかは OTT の最初の値と同じくらい
const TRACK_BTP = { down: 100, up: 100, time: 25, inGain: 0, outGain: 0 };
