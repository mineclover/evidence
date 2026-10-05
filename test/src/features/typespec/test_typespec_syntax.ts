import { EvidenceTypeSpecAdapter } from "@wrtnlabs/evidence";
import type {
  IEvidenceInventory,
  IEvidenceSourceSnapshot,
} from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

/**
 * Pins TypeSpec syntax that a character-level scan misclassifies.
 *
 * The expected unit sets match what the official TypeSpec parser declares for
 * the same sources.
 *
 * 1. Identifiers: backtick, `$`, quoted names, and members named like keywords.
 * 2. Delimiters inside strings, inline models, value objects, and init blocks.
 * 3. Namespaces, interface templates, spreads, union variants, and modifiers.
 * 4. Statements that own no unit, unsupported annotation hosts (including augment
 *    decorators), and syntax errors.
 */
export async function test_typespec_syntax(): Promise<void> {
  const units = (inventory: IEvidenceInventory): string[] =>
    inventory.units
      .map((unit) => `${unit.symbol} ${unit.identity.join(".")}`)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  // 1. Identifiers
  const identifiers = await analyze(dedent`
    namespace Shop;

    enum Mode { \`soft-wrap\`, \`explicit-lf\`: "lf", "Lnr ": "linear" }
    model Catalog {
      $schema: string;
      "content-type": string,
      op: string;
      model?: int32 = 1;
    }
  `);
  TestValidator.equals("identifier units", units(identifiers), [
    "property Shop.Catalog.$schema",
    "property Shop.Catalog.content-type",
    "property Shop.Catalog.model",
    "property Shop.Catalog.op",
    "property Shop.Mode.Lnr ",
    "property Shop.Mode.explicit-lf",
    "property Shop.Mode.soft-wrap",
    "type Shop.Catalog",
    "type Shop.Mode",
  ]);
  TestValidator.equals(
    "identifier inventory complete",
    identifiers.complete,
    true,
  );

  // 2. Delimiters that are not statement boundaries
  const delimiters = await analyze(dedent`
    #suppress "deprecated" "model op enum; } {"
    @doc("""
      Braces { and } and model Fake {} inside a triple-quoted string.
      """)
    model Page<T extends { id: string; }> is Base<{ a: string; b: int32 }> {
      items: T[];
      meta: { total: int32; next?: string };
      tags: string[] = #["a", "b"];
      options: Record<unknown> = #{ mode: "x;y", depth: 1 };
    }
    op create(@body body: { a: string; b: string }): { ok: boolean; };
    alias Pair = { left: string; right: string };
    scalar Slug extends string { init fromText(value: string); }
    model After {}
  `);
  TestValidator.equals("delimiter units", units(delimiters), [
    "function create",
    "property Page.items",
    "property Page.meta",
    "property Page.options",
    "property Page.tags",
    "type After",
    "type Page",
    "type Pair",
    "type Slug",
  ]);

  // 3. Scopes and member forms
  const scopes = await analyze(dedent`
    namespace Outer.Inner;

    @route("/chairs/{id}")
    namespace Operations {
      op lookup(id: string): void;
      namespace Deep.Er { model Leaf {} }
    }
    interface Store<T> extends Base<T> {
      op read(): T;
      write(value: T): void;
      list is Lister<T>;
    }
    enum Color { red, ...Palette, blue }
    union Result { success: Ok, failure: Err, string, "quoted-variant": int32 }
    model Mixed { ...Base; own: string }
    internal model Hidden {}
    extern dec helper(target: unknown);
    internal extern fn transform(input: Model): Model;
    @@doc(After, "augment model Fake {}");
    model After {}
  `);
  TestValidator.equals("scope units", units(scopes), [
    "function Outer.Inner.Operations.lookup",
    "function Outer.Inner.Store.list",
    "function Outer.Inner.Store.read",
    "function Outer.Inner.Store.write",
    "property Outer.Inner.Color.blue",
    "property Outer.Inner.Color.red",
    "property Outer.Inner.Mixed.own",
    "property Outer.Inner.Result.failure",
    "property Outer.Inner.Result.quoted-variant",
    "property Outer.Inner.Result.success",
    "type Outer.Inner.After",
    "type Outer.Inner.Color",
    "type Outer.Inner.Hidden",
    "type Outer.Inner.Mixed",
    "type Outer.Inner.Operations.Deep.Er.Leaf",
    "type Outer.Inner.Result",
    "type Outer.Inner.Store",
  ]);
  TestValidator.equals("scope inventory complete", scopes.complete, true);
  const hidden = scopes.units.find((unit) => unit.name === "Hidden");
  TestValidator.equals(
    "internal modifier withdraws the unit",
    (hidden?.withdrawals ?? []).map((withdrawal) => withdrawal.tag),
    ["internal"],
  );

  // 4. Annotations without a unit, and syntax that cannot be classified
  const hosts = await analyze(dedent`
    /** @evidence docs/req.md#vision Namespace-level citation. */
    @evidence("docs/req.md#scope", "Namespace-level citation")
    namespace Shop {
      @evidence("docs/req.md#model", "Model citation")
      model Item {}
    }
  `);
  TestValidator.equals(
    "namespace annotations are unsupported hosts",
    hosts.diagnostics.map((diagnostic) => diagnostic.code),
    ["unsupported-annotation-host", "unsupported-annotation-host"],
  );
  TestValidator.equals(
    "declaration annotation still attaches",
    hosts.declarations.map((declaration) => declaration.target),
    ["docs/req.md#model"],
  );

  const augmented = await analyze(dedent`
    model Item {}
    @@evidence(Item, "docs/req.md#augment", "Augment citation");
    @@doc(Item, "Ordinary augment decorators stay silent.");
  `);
  TestValidator.equals(
    "augment Evidence decorators are unsupported hosts",
    augmented.diagnostics.map((diagnostic) => diagnostic.code),
    ["unsupported-annotation-host"],
  );
  TestValidator.equals(
    "augment Evidence decorators acknowledge nothing",
    augmented.declarations,
    [],
  );
  TestValidator.equals("augment inventory complete", augmented.complete, true);

  for (const [title, content] of [
    ["unterminated comment", "model A {}\n/* never closed"],
    ["unterminated string", 'model A { name: "open; }'],
    ["unknown statement", "model A {}\nwidget B {}"],
    ["unterminated body", "model A { name: string;"],
  ] as const) {
    const broken = await analyze(content);
    TestValidator.equals(`${title} is incomplete`, broken.complete, false);
    TestValidator.predicate(`${title} reports typespec-syntax`, () =>
      broken.diagnostics.some(
        (diagnostic) => diagnostic.code === "typespec-syntax",
      ),
    );
  }
}

async function analyze(content: string): Promise<IEvidenceInventory> {
  const snapshot: IEvidenceSourceSnapshot = {
    root: { declared: ".", absolute: "/workspace", display: "." },
    files: [
      {
        id: "specs/main.tsp",
        physicalPath: "/workspace/specs/main.tsp",
        fingerprintPath: "specs/main.tsp",
        digest: "syntax",
        content,
        addresses: [
          {
            absolute: "/workspace/specs/main.tsp",
            relative: "specs/main.tsp",
            display: "specs/main.tsp",
          },
        ],
      },
    ],
    dependencies: [],
    diagnostics: [],
    complete: true,
  };
  return new EvidenceTypeSpecAdapter().analyze(snapshot);
}
