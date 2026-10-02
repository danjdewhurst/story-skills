import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { languagePack } from "../src/languages/index.js";
import { punctuation } from "../src/punctuation.js";
import { splitSentences } from "../src/sentences.js";
import { createStoryProject, voicesReport } from "../src/story.js";
import { narrationOnly, quotedSpans, quoteMatches, splitOpenSpeech } from "../src/voices.js";
import { makeTempDir, writeMarkdown } from "./helpers.js";

// Sentence and dialogue conventions come from the story's language pack.

const pack = (tag) => languagePack(tag);
const split = (text, tag) => splitSentences(text, { pack: pack(tag) });

function languageProject(language, characters, paragraphs) {
  const cwd = makeTempDir();
  const { root } = createStoryProject({ cwd, title: "Conventions", force: false, language });
  for (const [id, name] of characters) {
    writeMarkdown(path.join(root, "characters", `${id}.md`), `
name: ${name}
role: supporting
status: alive
`, `# ${name}\n`);
  }
  writeMarkdown(path.join(root, "chapters", "chapter-01.md"), `
title: Chapter 1
number: 1
status: draft
`, `## Chapter Text\n\n${paragraphs.join("\n\n")}\n`);
  return root;
}

describe("quote conventions", () => {
  test("the base pack recognises guillemets, low-high quotes, and corner brackets", () => {
    expect(quotedSpans("Mara leva les yeux. « Je ne sais pas. » Puis elle partit.", pack("fr"))).toEqual(["Je ne sais pas."]);
    expect(quotedSpans("„Komm“, sagte sie. ‚Gut‘", pack("cs"))).toEqual(["Komm", "Gut"]);
    expect(quotedSpans("„Chodź” – powiedział.", pack("pl"))).toEqual(["Chodź"]);
    expect(quotedSpans("«Он сказал „привет“», — ответила она.", pack("ru"))).toEqual(["Он сказал „привет“"]);
    expect(quotedSpans("「行こう」とミナは言った。『本当に』", pack("und"))).toEqual(["行こう", "本当に"]);
  });

  test("German »…« opens with » and Swiss German keeps «…»", () => {
    const german = "»Komm«, sagte Mara. »Wohin?«";
    expect(quotedSpans(german, pack("de"))).toEqual(["Komm", "Wohin?"]);
    expect(narrationOnly(german, pack("de"))).toBe(" , sagte Mara.  ");
    expect(quotedSpans("„Komm“, sagte sie. ‚Ja‘, ›Nein‹", pack("de-AT"))).toEqual(["Komm", "Ja", "Nein"]);
    // Read as French, the same marks would pair the wrong way round.
    expect(quotedSpans(german, pack("fr"))).toEqual([", sagte Mara."]);
    expect(quotedSpans("«Chumm», seit d Mara.", pack("de-CH"))).toEqual(["Chumm"]);
    expect(quotedSpans("»Kom«, sagde hun.", pack("da"))).toEqual(["Kom"]);
  });

  test("Swedish quotes use the same mark to open and close, and dash dialogue an en dash", () => {
    expect(quotedSpans("”Hej”, sa Mara. ”Kom nu.”", pack("sv"))).toEqual(["Hej", "Kom nu."]);
    expect(quotedSpans("Han sa ’kanske’ och gick. Det är Annas’ bok.", pack("sv"))).toEqual(["kanske"]);
    expect(quotedSpans("»Hej», sa hon.", pack("fi"))).toEqual(["Hej"]);
    expect(quotedSpans("– Hej, sa Mara.", pack("sv"))).toEqual(["Hej, sa Mara."]);
    expect(quotedSpans("– Hej, sa Mara.", pack("en"))).toEqual([]);
  });

  test("Japanese and Chinese never read a leading dash as dialogue", () => {
    expect(quotedSpans("――そうか。「待って」", pack("ja"))).toEqual(["待って"]);
    expect(quotedSpans("——是吗。“等一下，”小明说。", pack("zh"))).toEqual(["等一下，"]);
  });

  test("dash dialogue resumes after the tag", () => {
    expect(quotedSpans("—Ya voy —dijo ella—. Espera.", pack("es"))).toEqual(["Ya voy", "Espera."]);
    expect(narrationOnly("—Ya voy —dijo ella—. Espera.", pack("es"))).toBe(" dijo ella ");
    expect(quotedSpans("— Привет, — сказал он. — Как дела?", pack("ru"))).toEqual(["Привет,", "Как дела?"]);
    expect(quotedSpans("—Hola —dijo—.", pack("es"))).toEqual(["Hola"]);
    expect(quotedSpans("—Uno —dijo—, dos —añadió— y tres.", pack("es"))).toEqual(["Uno", "dos", "y tres."]);
    expect(quotedSpans("— Go — he waved, and left.")).toEqual(["Go"]);
    expect(quoteMatches("— Maybe, said Tom.")[0].text).toBe("Maybe");
    expect(quotedSpans("—Go home —he said— now.")).toEqual(["Go home", "now."]);
  });

  test("a dash in the narration after a dash tag is not speech", () => {
    expect(quotedSpans("—Go home —he said. The sky darkened—rain was coming.")).toEqual(["Go home"]);
    expect(quotedSpans("—Go home —he said, and walked off—before it rained.")).toEqual(["Go home"]);
    expect(quotedSpans("—and the house fell silent —or almost— until dawn.")).toEqual(["and the house fell silent"]);
    expect(quotedSpans("—Ya voy —dijo ella. El cielo se oscureció—llovía.", pack("es"))).toEqual(["Ya voy"]);
  });

  test("in Swedish and Finnish a dash after a finished sentence and before a capital starts a new line", () => {
    expect(quotedSpans("– Hej, sa Anna. – Kom hit.", pack("sv"))).toEqual(["Hej, sa Anna.", "Kom hit."]);
    expect(narrationOnly("– Hej, sa Anna. – Kom hit.", pack("sv"))).toBe("  ");
    expect(quotedSpans("– Moi. – Tule tänne.", pack("fi"))).toEqual(["Moi.", "Tule tänne."]);
    expect(quotedSpans("— Что? — спросил он.", pack("ru"))).toEqual(["Что?"]);
  });

  test("elsewhere a dash after a finished sentence and before a capital is narration", () => {
    expect(quotedSpans("—Is it? —I asked.")).toEqual(["Is it?"]);
    expect(quotedSpans("—Stop! —Mara grabbed his arm.")).toEqual(["Stop!"]);
    expect(quotedSpans("— Go. — He waved.")).toEqual(["Go."]);
    expect(quotedSpans("—Go home. —She turned. —Now.")).toEqual(["Go home."]);
    expect(quotedSpans("—Vete. —Ella se giró.", pack("es"))).toEqual(["Vete."]);
  });

  test("language packs keep straight and curly quotes and the em dash", () => {
    expect(quotedSpans("\"Hallo\", sagte Anna.", pack("de"))).toEqual(["Hallo"]);
    expect(quotedSpans("“Hallo”, sagte Anna. „Komm“", pack("de"))).toEqual(["Hallo", "Komm"]);
    expect(quotedSpans("\"Grüezi\", seit d Anna.", pack("de-CH"))).toEqual(["Grüezi"]);
    expect(quotedSpans("“Hej,” sagde Anna. ”Kom,” sagde hun. \"Ja.\"", pack("da"))).toEqual(["Hej,", "Kom,", "Ja."]);
    expect(quotedSpans("\"Hej\", sa Anna.", pack("sv"))).toEqual(["Hej"]);
    expect(quotedSpans("— Hej, sa Anna.", pack("sv"))).toEqual(["Hej, sa Anna."]);
    expect(quotedSpans("— Moi, sanoi Anna.", pack("fi"))).toEqual(["Moi, sanoi Anna."]);
    expect(quotedSpans("\"行くよ\"とミナは言った。", pack("ja"))).toEqual(["行くよ"]);
  });

  test("French speech is trimmed inside its guillemets", () => {
    expect(quoteMatches("« Viens », dit-il.", pack("fr"))[0].text).toBe("Viens");
  });

  test("speech left open continues with the pack's opening marks", () => {
    expect(splitOpenSpeech("Mara sagte: »Hör zu.", pack("de"))).toEqual({ narration: "Mara sagte: ", open: "Hör zu." });
    expect(splitOpenSpeech("Elle dit : « Écoute.", pack("fr"))).toEqual({ narration: "Elle dit : ", open: "Écoute." });
    expect(splitOpenSpeech("Hon sa: ’Lyssna", pack("sv")).open).toBeNull();
    expect(splitOpenSpeech("’Lyssna", pack("sv")).open).toBe("Lyssna");
  });

  test("English reads only curly and straight quotes", () => {
    expect(quotedSpans("He wrote « bonjour » and „hallo“ in the margin.")).toEqual([]);
    expect(quotedSpans("“Go,” she said. ‘Now,’ he said. \"Wait.\" 'Tis fine.")).toEqual(["Go,", "Now,", "Wait."]);
    expect(punctuation(pack("en")).openers).toBe("“‘\"'");
  });
});

describe("sentence conventions", () => {
  test("Arabic, Urdu, Hindi, and Ethiopic stops end a sentence", () => {
    expect(split("هل أنت بخير؟ نعم، أنا بخير.", "ar")).toEqual(["هل أنت بخير؟", "نعم، أنا بخير."]);
    expect(split("وہ آیا۔ وہ گیا۔", "ur")).toEqual(["وہ آیا۔", "وہ گیا۔"]);
    expect(split("वह आया। वह गया।", "hi")).toEqual(["वह आया।", "वह गया।"]);
    expect(split("दोहा एक॥ दोहा दो॥", "hi")).toEqual(["दोहा एक॥", "दोहा दो॥"]);
    expect(split("ሰላም ነው። እንሂድ።", "am")).toEqual(["ሰላም ነው።", "እንሂድ።"]);
  });

  test("a letter without case starts a sentence in any pack", () => {
    expect(split("שלום. מה שלומך?", "he")).toEqual(["שלום.", "מה שלומך?"]);
    // Hindi in a language without its own pack still splits.
    expect(split("वह आया। वह गया।", "mr")).toEqual(["वह आया।", "वह गया।"]);
    // An uncased pack lets any letter start a sentence; a cased one does not.
    expect(split("Hai. ok lalu.", "ja")).toEqual(["Hai.", "ok lalu."]);
    expect(split("Hai. ok lalu.", "id")).toEqual(["Hai. ok lalu."]);
    // A dash after the stop still keeps a tag in the sentence.
    expect(split("ماذا؟ — قال أحمد.", "ar")).toEqual(["ماذا؟ — قال أحمد."]);
  });

  test("Spanish ¿ and ¡ open a sentence", () => {
    expect(split("¿Vienes? ¡Claro! Vamos.", "es")).toEqual(["¿Vienes?", "¡Claro!", "Vamos."]);
    expect(split("—¿Vienes? —preguntó Ana.", "es")).toEqual(["—¿Vienes? —preguntó Ana."]);
  });

  test("closing quotes after a stop follow the pack", () => {
    expect(split("Er sagte: »Komm.« Dann ging er.", "de")).toEqual(["Er sagte: »Komm.«", "Dann ging er."]);
    expect(split("Il dit : « Viens. » Puis il partit.", "fr")).toEqual(["Il dit : « Viens. »", "Puis il partit."]);
    expect(split("Elle dit « Viens. » Puis il partit.", "fr")).toEqual(["Elle dit « Viens. »", "Puis il partit."]);
    expect(split("Il partit. Elle dit : « Viens ! »", "fr")).toEqual(["Il partit.", "Elle dit : « Viens ! »"]);
    expect(split("Er ging. »Komm.« Sie blieb.", "de")).toEqual(["Er ging.", "»Komm.«", "Sie blieb."]);
    expect(split("「行こう。」ミナは笑った。", "ja")).toEqual(["「行こう。」", "ミナは笑った。"]);
  });

  test("an opening guillemet may stand before a space", () => {
    expect(split("Il partit. « Quoi ? » demanda-t-il.", "fr")).toEqual(["Il partit.", "« Quoi ? » demanda-t-il."]);
    expect(split("Il partit. « Quoi ? » demanda-t-il.", "fr")).toEqual(["Il partit.", "« Quoi ? » demanda-t-il."]);
    expect(split("I left. « Quoi » he said.")).toEqual(["I left. « Quoi » he said."]);
  });

  test("after a full-width stop, a mark that can open a quote closes only an open one", () => {
    expect(split("他走了。“等一下，”小明说。", "zh")).toEqual(["他走了。", "“等一下，”小明说。"]);
    expect(split("„Er ging。“ Dann", "und")).toEqual(["„Er ging。“", "Dann."]);
    expect(split("他说\"好。\"然后走了。", "zh")).toEqual(["他说\"好。\"", "然后走了。"]);
    expect(split("好。\"然后\"走了。", "zh")).toEqual(["好。", "\"然后\"走了。"]);
  });

  test("English splitting is unchanged", () => {
    expect(splitSentences("\"Why?\" she asked. Dr. Hale left. I… I don't know.")).toEqual(["\"Why?\" she asked.", "Dr. Hale left.", "I… I don't know."]);
    expect(splitSentences("He said, “Go.” Then he left")).toEqual(["He said, “Go.”", "Then he left."]);
  });
});

describe("story voices across conventions", () => {
  test("Japanese 「」 dialogue is attributed to a name with no space around it", () => {
    const root = languageProject("ja", [["mina", "ミナ"], ["ken", "ケン"]], [
      "「行こう。」とミナは言った。",
      "ケンは笑った。「なぜ？」",
      "「早く！」とミナが叫んだ。"
    ]);
    const report = voicesReport(root);
    const mina = report.profiles.find((entry) => entry.id === "mina");
    const ken = report.profiles.find((entry) => entry.id === "ken");
    expect(mina).toMatchObject({ lines: 2, exclamations: 0.5 });
    expect(ken).toMatchObject({ lines: 1, questions: 1 });
    expect(report.unattributed).toBe(0);
  });

  test("Thai names match only at the dictionary's word boundaries", () => {
    const root = languageProject("th", [["som", "สม"]], [
      "“ไปกันเถอะ” สมพูด",
      "“ไม่” สมชายพูด"
    ]);
    const report = voicesReport(root);
    const som = report.profiles.find((entry) => entry.id === "som");
    // สมชาย is another name that starts with สม, so the second line is not Som's.
    expect(som.lines).toBe(1);
    expect(report.unattributed).toBe(1);
  });

  test("Arabic ؟ and Spanish ¿? count as questions, German » continues speech", () => {
    const arabic = languageProject("ar", [["ahmad", "أحمد"]], ["قال أحمد: «هل أنت بخير؟»", "نظر أحمد إليها. «انتظري!»"]);
    expect(voicesReport(arabic).profiles[0]).toMatchObject({ id: "ahmad", lines: 2, questions: 0.5, exclamations: 0.5 });

    const spanish = languageProject("es", [["ana", "Ana"]], ["—¿Vienes? —preguntó Ana—. ¡Vamos!"]);
    expect(voicesReport(spanish).profiles[0]).toMatchObject({ id: "ana", lines: 2, questions: 0.5, exclamations: 0.5 });

    const german = languageProject("de", [["mara", "Mara"]], ["Mara sagte: »Hör zu.", "»Wir gehen morgen.«"]);
    expect(voicesReport(german)).toMatchObject({ unattributed: 0, profiles: [{ id: "mara", lines: 2 }] });
  });

  test("voice-avoid phrases match inside unspaced text", () => {
    const root = languageProject("ja", [["mina", "ミナ"]], ["「絶対に行く。」とミナは言った。"]);
    const file = path.join(root, "characters", "mina.md");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("status: alive", "status: alive\nvoice-avoid:\n  - 絶対"));
    expect(voicesReport(root).warnings.map((warning) => warning.code)).toEqual(["voice-avoid"]);
  });
});
