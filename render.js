// render.js：描画（トラック一覧・パッド）
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）

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
  renderPads();
  renderChordPads();
  renderSynth();
  renderHlSelect();
  drawRoll();
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// トラック一覧を作り直す
function renderTracks() {
  let html = "";
  state.tracks.forEach((t, i) => {
    const cls = ["track"];
    if (i === state.current) cls.push("selected");
    if (!isAudible(t)) cls.push("silent");
    const name = esc(t.name);
    // 楽器トラックは音色の選択欄、ドラムトラックは「ドラム」の印
    let kind;
    if (isDrum(t)) {
      kind = '<p class="kind">ドラム（パッド16個）</p>';
    } else if (isFx(t)) {
      kind = '<p class="kind">FX（効果音8個）</p>';
    } else {
      let options = "";
      for (const key in INSTRUMENTS) {
        options += '<option value="' + key + '"' + (key === t.instrument ? " selected" : "") + ">" + INSTRUMENTS[key].name + "</option>";
      }
      options += '<option value="synth"' + (t.instrument === "synth" ? " selected" : "") + ">シンセ（自分で作る）</option>";
      kind = '<select class="inst" data-action="inst" aria-label="' + name + 'の音色">' + options + "</select>";
      if (t.instrument === "synth") kind += '<button class="open-synth" data-action="synth">シンセを開く</button>';
    }
    html +=
      '<div class="' + cls.join(" ") + '" data-index="' + i + '">' +
        '<div class="track-row">' +
          '<span class="dot" style="background:' + t.color + '"></span>' +
          (state.renaming === i
            ? '<input class="rename" value="' + name + '" maxlength="12" aria-label="トラックの名前">'
            : '<button class="name" data-action="select" title="2回続けてクリックで名前を変える">' + name + "</button>") +
          '<button class="ms' + (t.mute ? " mute-on" : "") + '" data-action="mute" aria-label="' + name + 'をミュート" aria-pressed="' + t.mute + '">M</button>' +
          '<button class="ms' + (t.solo ? " solo-on" : "") + '" data-action="solo" aria-label="' + name + 'だけ再生" aria-pressed="' + t.solo + '">S</button>' +
          (state.tracks.length > 1
            ? (state.confirmRemove === i
                ? '<button class="ms del sure" data-action="remove" aria-label="' + name + 'を本当に消す">消す</button>'
                : '<button class="ms del" data-action="remove" aria-label="' + name + 'を消す" title="トラックを消す（もう一度押すと消える）">×</button>')
            : "") +
        "</div>" +
        kind +
        '<label class="vol"><span>音量</span><input type="range" class="vol-range" data-prop="volume" min="0" max="100" value="' + t.volume + '" aria-label="' + name + 'の音量"><output>' + t.volume + "</output></label>" +
        '<div class="meter" aria-hidden="true"><i></i></div>' +
        (i === state.current ? trackToolsHtml(t, i, name) : "") +
      "</div>";
  });
  $("tracks").innerHTML = html;
  const full = state.tracks.length >= MAX_TRACKS;
  for (const id of ["add-inst", "add-synth", "add-drum", "add-fx"]) $(id).disabled = full;
}

// 編集中のトラックだけに出す、細かい設定（パン・リバーブ・サイドチェイン・並べかえ・複製）
function trackToolsHtml(t, i, name) {
  const pan = t.pan || 0;
  const panText = pan === 0 ? "C" : (pan < 0 ? "L" : "R") + Math.abs(pan);
  return '<div class="track-tools">' +
      '<label class="vol"><span>パン</span><input type="range" class="vol-range" data-prop="pan" min="-100" max="100" value="' + pan + '" aria-label="' + name + 'の左右" title="ダブルクリックで真ん中"><output>' + panText + "</output></label>" +
      '<label class="vol"><span>響き</span><input type="range" class="vol-range" data-prop="send" min="0" max="100" value="' + (t.send || 0) + '" aria-label="' + name + 'のリバーブ" title="みんなで使うリバーブに送る量"><output>' + (t.send || 0) + "</output></label>" +
      '<div class="tool-row">' +
        '<button class="ms duck' + (t.duck ? " duck-on" : "") + '" data-action="duck" aria-pressed="' + !!t.duck + '" title="サイドチェイン：キックが鳴った瞬間だけ、このトラックの音量を下げる">' + (t.duck ? "キックで下げる：ON" : "キックで下げる：OFF") + "</button>" +
      "</div>" +
      '<div class="tool-row">' +
        '<button class="ms" data-action="up" aria-label="' + name + 'を上へ"' + (i === 0 ? " disabled" : "") + ">↑</button>" +
        '<button class="ms" data-action="down" aria-label="' + name + 'を下へ"' + (i === state.tracks.length - 1 ? " disabled" : "") + ">↓</button>" +
        '<button class="ms" data-action="dup" title="同じトラックをもう1つ作る"' + (state.tracks.length >= MAX_TRACKS ? " disabled" : "") + ">複製</button>" +
      "</div>" +
    "</div>";
}

let lastPattern = 0;   // 最後に選んだリズムの型

// ドラムトラックを編集しているときだけ、パッド16個とリズムの型を出す
function renderPads() {
  const track = state.tracks[state.current];
  const box = $("pads");
  box.hidden = !isPadTrack(track);
  if (box.hidden) return;
  if (isFx(track)) {   // FX：一覧と使いどころだけ
    let h = '<p class="pads-title">FX<span>クリックで鳴る</span></p><div class="pad-grid fx-grid">';
    FX_LIST.forEach((f, i) => { h += '<button class="pad' + (i === state.pad ? " selected" : "") + '" data-pad="' + i + '">' + f.name + "</button>"; });
    const f = FX_LIST[state.pad] || FX_LIST[0];
    h += '</div><p class="fx-memo"><b>' + f.name + "</b>：" + f.memo + (f.fit ? "（置いた音の長さだけ鳴る）" : "") + "</p>";
    box.innerHTML = h;
    return;
  }
  let html = '<p class="pads-title">パッド<span>クリックで鳴る・音声ファイルをドロップで差し替え</span></p><div class="pad-grid">';
  DRUM_PADS.forEach((p, i) => {
    const custom = customSample(track, i);
    html += '<button class="pad' + (i === state.pad ? " selected" : "") + (custom ? " custom" : "") + '" data-pad="' + i + '" title="' + esc(padName(track, i)) + '">' + esc(padName(track, i)) + "</button>";
  });
  html += "</div>";
  const custom = customSample(track, state.pad);
  html +=
    '<div class="pad-load">' +
      '<p>選んだパッド：<b>' + esc(padName(track, state.pad)) + "</b></p>" +
      '<button data-action="load">自分の音を読み込む</button>' +
      (custom ? '<button data-action="reset">元の音に戻す</button>' : "") +
    "</div>" +
    '<div class="pad-pattern"><select id="pattern" aria-label="リズムの型">' +
      DRUM_PATTERNS.map((p, k) => '<option value="' + k + '"' + (k === lastPattern ? " selected" : "") + ">" + p.name + "</option>").join("") +
    '</select><button data-action="pattern">型を入れる</button></div>';
  box.innerHTML = html;
}
