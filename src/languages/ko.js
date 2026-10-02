// Korean: no letter case; words are spaced. No word lists yet. Labels avoid
// particles after a name or title, whose form depends on its last sound.
// The narration pace counts spaced words (eojeol), of about three
// syllables each.

export default {
  code: "ko",
  name: "Korean",
  cased: false,
  script: "Kore",
  segmentation: "space",
  narrationRate: 100,
  labels: {
    chapter: "제{n}장",
    "chapter-heading": "{chapter} {title}",
    contents: "차례",
    and: "{a}, {b}",
    copyright: "저작권",
    "all-rights-reserved": "이 책의 무단 전재와 복제를 금합니다.",
    "published-by": "펴낸곳: {publisher}",
    "scene-break": "장면 전환",
    "cover-alt": "『{title}』 표지",
    "start-of-content": "본문",
    "accessibility-summary": "텍스트로만 된 책으로, 탐색할 수 있는 차례, 장마다 제목, 하나의 논리적인 읽기 순서를 갖추고 있습니다.",
    "accessibility-summary-cover": "설명이 있는 표지 이미지가 포함된 텍스트 책으로, 탐색할 수 있는 차례, 장마다 제목, 하나의 논리적인 읽기 순서를 갖추고 있습니다.",
    "review-title": "{title}: 검토용 원고",
    "review-intro": "검토용 원고입니다.",
    "review-intro-build": "검토용 원고입니다(빌드 {build}).",
    "review-labels": "모든 문단에는 {label}(3장 12번째 문단) 같은 라벨이 붙어 있습니다.",
    "review-quote": "의견마다 라벨과 문단의 첫 몇 단어를 함께 적어 주세요. 그러면 본문이 바뀌어도 저자가 정확한 위치를 찾을 수 있습니다.",
    "review-quote-build": "의견마다 라벨과 빌드, 문단의 첫 몇 단어를 함께 적어 주세요. 그러면 본문이 바뀌어도 저자가 정확한 위치를 찾을 수 있습니다.",
    "review-note-link": "각 라벨 옆의 ‘의견’ 링크를 누르면 이 내용이 미리 채워진 의견이 열립니다.",
    note: "의견",
    "note-title": "{label} 의견 쓰기",
    "anchor-title": "{label} 링크",
    by: "",
    "approximate-words": "약 {words}단어",
    "approximate-characters": "약 {characters}자",
    "narration-opening": "『{title}』. {authors} 지음. {narrator} 낭독.",
    "narration-opening-anonymous": "『{title}』. {narrator} 낭독.",
    "narration-closing": "끝. 지금까지 들으신 작품은 『{title}』, {authors} 지음, {narrator} 낭독이었습니다.",
    "narration-closing-anonymous": "끝. 지금까지 들으신 작품은 『{title}』, {narrator} 낭독이었습니다.",
    "screenplay-credit": "각본",
    "screenplay-source": "원작: {authors}",
    "screenplay-source-anonymous": "원작을 바탕으로 함"
  }
};
