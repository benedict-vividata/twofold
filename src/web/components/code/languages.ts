import { LanguageDescription, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

const cache = new Map<string, Promise<LanguageSupport | null>>();

/** The language for a file name, loaded on demand and cached. */
export function languageFor(filename: string): Promise<LanguageSupport | null> {
  const description = LanguageDescription.matchFilename(languages, filename);
  if (description === null) return Promise.resolve(null);
  return loadDescription(description);
}

/** The language for a Markdown fence tag such as `ts` or `python`. */
export function languageForTag(tag: string): Promise<LanguageSupport | null> {
  const description = LanguageDescription.matchLanguageName(languages, tag, true);
  if (description === null) return Promise.resolve(null);
  return loadDescription(description);
}

function loadDescription(description: LanguageDescription): Promise<LanguageSupport | null> {
  let pending = cache.get(description.name);
  if (pending === undefined) {
    pending = description.load().catch(() => null);
    cache.set(description.name, pending);
  }
  return pending;
}
