// inserts.js：トラックに自由に入れるエフェクト（インサート）
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）
//
// どのトラック（楽器・シンセ・ドラム・FX）にも、シンセと同じ10種類のエフェクトを、好きな順番で好きな数だけ入れられる。
// 音の流れ：トラックの音 → エフェクト1 → エフェクト2 → … → 音量 → BTP → キックで下げる → パン → 全体
// つまみの種類・最初の値は、シンセのエフェクト（synth.js の FX_KNOBS・defaultSynth）と同じ

const MAX_INSERTS = 8;
let nextInsertId = 1;
const insertDefaults = (type) => JSON.parse(JSON.stringify(defaultSynth().fx[type]));
function newInsert(type) {
  const d = insertDefaults(type);
  if ("type" in d) { d.filterType = d.type; delete d.type; }   // Filter の「種類」は filterType に（type はエフェクトの種類に使う）
  return Object.assign({ id: "fx" + Date.now().toString(36) + (nextInsertId++), type }, d, { on: true });
}

// ---------- 1つ分の音の部品 ----------
// fxBox（synth.js）：ON/OFF と混ぜる量は dry・wet の大きさで決める
function makeInsert(fx) {
  const n = { type: fx.type };
  const B = (build) => fxBox(build);
  switch (fx.type) {
    case "chorus":
      n.box = B((input) => { const d = audio.createDelay(0.1); d.delayTime.value = 0.025; input.connect(d); n.lfo = lfo(0.8, 0.004, d.delayTime); return d; });
      break;
    case "compressor":
      n.box = B((input) => { n.comp = audio.createDynamicsCompressor(); n.gain = audio.createGain(); input.connect(n.comp).connect(n.gain); return n.gain; });
      break;
    case "delay":
      n.box = B((input) => { n.delay = audio.createDelay(3); n.fb = audio.createGain(); input.connect(n.delay); n.delay.connect(n.fb).connect(n.delay); return n.delay; });
      break;
    case "distortion":
      n.box = B((input) => { n.shaper = audio.createWaveShaper(); n.shaper.oversample = "2x"; n.gain = audio.createGain(); input.connect(n.shaper).connect(n.gain); return n.gain; });
      break;
    case "eq":
      n.box = B((input) => {
        n.lo = audio.createBiquadFilter(); n.mid = audio.createBiquadFilter(); n.hi = audio.createBiquadFilter();
        n.lo.type = "lowshelf"; n.mid.type = "peaking"; n.mid.Q.value = 0.9; n.hi.type = "highshelf";
        input.connect(n.lo).connect(n.mid).connect(n.hi);
        return n.hi;
      });
      break;
    case "filter":
      n.box = B((input) => { n.filter = audio.createBiquadFilter(); input.connect(n.filter); return n.filter; });
      break;
    case "flanger":
      n.box = B((input) => {
        const d = audio.createDelay(0.05); d.delayTime.value = 0.004;
        const fb = audio.createGain(); fb.gain.value = 0.55;
        input.connect(d); d.connect(fb).connect(d);
        n.lfo = lfo(0.3, 0.002, d.delayTime);
        return d;
      });
      break;
    case "phaser":
      n.box = B((input) => {
        n.lfo = { o: audio.createOscillator(), g: audio.createGain() };
        n.lfo.o.connect(n.lfo.g);
        let node = input;
        for (let i = 0; i < 4; i++) {
          const ap = audio.createBiquadFilter(); ap.type = "allpass"; ap.frequency.value = 900 + i * 300;
          n.lfo.g.connect(ap.frequency); node.connect(ap); node = ap;
        }
        n.lfo.o.start();
        return node;
      });
      break;
    case "reverb":
      n.box = B((input) => { n.conv = audio.createConvolver(); input.connect(n.conv); return n.conv; });
      break;
    case "btp":
      n.box = B((input) => { n.btp = makeBTP(); input.connect(n.btp.input); return n.btp.output; });
      break;
  }
  updateInsert(n, fx, true);
  return n;
}

// 設定の数字を、音の部品に反映する（シンセの updateChain と同じ計算）
function updateInsert(n, p, force) {
  const t = audio.currentTime;
  const set = (param, v) => param.setTargetAtTime(v, t, 0.02);
  const on = !!p.on;
  switch (p.type) {
    case "chorus": n.box.mix(on, p.mix / 100); set(n.lfo.g.gain, 0.0005 + (p.depth / 100) * 0.008); break;
    case "compressor":
      n.box.mix(on, 1);
      set(n.comp.threshold, -p.amount * 0.5); set(n.comp.ratio, 2 + p.amount * 0.14);
      set(n.gain.gain, Math.pow(10, (p.gain * 0.18) / 20));
      break;
    case "delay":
      n.box.mix(on, p.mix / 100);
      set(n.delay.delayTime, DELAY_TIMES[p.time] * beatSec()); set(n.fb.gain, (p.feedback / 100) * 0.85);
      break;
    case "distortion":
      n.box.mix(on, p.mix / 100);
      if (force || n.lastDrive !== p.drive) { n.shaper.curve = distCurve(p.drive); n.lastDrive = p.drive; }
      set(n.gain.gain, 1 / Math.pow(distK(p.drive), 0.8));
      break;
    case "eq":
      n.box.mix(on, 1);
      set(n.lo.frequency, p.lowFreq || 250); set(n.mid.frequency, p.midFreq || 1200); set(n.hi.frequency, p.highFreq || 5000);
      set(n.lo.gain, p.low); set(n.mid.gain, p.mid); set(n.hi.gain, p.high);
      break;
    case "filter":
      n.box.mix(on, 1);
      n.filter.type = p.filterType || "lowpass";
      set(n.filter.frequency, cutoffHz(p.cutoff)); set(n.filter.Q, 0.5 + (p.reso / 100) * 18);
      break;
    case "flanger":
      n.box.mix(on, p.mix / 100);
      set(n.lfo.o.frequency, 0.05 + (p.rate / 100) * 2); set(n.lfo.g.gain, (p.depth / 100) * 0.0035);
      break;
    case "phaser":
      n.box.mix(on, p.mix / 100);
      set(n.lfo.o.frequency, 0.05 + (p.rate / 100) * 3); set(n.lfo.g.gain, (p.depth / 100) * 800);
      break;
    case "reverb":
      n.box.mix(on, p.mix / 100);
      if (force || n.size !== p.size) { n.conv.buffer = makeImpulse(0.3 + (p.size / 100) * 3.7); n.size = p.size; }
      break;
    case "btp":
      n.box.mix(on, p.depth / 100);
      n.btp.update({ down: p.down, up: p.up, time: p.time, inGain: 0, outGain: p.out });
      break;
  }
}

// ---------- トラックの列につなぐ ----------
// b.pre（トラックの音の入口）→ エフェクトを順番に → b.in（音量）。並びが変わったときだけつなぎ直す
function syncInserts(track, b) {
  const list = track.inserts || [];
  const sig = list.map((x) => x.id + ":" + x.type).join(",");
  if (!b.inserts) b.inserts = new Map();
  if (sig !== b.insertSig) {
    b.pre.disconnect();
    for (const n of b.inserts.values()) n.box.out.disconnect();
    // 消えたエフェクトは捨てる
    for (const id of [...b.inserts.keys()]) if (!list.some((x) => x.id === id)) b.inserts.delete(id);
    let node = b.pre;
    for (const fx of list) {
      let n = b.inserts.get(fx.id);
      if (!n || n.type !== fx.type) { n = makeInsert(fx); b.inserts.set(fx.id, n); }
      node.connect(n.box.in);
      node = n.box.out;
    }
    node.connect(b.in);
    b.insertSig = sig;
  }
  for (const fx of list) updateInsert(b.inserts.get(fx.id), fx);
}

// ================================================
// エフェクトの画面（トラックの「エフェクト」ボタンで開く。ピアノロールの上に重なる）
// ================================================
const INSERT_NAMES = {
  chorus: "Chorus（広げる）", compressor: "Compressor（まとめる）", delay: "Delay（やまびこ）", distortion: "Distortion（歪ませる）",
  eq: "EQ（低・中・高）", filter: "Filter（削る）", flanger: "Flanger（シュワー）", phaser: "Phaser（ウワンウワン）",
  reverb: "Reverb（響き）", btp: "BTP（OTT のパクリ）"
};
const fxEditTrack = () => (state.fxEdit && state.tracks.find((t) => t.id === state.fxEdit)) || null;

function renderFxEdit() {
  const box = $("fxedit");
  const track = fxEditTrack();
  if (!track) { box.hidden = true; state.fxEdit = null; return; }
  box.hidden = false;
  const list = track.inserts || [];
  let html = '<div class="syn-head"><b>エフェクト：' + esc(track.name) + "</b>" +
    '<label class="sel-row"><span>足す</span><select data-fx-add="1"' + (list.length >= MAX_INSERTS ? " disabled" : "") + '><option value="">＋ エフェクトを選ぶ</option>' +
    FX_ORDER.map((k) => '<option value="' + k + '">' + INSERT_NAMES[k] + "</option>").join("") + "</select></label>" +
    '<span class="syn-sub">上から順番にかかる（' + list.length + "／" + MAX_INSERTS + "）</span>" +
    '<div class="spacer"></div><button data-fx="close">閉じる</button></div>';
  if (!list.length) html += '<p class="syn-note fx-empty">まだ何も入っていません。上の「足す」から選ぶと、このトラックの音にかかります。<br>楽器・シンセ・ドラム・FX、どのトラックにも入れられます</p>';
  html += '<div class="syn-fx fx-inserts">';
  list.forEach((fx, i) => {
    const knobs = FX_KNOBS[fx.type].map(([l, key, mn, mx, u]) => [l, "inserts." + i + "." + (key === "type" ? "filterType" : key), mn, mx, key === "type" ? fx.filterType || "lowpass" : fx[key], u]);
    html += '<section class="syn-card fx' + (fx.on ? "" : " off") + '" data-ins="' + i + '"><div class="syn-title">' + onHtml("inserts." + i + ".on", fx.on) +
      "<b>" + (i + 1) + ". " + (fx.type === "btp" ? "BTP" : FX_NAMES[fx.type]) + "</b>" +
      '<span class="fx-tools"><button data-fx="up" data-i="' + i + '" aria-label="上へ"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
      '<button data-fx="down" data-i="' + i + '" aria-label="下へ"' + (i === list.length - 1 ? " disabled" : "") + ">↓</button>" +
      '<button data-fx="remove" data-i="' + i + '" aria-label="外す">×</button></span></div>' +
      controls(knobs) + "</section>";
  });
  html += "</div>";
  box.innerHTML = html;
}

function applyInserts(track) {
  initAudio();
  busFor(track);
  updateBus(track);
}

function initFxEdit() {
  const box = $("fxedit");
  const setValue = (path, v) => {
    const t = fxEditTrack();
    if (!t) return;
    setPath(t, path, v);
    applyInserts(t);
  };
  const turn = (dial, v) => {
    const min = Number(dial.dataset.min), max = Number(dial.dataset.max);
    v = Math.round(Math.min(max, Math.max(min, v)));
    if (v === Number(dial.getAttribute("aria-valuenow"))) return;
    dial.setAttribute("aria-valuenow", v);
    dial.innerHTML = dialSvg(v, min, max);
    dial.nextElementSibling.innerHTML = v + (dial.dataset.unit ? "<small>" + dial.dataset.unit + "</small>" : "");
    setValue(dial.dataset.path, v);
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
    const t = fxEditTrack();
    if (!dial || !t) return;
    const [, i, key] = dial.dataset.path.split(".");
    const d = insertDefaults(t.inserts[Number(i)].type);
    turn(dial, d[key]);
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
  box.addEventListener("change", (e) => {
    const t = fxEditTrack();
    if (!t) return;
    const el = e.target;
    if (el.dataset.fxAdd) {
      if (el.value && (t.inserts || []).length < MAX_INSERTS) {
        pushHistory();
        if (!t.inserts) t.inserts = [];
        t.inserts.push(newInsert(el.value));
        applyInserts(t);
      }
    } else if (el.dataset.path) {
      setValue(el.dataset.path, el.type === "checkbox" ? el.checked : el.value);
    }
    el.blur();
    renderFxEdit();
    renderTracks();
  });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-fx]");
    const t = fxEditTrack();
    if (!b || !t) return;
    const i = Number(b.dataset.i), list = t.inserts || [];
    if (b.dataset.fx === "close") { state.fxEdit = null; render(); return; }
    pushHistory();
    if (b.dataset.fx === "remove") list.splice(i, 1);
    if (b.dataset.fx === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    if (b.dataset.fx === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    applyInserts(t);
    renderFxEdit();
    renderTracks();
  });
}
