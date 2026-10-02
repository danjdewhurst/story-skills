// Ukrainian: build labels and narration pace. No word lists yet. A chapter
// heading sets its title after a full stop (Розділ 1. Назва), a byline is
// the name alone, and credits name the author after a colon, which keeps
// names out of the genitive.

export default {
  code: "uk",
  name: "Ukrainian",
  narrationRate: 125,
  labels: {
    chapter: "Розділ {n}",
    "chapter-heading": "{chapter}. {title}",
    contents: "Зміст",
    and: "{a} і {b}",
    copyright: "Авторські права",
    "all-rights-reserved": "Усі права захищено.",
    "published-by": "Видавець: {publisher}",
    "scene-break": "Зміна сцени",
    "cover-alt": "Обкладинка книжки «{title}»",
    "start-of-content": "Початок тексту",
    "accessibility-summary": "Книжка, що містить лише текст, із навігаційним змістом, заголовком кожного розділу та єдиним логічним порядком читання.",
    "accessibility-summary-cover": "Текстова книжка з описаним зображенням обкладинки, навігаційним змістом, заголовком кожного розділу та єдиним логічним порядком читання.",
    "review-title": "{title}: примірник для рецензування",
    "review-intro": "Примірник для рецензування.",
    "review-intro-build": "Примірник для рецензування, версія {build}.",
    "review-labels": "Кожен абзац має мітку, наприклад {label} (розділ 3, абзац 12).",
    "review-quote": "Зазначайте мітку в кожному зауваженні разом із першими словами абзацу, щоб автор міг знайти точне місце навіть після змін у тексті.",
    "review-quote-build": "Зазначайте мітку й версію в кожному зауваженні разом із першими словами абзацу, щоб автор міг знайти точне місце навіть після змін у тексті.",
    "review-note-link": "Посилання «Зауваження» біля кожної мітки відкриває зауваження з уже заповненими даними.",
    note: "Зауваження",
    "note-title": "Написати зауваження до {label}",
    "anchor-title": "Посилання на {label}",
    by: "",
    "approximate-words": "Близько {words} слів",
    "approximate-characters": "Близько {characters} знаків",
    "narration-opening": "{title}. Автор: {authors}. Читає {narrator}.",
    "narration-opening-anonymous": "{title}. Читає {narrator}.",
    "narration-closing": "Кінець. Ви слухали книжку «{title}». Автор: {authors}. Читає {narrator}.",
    "narration-closing-anonymous": "Кінець. Ви слухали книжку «{title}». Читає {narrator}.",
    "screenplay-credit": "Сценарій",
    "screenplay-source": "За твором (автор: {authors})",
    "screenplay-source-anonymous": "За літературним твором"
  }
};
