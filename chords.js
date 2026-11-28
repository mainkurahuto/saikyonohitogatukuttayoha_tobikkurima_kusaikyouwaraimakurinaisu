// chords.js：早見表・コードを光らせる・コードパッド・ベース、説明の本を作る
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）

// ---------- 早見表（コードの構成音・定番のコード進行） ----------
const EN_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const keyLabel = () => EN_NAMES[state.key] + " " + SCALE_TYPES[state.scale].name;
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
// 3度ずつ重ねた音の間隔 → コードの種類
const TRIAD_TYPES = { "4,7": "", "3,7": "m", "3,6": "dim", "4,8": "aug" };
const SEVENTH_TYPES = { "4,7,11": "maj7", "3,7,10": "m7", "4,7,10": "7", "3,6,10": "m7b5", "3,6,9": "dim7", "3,7,11": "mM7", "4,8,11": "maj7#5" };

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
// キーの何番目（0から）のコードか → { 名前, 度数, 構成音(MIDI), ベース音(MIDI) }
// type を書かなければ、スケールの音を3度ずつ重ねて自然にできる種類。seventh なら4つ重ねた7thコード
function chordInKey(deg, type, seventh) {
  const st = chordSteps();
  const at = (k) => (st[(deg + k) % 7] - st[deg] + 12) % 12;   // ルートから何半音上か
  const rootPc = (state.key + st[deg]) % 12;
  let t = type;
  if (t === undefined) t = seventh ? SEVENTH_TYPES[[at(2), at(4), at(6)].join(",")] : TRIAD_TYPES[[at(2), at(4)].join(",")];
  if (t === undefined) t = "";
  const name = EN_NAMES[rootPc] + t;
  const notes = chordToMidis(name);
  // 度数：メジャースケールより低ければ ♭、高ければ ♯。暗いコードは小文字
  const diff = st[deg] - MAJOR[deg];
  const acc = diff < 0 ? "♭" : diff > 0 ? "♯" : "";
  let roman = ROMAN[deg];
  if (/^m(?!aj)|^dim/.test(t)) roman = roman.toLowerCase();
  const MARKS = { "": "", m: "", dim: "°", aug: "+", dim7: "°7", m7b5: "ø7" };
  const mark = t in MARKS ? MARKS[t] : t.replace(/^m(?!aj)/, "");
  return { name, degree: acc + roman + mark, notes, bass: notes[0] - 12 };
}

// <play=...> に渡す書き方を作る（ベース音を入れるなら「+ベース音」を足す）
function chordSpec(c, beats) {
  return "[" + c.name + "]" + (state.chartBass ? "+" + midiName(c.bass) : "") + ":" + beats;
}

function chartHtml() {
  let html = '<p class="toc-title">早見表</p>';
  html += '<p class="toc-score">キー：' + keyLabel() + "（作曲画面の「キー」「スケール」を変えると、表も変わります）</p>";
  html += '<label class="chart-bass"><input type="checkbox" id="chart-bass"' + (state.chartBass ? " checked" : "") +
          "><span>ベース音（一番下の音の1オクターブ下）も一緒に</span></label>";

  // このキーで使えるコード
  html += '<h3 class="chart-h">このキーで使えるコード</h3>';
  html += '<table class="chart-table"><thead><tr><th>度数</th><th>コード</th><th>構成音</th><th></th></tr></thead><tbody>';
  for (let d = 0; d < 7; d++) {
    const c = chordInKey(d);
    const names = c.notes.map((m) => NAMES[m % 12]).join("・");
    const bass = state.chartBass ? '<span class="chart-basstext">＋ベース ' + NAMES[c.bass % 12] + "</span>" : "";
    html += "<tr><td class=\"chart-deg\">" + c.degree + '</td><td class="chart-name">' + c.name + "</td><td>" + names + bass +
            '</td><td class="chart-btns"><button class="play-btn" data-play="' + chordSpec(c, 2) + '" aria-label="' + c.name + 'を聴く">▶</button>' +
            '<button class="hl-btn small" data-hl="' + c.name + '" aria-label="' + c.name + 'の音を作曲画面で光らせる" title="作曲画面で光らせる"><span class="hl-dot"></span></button></td></tr>';
  }
  html += "</tbody></table>";
  html += '<p class="chart-note">大文字（I・IV・V など）は明るいコード、小文字（ii・vi など）は暗いコードです。° のついたコードは不安定なので、最初は使わなくて大丈夫。</p>';

  // 定番のコード進行
  html += '<h3 class="chart-h">定番のコード進行</h3>';
  PROGRESSIONS.forEach((p, i) => {
    const cs = p.chords.map(([d, t]) => chordInKey(d, t));
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
    const ct = chordTrack();
    if (!ct) return null;
    const inBar = ct.notes.filter((n) => n.start < e && n.start + n.length > s);
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
  const names = [0, 1, 2, 3, 4, 5, 6].map((d) => chordInKey(d).name);
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
  const cs = PROGRESSIONS[i].chords.map(([d, t]) => chordInKey(d, t));
  const ct = ensureChordTrack();
  if (ct) putChords(ct, cs);
}

// ---------- コードのリズム ----------
// 1小節の中で、コードを鳴らす [位置, 長さ]（48分単位。1拍 = 12）
const CHORD_RHYTHMS = [
  { name: "1つ打ち（全音符）", hits: [[0, 48]] },
  { name: "2つ打ち（2分音符）", hits: [[0, 24], [24, 24]] },
  { name: "4つ打ち（4分音符）", hits: [[0, 12], [12, 12], [24, 12], [36, 12]] },
  { name: "付点8分×2＋8分（×2）", hits: [[0, 9], [9, 9], [18, 6], [24, 9], [33, 9], [42, 6]] },
  { name: "付点4分×2＋4分", hits: [[0, 18], [18, 18], [36, 12]] }
];

// コードの並びを、選んでいるリズムで track に入れる（1小節に1コード。足りなければ最初から繰り返して8小節にする）
function putChords(track, cs) {
  if (!cs.length) return;
  pushHistory();
  const hits = CHORD_RHYTHMS[state.rhythm].hits;
  const notes = [];
  for (let bar = 0; bar < 8; bar++) {
    const c = cs[bar % cs.length];
    const pitches = state.chartBass ? [c.bass, ...c.notes] : c.notes;
    for (const [t, len] of hits) {
      for (const p of pitches) notes.push({ pitch: p, start: bar * BAR + t, length: len, velocity: 90 });
    }
  }
  track.notes = notes;
  state.selected.clear();
  render();
}

// 今あるコードはそのままで、リズムだけ選んだ型に変える（小節ごとに、その小節で鳴っている音の高さを集めて並べ直す）
function applyRhythm(track) {
  const hits = CHORD_RHYTHMS[state.rhythm].hits;
  pushHistory();
  const notes = [];
  for (let bar = 0; bar < 8; bar++) {
    const s0 = bar * BAR, e0 = s0 + BAR;
    const pitches = [...new Set(track.notes.filter((n) => n.start < e0 && n.start + n.length > s0).map((n) => n.pitch))];
    for (const [t, len] of hits) {
      for (const p of pitches) notes.push({ pitch: p, start: s0 + t, length: len, velocity: 90 });
    }
  }
  track.notes = notes;
  state.selected.clear();
  render();
}

// ---------- ベース ----------
// 1小節の中で、ルート音を鳴らす [位置, 長さ]。"chord" はコードのリズムと同じにする
const BASS_PATTERNS = [
  { name: "1つ打ち（のばす）", hits: [[0, 48]] },
  { name: "4分で刻む", hits: [[0, 12], [12, 12], [24, 12], [36, 12]] },
  { name: "8分で刻む", hits: [0, 6, 12, 18, 24, 30, 36, 42].map((t) => [t, 6]) },
  { name: "裏拍（キックとずらす）", hits: [6, 18, 30, 42].map((t) => [t, 6]) },
  { name: "コードのリズムと同じ", hits: "chord" }
];

// コードトラックの小節ごとに一番低い音を探し、その音を C2〜B2 の高さにしてベースにする
function insertBass(track) {
  const pat = BASS_PATTERNS[state.bassPattern];
  const hits = pat.hits === "chord" ? CHORD_RHYTHMS[state.rhythm].hits : pat.hits;
  pushHistory();
  const notes = [];
  for (let bar = 0; bar < 8; bar++) {
    const s0 = bar * BAR, e0 = s0 + BAR;
    const inBar = chordTrack().notes.filter((n) => n.start < e0 && n.start + n.length > s0);
    if (!inBar.length) continue;
    const root = Math.min(...inBar.map((n) => n.pitch)) % 12;
    for (const [t, len] of hits) notes.push({ pitch: 36 + root, start: s0 + t, length: len, velocity: 100 });
  }
  track.notes = notes;
  state.selected.clear();
  render();
}

// コードパッドを出すトラック：メロディ以外の楽器トラック
const chordPadTrack = () => {
  const t = state.tracks[state.current];
  return !isPadTrack(t) && t.role !== "melody" ? t : null;
};

function renderChordPads() {
  const track = chordPadTrack();
  const box = $("chordpads");
  box.hidden = !track;
  if (!track) return;
  let html = '<p class="pads-title">コードパッド<span>押すと鳴って、下に並ぶ</span></p><div class="pad-grid">';
  for (let d = 0; d < 7; d++) {
    const c = chordInKey(d, undefined, state.chord7);
    html += '<button class="pad chord-pad" data-deg="' + d + '"><b>' + c.name + "</b><small>" + c.degree + "</small></button>";
  }
  html += "</div>";
  html += '<label class="check"><input type="checkbox" id="chord7"' + (state.chord7 ? " checked" : "") + '>7thコードにする</label>';
  html += '<label class="check"><input type="checkbox" id="chord-bass"' + (state.chartBass ? " checked" : "") + '>ベース音も入れる</label>';
  // 選んだコードの並び
  html += '<div class="seq">';
  if (state.chordSeq.length === 0) html += '<p class="seq-empty">パッドを押すと、ここに並びます（8つまで）</p>';
  state.chordSeq.forEach((x, i) => {
    html += '<button class="seq-chip" data-seq="' + i + '" aria-label="' + (i + 1) + "番目を消す" + '">' + chordInKey(x.deg, undefined, x.seventh).name + "<span>×</span></button>";
  });
  html += "</div>";
  html += '<label class="rhythm">リズム<select id="rhythm">' +
    CHORD_RHYTHMS.map((r, k) => '<option value="' + k + '"' + (k === state.rhythm ? " selected" : "") + ">" + r.name + "</option>").join("") + "</select></label>";
  html += '<div class="pad-load">' +
    '<button data-action="seq-insert"' + (state.chordSeq.length ? "" : " disabled") + ">このトラックに入れる</button>" +
    '<button data-action="seq-clear"' + (state.chordSeq.length ? "" : " disabled") + ">並びを消す</button>" +
    '<button data-action="rhythm"' + (track.notes.length ? "" : " disabled") + ">今のコードのリズムだけ変える</button>" +
    "</div>";
  // ベース：コードトラックのルート音から作る（コードトラック以外を選んでいるとき）
  const ct = chordTrack();
  if (ct && ct !== track) {
    html += '<p class="pads-title bass-title">ベースを作る<span>コードトラックのルート音から</span></p>' +
      '<label class="rhythm">リズム<select id="bass-pattern">' +
      BASS_PATTERNS.map((b, k) => '<option value="' + k + '"' + (k === state.bassPattern ? " selected" : "") + ">" + b.name + "</option>").join("") + "</select></label>" +
      '<div class="pad-load"><button data-action="bass"' + (ct.notes.length ? "" : " disabled") + ">このトラックにベースを入れる</button></div>";
  }
  box.innerHTML = html;
}

// 説明のステップ：lessons.js に書いた文章を読み込んで作る
// （上の関数や決まりごとを全部書き終わってから実行する）
// 作曲編（lessons.js）と編曲編（arrange.js）は別々の本として読み込み、上のボタンで切り替える
// :::order・目次・クイズの答えは、本ごとに別々に覚える
function buildBook(sources, prefix) {
  ORDER_BLOCKS.length = 0;
  const st = sources.map((src, i) => parseLesson(src, prefix + i));
  return { steps: st, blocks: ORDER_BLOCKS.slice(), orderPick: {}, step: 0 };
}
const BOOKS = { compose: buildBook(LESSON_SOURCES, ""), arrange: buildBook(ARRANGE_SOURCES, "a") };
let steps = BOOKS.compose.steps;
ORDER_BLOCKS.length = 0;
ORDER_BLOCKS.push(...BOOKS.compose.blocks);
state.orderPick = BOOKS.compose.orderPick;
let order = computeOrder();   // 表示する順番（steps の番号の並び）。コード先・メロ先などで変わる

function switchBook(name) {
  if (name === state.book || !BOOKS[name].steps.length) return;
  BOOKS[state.book].step = state.step;
  state.book = name;
  const b = BOOKS[name];
  steps = b.steps;
  ORDER_BLOCKS.length = 0;
  ORDER_BLOCKS.push(...b.blocks);
  state.orderPick = b.orderPick;
  order = computeOrder();
  state.step = b.step;
  state.panel = "lesson";
  stopSound();
  $("book-compose").classList.toggle("active", name === "compose");
  $("book-arrange").classList.toggle("active", name === "arrange");
  renderExplain();
  $("lesson").scrollTop = 0;
}
// QOL（便利な機能）のページ：qol.js に書いた文章を、説明と同じ書き方で読み込む
const QOL_PAGE = parseLesson(QOL_SOURCES.join("\n"), "qol");
