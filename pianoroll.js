// pianoroll.js：ピアノロール（描く・マウス操作）
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）

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
    view.y = (TOP - 66) * ROW_H - (H - LANE_H - RULER_H) / 2;
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
  const maxY = rowCount() * ROW_H - (H - LANE_H - RULER_H);
  view.y = Math.min(Math.max(0, maxY), Math.max(0, view.y));
}

// 行の並び：楽器トラックは上が高い音（C7 〜 C2）、ドラムトラックは上からパッド 0〜15
const drumView = () => isPadTrack(state.tracks[state.current]);
const padCount = () => (isFx(state.tracks[state.current]) ? FX_LIST.length : DRUM_PADS.length);
const rowCount = () => (drumView() ? padCount() : TOP - BOTTOM + 1);
const pitchRange = () => (drumView() ? [0, padCount() - 1] : [BOTTOM, TOP]);
const rowToPitch = (row) => (drumView() ? row : TOP - row);
const pitchToRow = (p) => (drumView() ? p : TOP - p);

// 時間・音の高さ ⇔ 画面の位置
const timeToX = (t) => KEY_W + (t - view.x) * view.unitW;
const pitchToY = (p) => RULER_H + pitchToRow(p) * ROW_H - view.y;
const unitAt = (x) => view.x + (x - KEY_W) / view.unitW;
const pitchAt = (y) => rowToPitch(Math.floor((y - RULER_H + view.y) / ROW_H));
const snapFloor = (u) => Math.floor(u / state.grid) * state.grid;   // 左のグリッド線に合わせる
const snapRound = (u) => Math.round(u / state.grid) * state.grid;   // 近い方のグリッド線に合わせる

function drawNotes(track, alpha, isCurrent) {
  ctx.globalAlpha = alpha;
  for (const n of track.notes) {
    const x = timeToX(n.start) + 1;
    const y = pitchToY(n.pitch) + 1;
    const w = Math.max(2, n.length * view.unitW - 2);
    ctx.globalAlpha = alpha * (0.35 + 0.65 * (n.velocity / 127));   // 弱い音ほど薄く
    ctx.fillStyle = track.color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, ROW_H - 3, 3);
    ctx.fill();
    if (isCurrent && state.selected.has(n)) {   // 選択中の音は白い枠
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (w > 30 && isCurrent && !isPadTrack(track)) {
      ctx.fillStyle = "#1a1408";
      ctx.fillText(NAMES[n.pitch % 12], x + 4, y + 13);
    }
  }
  ctx.globalAlpha = 1;
}

function drawRoll() {
  if (!resizeCanvas()) return;
  ctx.clearRect(0, 0, W, H);
  const scale = scalePcs();
  const firstRow = Math.floor(view.y / ROW_H);
  const lastRow = Math.ceil((view.y + H - LANE_H - RULER_H) / ROW_H);

  // ---- マス目（はみ出した分は切り取る） ----
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEY_W, RULER_H, W - KEY_W, H - LANE_H - RULER_H);
  ctx.clip();

  const drums = drumView();
  const rows = rowCount();

  // 行：白鍵は少し明るく、スケールの音は青っぽく（ドラムは1行おきに色を変えるだけ）
  for (let row = firstRow; row <= lastRow && row < rows; row++) {
    const p = rowToPitch(row);
    if (drums) {
      ctx.fillStyle = row % 2 ? "#26282d" : "#2c2e34";
    } else {
      const pc = p % 12;
      const black = BLACK.includes(pc);
      const inScale = scale.includes(pc);
      ctx.fillStyle = inScale ? (black ? "#262c38" : "#313949") : (black ? "#1f2024" : "#2a2c31");
    }
    ctx.fillRect(KEY_W, pitchToY(p), W - KEY_W, ROW_H - 1);
  }

  // コードの音の行を光らせる（ルート音は黄色、ほかの音は緑）。ドラムのときは光らせない
  if (state.highlight && !drums) {
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
    ctx.fillRect(Math.round(timeToX(t)), RULER_H, 1, H - LANE_H - RULER_H);
  }

  // 音：ほかのトラックは薄く、編集中のトラックははっきり（楽器とドラムは行の並びが違うので、同じ種類だけ重ねる）
  ctx.font = "11px sans-serif";
  const curType = state.tracks[state.current].type;
  state.tracks.forEach((t, i) => { if (i !== state.current && t.type === curType) drawNotes(t, 0.3, false); });
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

  // Ctrl で縮める・広げるときは、何倍かを出す
  if (drag && drag.stretch && mouse) {
    ctx.fillStyle = "#f2a541";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText("×" + drag.stretch.toFixed(2), mouse.x + 12, mouse.y - 8);
    ctx.font = "11px sans-serif";
  }

  // 再生位置の線
  if (state.playing) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(Math.round(timeToX(player.pos)), RULER_H, 2, H - LANE_H - RULER_H);
  }
  ctx.restore();

  // ---- 左の鍵盤 ----
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_H, KEY_W, H - LANE_H - RULER_H);
  ctx.clip();
  // ドラム：パッドの名前を並べる
  if (drums) {
    const track = state.tracks[state.current];
    for (let row = firstRow; row <= lastRow && row < rows; row++) {
      const y = pitchToY(row);
      ctx.fillStyle = row === state.pad ? "#f2a541" : "#d9d9de";
      ctx.fillRect(0, y, KEY_W - 1, ROW_H - 1);
      ctx.fillStyle = "#1d1d1f";
      const label = padName(track, row);
      ctx.font = ctx.measureText(label).width > KEY_W - 10 ? "9px sans-serif" : "11px sans-serif";   // 長い名前は小さく
      ctx.fillText(label, 6, y + 14);
      ctx.font = "11px sans-serif";
    }
  }
  for (let row = firstRow; row <= lastRow && !drums; row++) {
    const p = TOP - row;
    if (p < BOTTOM) break;
    const pc = p % 12;
    const black = BLACK.includes(pc);
    const y = pitchToY(p);
    ctx.fillStyle = liveKeys.has(p) ? "#f2a541" : black ? "#141518" : "#e6e6ea";   // キーボードで弾いている音はオレンジ
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
  // ループの範囲（全部のときは出さない）
  if (state.loop[0] > 0 || state.loop[1] < 8) {
    const x1 = timeToX(loopStart()), x2 = timeToX(loopEnd());
    ctx.fillStyle = "rgba(242,165,65,0.28)";
    ctx.fillRect(x1, 0, x2 - x1, RULER_H);
    ctx.fillStyle = "#f2a541";
    ctx.fillRect(x1, RULER_H - 3, x2 - x1, 3);
  }
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
  drawVelocityLane();
}

// ---- 下の「強さ」の欄：編集中のトラックの音を、棒の高さで見せる ----
function drawVelocityLane() {
  const top = H - LANE_H;
  const base = H - 6, span = LANE_H - 14;   // 棒の根元と、最大の長さ
  ctx.fillStyle = "#17181b";
  ctx.fillRect(0, top, W, LANE_H);
  ctx.fillStyle = "#2c2e34";
  ctx.fillRect(0, top, W, 1);
  ctx.fillStyle = "#a1a3aa";
  ctx.font = "11px sans-serif";
  ctx.fillText("強さ", 8, top + 18);
  ctx.fillStyle = "#6b6d74";
  ctx.font = "10px sans-serif";
  ctx.fillText("ドラッグで", 8, top + 36);
  ctx.fillText("変える", 8, top + 50);
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEY_W, top + 1, W - KEY_W, LANE_H - 1);
  ctx.clip();
  for (let b = 0; b <= 8; b++) {   // 小節の線
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(Math.round(timeToX(b * BAR)), top, 1, LANE_H);
  }
  ctx.fillStyle = "rgba(255,255,255,0.06)";   // 真ん中（64）の目安線
  ctx.fillRect(KEY_W, Math.round(base - span / 2), W - KEY_W, 1);
  const track = state.tracks[state.current];
  for (const n of track.notes) {
    const x = Math.round(timeToX(n.start)) + 1;
    const h = (n.velocity / 127) * span;
    const sel = state.selected.has(n);
    ctx.fillStyle = sel ? "#ffffff" : track.color;
    ctx.fillRect(x, base - h, 3, h);
    ctx.beginPath();
    ctx.arc(x + 1.5, base - h, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (drag && drag.mode === "vel" && drag.show) {   // ドラッグ中は数字を出す
    ctx.fillStyle = "#f2a541";
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(String(drag.show.v), Math.min(W - 30, drag.show.x + 8), Math.max(top + 14, drag.show.y));
  }
  ctx.restore();
}

// 強さの欄の位置 → 強さ（1〜127）
const velAt = (y) => Math.max(1, Math.min(127, Math.round(((H - 6 - y) / (LANE_H - 14)) * 127)));
// その横位置にある音（頭の位置が近いもの）
function notesAtX(x) {
  const r = Math.max(4, (state.grid * view.unitW) / 2);
  return currentNotes().filter((n) => Math.abs(timeToX(n.start) - x) <= r);
}

// 強さを変える：選択中の音の棒をつかんだら選択中の音を全部、そうでなければ、なぞった所の音を変える
function setVelocity(x, y) {
  const v = velAt(y);
  const hit = notesAtX(x);
  if (drag.group) {
    for (const n of state.selected) n.velocity = v;
  } else {
    for (const n of hit) n.velocity = v;
  }
  drag.show = { v, x, y };
  drawRoll();
}

// ================================================

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
  if (y < RULER_H) {                      // 小節番号の上：ドラッグでループの範囲を決める
    if (x < KEY_W || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const bar = Math.max(0, Math.min(7, Math.floor(unitAt(x) / BAR)));
    drag = { mode: "loop", bar0: bar, x0: x, moved: false };
    return;
  }
  if (y >= H - LANE_H) {                  // 下の「強さ」の欄
    if (x < KEY_W || e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const hit = notesAtX(x);
    drag = { mode: "vel", group: hit.some((n) => state.selected.has(n)) && state.selected.size > 1 };
    setVelocity(x, y);
    return;
  }
  if (x < KEY_W) {                        // 鍵盤（ドラムはパッドの名前）を押すと、その音を鳴らす
    const p = pitchAt(y);
    const [lo, hi] = pitchRange();
    if (e.button === 0 && p >= lo && p <= hi) {
      preview(p);
      if (drumView()) { state.pad = p; renderPads(); drawRoll(); }
    }
    return;
  }
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
    const [lo, hi] = pitchRange();
    if (p < lo || p > hi || u >= TOTAL) return;
    const start = snapFloor(u);
    const note = { pitch: p, start: start, length: Math.min(state.noteLength, TOTAL - start), velocity: 100 };
    currentNotes().push(note);
    state.selected.clear();
    state.selected.add(note);
    preview(p);
    drag = { mode: "resize", grab: note, moved: true, created: true };
  }
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
    if (y >= H - LANE_H) { canvas.style.cursor = x >= KEY_W ? "ns-resize" : "default"; return; }
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
  if (drag.mode === "vel") { setVelocity(x, y); return; }
  if (drag.mode === "loop") {
    if (Math.abs(x - drag.x0) < 4 && !drag.moved) return;
    drag.moved = true;
    const bar = Math.max(0, Math.min(7, Math.floor(unitAt(x) / BAR)));
    setLoop(Math.min(drag.bar0, bar), Math.max(drag.bar0, bar) + 1);
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
    if ((e.ctrlKey || e.metaKey) && !drag.created && drag.orig.length > 1) {
      // Ctrl を押しながら：選択中の音全体を、横に縮める・広げる（位置も長さも同じ割合で）
      // 一番左の音の頭を動かない点にして、つかんだ音の終わりがマウスに来るように割合を決める
      const anchor = Math.min(...drag.orig.map((o) => o.start));
      const end = Math.max(anchor + 1, snapRound(origEnd + raw));
      let k = (end - anchor) / (origEnd - anchor);
      const maxEnd = Math.max(...drag.orig.map((o) => o.start + o.length));
      k = Math.min(k, (TOTAL - anchor) / (maxEnd - anchor));   // 8小節からはみ出さない
      for (const o of drag.orig) {
        o.n.start = anchor + Math.round((o.start - anchor) * k);
        o.n.length = Math.max(1, Math.round(o.length * k));
      }
      drag.stretch = k;
    } else {
      for (const o of drag.orig) {
        o.n.start = o.start;
        o.n.length = Math.max(state.grid, Math.min(TOTAL - o.start, o.length + dt));
      }
      drag.stretch = null;
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
    const [lo, hi] = pitchRange();
    dt = Math.max(-minStart, Math.min(TOTAL - maxEnd, dt));
    dp = Math.max(lo - minPitch, Math.min(hi - maxPitch, dp));

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

  if (drag.mode === "loop") {
    // クリックだけ：全部をループしていたらその1小節だけ、範囲があったら全部に戻す
    if (!drag.moved) state.loop[0] === 0 && state.loop[1] === 8 ? setLoop(drag.bar0, drag.bar0 + 1) : setLoop(0, 8);
    drag = null;
    drawRoll();
    return;
  }
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

  drag = null;   // 「元に戻す」の記録は、操作が終わったときにまとめてやる（commitSoon）
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
