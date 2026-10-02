// Japanese: no letter case, and no spaces between words, so each character
// counts as a word, as Word and Scrivener count it. Speech is set in corner
// brackets (「…」, 『…』 inside), sometimes in “…”, 〝…〟, or "…"; a leading dash
// (――) is a pause, not dialogue. Lengths are counted in characters
// (原稿用紙 sheets of 400字). No word lists yet.
// The narration pace is the broadcast norm of about 300 characters a
// minute.

export default {
  code: "ja",
  name: "Japanese",
  cased: false,
  script: "Jpan",
  segmentation: "character",
  quotes: [["「", "」"], ["『", "』"], ["“", "”"], ["〝", "〟"], ["\"", "\""]],
  dialogueDash: null,
  countUnit: "characters",
  // Usual lengths by form, in characters. Japanese draws no fixed lines:
  // 中編 is about 100 to 300 sheets of 400字 (40,000-120,000), 短編 up to
  // 100 sheets, 長編 300 and up with no upper limit, and ショートショート
  // about 10 sheets; the cap of 10,000 for flash is the Hoshi Shinichi
  // Award's entry rule. Sheets times 400 runs above a count of characters,
  // since line ends and dialogue leave cells blank. No source sets the
  // other forms, so they have no range; see docs/project-format.md.
  characterForms: {
    flash: { min: 1, max: 10000, target: 4000 },
    "short-story": { min: 4000, max: 40000, target: 20000 },
    novella: { min: 40000, max: 120000, target: 80000 },
    novel: { min: 120000, max: null, target: 150000 }
  },
  narrationRate: 300,
  labels: {
    chapter: "第{n}章",
    "chapter-heading": "{chapter}　{title}",
    contents: "目次",
    and: "{a}、{b}",
    copyright: "著作権",
    "all-rights-reserved": "本書の無断転載・複製を禁じます。",
    "published-by": "発行所：{publisher}",
    "scene-break": "場面転換",
    "cover-alt": "『{title}』の表紙",
    "start-of-content": "本文",
    "accessibility-summary": "テキストのみの書籍です。ナビゲーション可能な目次、各章の見出し、単一の論理的な読み順を備えています。",
    "accessibility-summary-cover": "説明付きの表紙画像があるテキストの書籍です。ナビゲーション可能な目次、各章の見出し、単一の論理的な読み順を備えています。",
    "review-title": "{title}（レビュー用原稿）",
    "review-intro": "レビュー用の原稿です。",
    "review-intro-build": "レビュー用の原稿です（ビルド {build}）。",
    "review-labels": "各段落には {label}（第3章の第12段落）のようなラベルが付いています。",
    "review-quote": "コメントには、ラベルと段落の書き出しを添えてください。本文が変わっても、著者が正確な箇所を見つけられます。",
    "review-quote-build": "コメントには、ラベルとビルド、段落の書き出しを添えてください。本文が変わっても、著者が正確な箇所を見つけられます。",
    "review-note-link": "各ラベルの横にある「コメント」リンクを開くと、これらが入力済みのコメントを書けます。",
    note: "コメント",
    "note-title": "{label} にコメントを書く",
    "anchor-title": "{label} へのリンク",
    by: "",
    "approximate-words": "約{words}語",
    "approximate-characters": "約{characters}字",
    "narration-opening": "『{title}』。作、{authors}。朗読、{narrator}。",
    "narration-opening-anonymous": "『{title}』。朗読、{narrator}。",
    "narration-closing": "おわり。お聴きいただいたのは、{authors}作『{title}』、朗読は{narrator}でした。",
    "narration-closing-anonymous": "おわり。お聴きいただいたのは『{title}』、朗読は{narrator}でした。",
    "screenplay-credit": "脚本",
    "screenplay-source": "原作：{authors}",
    "screenplay-source-anonymous": "原作に基づく"
  }
};
