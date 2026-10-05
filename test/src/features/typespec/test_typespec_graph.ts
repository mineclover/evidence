import { EvidenceChecker } from "@wrtnlabs/evidence";
import type { IEvidenceCheckReport } from "@wrtnlabs/evidence";
import { TestValidator } from "@nestia/e2e";
import { dedent } from "@typia/utils";
import { join } from "node:path";

import { EvidenceTestFileSystem } from "../../internal/EvidenceTestFileSystem";

/**
 * Checks a requirement -> TypeSpec -> TypeScript chain end to end.
 *
 * TypeSpec targets resolve from the reference root like Markdown targets, so a
 * DTO in any directory cites `specs/main.tsp#Model`.
 *
 * 1. Cover Markdown requirements from TypeSpec and TypeSpec from nested DTOs.
 * 2. Reject citing-file-relative paths that leave the reference root.
 * 3. Report a root-relative path that names no selected TypeSpec file.
 * 4. With TypeSpec and TypeScript references on one claim, route root-relative
 *    TypeSpec targets and citing-file-relative TypeScript targets to their own
 *    reference, leaving upstream TypeScript resolution unchanged.
 */
export async function test_typespec_graph(): Promise<void> {
  await EvidenceTestFileSystem.experiment(
    "typespec-graph",
    {
      "evidence.config.ts": dedent`
        export default {
          claims: [
            {
              name: "contracts",
              type: "typespec",
              files: ["specs/*.tsp"],
              reference: { type: "markdown", files: ["docs/*.md"], symbol: ["h2"] },
            },
            {
              name: "implementation",
              type: "typescript",
              files: ["src/**/*.ts"],
              reference: { type: "typespec", files: ["specs/*.tsp"], symbol: ["type", "function"] },
            },
          ],
        };
      `,
      "docs/requirements.md": dedent`
        # Requirements

        ## User profile {#user-profile}

        ## User lookup {#user-lookup}
      `,
      "specs/main.tsp": dedent`
        namespace Shop;

        @evidence("docs/requirements.md#user-profile", "Profile contract")
        model User {
          id: string;
        }

        /** @evidence docs/requirements.md#user-lookup Lookup contract */
        op getUser(id: string): User;
      `,
      "src/dto/user.ts": dedent`
        /** @evidence specs/main.tsp#User Implements the User contract. */
        export interface UserDTO {
          id: string;
        }

        /** @evidence specs/main.tsp#Shop.getUser Implements the lookup operation. */
        export function getUser(id: string): UserDTO {
          return { id };
        }
      `,
    },
    async (directory) => {
      const file = join(directory, "evidence.config.ts");
      const codes = (report: IEvidenceCheckReport): string[] =>
        report.diagnostics.map((diagnostic) => diagnostic.code);

      const covered = await EvidenceChecker.check(file);
      TestValidator.equals("chain diagnostics", codes(covered), []);
      TestValidator.equals("chain exit code", covered.exitCode, 0);

      await EvidenceTestFileSystem.save(directory, {
        "src/dto/user.ts": dedent`
          /** @evidence ../../specs/main.tsp#User Citing-file-relative path. */
          export interface UserDTO {
            id: string;
          }

          /** @evidence specs/main.tsp#Shop.getUser Implements the lookup operation. */
          export function getUser(id: string): UserDTO {
            return { id };
          }
        `,
      });
      const escaped = await EvidenceChecker.check(file);
      TestValidator.predicate("parent traversal is malformed", () =>
        codes(escaped).includes("target-malformed"),
      );

      await EvidenceTestFileSystem.save(directory, {
        "src/dto/user.ts": dedent`
          /** @evidence specs/missing.tsp#User Unknown contract file. */
          export interface UserDTO {
            id: string;
          }

          /** @evidence specs/main.tsp#Shop.getUser Implements the lookup operation. */
          export function getUser(id: string): UserDTO {
            return { id };
          }
        `,
      });
      const missing = await EvidenceChecker.check(file);
      TestValidator.predicate("unselected file is missing", () =>
        codes(missing).includes("target-missing-file"),
      );

      // 4. One claim, two references with different target roots.
      await EvidenceTestFileSystem.save(directory, {
        "evidence.config.ts": dedent`
          export default {
            claims: [
              {
                name: "implementation",
                type: "typescript",
                files: ["src/dto/*.ts"],
                reference: [
                  { type: "typespec", files: ["specs/*.tsp"], symbol: ["type", "function"] },
                  { type: "typescript", files: ["src/model/*.ts"], symbol: ["type"] },
                ],
              },
            ],
          };
        `,
        "src/model/base.ts": "export interface Base {\n  id: string;\n}\n",
        "src/dto/user.ts": dedent`
          /**
           * @evidence specs/main.tsp#User Implements the User contract.
           * @evidence ../model/base.ts#Base Extends the shared base shape.
           */
          export interface UserDTO {
            id: string;
          }

          /** @evidence specs/main.tsp#Shop.getUser Implements the lookup operation. */
          export function getUser(id: string): UserDTO {
            return { id };
          }
        `,
      });
      const mixed = await EvidenceChecker.check(file);
      TestValidator.equals("mixed reference diagnostics", codes(mixed), []);
      TestValidator.equals("mixed reference exit code", mixed.exitCode, 0);

      // The TypeScript target keeps citing-file-relative resolution: a
      // root-relative spelling of it names no file next to the citing DTO.
      await EvidenceTestFileSystem.save(directory, {
        "src/dto/user.ts": dedent`
          /**
           * @evidence specs/main.tsp#User Implements the User contract.
           * @evidence src/model/base.ts#Base Root-relative TypeScript target.
           */
          export interface UserDTO {
            id: string;
          }

          /** @evidence specs/main.tsp#Shop.getUser Implements the lookup operation. */
          export function getUser(id: string): UserDTO {
            return { id };
          }
        `,
      });
      const rooted = await EvidenceChecker.check(file);
      TestValidator.equals(
        "root-relative TypeScript target fails",
        rooted.exitCode,
        1,
      );
      TestValidator.predicate("TypeScript base stays unacknowledged", () =>
        codes(rooted).includes("graph-missing-acknowledgement"),
      );
    },
  );
}
