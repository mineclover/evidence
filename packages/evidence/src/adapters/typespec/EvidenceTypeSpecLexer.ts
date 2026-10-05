import type { IEvidenceTypeSpecToken } from "./IEvidenceTypeSpecToken";

/** A lexical failure that leaves the token stream incomplete. */
interface ILexError {
  message: string;
  start: number;
  end: number;
}

const PUNCTUATION = [
  "...",
  "@@",
  "#{",
  "#[",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  "<",
  ">",
  ";",
  ",",
  ":",
  "?",
  "=",
  ".",
  "@",
  "#",
  "|",
  "&",
];

/**
 * Tokenizes TypeSpec source text.
 *
 * Strings (including triple-quoted and `${...}` interpolated forms), backtick
 * identifiers, and comments are consumed atomically so their contents can never
 * be mistaken for declarations or delimiters. Unterminated constructs are
 * reported instead of guessed.
 */
export namespace EvidenceTypeSpecLexer {
  export function tokenize(content: string): {
    tokens: IEvidenceTypeSpecToken[];
    errors: Array<{ message: string; start: number; end: number }>;
  } {
    const tokens: IEvidenceTypeSpecToken[] = [];
    const errors: ILexError[] = [];
    let index = 0;
    while (index < content.length) {
      const ch = content.charAt(index);
      if (/\s/u.test(ch)) {
        index++;
      } else if (content.startsWith("//", index)) {
        const newline = content.indexOf("\n", index);
        index = newline === -1 ? content.length : newline + 1;
      } else if (content.startsWith("/*", index)) {
        const close = content.indexOf("*/", index + 2);
        const end = close === -1 ? content.length : close + 2;
        if (close === -1)
          errors.push({
            message: "Unterminated block comment.",
            start: index,
            end,
          });
        else if (
          content.startsWith("/**", index) &&
          !content.startsWith("/**/", index)
        )
          tokens.push({
            kind: "doc",
            value: content.slice(index, end),
            start: index,
            end,
          });
        index = end;
      } else if (ch === '"') {
        const end = readString(content, index, errors);
        tokens.push({
          kind: "string",
          value: stringValue(content, index, end),
          start: index,
          end,
        });
        index = end;
      } else if (ch === "`") {
        const close = findBacktickClose(content, index + 1);
        if (close === -1) {
          errors.push({
            message: "Unterminated backtick identifier.",
            start: index,
            end: content.length,
          });
          index = content.length;
        } else {
          tokens.push({
            kind: "identifier",
            value: content.slice(index + 1, close).replace(/\\(.)/gu, "$1"),
            start: index,
            end: close + 1,
          });
          index = close + 1;
        }
      } else if (isIdentifierStart(content, index)) {
        let end = index + width(content, index);
        while (end < content.length && isIdentifierPart(content, end))
          end += width(content, end);
        tokens.push({
          kind: "identifier",
          value: content.slice(index, end),
          start: index,
          end,
        });
        index = end;
      } else if (/[0-9]/u.test(ch)) {
        let end = index + 1;
        while (end < content.length && /[\w.]/u.test(content.charAt(end))) {
          // A dot only continues a number when a digit follows (1.5, not 1..2).
          if (
            content.charAt(end) === "." &&
            !/[0-9]/u.test(content.charAt(end + 1))
          )
            break;
          end++;
        }
        tokens.push({
          kind: "number",
          value: content.slice(index, end),
          start: index,
          end,
        });
        index = end;
      } else {
        const punctuation = PUNCTUATION.find((candidate) =>
          content.startsWith(candidate, index),
        );
        const value = punctuation ?? ch;
        tokens.push({
          kind: "punctuation",
          value,
          start: index,
          end: index + value.length,
        });
        index += value.length;
      }
    }
    return { tokens, errors };
  }

  function readString(
    content: string,
    start: number,
    errors: ILexError[],
  ): number {
    const triple = content.startsWith('"""', start);
    const delimiter = triple ? '"""' : '"';
    let index = start + delimiter.length;
    while (index < content.length) {
      if (content[index] === "\\") {
        index += 2;
      } else if (content.startsWith("${", index)) {
        index = skipInterpolation(content, index + 2, errors);
      } else if (content.startsWith(delimiter, index)) {
        return index + delimiter.length;
      } else if (!triple && content[index] === "\n") {
        break;
      } else {
        index++;
      }
    }
    errors.push({
      message: "Unterminated string literal.",
      start,
      end: Math.min(index, content.length),
    });
    return Math.min(index, content.length);
  }

  // Interpolations may nest strings and braces; skip to the matching `}`.
  function skipInterpolation(
    content: string,
    start: number,
    errors: ILexError[],
  ): number {
    let depth = 1;
    let index = start;
    while (index < content.length && depth > 0) {
      const ch = content.charAt(index);
      if (ch === '"') index = readString(content, index, errors);
      else {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        index++;
      }
    }
    return index;
  }

  function stringValue(content: string, start: number, end: number): string {
    const triple = content.startsWith('"""', start);
    const inner = content.slice(
      start + (triple ? 3 : 1),
      Math.max(start + (triple ? 3 : 1), end - (triple ? 3 : 1)),
    );
    return inner.replace(/\\(.)/gu, (_, escaped: string) =>
      escaped === "n"
        ? "\n"
        : escaped === "t"
          ? "\t"
          : escaped === "r"
            ? "\r"
            : escaped,
    );
  }

  function findBacktickClose(content: string, start: number): number {
    for (let index = start; index < content.length; index++) {
      if (content[index] === "\\") index++;
      else if (content[index] === "`") return index;
      else if (content[index] === "\n") return -1;
    }
    return -1;
  }

  function character(content: string, index: number): string {
    return String.fromCodePoint(content.codePointAt(index) ?? 0);
  }

  function width(content: string, index: number): number {
    return character(content, index).length;
  }

  function isIdentifierStart(content: string, index: number): boolean {
    const ch = character(content, index);
    return ch === "$" || ch === "_" || /\p{ID_Start}/u.test(ch);
  }

  function isIdentifierPart(content: string, index: number): boolean {
    const ch = character(content, index);
    return ch === "$" || /\p{ID_Continue}/u.test(ch);
  }
}
