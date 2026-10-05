import {
  EvidenceLanguageRegistry,
  EvidenceTypeSpecAdapter,
} from "@wrtnlabs/evidence";
import type { IEvidenceSourceSnapshot } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";

/**
 * Validates the official EvidenceTypeSpecAdapter extraction contract.
 *
 * Verifies:
 *
 * 1. Language registry and grammar registration for "typespec".
 * 2. Model, operation, enum, and member unit discovery.
 * 3. Native TypeSpec @evidence, @evidenceReview, @evidenceExclude decorators.
 * 4. JSDoc block comments carrying @evidence tags.
 * 5. Public addresses for qualified and unqualified names.
 */
export async function test_typespec_adapter(): Promise<void> {
  // 1. Verify language registry and adapter type
  const grammar = EvidenceLanguageRegistry.select("typespec", "specs/shop.tsp");
  TestValidator.equals("typespec grammar id", "typespec", grammar.id);

  const directAdapter = new EvidenceTypeSpecAdapter();
  TestValidator.equals("typespec adapter type", "typespec", directAdapter.type);

  // 2. Prepare sample TypeSpec source snapshot
  const tspContent = dedent`
    import "@typespec/http";
    import "@samchon/typespec-evidence";

    using TypeSpec.Http;
    using Samchon.Evidence;

    namespace Shop.Service;

    /**
     * Product inventory model.
     * @evidence docs/requirements.md#product-catalog Catalog model requirement
     */
    @doc("Product inventory model")
    @evidence("docs/requirements.md#product-catalog", "Catalog model requirement")
    @evidenceReview("specs/shop.tsp#Product", "rev12345", "Reviewed against schema")
    model Product {
      @evidence("docs/requirements.md#product-id", "Unique identifier for product")
      id: string;

      name: string;
      price: float64;
    }

    @evidence("docs/requirements.md#get-product", "Retrieve product by ID")
    @route("/products/{id}")
    op getProduct(@path id: string): Product;

    @evidence("docs/requirements.md#category-taxonomy", "Product category enumeration")
    enum ProductCategory {
      @evidence("docs/requirements.md#cat-electronics", "Electronics category")
      electronics,
      books,
      apparel,
    }

    /**
     * Cart session specification.
     * @evidence docs/requirements.md#cart-session User cart storage
     */
    model CartSession {
      cartId: string;
    }

    @evidenceExclude("Internal debugging scalar not tracked in public requirement")
    scalar DebugToken extends string;
  `;

  const snapshot: IEvidenceSourceSnapshot = {
    root: {
      declared: ".",
      absolute: "/workspace",
      display: ".",
    },
    files: [
      {
        id: "specs/shop.tsp",
        physicalPath: "/workspace/specs/shop.tsp",
        fingerprintPath: "specs/shop.tsp",
        digest: "a1b2c3d4e5f6",
        content: tspContent,
        addresses: [
          {
            absolute: "/workspace/specs/shop.tsp",
            relative: "specs/shop.tsp",
            display: "specs/shop.tsp",
          },
        ],
      },
    ],
    dependencies: [],
    diagnostics: [],
    complete: true,
  };

  // 3. Analyze through adapter
  const inventory = await directAdapter.analyze(snapshot);

  // 4. Assert completeness and unit discovery
  TestValidator.equals("inventory complete", true, inventory.complete);
  TestValidator.equals(
    "inventory diagnostics count",
    0,
    inventory.diagnostics.length,
  );

  // Units
  const productUnit = inventory.units.find(
    (u) => u.name === "Product" && u.symbol === "type",
  );
  TestValidator.predicate(
    "Product model unit exists",
    () => productUnit !== undefined,
  );

  const idPropertyUnit = inventory.units.find(
    (u) =>
      u.name === "id" &&
      u.symbol === "property" &&
      u.parentId === productUnit?.id,
  );
  TestValidator.predicate(
    "id property unit exists with parent Product",
    () => idPropertyUnit !== undefined,
  );

  const getProductOp = inventory.units.find(
    (u) => u.name === "getProduct" && u.symbol === "function",
  );
  TestValidator.predicate(
    "getProduct operation unit exists",
    () => getProductOp !== undefined,
  );

  const categoryEnum = inventory.units.find(
    (u) => u.name === "ProductCategory" && u.symbol === "type",
  );
  TestValidator.predicate(
    "ProductCategory enum unit exists",
    () => categoryEnum !== undefined,
  );

  const electronicsMember = inventory.units.find(
    (u) =>
      u.name === "electronics" &&
      u.symbol === "property" &&
      u.parentId === categoryEnum?.id,
  );
  TestValidator.predicate(
    "electronics enum member unit exists",
    () => electronicsMember !== undefined,
  );

  const cartSession = inventory.units.find(
    (u) => u.name === "CartSession" && u.symbol === "type",
  );
  TestValidator.predicate(
    "CartSession model unit exists",
    () => cartSession !== undefined,
  );

  const debugToken = inventory.units.find(
    (u) => u.name === "DebugToken" && u.symbol === "type",
  );
  TestValidator.predicate(
    "DebugToken scalar unit exists",
    () => debugToken !== undefined,
  );

  // Declarations
  const productDecl = inventory.declarations.find(
    (d) =>
      d.target === "docs/requirements.md#product-catalog" &&
      d.kind === "evidence",
  );
  TestValidator.predicate(
    "Product declaration found",
    () => productDecl !== undefined,
  );

  const idDecl = inventory.declarations.find(
    (d) =>
      d.target === "docs/requirements.md#product-id" && d.kind === "evidence",
  );
  TestValidator.predicate(
    "Property id declaration found",
    () => idDecl !== undefined,
  );

  const getProductDecl = inventory.declarations.find(
    (d) =>
      d.target === "docs/requirements.md#get-product" && d.kind === "evidence",
  );
  TestValidator.predicate(
    "getProduct operation declaration found",
    () => getProductDecl !== undefined,
  );

  const cartDecl = inventory.declarations.find(
    (d) =>
      d.target === "docs/requirements.md#cart-session" && d.kind === "evidence",
  );
  TestValidator.predicate(
    "JSDoc cart session declaration found",
    () => cartDecl !== undefined,
  );

  const excludeDecl = inventory.declarations.find(
    (d) => d.kind === "evidenceExclude",
  );
  TestValidator.predicate(
    "evidenceExclude declaration found",
    () =>
      excludeDecl !== undefined &&
      excludeDecl.reason.includes("Internal debugging scalar"),
  );

  // Reviews
  const productReview = inventory.reviews.find(
    (r) =>
      r.target === "specs/shop.tsp#Product" && r.fingerprint === "rev12345",
  );
  TestValidator.predicate(
    "Product review statement found with matching fingerprint",
    () => productReview !== undefined,
  );

  // Addresses
  const productAddresses = inventory.addresses.filter(
    (a) => a.unitId === productUnit?.id,
  );
  TestValidator.predicate(
    "Product has both qualified and unqualified addresses",
    () =>
      productAddresses.some(
        (a) => a.segments.join(".") === "Shop.Service.Product",
      ) && productAddresses.some((a) => a.segments.join(".") === "Product"),
  );
}
