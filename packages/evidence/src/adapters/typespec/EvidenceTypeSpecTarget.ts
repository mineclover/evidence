import { EvidenceAccessor } from "../../targets/EvidenceAccessor";
import type { IEvidenceAddress } from "../../structures/IEvidenceAddress";

/**
 * Parses reference-root-relative TypeSpec targets.
 *
 * TypeSpec files are shared contract documents: generated DTOs, handlers, and
 * tests cite them as `specs/main.tsp#Model` from any directory. Like Markdown,
 * the path therefore resolves from the reference root instead of the citing
 * file, while the fragment keeps the ordinary dotted public accessor grammar
 * (`Namespace.Model`, `Model.property`).
 *
 * @example
 *   EvidenceTypeSpecTarget.parse("specs/main.tsp#Shop.Product");
 *   // { file: "specs/main.tsp", segments: ["Shop", "Product"] }
 */
export namespace EvidenceTypeSpecTarget {
  /**
   * Splits a target into its normalized root-relative file and accessor.
   *
   * Absolute paths and parent traversal are rejected because they would escape
   * the reference root that gives the path its meaning.
   */
  export function parse(target: string): IEvidenceAddress {
    const hash = target.indexOf("#");
    if (hash === target.length - 1)
      throw new Error(
        "Name a TypeSpec declaration after '#', or omit '#' when citing the file unit itself.",
      );
    let file: string;
    try {
      file = normalize(
        decodeURIComponent(hash < 0 ? target : target.slice(0, hash)),
      );
    } catch {
      throw new Error(
        "Use valid percent escapes in the TypeSpec path; write %20 for a space and %23 for a literal '#'.",
      );
    }
    if (file === "") throw new Error("Name the TypeSpec file before '#'.");
    if (file.startsWith("/") || /^[A-Za-z]:\//u.test(file))
      throw new Error(
        "TypeSpec targets are reference-root-relative; remove the absolute prefix.",
      );
    if (file.split("/").includes(".."))
      throw new Error(
        "TypeSpec targets are reference-root-relative; '..' cannot leave the reference root.",
      );
    return {
      file,
      segments: hash < 0 ? [] : EvidenceAccessor.parse(target.slice(hash + 1)),
    };
  }

  /** Normalizes separators and leading `./` segments of a root-relative path. */
  export function normalize(file: string): string {
    let output = file.replaceAll("\\", "/");
    while (output.startsWith("./")) output = output.slice(2);
    return output;
  }
}
