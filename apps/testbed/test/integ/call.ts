import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const Outcome = Schema.Union([
  Schema.TaggedStruct("Returned", { value: Schema.optionalKey(Schema.Unknown) }),
  Schema.TaggedStruct("ThrewError", { message: Schema.String }),
  Schema.TaggedStruct("Threw", { value: Schema.Unknown }),
]);
const decodeOutcome = Schema.decodeUnknownEffect(Outcome);

export const call = (websiteUrl: string, method: string, ...args: unknown[]) =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      fetch(new URL(method, websiteUrl), { method: "POST", body: JSON.stringify(args) }),
    );
    return yield* decodeOutcome(yield* Effect.promise(() => response.json()));
  });
