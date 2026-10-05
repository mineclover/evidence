/**
 * One lexical TypeSpec token with its source offsets.
 *
 * `identifier` values are unescaped (backtick identifiers lose their quotes),
 * `string` values hold the literal contents, and `doc` tokens are JSDoc block
 * comments kept for annotation parsing. Other comments and whitespace are not
 * tokens.
 */
export interface IEvidenceTypeSpecToken {
  /** Token category. */
  kind: "identifier" | "string" | "number" | "doc" | "punctuation";

  /** Unescaped identifier, string contents, or the literal token text. */
  value: string;

  /** Inclusive start offset in the source text. */
  start: number;

  /** Exclusive end offset in the source text. */
  end: number;
}
