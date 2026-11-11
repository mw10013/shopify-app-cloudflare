/**
 * Reading and rewriting assignments in a dotenv file as text, so every line it does not set
 * (comments, blank lines, other variables) stays byte for byte.
 *
 * @module
 */

/** One `NAME=value` assignment, spanning `first` to `last` when its quoted value runs on. */
interface Assignment {
  readonly name: string;
  readonly value: string;
  readonly first: number;
  readonly last: number;
}

const ASSIGNMENT = /^\s*(?:export\s+)?(?<name>[A-Za-z_]\w*)\s*=\s*(?<rest>.*?)\r?$/u;

const QUOTES = new Set(['"', "'", "`"]);

const assignmentsOf = (lines: readonly string[]): readonly Assignment[] => {
  const found: Assignment[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const groups = ASSIGNMENT.exec(lines[index])?.groups;
    if (groups?.name === undefined || groups.rest === undefined) continue;
    const { name, rest } = groups;
    const quote = rest.charAt(0);
    if (!QUOTES.has(quote)) {
      found.push({ name, value: rest.replace(/\s+#.*$/u, "").trim(), first: index, last: index });
      continue;
    }
    let body = rest.slice(1);
    let last = index;
    while (!body.includes(quote) && last + 1 < lines.length) {
      last += 1;
      body = `${body}\n${lines[last].replace(/\r$/u, "")}`;
    }
    const close = body.indexOf(quote);
    const raw = close === -1 ? body : body.slice(0, close);
    found.push({
      name,
      value: quote === '"' ? raw.replaceAll(String.raw`\n`, "\n") : raw,
      first: index,
      last,
    });
    index = last;
  }
  return found;
};

/** The file's values by name; a name assigned twice takes its last value, as dotenv does. */
export const readEnv = (text: string): ReadonlyMap<string, string> =>
  new Map(assignmentsOf(text.split("\n")).map(({ name, value }) => [name, value]));

/**
 * `text` with each of `values` assigned unquoted: every existing assignment of the name is
 * replaced where it stands, and a name the file lacks is appended.
 */
export const setEnv = (text: string, values: Readonly<Record<string, string>>): string => {
  const lines = text.split("\n");
  const assignments = assignmentsOf(lines).filter(({ name }) => Object.hasOwn(values, name));
  const replacements = new Map(
    assignments.map(({ name, first }) => [first, `${name}=${values[name]}`]),
  );
  const continuations = new Set(
    assignments.flatMap(({ first, last }) =>
      Array.from({ length: last - first }, (_, offset) => first + 1 + offset),
    ),
  );
  const body = lines
    .flatMap((line, index) => (continuations.has(index) ? [] : [replacements.get(index) ?? line]))
    .join("\n");
  const present = new Set(assignments.map(({ name }) => name));
  const appended = Object.entries(values)
    .filter(([name]) => !present.has(name))
    .map(([name, value]) => `${name}=${value}\n`);
  if (appended.length === 0) return body;
  return `${body}${body === "" || body.endsWith("\n") ? "" : "\n"}${appended.join("")}`;
};
