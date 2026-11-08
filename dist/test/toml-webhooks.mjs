// src/test/toml-webhooks.ts
const unquote = (value) => value.trim().replace(/^"(?<inner>.*)"$/u, "$<inner>");
/**
* Reads `[webhooks] api_version` and each `[[webhooks.subscriptions]]`'s `uri`, `topics` and
* `compliance_topics` from a `shopify.app.toml`: the subset of TOML Shopify CLI writes there,
* string values and arrays of strings, an array allowed to span lines.
*/
const readWebhooks = (toml) => {
	let table = "";
	let apiVersion;
	const subscriptions = [];
	const lines = toml.split("\n").map((line) => line.replace(/#.*$/u, "").trim());
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (line === "") continue;
		const header = /^\[\[?(?<name>[^\]]+)\]\]?$/u.exec(line);
		if (header?.groups?.name !== void 0) {
			table = header.groups.name.trim();
			if (table === "webhooks.subscriptions" && line.startsWith("[[")) subscriptions.push({
				uri: void 0,
				topics: []
			});
			continue;
		}
		const pair = /^(?<key>[A-Za-z_]+)\s*=\s*(?<value>.*)$/u.exec(line);
		if (pair?.groups?.key === void 0 || pair.groups.value === void 0) continue;
		let value = pair.groups.value;
		while (value.startsWith("[") && !value.includes("]") && index + 1 < lines.length) {
			index += 1;
			value += lines[index] ?? "";
		}
		const { key } = pair.groups;
		if (table === "webhooks" && key === "api_version") apiVersion = unquote(value);
		const current = subscriptions.at(-1);
		if (table !== "webhooks.subscriptions" || current === void 0) continue;
		if (key === "uri") current.uri = unquote(value);
		if (key === "topics" || key === "compliance_topics") current.topics.push(...value.replaceAll(/^\[|\]$/gu, "").split(",").map(unquote).filter((topic) => topic !== ""));
	}
	return {
		apiVersion,
		subscriptions
	};
};
export { readWebhooks };
