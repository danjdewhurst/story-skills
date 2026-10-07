import { describe, expect, test } from "bun:test";
import { languagePack } from "../src/languages/index.js";
import { withStyleLists } from "../src/languages/style.js";
import { splitSentences } from "../src/sentences.js";
import { expectLinearTime } from "./helpers.js";

const split = (text, tag) => splitSentences(text, { pack: languagePack(tag) });

describe("splitSentences", () => {
  test("a run of stops ends a sentence only before a space or the end", () => {
    expect(splitSentences("Wait.....x. Then go!?! Done...")).toEqual(["Wait.....x.", "Then go!?!", "Done..."]);
    expect(splitSentences("He stopped..... She ran.")).toEqual(["He stopped.....", "She ran."]);
  });

  test("a long run of stops with no space after it splits in linear time (#587)", () => {
    expectLinearTime(splitSentences, (n) => `${".".repeat(n)}x`);
    expectLinearTime(splitSentences, (n) => `${"?!…".repeat(n / 3)}x`);
  });

  test("I. and a capital alone before a word that is never a name end a sentence (#586)", () => {
    expect(splitSentences("So do I. She laughed and left.")).toEqual(["So do I.", "She laughed and left."]);
    expect(splitSentences("He wanted plan B. Nobody agreed.")).toEqual(["He wanted plan B.", "Nobody agreed."]);
    // A contraction keeps the word whole.
    expect(splitSentences("He chose plan B. It's done. He chose plan C. It’s done.")).toEqual(["He chose plan B.", "It's done.", "He chose plan C.", "It’s done."]);
    // An article before a word in lower case is not a name.
    expect(splitSentences("He wanted plan B. The navy agreed.")).toEqual(["He wanted plan B.", "The navy agreed."]);
    expect(split("Quería el plan B. Nadie estuvo de acuerdo.", "es")).toEqual(["Quería el plan B.", "Nadie estuvo de acuerdo."]);
    expect(split("Ludwig I. Er war König.", "de")).toEqual(["Ludwig I.", "Er war König."]);
  });

  test("initials still run on into the name (#586)", () => {
    expect(splitSentences("J. R. Tolkien wrote it. Anna K. Smith read it. He met J. Smith. Then he left."))
      .toEqual(["J. R. Tolkien wrote it.", "Anna K. Smith read it.", "He met J. Smith.", "Then he left."]);
    // I is an initial at the start of a sentence, after a name, or next to
    // another initial, even another that is a word (J. A. Smith).
    expect(splitSentences("I. Smith wrote it. Anna I. Smith read it. I. M. Pei drew it. He met J. I. Hale. J. A. Smith came."))
      .toEqual(["I. Smith wrote it.", "Anna I. Smith read it.", "I. M. Pei drew it.", "He met J. I. Hale.", "J. A. Smith came."]);
    // A run of initials never ends a sentence, even before a word that is
    // never a name (German z. B. Wasser).
    expect(split("Man braucht z. B. Wasser und Brot. Dann ging er.", "de")).toEqual(["Man braucht z. B. Wasser und Brot.", "Dann ging er."]);
  });

  test("where the text cannot tell an initial from a sentence end, the sentence runs on (#586)", () => {
    const together = (text, tag = "en") => expect(split(text, tag)).toEqual([text]);
    // Before a name, I is an initial, whatever comes before it.
    for (const text of [
      "It was written by I. Asimov in 1950.", "A letter from I. Kant arrived.", "Dr I. Smith arrived.", "Mrs I. Hale left.",
      "So do I. Hale laughed.", "Not I. Hale did it.", "—Not I. Hale did it.", "“Not I. Hale did it.”", "Yes, I. Hale did."
    ]) {
      together(text);
    }
    // Days and months are surnames too.
    together("Theresa M. May spoke.");
    together("Brian H. May played guitar.");
    together("Juan F. Mayo llegó.", "es");
    together("Thomas M. Mai kam.", "de");
    // A particle or article before a capital starts a name.
    together("Ursula K. Le Guin a écrit ce livre.", "fr");
    together("Juan C. De León llegó tarde.", "es");
    together("He wanted plan B. The Navy agreed.");
    // A word that is never a name, before an apostrophe and a capital, is
    // part of a name (Spanish O, or).
    together("Juan B. O'Higgins llegó.", "es");
    together("Juan B. O’Higgins llegó.", "es");
  });

  test("the words that are never names come from the pack and the style sheet (#586)", () => {
    expect(split("Era il piano B. Nessuno rise.", "it")).toEqual(["Era il piano B. Nessuno rise."]);
    const italian = withStyleLists(languagePack("it"), { "add-words": [{ "candidate-stopwords": "Nessuno" }] });
    expect(splitSentences("Era il piano B. Nessuno rise.", { pack: italian })).toEqual(["Era il piano B.", "Nessuno rise."]);
  });

  test("a dialogue dash before a capital opens a sentence, but a tag after it stays in the sentence (#586)", () => {
    expect(split("—Vete. —Ella se giró.", "es")).toEqual(["—Vete.", "—Ella se giró."]);
    expect(split("—¿Vienes? —preguntó ella. —Sí.", "es")).toEqual(["—¿Vienes? —preguntó ella.", "—Sí."]);
    expect(split("— Привет, — сказал он. — Как дела?", "ru")).toEqual(["— Привет, — сказал он.", "— Как дела?"]);
    expect(split("– Hej, sa Anna. – Kom hit.", "sv")).toEqual(["– Hej, sa Anna.", "– Kom hit."]);
    expect(splitSentences("—Go. —She turned. ―Stay. ―He sat.")).toEqual(["—Go.", "—She turned.", "―Stay.", "―He sat."]);
    // An abbreviation before the dash keeps the sentence going.
    expect(splitSentences("Apples, pears, etc. — Anna loved them.")).toEqual(["Apples, pears, etc. — Anna loved them."]);
    // A letter without case after the dash cannot tell a new sentence from
    // a tag, in a language with a pack or without one (Urdu, Amharic).
    expect(split("ماذا؟ — قال أحمد.", "ar")).toEqual(["ماذا؟ — قال أحمد."]);
    expect(split("کیا؟ — اس نے کہا۔", "ur")).toEqual(["کیا؟ — اس نے کہا۔"]);
    expect(split("ምን? — አለ።", "am")).toEqual(["ምን? — አለ።"]);
  });

  test("a quotative と keeps a Japanese quote in its sentence (#586)", () => {
    expect(split("「はい。」と言った。彼は笑った。", "ja")).toEqual(["「はい。」と言った。", "彼は笑った。"]);
    expect(split("「はい。」と、彼は言った。", "ja")).toEqual(["「はい。」と、彼は言った。"]);
    expect(split("『本当？』って聞いた。「はい。」って。", "ja")).toEqual(["『本当？』って聞いた。", "「はい。」って。"]);
    expect(splitSentences("「はい。」と言った。")).toEqual(["「はい。」と言った。"]);
    // A quote inside a quote still closes with the outer one.
    expect(split("\"彼は「はい。」と言った。\"それから帰った。", "ja")).toEqual(["\"彼は「はい。」と言った。\"", "それから帰った。"]);
    // A word that starts with と, and と before anything but punctuation or
    // a verb of saying or thinking, start the next sentence.
    expect(split("「行こう。」ところが彼は動かなかった。", "ja")).toEqual(["「行こう。」", "ところが彼は動かなかった。"]);
    expect(split("「はい。」とにかく帰ろう。", "ja")).toEqual(["「はい。」", "とにかく帰ろう。"]);
    expect(split("「はい。」とても嬉しい。", "ja")).toEqual(["「はい。」", "とても嬉しい。"]);
    expect(split("「はい。」と彼は言った。", "ja")).toEqual(["「はい。」", "と彼は言った。"]);
    // Without a quote before it, と starts the next sentence.
    expect(split("はい。と、ドアが開いた。", "ja")).toEqual(["はい。", "と、ドアが開いた。"]);
  });

  test("a sentence that quotative と keeps open splits in linear time (#586)", () => {
    // Each と keeps the sentence open, so it must not be reread at each stop.
    expectLinearTime((text) => split(text, "ja"), (n) => "\"はい。\"と言い".repeat(n / 8));
  });
});

describe("#208 Chinese and Japanese count per character", () => {
  test("。！？ end sentences", () => {
    expect(splitSentences("我是一个学生。他很好！你呢？")).toEqual(["我是一个学生。", "他很好！", "你呢？"]);
    expect(splitSentences("没有句号")).toEqual(["没有句号."]);
  });

  test("an abbreviation inside emphasis or a link does not end the sentence (#705)", () => {
    expect(splitSentences("She reread *Mr. Darcy* twice. Then she slept.")).toEqual(["She reread *Mr. Darcy* twice.", "Then she slept."]);
    expect(splitSentences("She reread _Mr. Darcy_ twice. Then she slept.")).toEqual(["She reread _Mr. Darcy_ twice.", "Then she slept."]);
    expect(splitSentences("She met **Dr. Hale** and [Mrs. Hale](x) twice. Then she slept.")).toEqual(["She met **Dr. Hale** and [Mrs. Hale](x) twice.", "Then she slept."]);
    // The stop can sit inside the emphasis, before its closing mark.
    expect(splitSentences("She met *Mr.* Darcy. Then she slept.")).toEqual(["She met *Mr.* Darcy.", "Then she slept."]);
  });
});

describe("#710 a sentence that starts with an emoji is split", () => {
  test("an emoji run before a capital starts the next sentence", () => {
    expect(splitSentences("Yay! \u{1F600} Next one here.")).toEqual(["Yay!", "\u{1F600} Next one here."]);
    expect(splitSentences("Yay! ❤️ Next one here.")).toEqual(["Yay!", "❤️ Next one here."]);
    expect(splitSentences("Yay! \u{1F468}‍\u{1F469}‍\u{1F467} Next one here.")).toEqual(["Yay!", "\u{1F468}‍\u{1F469}‍\u{1F467} Next one here."]);
  });

  test("an emoji before a lower-case word still runs on", () => {
    expect(splitSentences("Yay! \u{1F600} and so on.")).toEqual(["Yay! \u{1F600} and so on."]);
  });

  test("a flag, with its tag characters, before a capital starts the next sentence", () => {
    const scotland = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}";
    expect(splitSentences(`Yay! ${scotland} Next one here.`)).toEqual(["Yay!", `${scotland} Next one here.`]);
  });

  test("other symbols before a capital start the next sentence too", () => {
    expect(splitSentences("It cost 5. ★ Dan Hale wrote it.")).toEqual(["It cost 5.", "★ Dan Hale wrote it."]);
    expect(splitSentences("It cost 5. ° Dan Hale wrote it.")).toEqual(["It cost 5.", "° Dan Hale wrote it."]);
    expect(splitSentences("It cost 5. © Dan Hale wrote it.")).toEqual(["It cost 5.", "© Dan Hale wrote it."]);
  });
});

describe("sentence and speech edge cases", () => {
  test("a stammer across an ellipsis does not end the sentence", () => {
    expect(splitSentences("I… I don’t know. Fine.")).toEqual(["I… I don’t know.", "Fine."]);
    expect(splitSentences("We... we should go. Now.")).toEqual(["We... we should go.", "Now."]);
  });
});
