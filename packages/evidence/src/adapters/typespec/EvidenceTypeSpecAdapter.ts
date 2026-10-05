import typia from "typia";

import { EvidenceInventory } from "../../graph/EvidenceInventory";
import { EvidenceTypeSpecScanner } from "./EvidenceTypeSpecScanner";
import type { IEvidenceAdapter } from "../../structures/IEvidenceAdapter";
import type { IEvidenceInventory } from "../../structures/IEvidenceInventory";
import type { IEvidenceSourceSnapshot } from "../../structures/IEvidenceSourceSnapshot";

/**
 * Extracts TypeSpec models, interfaces, operations, enums, unions, scalars, and
 * aliases (qualified by namespace) with decorator- and JSDoc-based annotation
 * hosts.
 *
 * EvidenceTypeSpecScanner tokenizes each source, discovers declared units and
 * members, maps JSDoc comments and native TypeSpec `@evidence` /
 * `@evidenceReview` / `@evidenceExclude` decorators, and reports syntax it
 * cannot classify as an incomplete inventory.
 */
export class EvidenceTypeSpecAdapter implements IEvidenceAdapter<"typespec"> {
  /** Artifact discriminator selecting TypeSpec grammar and contract extraction. */
  public get type(): "typespec" {
    return "typespec";
  }

  /** Scans captured TypeSpec contents into an owned normalized inventory. */
  public async analyze(
    snapshot: IEvidenceSourceSnapshot,
  ): Promise<IEvidenceInventory> {
    const input = structuredClone(typia.assert(snapshot));
    const inventory: IEvidenceInventory = {
      schemaVersion: 1,
      sources: input.files,
      annotationRanges: [],
      units: [],
      addresses: [],
      hosts: [],
      declarations: [],
      reviews: [],
      diagnostics: input.diagnostics.map((diagnostic) => ({
        code: `source-${diagnostic.code}`,
        severity: "error",
        message: diagnostic.message,
        repair:
          "Restore access to the selected TypeSpec source before evaluating coverage.",
        location: { file: diagnostic.path },
      })),
      dependencies: input.dependencies,
      complete: input.complete,
    };
    for (const source of input.files) {
      new EvidenceTypeSpecScanner(inventory, source).scan();
    }
    return new EvidenceInventory([inventory]).snapshot();
  }
}
