// Chinese in Traditional characters: zh-Hant, and zh-TW, zh-HK, and zh-MO,
// which use it, layered over ./zh.js with only the script and build labels
// changed. Cantonese (yue, and zh-yue under zh) and Classical Chinese (lzh)
// are written in Traditional characters too, as ../typesetting.js sets them;
// as tags of their own they also need zh's case and segmentation.

const labels = {
  chapter: "第{n}章",
  "chapter-heading": "{chapter}　{title}",
  contents: "目錄",
  and: "{a}、{b}",
  copyright: "版權",
  "all-rights-reserved": "版權所有，翻印必究。",
  "published-by": "出版者：{publisher}",
  "scene-break": "場景轉換",
  "cover-alt": "《{title}》封面",
  "start-of-content": "正文",
  "accessibility-summary": "純文字圖書，包含可導覽的目錄、每章的標題和單一的邏輯閱讀順序。",
  "accessibility-summary-cover": "文字圖書，包含附描述的封面圖片、可導覽的目錄、每章的標題和單一的邏輯閱讀順序。",
  "review-title": "{title}（審閱本）",
  "review-intro": "審閱本。",
  "review-intro-build": "審閱本，版本 {build}。",
  "review-labels": "每個段落都有一個標籤，例如 {label}（第3章第12段）。",
  "review-quote": "每則意見請註明標籤和該段開頭的幾個詞，這樣即使文字有改動，作者也能找到確切位置。",
  "review-quote-build": "每則意見請註明標籤、版本和該段開頭的幾個詞，這樣即使文字有改動，作者也能找到確切位置。",
  "review-note-link": "每個標籤旁的「意見」連結會開啟一則已填好這些資訊的意見。",
  note: "意見",
  "note-title": "為 {label} 寫意見",
  "anchor-title": "連結到 {label}",
  by: "",
  "approximate-words": "約{words}詞",
  "approximate-characters": "約{characters}字",
  "narration-opening": "《{title}》。作者：{authors}。朗讀：{narrator}。",
  "narration-opening-anonymous": "《{title}》。朗讀：{narrator}。",
  "narration-closing": "全書完。您收聽的是《{title}》，作者{authors}，朗讀{narrator}。",
  "narration-closing-anonymous": "全書完。您收聽的是《{title}》，朗讀{narrator}。",
  "screenplay-credit": "編劇",
  "screenplay-source": "改編自{authors}的作品",
  "screenplay-source-anonymous": "改編自原著"
};

const chinese = { cased: false, segmentation: "character", countUnit: "characters", dialogueDash: null, narrationRate: 300 };

export default [
  ...["zh-hant", "zh-tw", "zh-hk", "zh-mo"].map((code) => ({ code, name: "Chinese (Traditional)", script: "Hant", labels })),
  { code: "yue", name: "Cantonese", ...chinese, script: "Hant", labels },
  { code: "lzh", name: "Classical Chinese", ...chinese, script: "Hant", labels }
];
