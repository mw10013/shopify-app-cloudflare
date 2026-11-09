import { TestFileStage } from "@mw10013/rigging/cloudflare/stage";
import * as Schema from "effect/Schema";

const encodeTestFileStage = Schema.encodeSync(TestFileStage);
const decodeTestFileStage = Schema.decodeUnknownSync(TestFileStage);

/**
 * An integ file's own stage, the checkout's `test` stage (`ALCHEMY_TEST_STAGE`) with `name`
 * appended, as {@link TestFileStage} spells it. Pass it to `Test.make`'s `stage`: files run in
 * parallel, and two files on one stage would destroy each other's stack. `name` is the file's
 * name without its dashes (`backendbinding` for `backend-binding.test.ts`).
 */
export const fileStage = (name: string) =>
  encodeTestFileStage(decodeTestFileStage(`${String(process.env.ALCHEMY_TEST_STAGE)}-${name}`));
