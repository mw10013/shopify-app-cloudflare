import { POLARIS_URL } from "@mw10013/shopify-app-cloudflare/website";

// Needs network access to cdn.shopify.com.
await new Promise<void>((resolve, reject) => {
  const script = document.createElement("script");
  script.src = POLARIS_URL;
  script.addEventListener("load", () => {
    resolve();
  });
  script.addEventListener("error", () => {
    reject(new Error(`Polaris failed to load: ${POLARIS_URL}`));
  });
  document.head.append(script);
});
await customElements.whenDefined("s-page");
