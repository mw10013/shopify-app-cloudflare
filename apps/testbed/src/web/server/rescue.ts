import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * A Backend call's declared failure, back as its class: the binding rejects with the plain
 * `{ _tag, ...fields }`, which `failures` (a union of the error classes the method declares)
 * decodes. Anything that does not decode, a defect included, is rethrown unchanged, so the route
 * error page shows it. Apart from `backend.ts`, which imports Alchemy's bridge, so a module the
 * browser loads can call it at top level.
 */
export const rescue =
  <S extends Schema.Top & { readonly DecodingServices: never }, A>(
    failures: S,
    onFailure: (failure: S["Type"]) => A,
  ) =>
  (error: unknown): A =>
    Option.match(Schema.decodeUnknownOption(failures)(error), {
      onNone: () => {
        throw error;
      },
      onSome: onFailure,
    });
