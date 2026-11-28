// ================================================
// 最初に1回だけやること（ほかのファイルを全部読み込んでから）
// ================================================
initSynthUI();
initSynthViews();
initPadEdit();
initFxEdit();
$("book-arrange").disabled = !BOOKS.arrange.steps.length;
renderLoopSelects();
loadAutosave();      // 前に作っていたものがあれば戻す
commitHistory();     // 今の中身を「元に戻す」の出発点にする
render();            // 最初の1回
renderExplain();
prepareSoundsIdle(); // ドラムの音などを、ひまなときに作っておく

// スマホ・タブレット（マウスがない画面）で開いたら、お知らせを出す
if (window.matchMedia("(pointer: coarse) and (hover: none)").matches || window.innerWidth < 700) {
  $("mobile-note").hidden = false;
  $("mobile-ok").addEventListener("click", () => { $("mobile-note").hidden = true; });
}
