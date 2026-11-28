// parser.js：説明の文章 → HTML（タグ・▶ボタン・クイズ・用語）
// ほかのファイルと名前を共有している（<script> で順番に読み込むので、上のファイルで作ったものは下のファイルで使える）

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
  m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], mM7: [0, 3, 7, 11], "maj7#5": [0, 4, 8, 11],
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
  // String.raw`…` の中では ` が書けないので、\` と書いたら ` にする
  const lines = src.replace(/\r/g, "").replace(/\\`/g, "`").split("\n");
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
        let body = sameLine ? [sameLine, ...inner] : inner;
        // 「:::try 確認=コード:4」：DAW の中身を見て、できたら ✓ を出す
        let check = "";
        if (boxName === "try" && /^確認\s*[=＝]/.test(sameLine)) {
          check = sameLine.replace(/^確認\s*[=＝]\s*/, "").replace(/"/g, "");
          body = inner;
        }
        html += '<div class="box box-' + boxName + '"><p class="box-label">' + (BOX_LABELS[boxName] || boxName) + "</p>" +
                parseBlocks(body, step, stepIndex, only) +
                (check ? '<p class="try-check" data-check="' + check + '"></p>' : "") + "</div>";
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

// ---------- 「やってみよう」の確認 ----------
// 「コード:4, ドラム:8」のように「トラック:音の数」を並べる。全部そろったら ✓
// トラックは名前の一部で探す。「ドラム」「FX」「シンセ」「コード」「メロディ」は種類・役目でも探す。「トラック数:4」はトラックの数
function trackMatches(t, key) {
  return t.name.includes(key) || (key === "ドラム" && isDrum(t)) || (key === "FX" && isFx(t)) ||
         (key === "シンセ" && t.instrument === "synth" && !isPadTrack(t)) || (key === "コード" && t.role === "chord") || (key === "メロディ" && t.role === "melody");
}
function evalCheck(text) {
  const parts = text.split(/[,、，]/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(.+?)\s*[:：]\s*(\d+)$/);
    if (!m) return null;
    const key = m[1].trim(), need = Number(m[2]);
    if (key === "トラック数") return { label: "トラック", have: state.tracks.length, need, unit: "個" };
    const have = Math.max(0, ...state.tracks.filter((t) => trackMatches(t, key)).map((t) => t.notes.length));
    return { label: key, have, need, unit: "音" };
  }).filter(Boolean);
  return { ok: parts.every((p) => p.have >= p.need), parts };
}
function updateTryChecks() {
  document.querySelectorAll("#lesson .try-check").forEach((el) => {
    const r = evalCheck(el.dataset.check);
    el.classList.toggle("done", r.ok);
    el.textContent = r.ok ? "✓ できた！" : "まだ：" + r.parts.filter((p) => p.have < p.need).map((p) => p.label + " " + Math.min(p.have, p.need) + "／" + p.need + p.unit).join("　");
  });
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

// クイズの答えを覚える名前（本ごとに分ける）
const ansKey = (stepIndex, qi) => state.book + ":" + stepIndex + "-" + qi;

// クイズ1つ分の HTML（答えたかどうかで見た目が変わる）
// stepIndex は steps の番号（並べ替えても変わらない番号）。答えもこの番号で覚える
// page を渡すと、steps 以外のページ（ジャンル別など）のクイズも出せる
function quizHtml(stepIndex, qi, page) {
  const q = (page || steps[stepIndex]).quizzes[qi];
  const ans = state.answers[ansKey(stepIndex, qi)];
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
    const a = state.answers[ansKey(stepIndex, qi)];
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
  updateTryChecks();
  markDirty();          // 開いているステップも自動保存する

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
function showTip(el, index) {
  const g = GLOSSARY[index !== undefined ? index : Number(el.dataset.term)];
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

// ---------- 作曲画面でも、用語の説明を出す（右上の「用語ヒント」で ON／OFF） ----------
// ボタン・つまみ・見出しの文字に登録した言葉があれば、マウスを乗せたときに説明を出す
// 英語のつまみの名前は、日本語の言葉に読みかえて探す
const DAW_ALIAS = {
  PITCH: "ピッチ", FINE: "セント", UNISON: "ユニゾン", DETUNE: "デチューン", PAN: "パン", LEVEL: "音量",
  OSC: "オシレーター", NOISE: "ノイズ", ENVELOPE: "エンベロープ", WOBBLE: "ウォブル", EFFECTS: "エフェクト",
  CHORUS: "コーラス", COMPRESSOR: "コンプ", DELAY: "ディレイ", DISTORTION: "ディストーション", FILTER: "フィルター",
  FLANGER: "フランジャー", PHASER: "フェイザー", REVERB: "リバーブ", DRIVE: "ディストーション", CUTOFF: "カットオフ",
  "SIDECHAIN OUT": "サイドチェイン", "TEMPO SYNC": "タイムストレッチ", "PLAY MODE": "サンプラー", SAMPLE: "サンプル",
  SLICE: "スライス", "AUTO SLICE": "スライス", "SPLIT EVENLY": "スライス", REPITCH: "ピッチ", "SAMPLE BPM": "BPM",
  M: "ミュート", S: "ソロ", "キックで下げる": "サイドチェイン", "響き": "センド", "強さ": "ベロシティ", "シンセを開く": "シンセ",
  "リズムの型": "四つ打ち", "メトロノーム": "メトロノーム", "MIDI 鍵盤": "MIDI キーボード"
};
let dawHints = true;
try { dawHints = localStorage.getItem("zero8-daw-hints") !== "off"; } catch (err) { /* 保存できなくても ON のまま */ }
function termForControl(el) {
  let text = "";
  if (el.classList.contains("knob")) text = el.querySelector(".knob-label").textContent;
  else if (el.matches("label")) {   // 「グリッド <select>」のような所は、中の選択欄の文字を除いた言葉だけ
    const span = el.querySelector(":scope > span");
    text = span ? span.textContent : [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
  }
  else text = el.textContent;
  text = text.replace(/[：:（(].*$/, "").replace(/[▶◀■＋+]/g, "").trim();
  if (!text || text.length > 24) return null;
  const alias = DAW_ALIAS[text.toUpperCase()] || DAW_ALIAS[text];
  if (alias && TERM_INDEX[alias] !== undefined) return TERM_INDEX[alias];
  if (TERM_INDEX[text] !== undefined) return TERM_INDEX[text];
  // 大文字・小文字の違いを気にしない（「Attack」→「アタック|Attack」など）
  const key = Object.keys(TERM_INDEX).find((k) => k.toLowerCase() === text.toLowerCase());
  if (key) return TERM_INDEX[key];
  TERM_REGEX.lastIndex = 0;
  const m = TERM_REGEX && TERM_REGEX.exec(text);
  return m ? TERM_INDEX[m[0]] : null;
}
let dawTipTimer = null, dawTipEl = null;
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest(".term");
  clearTimeout(dawTipTimer);
  if (el) { showTip(el); return; }
  const ctl = dawHints && e.target.closest("#daw") && e.target.closest(".knob, button, label, .syn-title b, .pads-title, .syn-h, .kind, .pad");
  if (ctl && ctl.closest("#daw")) {
    if (ctl === dawTipEl && !tip.hidden) return;
    const idx = TERM_REGEX ? termForControl(ctl) : null;
    if (idx !== null && idx !== undefined) {
      dawTipEl = ctl;
      dawTipTimer = setTimeout(() => showTip(ctl, idx), 350);   // 少し止まったら出す（通りすぎただけでは出さない）
      return;
    }
  }
  dawTipEl = null;
  hideTip();
});
$("hint-toggle").addEventListener("click", (e) => {
  dawHints = !dawHints;
  try { localStorage.setItem("zero8-daw-hints", dawHints ? "on" : "off"); } catch (err) { /* 保存できなくても切り替えはできる */ }
  renderHintToggle();
  e.target.blur();
});
function renderHintToggle() {
  const b = $("hint-toggle");
  b.textContent = "用語ヒント：" + (dawHints ? "ON" : "OFF");
  b.classList.toggle("active", dawHints);
  b.setAttribute("aria-pressed", dawHints);
}
renderHintToggle();
document.addEventListener("pointerdown", () => { clearTimeout(dawTipTimer); if (dawTipEl) hideTip(); });
document.addEventListener("focusin", (e) => { if (e.target.classList.contains("term")) showTip(e.target); });
document.addEventListener("focusout", hideTip);
$("lesson").addEventListener("scroll", hideTip);
$("glossary").addEventListener("scroll", hideTip);
$("chart").addEventListener("scroll", hideTip);
$("qol").addEventListener("scroll", hideTip);
