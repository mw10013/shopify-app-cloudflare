/**
 * The admin pages of the orphan sweep: the stage's `ShopActor` objects, and the orphans among
 * them with a Destroy each. They hold no server call: an app's route loads the data and passes
 * callbacks.
 *
 * @module
 */

import { type ReactNode, useState } from "react";

import { Breadcrumb, type PageLink } from "./admin-link.tsx";
import {
  type OrphanShopActorObjectsData,
  SHOP_ACTOR_OBJECTS_LIMIT,
  type ShopActorObject,
  type ShopActorObjectsData,
} from "./shop-actor-objects-contract.ts";

const INVENTORY_TABLE_LIMIT = 50;

interface AdminPageProps {
  /** The breadcrumb to the admin's index. */
  readonly adminLink: PageLink;
  /** The app's own page actions, such as its log-out button, slotted into the page. */
  readonly children?: ReactNode;
}

function StoredData({ hasStoredData }: Pick<ShopActorObject, "hasStoredData">) {
  if (hasStoredData === undefined) return <s-text tone="neutral">undefined</s-text>;
  return (
    <s-badge tone={hasStoredData ? "success" : "neutral"}>{hasStoredData ? "Yes" : "No"}</s-badge>
  );
}

/** The inventory's search: the batch's `cursor` and the table page within it. */
export interface ShopActorObjectsSearch {
  readonly cursor?: string | undefined;
  readonly page?: number | undefined;
}

export interface ShopActorObjectsPageProps extends AdminPageProps {
  readonly data: ShopActorObjectsData;
  /** The cursor `data` was read with, none for the first batch. */
  readonly cursor: string | undefined;
  /** The table page within the batch, from 0. */
  readonly page: number;
  /** Takes the app's route to `search`. */
  readonly onNavigate: (search: ShopActorObjectsSearch) => void;
}

/**
 * Every `ShopActor` object of one batch, {@link INVENTORY_TABLE_LIMIT} to a table page, with its
 * stored data as Cloudflare reports it.
 */
export function ShopActorObjectsPage(props: ShopActorObjectsPageProps) {
  const { data, cursor, page } = props;
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const objects = data.objects.slice(
    page * INVENTORY_TABLE_LIMIT,
    (page + 1) * INVENTORY_TABLE_LIMIT,
  );
  const hasPreviousPage = page > 0 || history.length > 0;
  const hasNextPage =
    (page + 1) * INVENTORY_TABLE_LIMIT < data.objects.length || data.cursor !== undefined;
  return (
    <s-page heading="Shop Actor Objects" inlineSize="large">
      <Breadcrumb link={props.adminLink} label="Admin" />
      {props.children}
      <s-section padding="none" accessibilityLabel="Shop Actor objects table">
        <s-table
          paginate={hasPreviousPage || hasNextPage}
          hasPreviousPage={hasPreviousPage}
          hasNextPage={hasNextPage}
          onPreviousPage={() => {
            if (page > 0) {
              props.onNavigate({ cursor, page: page - 1 });
              return;
            }
            const previous = history.at(-1);
            setHistory(history.slice(0, -1));
            props.onNavigate({ cursor: previous });
          }}
          onNextPage={() => {
            if ((page + 1) * INVENTORY_TABLE_LIMIT < data.objects.length) {
              props.onNavigate({ cursor, page: page + 1 });
              return;
            }
            setHistory([...history, cursor]);
            props.onNavigate({ cursor: data.cursor });
          }}
        >
          <s-table-header-row>
            <s-table-header listSlot="primary">Object ID</s-table-header>
            <s-table-header>Name</s-table-header>
            <s-table-header>Stored data</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {objects.map((object) => (
              <s-table-row key={object.id} id={object.id}>
                <s-table-cell>
                  <s-text>{object.id}</s-text>
                </s-table-cell>
                <s-table-cell>
                  <s-text>{object.name}</s-text>
                </s-table-cell>
                <s-table-cell>
                  <StoredData hasStoredData={object.hasStoredData} />
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
      {data.objects.length === 0 && <s-banner tone="info">No Shop Actor objects found.</s-banner>}
    </s-page>
  );
}

/** How a press of Destroy ended. `Redirected`: the app's server function sent the browser away. */
export type DestroyOutcome = "Destroyed" | "InstalledAgain" | "Redirected";

export interface OrphanShopActorObjectsPageProps extends AdminPageProps {
  readonly data: OrphanShopActorObjectsData;
  /** The cursor `data` was read with, none for the first batch. */
  readonly cursor: string | undefined;
  /** Takes the app's route to the batch at `cursor`, the first when none. */
  readonly onNavigate: (cursor: string | undefined) => void;
  /** Destroys the object `id`; the app's route reloads its loader after. */
  readonly onDestroy: (id: string) => Promise<DestroyOutcome>;
}

/**
 * The orphans in one batch of the stage's `ShopActor` objects, each with Destroy, which empties
 * it by id and never creates one. A tombstone (`hasStoredData: false`) is listed without
 * Destroy: it holds nothing, and destroying it again changes nothing.
 */
export function OrphanShopActorObjectsPage(props: OrphanShopActorObjectsPageProps) {
  const { data, cursor } = props;
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [destroyingId, setDestroyingId] = useState<string>();
  const [installedAgain, setInstalledAgain] = useState(false);
  const hasNextPage = data.cursor !== undefined;
  return (
    <s-page heading="Orphan Shop Actor Objects" inlineSize="large">
      <Breadcrumb link={props.adminLink} label="Admin" />
      {props.children}
      {installedAgain && (
        <s-banner tone="warning">
          This shop was installed again, so its object is no longer an orphan.
        </s-banner>
      )}
      <s-section padding="none" accessibilityLabel="Orphan Shop Actor objects table">
        <s-table
          paginate={history.length > 0 || hasNextPage}
          hasPreviousPage={history.length > 0}
          hasNextPage={hasNextPage}
          onPreviousPage={() => {
            const previous = history.at(-1);
            setHistory(history.slice(0, -1));
            props.onNavigate(previous);
          }}
          onNextPage={() => {
            setHistory([...history, cursor]);
            props.onNavigate(data.cursor);
          }}
        >
          <s-table-header-row>
            <s-table-header listSlot="primary">Object ID</s-table-header>
            <s-table-header>Name</s-table-header>
            <s-table-header>Stored data</s-table-header>
            <s-table-header>Action</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {data.orphans.map((object) => (
              <s-table-row key={object.id} id={object.id}>
                <s-table-cell>
                  <s-text>{object.id}</s-text>
                </s-table-cell>
                <s-table-cell>
                  <s-text>{object.name}</s-text>
                </s-table-cell>
                <s-table-cell>
                  <StoredData hasStoredData={object.hasStoredData} />
                </s-table-cell>
                <s-table-cell>
                  {object.hasStoredData === false ? null : (
                    <s-button
                      tone="critical"
                      loading={destroyingId === object.id}
                      disabled={destroyingId !== undefined}
                      onClick={() => {
                        setDestroyingId(object.id);
                        setInstalledAgain(false);
                        void props
                          .onDestroy(object.id)
                          .then((outcome) => {
                            setInstalledAgain(outcome === "InstalledAgain");
                          })
                          .finally(() => {
                            setDestroyingId(undefined);
                          });
                      }}
                    >
                      Destroy
                    </s-button>
                  )}
                </s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
      {data.orphans.length === 0 &&
        (hasNextPage ? (
          <s-banner tone="info">
            No orphans in this batch of {SHOP_ACTOR_OBJECTS_LIMIT}. Check the next batch.
          </s-banner>
        ) : (
          <s-banner tone="success">No orphans.</s-banner>
        ))}
    </s-page>
  );
}
