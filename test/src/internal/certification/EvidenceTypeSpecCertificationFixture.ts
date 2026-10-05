import { EvidenceTypeSpecAdapter } from "@wrtnlabs/evidence";
import { dedent } from "@typia/utils";

import type { IEvidenceAdapterCertification } from "./IEvidenceAdapterCertification";

/**
 * Supplies independent exact TypeSpec expectations.
 *
 * Namespaces qualify declarations without owning a unit, so every namespaced
 * declaration is published with and without its namespace.
 */
export namespace EvidenceTypeSpecCertificationFixture {
  /** Builds a fresh TypeSpec certification scenario. */
  export function create(): IEvidenceAdapterCertification {
    const file = "specs/contract.tsp";
    const qualified = (accessor: string) => [
      { file, accessor: `Shop.${accessor}` },
      { file, accessor },
    ];
    return {
      type: "typespec",
      adapter: new EvidenceTypeSpecAdapter(),
      sources: [
        {
          file,
          content: dedent`
      import "@typespec/http";

      namespace Shop;

      /**
       * 상품 📘
       * @evidence docs/requirements.md#type Implements the product contract.
       */
      model Product {
        /**
         * 식별자
         * @evidence docs/requirements.md#property Implements the identifier.
         */
        id: string;

        /** @internal Retired public contract. */
        legacy?: string;
      }

      /**
       * 조회
       * @evidence docs/requirements.md#function Implements the lookup operation.
       */
      op lookup(id: string): Product;

      extern dec audit(target: unknown);
    `,
        },
      ],
      units: [
        {
          key: "type:Shop.Product",
          symbol: "type",
          identity: ["Shop", "Product"],
          sites: 1,
          addresses: qualified("Product"),
          withdrawals: [],
        },
        {
          key: "property:Shop.Product.id",
          symbol: "property",
          identity: ["Shop", "Product", "id"],
          parent: "type:Shop.Product",
          sites: 1,
          addresses: qualified("Product.id"),
          withdrawals: [],
        },
        {
          key: "property:Shop.Product.legacy",
          symbol: "property",
          identity: ["Shop", "Product", "legacy"],
          parent: "type:Shop.Product",
          sites: 1,
          addresses: qualified("Product.legacy"),
          withdrawals: ["internal"],
        },
        {
          key: "function:Shop.lookup",
          symbol: "function",
          identity: ["Shop", "lookup"],
          sites: 1,
          addresses: qualified("lookup"),
          withdrawals: [],
        },
      ],
      hosts: [
        "type:Shop.Product",
        "property:Shop.Product.id",
        "property:Shop.Product.legacy",
        "function:Shop.lookup",
      ].map((unit) => ({ attachment: "attached", units: [unit] })),
      requirements: [
        { unit: "type:Shop.Product", target: "docs/requirements.md#type" },
        {
          unit: "property:Shop.Product.id",
          target: "docs/requirements.md#property",
        },
        {
          unit: "function:Shop.lookup",
          target: "docs/requirements.md#function",
        },
      ],
      excludedUnits: ["type:Shop", "function:Shop.audit"],
      annotationRanges: 3,
      incomplete: {
        sources: [
          {
            file,
            content: "model Product {}\nprojection Product#v1 {}\n",
          },
        ],
        diagnosticCodes: ["typespec-syntax"],
      },
      malformed: {
        sources: [{ file, content: "model Product {}\n/* never closed\n" }],
        diagnosticCodes: ["typespec-syntax"],
      },
      falsePositive: {
        source: {
          file,
          content: dedent`
        /** @evidence docs/requirements.md#attached Attached documentation. */
        model Product {
          // @evidence docs/requirements.md#comment Line comments are inert.
          name: string = "@evidence docs/requirements.md#literal Literal text is inert.";
        }

        @@evidence(Product, "docs/requirements.md#augment", "Augment decorators own no host.");
      `,
        },
        attachedTarget: "docs/requirements.md#attached",
        unsupportedAnnotations: 1,
      },
      mutation: {
        unit: "function:Shop.lookup",
        reasonBefore: "Implements the lookup operation.",
        reasonAfter: "Explains the lookup operation differently.",
        contentBefore: "op lookup(id: string): Product;",
        contentAfter: "op lookup(id: string, locale: string): Product;",
      },
    };
  }
}
