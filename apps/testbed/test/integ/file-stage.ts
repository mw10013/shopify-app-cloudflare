import { TestFileStage } from "@mw10013/rigging/cloudflare/stage";
import * as Schema from "effect/Schema";

const encodeTestFileStage = Schema.encodeSync(TestFileStage);
const decodeTestFileStage = Schema.decodeUnknownSync(TestFileStage);

/** Files run in parallel, and two files on one stage would destroy each other's stack. */
export const fileStage = (name: string) =>
  encodeTestFileStage(decodeTestFileStage(`${String(process.env.ALCHEMY_TEST_STAGE)}-${name}`));
