import { baseRestrictions, lint } from "@mw10013/devkit/core/lint/rules";
import { defineConfig } from "vite-plus";
import type { OxlintOverride } from "vite-plus/lint";

/**
 * Keeps `files` from importing the `forbidden` runtime directories under the testbed's `src/`,
 * which would put one Worker's code in another's bundle, and the package's test support, which
 * would put `ShopifyTestDoor` and the fakes in a production Worker; `testEntries` are the test
 * support entries `files` may still import. An override replaces the base `no-restricted-imports`
 * options, so it carries {@link baseRestrictions} again.
 */
const runtimeBoundary = (
  files: string,
  forbidden: readonly string[],
  message: string,
  options: { allowTypeImports?: boolean; testEntries?: readonly string[] } = {},
): OxlintOverride => ({
  files: [files],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        ...baseRestrictions,
        patterns: [
          ...baseRestrictions.patterns,
          {
            group: forbidden.map((dir) => `#${dir}/**`),
            message,
            ...(options.allowTypeImports === undefined
              ? {}
              : { allowTypeImports: options.allowTypeImports }),
          },
          {
            group: [
              "@mw10013/shopify-app-workers/test",
              "@mw10013/shopify-app-workers/test/**",
              ...(options.testEntries ?? []).map(
                (entry) => `!@mw10013/shopify-app-workers/${entry}`,
              ),
            ],
            message: "Test support stays in test/; a production Worker never carries it.",
          },
        ],
      },
    ],
  },
});

/** The files that hold a component or a hook. */
const WEB_FILES = [
  "apps/testbed/src/web/**",
  "apps/testbed/test/browser/**",
  "packages/shopify-app-workers/src/**/*.tsx",
];

/**
 * The rules that read components and hooks: those the categories turn on under the `react` and
 * `jsx-a11y` plugins (`vp lint --print-config`), and the TanStack Router rules opted in by name.
 * Only {@link WEB_FILES} hold a component or a hook, and elsewhere the hooks rules read every
 * `use…` call as one (Playwright's fixture `use`). Oxlint applies categories only to the base
 * plugins, so the override that turns these off elsewhere names each rule.
 */
const webOnlyRules = [
  ...[
    "capitalized-calls",
    "checked-requires-onchange-or-readonly",
    "display-name",
    "error-boundaries",
    "exhaustive-deps",
    "exhaustive-effect-dependencies",
    "forward-ref-uses-ref",
    "function-component-definition",
    "globals",
    "hook-use-state",
    "hooks",
    "iframe-missing-sandbox",
    "immutability",
    "incompatible-library",
    "jsx-boolean-value",
    "jsx-curly-brace-presence",
    "jsx-fragments",
    "jsx-key",
    "jsx-no-comment-textnodes",
    "jsx-no-constructed-context-values",
    "jsx-no-duplicate-props",
    "jsx-no-script-url",
    "jsx-no-target-blank",
    "jsx-no-undef",
    "jsx-no-useless-fragment",
    "jsx-pascal-case",
    "jsx-props-no-spread-multi",
    "memo-dependencies",
    "no-array-index-key",
    "no-children-prop",
    "no-danger-with-children",
    "no-deriving-state-in-effects",
    "no-did-mount-set-state",
    "no-did-update-set-state",
    "no-direct-mutation-state",
    "no-find-dom-node",
    "no-is-mounted",
    "no-namespace",
    "no-object-type-as-default-prop",
    "no-redundant-should-component-update",
    "no-render-return-value",
    "no-set-state",
    "no-string-refs",
    "no-this-in-sfc",
    "no-unsafe",
    "no-unstable-nested-components",
    "no-will-update-set-state",
    "prefer-es6-class",
    "preserve-manual-memoization",
    "purity",
    "refs",
    "rules-of-hooks",
    "self-closing-comp",
    "set-state-in-effect",
    "set-state-in-render",
    "state-in-constructor",
    "static-components",
    "style-prop-object",
    "use-memo",
    "void-dom-elements-no-children",
    "void-use-memo",
  ].map((rule) => `react/${rule}`),
  ...[
    "alt-text",
    "anchor-has-content",
    "anchor-is-valid",
    "aria-activedescendant-has-tabindex",
    "aria-props",
    "aria-proptypes",
    "aria-role",
    "aria-unsupported-elements",
    "autocomplete-valid",
    "click-events-have-key-events",
    "control-has-associated-label",
    "heading-has-content",
    "html-has-lang",
    "iframe-has-title",
    "img-redundant-alt",
    "interactive-supports-focus",
    "label-has-associated-control",
    "lang",
    "media-has-caption",
    "mouse-events-have-key-events",
    "no-access-key",
    "no-aria-hidden-on-focusable",
    "no-autofocus",
    "no-distracting-elements",
    "no-interactive-element-to-noninteractive-role",
    "no-noninteractive-element-interactions",
    "no-noninteractive-element-to-interactive-role",
    "no-noninteractive-tabindex",
    "no-redundant-roles",
    "no-static-element-interactions",
    "prefer-tag-over-role",
    "role-has-required-aria-props",
    "role-supports-aria-props",
    "scope",
    "tabindex-no-positive",
  ].map((rule) => `jsx-a11y/${rule}`),
  "@tanstack/router/create-route-property-order",
  "@tanstack/router/route-param-names",
];

const PACKAGE_NODE_ONLY = [
  "packages/shopify-app-workers/src/test-node.ts",
  "packages/shopify-app-workers/src/test/node/**",
];
const PACKAGE_E2E = [
  "packages/shopify-app-workers/src/test-e2e.ts",
  "packages/shopify-app-workers/src/test-e2e-server.ts",
  "packages/shopify-app-workers/src/test/e2e/**",
];
const NODE_SQLITE = {
  name: "node:sqlite",
  message: "node:sqlite is Node-only; it belongs behind /test/node.",
};
const TANSTACK_START = {
  group: ["@tanstack/react-start", "@tanstack/react-start/**"],
  message:
    "TanStack Start's compiler rewrites createServerFn, createMiddleware and createIsomorphicFn only in the app's source; the app wraps the package's plain functions.",
};
const TEST_NODE_IMPORTS = {
  group: ["#test/node/**", "./test/node/**"],
  message: "src/test/node/ is Node-only; only /test/node imports it.",
};
const E2E_IMPORTS = {
  group: [
    "playwright",
    "playwright/**",
    "@mw10013/devkit",
    "@mw10013/devkit/**",
    "@effect/platform-node",
    "@effect/platform-node/**",
    "#test/e2e/**",
    "./test/e2e/**",
  ],
  message:
    "Playwright, devkit and Node platform code are the e2e pack's optional peers; only /test/e2e imports them.",
};

/**
 * The package's entries keep apart what each may load: `files` (less `excludeFiles`) may not
 * import `paths` or `patterns`, on top of {@link baseRestrictions}.
 */
const packageBoundary = (
  files: readonly string[],
  excludeFiles: readonly string[],
  paths: readonly { name: string; message: string }[],
  patterns: readonly { group: string[]; message: string }[],
): OxlintOverride => ({
  files: [...files],
  excludeFiles: [...excludeFiles],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        ...baseRestrictions,
        paths: [...baseRestrictions.paths, ...paths],
        patterns: [...baseRestrictions.patterns, ...patterns],
      },
    ],
  },
});

export default defineConfig({
  fmt: {
    sortImports: true,
    ignorePatterns: ["**/routeTree.gen.ts", "AGENTS.md", "refs/**", "docs/**", "pnpm-lock.yaml"],
  },
  lint: {
    ...lint,
    plugins: [...lint.plugins, "react", "jsx-a11y"],
    settings: { react: { linkComponents: [{ name: "Link", attribute: "to" }] } },
    ignorePatterns: ["**/dist/", "docs/", "refs/", "tmp/", "**/routeTree.gen.ts"],
    rules: {
      ...lint.rules,
      "react/no-unstable-nested-components": ["error", { allowAsProps: true }],
      "@tanstack/router/create-route-property-order": "error",
      "@tanstack/router/route-param-names": "error",
    },
    jsPlugins: ["@tanstack/eslint-plugin-router", ...lint.jsPlugins],
    overrides: [
      {
        files: ["**"],
        excludeFiles: WEB_FILES,
        rules: Object.fromEntries(webOnlyRules.map((rule) => [rule, "off" as const])),
      },
      runtimeBoundary(
        "apps/testbed/src/web/**",
        ["backend", "e2e"],
        "The Website bundle never carries Backend code; use `import type`.",
        { allowTypeImports: true },
      ),
      runtimeBoundary(
        "apps/testbed/src/contract/**",
        ["backend", "web", "e2e"],
        "The contract crosses to the browser and the Backend alike, so it imports neither.",
      ),
      runtimeBoundary(
        "apps/testbed/src/backend/**",
        ["web", "e2e"],
        "The Backend never imports the Website or the e2e stage's Backend, which only `e2e` deploys.",
      ),
      runtimeBoundary(
        "apps/testbed/src/e2e/**",
        ["web"],
        "The e2e stage's Backend never imports the Website.",
        // The e2e stage's Backend is the one Worker that serves the pack's e2e routes.
        { testEntries: ["test/e2e/backend"] },
      ),
      packageBoundary(
        // Only `/test/node` runs under Node alone; every other entry can reach a workerd bundle.
        ["packages/shopify-app-workers/src/**"],
        [...PACKAGE_NODE_ONLY, ...PACKAGE_E2E],
        [NODE_SQLITE],
        [TEST_NODE_IMPORTS, E2E_IMPORTS, TANSTACK_START],
      ),
      packageBoundary(PACKAGE_NODE_ONLY, [], [], [E2E_IMPORTS]),
      packageBoundary(PACKAGE_E2E, [], [NODE_SQLITE], [TEST_NODE_IMPORTS]),
      ...lint.overrides,
    ],
  },
});
