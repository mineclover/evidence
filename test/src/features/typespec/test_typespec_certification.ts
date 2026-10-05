import { EvidenceAdapterCertification } from "../../internal/certification/EvidenceAdapterCertification";
import { EvidenceAdapterCertificationFixtures } from "../../internal/certification/EvidenceAdapterCertificationFixtures";

/**
 * Applies the shared adapter certification contract to TypeSpec.
 *
 * The TypeSpec fixture defines expected inventory, graph failure, mutation, and
 * fingerprint behavior.
 *
 * 1. Construct the TypeSpec fixture.
 * 2. Run shared adapter certification.
 * 3. Require every declared gate to pass.
 */
export async function test_typespec_certification(): Promise<void> {
  const fixture = EvidenceAdapterCertificationFixtures.all().find(
    (item) => item.type === "typespec",
  );
  if (fixture === undefined)
    throw new Error("TypeSpec certification fixture is missing.");

  EvidenceAdapterCertification.assertInventory(
    fixture,
    await EvidenceAdapterCertification.analyze(fixture),
  );
  await EvidenceAdapterCertification.assertGraph(fixture);
  await EvidenceAdapterCertification.assertFailures(fixture);
  await EvidenceAdapterCertification.assertFingerprint(fixture);
  await EvidenceAdapterCertification.assertAmbiguity(fixture);
}
