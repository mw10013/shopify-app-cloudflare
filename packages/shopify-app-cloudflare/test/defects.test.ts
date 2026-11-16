import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import { crossableDefect, crossDefects } from "#internal/defects.ts";

describe("crossableDefect", () => {
  it("turns a defect that is no object into an Error of its text", () => {
    for (const [defect, message] of [
      ["boom", "boom"],
      [42, "42"],
      [null, "null"],
      [undefined, "undefined"],
    ] as const) {
      const error = crossableDefect(defect);
      assert.instanceOf(error, Error);
      assert.strictEqual(error.message, message);
      assert.isUndefined(error.cause);
    }
  });

  it("turns a function into an Error of its text, not an object of its fields", () => {
    const defect = Object.assign(() => 1, { code: 7 });
    const error = crossableDefect(defect);
    assert.strictEqual(error.message, String(defect));
    assert.notProperty(error, "code");
  });

  it("keeps name, message, primitive fields and the cause chain, and drops the rest", () => {
    const inner = Object.assign(new Error("inner"), { name: "InnerError", code: 7 });
    const outer = Object.assign(new Error("outer", { cause: inner }), {
      name: "OuterError",
      shop: "a.myshopify.com",
      retry: false,
      check: () => true,
      detail: { nested: 1 },
      [Symbol.for("hidden")]: "symbol",
    });
    const error = crossableDefect(outer);
    assert.strictEqual(error.name, "OuterError");
    assert.strictEqual(error.message, "outer");
    assert.propertyVal(error, "shop", "a.myshopify.com");
    assert.propertyVal(error, "retry", false);
    assert.notProperty(error, "check");
    assert.notProperty(error, "detail");
    assert.deepStrictEqual(Object.getOwnPropertySymbols(error), []);
    assert.instanceOf(error.cause, Error);
    const cause = error.cause;
    assert.strictEqual(cause.name, "InnerError");
    assert.strictEqual(cause.message, "inner");
    assert.propertyVal(cause, "code", 7);
    assert.isUndefined(cause.cause);
  });

  it("reads a plain object's message and name, and gives an empty message to one without", () => {
    const error = crossableDefect({ _tag: "SchemaError", message: 3, name: "SchemaError" });
    assert.strictEqual(error.message, "");
    assert.strictEqual(error.name, "SchemaError");
    assert.propertyVal(error, "_tag", "SchemaError");
    assert.strictEqual(crossableDefect({ name: "Nameless" }).message, "");
  });

  it("stops at a cause it has already crossed", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    const b = { message: "b", cause: a };
    a.cause = b;
    const error = crossableDefect(a);
    const cause = error.cause as Error;
    assert.strictEqual(cause.message, "b");
    assert.isUndefined(cause.cause);
  });

  it("reads each field once, so a getter cannot cross a function", () => {
    let reads = 0;
    const error = crossableDefect({
      message: "m",
      get code() {
        reads += 1;
        return reads === 1 ? 1 : () => true;
      },
    });
    assert.propertyVal(error, "code", 1);
    assert.strictEqual(reads, 1);
  });

  it("never overwrites a property the Error already has", () => {
    const error = crossableDefect({ message: "m", stack: "fake stack" });
    assert.notStrictEqual(error.stack, "fake stack");
  });
});

describe("crossDefects", () => {
  it.effect("crosses each effect's defect and passes the rest through", () =>
    Effect.gen(function* () {
      const methods = {
        ok: (n: number) => Effect.succeed(n + 1),
        dies: () => Effect.die({ message: "bad", check: () => true }),
        plain: (n: number) => n * 2,
      };
      const crossed = crossDefects(methods);
      assert.deepStrictEqual(Object.keys(crossed), ["ok", "dies", "plain"]);
      assert.strictEqual(crossed.plain(3), 6);
      assert.strictEqual(yield* crossed.ok(1), 2);
      const defect = yield* crossed
        .dies()
        .pipe(Effect.sandbox, Effect.flip, Effect.map(Cause.squash));
      assert.instanceOf(defect, Error);
      assert.strictEqual(defect.message, "bad");
      assert.notProperty(defect, "check");
    }),
  );
});
