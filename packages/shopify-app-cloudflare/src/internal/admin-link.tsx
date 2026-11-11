/**
 * The admin pages' links: an `href` for the browser and the app's client navigation for a
 * plain click.
 *
 * @module
 */

/**
 * A link to `href`. A plain click calls `onClick`, the app's client navigation, in place of
 * loading `href`; a click with a modifier key opens `href` elsewhere.
 */
export interface PageLink {
  readonly href: string;
  readonly onClick: () => void;
}

const MODIFIERS = ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const;

/**
 * Polaris types a click as `Event` while React hands its synthetic mouse event, so the modifier
 * keys are read by name.
 */
const opensElsewhere = (event: Event) =>
  MODIFIERS.some((key) => key in event && Reflect.get(event, key) === true);

export const linkProps = ({ href, onClick }: PageLink) => ({
  href,
  onClick: (event: Event) => {
    if (opensElsewhere(event)) return;
    event.preventDefault();
    onClick();
  },
});

export function Breadcrumb({ link, label }: { readonly link: PageLink; readonly label: string }) {
  return (
    <s-link slot="breadcrumb-actions" {...linkProps(link)}>
      {label}
    </s-link>
  );
}
