// Russian: build labels and narration pace. No word lists yet. A chapter
// heading sets its title after a full stop (Глава 1. Название), a byline is
// the name alone, and credits name the author after a colon, which keeps
// names out of the genitive.

export default {
  code: "ru",
  name: "Russian",
  narrationRate: 125,
  labels: {
    chapter: "Глава {n}",
    "chapter-heading": "{chapter}. {title}",
    contents: "Содержание",
    and: "{a} и {b}",
    copyright: "Авторские права",
    "all-rights-reserved": "Все права защищены.",
    "published-by": "Издатель: {publisher}",
    "scene-break": "Смена сцены",
    "cover-alt": "Обложка книги «{title}»",
    "start-of-content": "Начало текста",
    "accessibility-summary": "Книга, содержащая только текст, с навигационным оглавлением, заголовком у каждой главы и единым логическим порядком чтения.",
    "accessibility-summary-cover": "Текстовая книга с описанным изображением обложки, навигационным оглавлением, заголовком у каждой главы и единым логическим порядком чтения.",
    "review-title": "{title}: экземпляр для рецензирования",
    "review-intro": "Экземпляр для рецензирования.",
    "review-intro-build": "Экземпляр для рецензирования, версия {build}.",
    "review-labels": "У каждого абзаца есть метка, например {label} (глава 3, абзац 12).",
    "review-quote": "Указывайте метку в каждом замечании вместе с первыми словами абзаца, чтобы автор мог найти точное место даже после правок в тексте.",
    "review-quote-build": "Указывайте метку и версию в каждом замечании вместе с первыми словами абзаца, чтобы автор мог найти точное место даже после правок в тексте.",
    "review-note-link": "Ссылка «Замечание» рядом с каждой меткой открывает замечание с уже заполненными данными.",
    note: "Замечание",
    "note-title": "Написать замечание к {label}",
    "anchor-title": "Ссылка на {label}",
    by: "",
    "approximate-words": "Около {words} слов",
    "approximate-characters": "Около {characters} знаков",
    "narration-opening": "{title}. Автор: {authors}. Читает {narrator}.",
    "narration-opening-anonymous": "{title}. Читает {narrator}.",
    "narration-closing": "Конец. Вы слушали книгу «{title}». Автор: {authors}. Читает {narrator}.",
    "narration-closing-anonymous": "Конец. Вы слушали книгу «{title}». Читает {narrator}.",
    "screenplay-credit": "Сценарий",
    "screenplay-source": "По произведению (автор: {authors})",
    "screenplay-source-anonymous": "По литературному произведению"
  }
};
