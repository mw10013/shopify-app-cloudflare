/**
 * Every state file this package writes carries `"format": 1`. A file without one is format 1, written
 * before the field existed. A reader that finds another format fails before
 * it writes anything, so an old package never rewrites a file a newer one made.
 *
 * @module
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const FORMAT = 1;

export class UnsupportedFormatError extends Schema.TaggedError<UnsupportedFormatError>()(
  "UnsupportedFormatError",
  { file: Schema.String, found: Schema.String },
) {
  override get message() {
    return `${this.file} is format ${this.found}, but this version reads format ${String(FORMAT)}: upgrade @mw10013/shopify-app-cloudflare`;
  }
}

export class StateFileInvalidError extends Schema.TaggedError<StateFileInvalidError>()(
  "StateFileInvalidError",
  { file: Schema.String, issue: Schema.String },
) {
  override get message() {
    return `${this.file} is invalid: ${this.issue}`;
  }
}

const FileObject = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

/** `text`'s fields other than `format`, decoded by `schema`. */
export const readFormatted = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  file: string,
  text: string,
): Effect.Effect<S["Type"], UnsupportedFormatError | StateFileInvalidError> =>
  Effect.gen(function* () {
    const invalid = (issue: { readonly message: string }) =>
      new StateFileInvalidError({ file, issue: issue.message });
    const { format = FORMAT, ...body } = yield* Schema.decodeUnknownEffect(FileObject)(text).pipe(
      Effect.mapError(invalid),
    );
    if (format !== FORMAT)
      return yield* new UnsupportedFormatError({ file, found: JSON.stringify(format) });
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(Effect.mapError(invalid));
  });

export const formattedText = <S extends Schema.Top & { readonly EncodingServices: never }>(
  schema: S,
  value: S["Type"],
): string =>
  `${JSON.stringify({ format: FORMAT, ...(Schema.encodeSync(schema)(value) as object) }, null, 2)}\n`;
