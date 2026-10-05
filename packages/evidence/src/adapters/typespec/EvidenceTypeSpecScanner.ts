import { EvidenceDocumentation } from "../../parsers/EvidenceDocumentation";
import { EvidenceSourceText } from "../../internal/EvidenceSourceText";
import { EvidenceTagParser } from "../../parsers/EvidenceTagParser";
import { EvidenceTypeSpecLexer } from "./EvidenceTypeSpecLexer";
import type { IEvidenceTypeSpecToken } from "./IEvidenceTypeSpecToken";
import type { IEvidenceHost } from "../../structures/IEvidenceHost";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceFile } from "../../structures/IEvidenceSourceFile";
import type { IEvidenceSourceLocation } from "../../structures/IEvidenceSourceLocation";
import type { IEvidenceUnit } from "../../structures/IEvidenceUnit";
import type { EvidenceSymbol } from "../../typings/EvidenceSymbol";

/**
 * A decorator application; `args[i]` is set when argument i is one string
 * literal.
 */
interface IDecorator {
  name: string;
  start: number;
  end: number;
  args: Array<string | undefined>;
}

/** Documentation and decorators that precede one statement or member. */
interface ILeading {
  docs: IEvidenceTypeSpecToken[];
  decorators: IDecorator[];
  start: number | undefined;
  /** The `internal` declaration modifier, when present. */
  internal?: IEvidenceTypeSpecToken;
}

type MemberKind = "model" | "interface" | "enum" | "union";

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

const DECLARATIONS = new Set([
  "model",
  "interface",
  "enum",
  "union",
  "scalar",
  "alias",
  "op",
]);
const SKIPPED_STATEMENTS = new Set([
  "import",
  "using",
  "extern",
  "dec",
  "fn",
  "const",
]);
const OPENERS = new Set(["(", "[", "{", "<", "#{", "#["]);
const CLOSERS = new Set([")", "]", "}", ">"]);

/**
 * Scans one TypeSpec source into units, addresses, hosts, and annotations.
 *
 * Models, interfaces, enums, unions, scalars, aliases, and operations become
 * `type` / `function` units qualified by their namespace; model properties,
 * enum members, and named union variants become `property` units and interface
 * operations `function` units. JSDoc and the `@evidence`, `@evidenceReview`,
 * and `@evidenceExclude` decorators attach to the following declaration.
 *
 * The scanner works on tokens, so strings, comments, and backtick identifiers
 * cannot be mistaken for syntax. Syntax it cannot classify marks the inventory
 * incomplete with a diagnostic instead of guessing a smaller population, and
 * annotations on statements that own no unit (namespaces, spreads, unnamed
 * variants) land on unsupported hosts so the checker reports them.
 */
export class EvidenceTypeSpecScanner {
  private readonly text: EvidenceSourceText;

  private readonly tokens: IEvidenceTypeSpecToken[];

  private index = 0;

  public constructor(
    private readonly inventory: IEvidenceInventory,
    private readonly source: IEvidenceSourceFile,
  ) {
    this.text = new EvidenceSourceText(source.content);
    const lexed = EvidenceTypeSpecLexer.tokenize(source.content);
    this.tokens = lexed.tokens;
    for (const error of lexed.errors)
      this.problem(error.message, error.start, error.end);
  }

  /** Scans the complete source. */
  public scan(): void {
    this.statements([], false);
  }

  private statements(prefix: string[], block: boolean): void {
    let scope = prefix;
    for (;;) {
      const leading = this.leading();
      const token = this.peek();
      if (token === undefined) {
        if (block)
          this.problem(
            "Unterminated namespace block.",
            this.source.content.length,
            this.source.content.length,
          );
        this.unsupported(
          leading,
          "Move the annotation onto a model, interface, enum, union, scalar, alias, or operation.",
        );
        return;
      }
      if (this.isPunctuation(token, "}")) {
        this.unsupported(
          leading,
          "Move the annotation onto a model, interface, enum, union, scalar, alias, or operation.",
        );
        if (block) {
          this.index++;
          return;
        }
        this.problem("Unexpected '}' outside a block.", token.start, token.end);
        this.index++;
        continue;
      }
      if (this.isPunctuation(token, ";")) {
        this.index++;
        continue;
      }
      if (token.kind === "identifier" && token.value === "namespace") {
        this.index++;
        this.unsupported(
          leading,
          "Namespaces own no unit; annotate the declarations inside the namespace.",
        );
        const name = this.qualifiedName();
        if (name.length === 0) {
          this.problem("Expected a namespace name.", token.start, token.end);
          this.skipStatement();
          continue;
        }
        if (this.consumePunctuation(";")) scope = [...scope, ...name];
        else if (this.consumePunctuation("{"))
          this.statements([...scope, ...name], true);
        else {
          this.problem(
            "Expected ';' or '{' after the namespace name.",
            token.start,
            token.end,
          );
          this.skipStatement();
        }
        continue;
      }
      if (token.kind === "identifier" && DECLARATIONS.has(token.value)) {
        this.declaration(token, scope, leading);
        continue;
      }
      if (this.isPunctuation(token, "@@")) {
        // An augment decorator names its target by reference, so an Evidence
        // annotation applied through one has no declaration host.
        leading.start ??= token.start;
        leading.decorators.push(this.decorator());
        this.unsupported(
          leading,
          "Apply Evidence decorators directly to the declaration instead of through an augment decorator.",
        );
        this.skipStatement();
        continue;
      }
      if (token.kind === "identifier" && SKIPPED_STATEMENTS.has(token.value)) {
        // Imports, using directives, declarations of decorators/functions,
        // and constants add no contract units.
        this.unsupported(
          leading,
          "Move the annotation onto a model, interface, enum, union, scalar, alias, or operation.",
        );
        this.skipStatement();
        continue;
      }
      this.problem(
        `Unsupported TypeSpec statement starting with '${token.value}'.`,
        token.start,
        token.end,
      );
      this.skipStatement();
    }
  }

  private declaration(
    keyword: IEvidenceTypeSpecToken,
    scope: string[],
    leading: ILeading,
  ): void {
    this.index++;
    const nameToken = this.peek();
    if (nameToken?.kind !== "identifier") {
      this.problem(
        `Expected a name after '${keyword.value}'.`,
        keyword.start,
        keyword.end,
      );
      this.skipStatement();
      return;
    }
    this.index++;
    const kind = keyword.value;
    let bodyOpen: number | undefined;
    let end = nameToken.end;
    if (kind === "scalar" || kind === "alias" || kind === "op") {
      // Scalars may carry an `init` block; aliases and operations end at ';'.
      const result = this.skipUntilTerminator(kind === "scalar");
      end = result.end;
    } else {
      const result = this.skipUntilTerminator(true);
      end = result.end;
      bodyOpen = result.bodyOpen;
    }

    const local = [nameToken.value];
    const unit = this.emitUnit(
      scope,
      local,
      kind === "op" ? "function" : "type",
      undefined,
      keyword.start,
      end,
      leading,
    );

    if (bodyOpen !== undefined && kind !== "scalar") {
      const saved = this.index;
      this.index = bodyOpen + 1;
      this.members(kind as MemberKind, unit, scope, local);
      this.index = saved;
    }
  }

  private members(
    kind: MemberKind,
    parent: IEvidenceUnit,
    scope: string[],
    parentLocal: string[],
  ): void {
    const hint =
      "Move the annotation onto a named member or onto the enclosing declaration.";
    for (;;) {
      const leading = this.leading();
      const token = this.peek();
      if (token === undefined || this.isPunctuation(token, "}")) {
        this.unsupported(leading, hint);
        return;
      }
      if (this.isPunctuation(token, ",") || this.isPunctuation(token, ";")) {
        this.unsupported(leading, hint);
        this.index++;
        continue;
      }
      if (this.isPunctuation(token, "...")) {
        this.unsupported(
          leading,
          "Spread members own no unit; annotate the spread source instead.",
        );
        this.skipMember();
        continue;
      }

      let name: IEvidenceTypeSpecToken | undefined;
      if (kind === "interface") {
        const next = this.peek(1);
        if (
          token.kind === "identifier" &&
          token.value === "op" &&
          next?.kind === "identifier"
        ) {
          name = next;
          this.index++;
        } else if (token.kind === "identifier") name = token;
      } else if (kind === "union") {
        // Only `name: Type` variants are named; bare type expressions own no unit.
        const named =
          (token.kind === "identifier" || token.kind === "string") &&
          this.isPunctuation(this.peek(1), ":");
        if (named) name = token;
      } else if (token.kind === "identifier" || token.kind === "string") {
        name = token;
      }

      if (name === undefined) {
        if (kind === "union") this.unsupported(leading, hint);
        else
          this.problem(
            `Unsupported ${kind} member starting with '${token.value}'.`,
            token.start,
            token.end,
          );
        this.skipMember();
        continue;
      }
      this.index++;
      const end = this.skipMember();
      const symbol: EvidenceSymbol =
        kind === "interface" ? "function" : "property";
      this.emitUnit(
        scope,
        [...parentLocal, name.value],
        symbol,
        parent,
        token.start,
        end,
        leading,
      );
    }
  }

  private emitUnit(
    scope: string[],
    local: string[],
    symbol: EvidenceSymbol,
    parent: IEvidenceUnit | undefined,
    start: number,
    end: number,
    leading: ILeading,
  ): IEvidenceUnit {
    const identity = [...scope, ...local];
    const id = `typespec:${this.source.id}:${identity.join(".")}`;
    const range = this.text.range(start, end);
    const site = {
      id: `${id}:site`,
      file: this.source.physicalPath,
      range,
      content: [range],
    };
    const unit: IEvidenceUnit = {
      id,
      ...(parent !== undefined ? { parentId: parent.id } : {}),
      type: "typespec",
      symbol,
      identity,
      name: identity.at(-1) ?? "",
      sites: [site],
      withdrawals: [],
    };
    this.inventory.units.push(unit);
    this.publishAddresses(id, scope, local);
    const host: IEvidenceHost = {
      id: `${id}:host`,
      file: this.source.physicalPath,
      range:
        leading.start !== undefined && leading.start < start
          ? this.text.range(leading.start, start)
          : range,
      origins: this.source.addresses.map((address) => address.absolute),
      siteId: site.id,
      unitIds: [unit.id],
      attachment: "attached",
    };
    this.inventory.hosts.push(host);
    this.attach(host, unit, leading);
    if (leading.internal !== undefined)
      unit.withdrawals.push({
        tag: "internal",
        location: {
          file: this.source.physicalPath,
          range: this.text.range(leading.internal.start, leading.internal.end),
        },
      });
    return unit;
  }

  /**
   * Reports annotations that precede a statement owning no unit
   * (`unsupported-annotation-host`) instead of silently dropping them.
   */
  private unsupported(leading: ILeading, problem: string): void {
    if (leading.start === undefined) return;
    const end = Math.max(
      ...leading.docs.map((doc) => doc.end),
      ...leading.decorators.map((decorator) => decorator.end),
    );
    const host: IEvidenceHost = {
      id: `typespec:${this.source.id}:unsupported:${leading.start}`,
      file: this.source.physicalPath,
      range: this.text.range(leading.start, end),
      origins: this.source.addresses.map((address) => address.absolute),
      unitIds: [],
      attachment: "unsupported",
      problem,
    };
    const before = this.inventory.diagnostics.length;
    this.attach(host, undefined, leading);
    if (this.inventory.diagnostics.length > before)
      this.inventory.hosts.push(host);
  }

  private leading(): ILeading {
    const leading: ILeading = { docs: [], decorators: [], start: undefined };
    for (;;) {
      const token = this.peek();
      if (token === undefined) return leading;
      if (token.kind === "doc") {
        leading.docs.push(token);
        leading.start ??= token.start;
        this.index++;
      } else if (this.isPunctuation(token, "@")) {
        leading.start ??= token.start;
        leading.decorators.push(this.decorator());
      } else if (
        token.kind === "identifier" &&
        token.value === "internal" &&
        this.peek(1)?.kind === "identifier"
      ) {
        // `internal` restricts a declaration to its package, like @internal.
        leading.internal = token;
        this.index++;
      } else if (
        this.isPunctuation(token, "#") &&
        this.peek(1)?.kind === "identifier"
      ) {
        // Directives (#suppress "code" "reason", #deprecated "message").
        this.index += 2;
        while (this.peek()?.kind === "string") this.index++;
      } else return leading;
    }
  }

  private decorator(): IDecorator {
    const at = this.take();
    const name = this.qualifiedName().join(".");
    let end = this.previousEnd(at.end);
    const args: Array<string | undefined> = [];
    if (this.isPunctuation(this.peek(), "(")) {
      this.index++;
      let depth = 0;
      let current: IEvidenceTypeSpecToken[] = [];
      for (let token = this.peek(); token !== undefined; token = this.peek()) {
        this.index++;
        end = token.end;
        if (depth === 0 && this.isPunctuation(token, ")")) break;
        if (depth === 0 && this.isPunctuation(token, ",")) {
          args.push(argument(current));
          current = [];
          continue;
        }
        if (token.kind === "punctuation" && OPENERS.has(token.value)) depth++;
        else if (token.kind === "punctuation" && CLOSERS.has(token.value))
          depth--;
        current.push(token);
      }
      if (current.length !== 0) args.push(argument(current));
    }
    return { name, start: at.start, end, args };

    function argument(tokens: IEvidenceTypeSpecToken[]): string | undefined {
      const [only] = tokens;
      return tokens.length === 1 && only?.kind === "string"
        ? only.value
        : undefined;
    }
  }

  private qualifiedName(): string[] {
    const parts: string[] = [];
    while (this.peek()?.kind === "identifier") {
      parts.push(this.take().value);
      if (
        !this.isPunctuation(this.peek(), ".") ||
        this.peek(1)?.kind !== "identifier"
      )
        break;
      this.index++;
    }
    return parts;
  }

  /**
   * Advances past a declaration header and its terminator.
   *
   * Template parameters, heritage clauses, and inline expressions are skipped
   * with bracket depth, so `{` inside `<...>` or `(...)` is never mistaken for
   * the body. With `allowBody`, a depth-0 `{` opens the body (skipped to its
   * matching `}`); otherwise a `{` is an inline model expression.
   */
  private skipUntilTerminator(allowBody: boolean): {
    end: number;
    bodyOpen?: number;
  } {
    let depth = 0;
    let end = this.previousEnd(0);
    for (let token = this.peek(); token !== undefined; token = this.peek()) {
      if (depth === 0 && this.isPunctuation(token, ";")) {
        this.index++;
        return { end: token.end };
      }
      if (depth === 0 && this.isPunctuation(token, "}")) return { end };
      if (depth === 0 && allowBody && this.isPunctuation(token, "{")) {
        const bodyOpen = this.index;
        const close = this.matching(this.index);
        this.index = close + 1;
        const closeToken = this.tokens[close];
        if (closeToken === undefined || !this.isPunctuation(closeToken, "}")) {
          this.problem(
            "Unterminated declaration body.",
            token.start,
            token.end,
          );
          return { end: this.source.content.length, bodyOpen };
        }
        return { end: closeToken.end, bodyOpen };
      }
      if (token.kind === "punctuation" && OPENERS.has(token.value)) depth++;
      else if (token.kind === "punctuation" && CLOSERS.has(token.value))
        depth--;
      end = token.end;
      this.index++;
    }
    return { end };
  }

  /** Skips one member up to and including its `,` / `;`, stopping before `}`. */
  private skipMember(): number {
    let depth = 0;
    let end = this.previousEnd(0);
    for (let token = this.peek(); token !== undefined; token = this.peek()) {
      if (depth === 0 && this.isPunctuation(token, "}")) return end;
      if (
        depth === 0 &&
        (this.isPunctuation(token, ";") || this.isPunctuation(token, ","))
      ) {
        this.index++;
        return token.end;
      }
      if (token.kind === "punctuation" && OPENERS.has(token.value)) depth++;
      else if (token.kind === "punctuation" && CLOSERS.has(token.value))
        depth--;
      end = token.end;
      this.index++;
    }
    return end;
  }

  /**
   * Skips one statement up to and including its `;`, stopping before an
   * enclosing `}`.
   */
  private skipStatement(): void {
    let depth = 0;
    for (let token = this.peek(); token !== undefined; token = this.peek()) {
      if (depth === 0 && this.isPunctuation(token, "}")) return;
      this.index++;
      if (depth === 0 && this.isPunctuation(token, ";")) return;
      if (token.kind === "punctuation" && OPENERS.has(token.value)) depth++;
      else if (token.kind === "punctuation" && CLOSERS.has(token.value)) {
        depth--;
        // A closed top-level block (e.g. `extern dec x() {}`) ends the statement.
        if (depth === 0 && token.value === "}") return;
      }
    }
  }

  /**
   * Index of the `}` matching the `{` at `open`, or the token count when the
   * body never closes. Only braces are balanced: `#{` value objects close with
   * `}` too, while `<`/`(`/`[` cannot contain an unbalanced brace.
   */
  private matching(open: number): number {
    let depth = 0;
    for (let index = open; index < this.tokens.length; index++) {
      const token = this.tokens[index];
      if (token?.kind !== "punctuation") continue;
      if (token.value === "{" || token.value === "#{") depth++;
      else if (token.value === "}") {
        depth--;
        if (depth === 0) return index;
      }
    }
    return this.tokens.length;
  }

  private peek(offset = 0): IEvidenceTypeSpecToken | undefined {
    return this.tokens[this.index + offset];
  }

  /** Consumes the current token; callers check `peek()` first. */
  private take(): IEvidenceTypeSpecToken {
    const token = this.peek();
    if (token === undefined)
      throw new Error("TypeSpec scanner read past the last token.");
    this.index++;
    return token;
  }

  private previousEnd(fallback: number): number {
    return this.tokens[this.index - 1]?.end ?? fallback;
  }

  private isPunctuation(
    token: IEvidenceTypeSpecToken | undefined,
    value: string,
  ): boolean {
    return token?.kind === "punctuation" && token.value === value;
  }

  private consumePunctuation(value: string): boolean {
    if (!this.isPunctuation(this.peek(), value)) return false;
    this.index++;
    return true;
  }

  private problem(message: string, start: number, end: number): void {
    this.inventory.complete = false;
    this.inventory.diagnostics.push({
      code: "typespec-syntax",
      severity: "error",
      message,
      repair:
        "Fix the TypeSpec syntax so every declaration can be classified before evaluating coverage.",
      location: {
        file: this.source.physicalPath,
        range: this.text.range(start, end),
      },
    });
  }

  /**
   * Publishes the namespace-qualified identity and, for namespaced
   * declarations, the identity without its namespace, under every physical
   * address of the source.
   */
  private publishAddresses(
    unitId: string,
    scope: string[],
    local: string[],
  ): void {
    const files = new Set(
      this.source.addresses.map((address) => address.absolute),
    );
    const spellings = [[...scope, ...local]];
    if (scope.length !== 0) spellings.push(local);
    for (const file of files)
      for (const segments of spellings)
        this.inventory.addresses.push({ unitId, file, segments });
  }

  private attach(
    host: IEvidenceHost,
    unit: IEvidenceUnit | undefined,
    leading: ILeading,
  ): void {
    for (const doc of leading.docs) {
      const documentation = EvidenceDocumentation.read(
        this.source.content,
        host.id,
        this.text.range(doc.start, doc.end),
        {
          opening: "/**",
          closing: "*/",
          linePrefix: "*",
          tagBoundaries: true,
          allowWithdrawal: true,
        },
      );
      const parsed = EvidenceTagParser.parse(
        this.source.content,
        host,
        documentation,
      );
      for (const declaration of parsed.declarations)
        this.addDeclaration(declaration);
      for (const review of parsed.reviews) this.addReview(review);
      if (unit !== undefined) unit.withdrawals.push(...parsed.withdrawals);
      this.inventory.diagnostics.push(...parsed.diagnostics);
    }

    for (const decorator of leading.decorators) {
      const name = decorator.name.split(".").pop();
      const location: IEvidenceSourceLocation = {
        file: this.source.physicalPath,
        range: this.text.range(decorator.start, decorator.end),
      };
      if (host.attachment !== "attached") {
        if (
          name === "evidence" ||
          name === "evidenceExclude" ||
          name === "evidenceReview"
        )
          this.inventory.diagnostics.push({
            code: "unsupported-annotation-host",
            severity: "error",
            message: `@${name} has no eligible declaration host.`,
            repair:
              host.problem ??
              "Move the annotation onto a supported declaration.",
            location,
            hostId: host.id,
          });
        continue;
      }
      if (name === "evidence") {
        const target = decorator.args[0];
        if (target === undefined || target.length === 0) continue;
        this.addDeclaration({
          id: `declaration:${host.id}:${target}`,
          hostId: host.id,
          target,
          kind: "evidence",
          reason:
            nonEmpty(decorator.args[1]) ?? "TypeSpec contract specification",
          location,
        });
      } else if (name === "evidenceExclude") {
        this.addDeclaration({
          id: `declaration:${host.id}:exclude`,
          hostId: host.id,
          target: "",
          kind: "evidenceExclude",
          reason:
            nonEmpty(decorator.args[0]) ??
            "Excluded from evidence requirements",
          location,
        });
      } else if (name === "evidenceReview") {
        const target = decorator.args[0];
        if (target === undefined || target.length === 0) continue;
        const fingerprint =
          decorator.args[1] === undefined
            ? undefined
            : decorator.args[1].replace(/^#/u, "");
        this.addReview({
          id: `review:${host.id}:${target}`,
          hostId: host.id,
          target,
          location,
          reviews: "evidence",
          description:
            nonEmpty(decorator.args[2]) ?? "TypeSpec contract review",
          ...(fingerprint !== undefined ? { fingerprint } : {}),
        });
      } else if (
        unit !== undefined &&
        (name === "internal" || name === "hidden" || name === "ignore")
      ) {
        unit.withdrawals.push({ tag: name, location });
      }
    }
  }

  // JSDoc and decorator forms of one citation on the same host count once.
  private addDeclaration(
    declaration: IEvidenceInventory["declarations"][number],
  ): void {
    if (
      this.inventory.declarations.some(
        (existing) =>
          existing.hostId === declaration.hostId &&
          existing.target === declaration.target &&
          existing.kind === declaration.kind,
      )
    )
      return;
    this.inventory.declarations.push(declaration);
    this.inventory.annotationRanges.push(declaration.location);
  }

  private addReview(review: IEvidenceInventory["reviews"][number]): void {
    if (
      this.inventory.reviews.some(
        (existing) =>
          existing.hostId === review.hostId &&
          existing.target === review.target,
      )
    )
      return;
    this.inventory.reviews.push(review);
    this.inventory.annotationRanges.push(review.location);
  }
}
