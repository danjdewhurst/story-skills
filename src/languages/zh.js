// Chinese: no letter case, and no spaces between words, so each character
// counts as a word, as Word and Scrivener count it. Speech is set in “…”
// or corner brackets (the base pack's quotes); a leading dash (——) is not
// dialogue. Lengths are counted in characters (字数).
// No word lists yet. The labels are Simplified Chinese; ./zh-hant.js has
// the Traditional ones. Narration is timed at 300 characters a minute,
// as for Japanese; Mandarin narration runs a little slower.

export default {
  code: "zh",
  name: "Chinese",
  cased: false,
  script: "Hans",
  segmentation: "character",
  dialogueDash: null,
  countUnit: "characters",
  // Usual lengths by form, in characters, from the China Writers
  // Association's prize rules: 小小说 under 2,000, 短篇 under 25,000, and
  // 中篇 25,000-130,000 (Lu Xun Literary Prize, 2022), 长篇 130,000 and up
  // with no upper limit (Mao Dun Literature Prize, 2023). Those count
  // 版面字数, a page-layout count that runs above a count of characters.
  // No source sets the other forms, so they have no range; see
  // docs/project-format.md.
  characterForms: {
    flash: { min: 1, max: 2000, target: 1500 },
    "short-story": { min: 2000, max: 25000, target: 10000 },
    novella: { min: 25000, max: 130000, target: 60000 },
    novel: { min: 130000, max: null, target: 200000 }
  },
  narrationRate: 300,
  labels: {
    chapter: "第{n}章",
    "chapter-heading": "{chapter}　{title}",
    contents: "目录",
    and: "{a}、{b}",
    copyright: "版权",
    "all-rights-reserved": "版权所有，侵权必究。",
    "published-by": "出版者：{publisher}",
    "scene-break": "场景转换",
    "cover-alt": "《{title}》封面",
    "start-of-content": "正文",
    "accessibility-summary": "纯文本图书，包含可导航的目录、每章的标题和单一的逻辑阅读顺序。",
    "accessibility-summary-cover": "文本图书，包含带描述的封面图片、可导航的目录、每章的标题和单一的逻辑阅读顺序。",
    "review-title": "{title}（审阅本）",
    "review-intro": "审阅本。",
    "review-intro-build": "审阅本，版本 {build}。",
    "review-labels": "每个段落都有一个标签，例如 {label}（第3章第12段）。",
    "review-quote": "每条意见请注明标签和该段开头的几个词，这样即使文本有改动，作者也能找到确切位置。",
    "review-quote-build": "每条意见请注明标签、版本和该段开头的几个词，这样即使文本有改动，作者也能找到确切位置。",
    "review-note-link": "每个标签旁的“意见”链接会打开一条已填好这些信息的意见。",
    note: "意见",
    "note-title": "为 {label} 写意见",
    "anchor-title": "链接到 {label}",
    by: "",
    "approximate-words": "约{words}词",
    "approximate-characters": "约{characters}字",
    "narration-opening": "《{title}》。作者：{authors}。演播：{narrator}。",
    "narration-opening-anonymous": "《{title}》。演播：{narrator}。",
    "narration-closing": "全书完。您收听的是《{title}》，作者{authors}，演播{narrator}。",
    "narration-closing-anonymous": "全书完。您收听的是《{title}》，演播{narrator}。",
    "screenplay-credit": "编剧",
    "screenplay-source": "改编自{authors}的作品",
    "screenplay-source-anonymous": "改编自原著"
  }
};
