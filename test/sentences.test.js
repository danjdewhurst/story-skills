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
    expect(splitSentences("He chose plan B. It's done. Not I. Hale did.")).toEqual(["He chose plan B.", "It's done.", "Not I.", "Hale did."]);
    // I is a pronoun after a word that is not a name, whatever follows.
    expect(splitSentences("So do I. Hale laughed.")).toEqual(["So do I.", "Hale laughed."]);
    expect(split("Quería el plan B. Nadie estuvo de acuerdo.", "es")).toEqual(["Quería el plan B.", "Nadie estuvo de acuerdo."]);
    expect(split("Ludwig I. Er war König.", "de")).toEqual(["Ludwig I.", "Er war König."]);
  });

  test("initials still run on into the name (#586)", () => {
    expect(splitSentences("J. R. Tolkien wrote it. Anna K. Smith read it. He met J. Smith. Then he left."))
      .toEqual(["J. R. Tolkien wrote it.", "Anna K. Smith read it.", "He met J. Smith.", "Then he left."]);
    // I is an initial at the start of a sentence, after a name, or next to
    // another initial.
    expect(splitSentences("I. Smith wrote it. Anna I. Smith read it. I. M. Pei drew it. He met J. I. Hale."))
      .toEqual(["I. Smith wrote it.", "Anna I. Smith read it.", "I. M. Pei drew it.", "He met J. I. Hale."]);
    // A run of initials never ends a sentence, even before a word that is
    // never a name (German z. B. Wasser).
    expect(split("Man braucht z. B. Wasser und Brot. Dann ging er.", "de")).toEqual(["Man braucht z. B. Wasser und Brot.", "Dann ging er."]);
  });

  test("the words that are never names come from the pack and the style sheet (#586)", () => {
    expect(split("Era il piano B. Nessuno rise.", "it")).toEqual(["Era il piano B. Nessuno rise."]);
    const italian = withStyleLists(languagePack("it"), { "add-words": [{ "candidate-stopwords": "Nessuno" }] });
    expect(splitSentences("Era il piano B. Nessuno rise.", { pack: italian })).toEqual(["Era il piano B.", "Nessuno rise."]);
  });

  test("a dialogue dash opens a sentence, but a tag after it stays in the sentence (#586)", () => {
    expect(split("—Vete. —Ella se giró.", "es")).toEqual(["—Vete.", "—Ella se giró."]);
    expect(split("—¿Vienes? —preguntó ella. —Sí.", "es")).toEqual(["—¿Vienes? —preguntó ella.", "—Sí."]);
    expect(split("— Привет, — сказал он. — Как дела?", "ru")).toEqual(["— Привет, — сказал он.", "— Как дела?"]);
    expect(split("– Hej, sa Anna. – Kom hit.", "sv")).toEqual(["– Hej, sa Anna.", "– Kom hit."]);
  });

  test("a quotative と keeps a Japanese quote in its sentence (#586)", () => {
    expect(split("「はい。」と言った。彼は笑った。", "ja")).toEqual(["「はい。」と言った。", "彼は笑った。"]);
    expect(split("『本当？』って聞いた。", "ja")).toEqual(["『本当？』って聞いた。"]);
    expect(splitSentences("「はい。」と言った。")).toEqual(["「はい。」と言った。"]);
    // A quote inside a quote still closes with the outer one.
    expect(split("\"彼は「はい。」と言った。\"それから帰った。", "ja")).toEqual(["\"彼は「はい。」と言った。\"", "それから帰った。"]);
    // Without a quote before it, と starts the next sentence.
    expect(split("はい。と、ドアが開いた。", "ja")).toEqual(["はい。", "と、ドアが開いた。"]);
  });

  test("lone capitals, dialogue dashes, and quotative と split in linear time (#586)", () => {
    expectLinearTime(splitSentences, (n) => "So do I. Nobody B. ".repeat(n / 19));
    expectLinearTime((text) => split(text, "es"), (n) => `Vete. ${"— ".repeat(n / 2)}x`);
    // Each と keeps the sentence open, so it must not be reread at each stop.
    expectLinearTime((text) => split(text, "ja"), (n) => "\"はい。\"と".repeat(n / 6));
  });
});
