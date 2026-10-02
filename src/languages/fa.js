// Persian: no letter case; words are spaced. Build labels only; no word
// lists yet, and no narration pace of its own.

export default {
  code: "fa",
  name: "Persian",
  cased: false,
  segmentation: "space",
  labels: {
    chapter: "فصل {n}",
    "chapter-heading": "{chapter}: {title}",
    contents: "فهرست مطالب",
    and: "{a} و {b}",
    copyright: "حق نشر",
    "all-rights-reserved": "همهٔ حقوق محفوظ است.",
    "published-by": "ناشر: {publisher}",
    "scene-break": "تغییر صحنه",
    "cover-alt": "جلد کتاب {title}",
    "start-of-content": "آغاز محتوا",
    "accessibility-summary": "کتابی فقط متنی، با فهرست مطالب پیمایش‌پذیر، عنوانی برای هر فصل و یک ترتیب خواندن منطقی واحد.",
    "accessibility-summary-cover": "کتابی متنی با تصویر جلد توصیف‌شده، فهرست مطالب پیمایش‌پذیر، عنوانی برای هر فصل و یک ترتیب خواندن منطقی واحد.",
    "review-title": "{title}: نسخهٔ بازبینی",
    "review-intro": "نسخهٔ بازبینی.",
    "review-intro-build": "نسخهٔ بازبینی، ویرایش {build}.",
    "review-labels": "هر بند برچسبی مانند {label} دارد (فصل 3، بند 12).",
    "review-quote": "در هر یادداشت، برچسب و چند واژهٔ نخست بند را بیاورید تا نویسنده حتی پس از تغییر متن، جای دقیق را پیدا کند.",
    "review-quote-build": "در هر یادداشت، برچسب، ویرایش و چند واژهٔ نخست بند را بیاورید تا نویسنده حتی پس از تغییر متن، جای دقیق را پیدا کند.",
    "review-note-link": "پیوند «یادداشت» کنار هر برچسب، یادداشتی باز می‌کند که این موارد از پیش در آن پر شده‌اند.",
    note: "یادداشت",
    "note-title": "نوشتن یادداشت برای {label}",
    "anchor-title": "پیوند به {label}",
    by: "نوشتهٔ",
    "approximate-words": "حدود {words} واژه",
    "approximate-characters": "حدود {characters} نویسه",
    "narration-opening": "{title}. نوشتهٔ {authors}. با صدای {narrator}.",
    "narration-opening-anonymous": "{title}. با صدای {narrator}.",
    "narration-closing": "پایان. شما {title}، نوشتهٔ {authors}، را با صدای {narrator} شنیدید.",
    "narration-closing-anonymous": "پایان. شما {title} را با صدای {narrator} شنیدید.",
    "screenplay-credit": "نوشتهٔ",
    "screenplay-source": "برگرفته از اثری از {authors}",
    "screenplay-source-anonymous": "برگرفته از یک اثر ادبی"
  }
};
