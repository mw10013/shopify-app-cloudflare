import { type AnyRouter, useLoaderData, useRouter, useSearch } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { useState } from "react";

import {
  REDIRECTED,
  searchOrFirstPage,
  type ServerCall,
  STALE_RELOAD_MODE,
  useServerCall,
} from "./admin-section.tsx";
import {
  type DestroyOrphanRequest,
  type OrphanShopActorObjectsData,
  SHOP_ACTOR_OBJECTS_LIMIT,
  type ShopActorObject,
  type ShopActorObjectsData,
  ShopActorObjectsRequest,
} from "./shop-actor-objects-contract.ts";

const INVENTORY_TABLE_LIMIT = 50;

function StoredData({ hasStoredData }: Pick<ShopActorObject, "hasStoredData">) {
  if (hasStoredData === undefined) return <s-text tone="neutral">undefined</s-text>;
  return (
    <s-badge tone={hasStoredData ? "success" : "neutral"}>{hasStoredData ? "Yes" : "No"}</s-badge>
  );
}

const ShopActorObjectsSearch = Schema.Struct({
  ...ShopActorObjectsRequest.fields,
  page: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
type ShopActorObjectsSearch = typeof ShopActorObjectsSearch.Type;

const useNavigateSearch = () => {
  const router: AnyRouter = useRouter();
  return (search: ShopActorObjectsSearch) => {
    void router.navigate({ to: ".", search: () => search });
  };
};

function ShopActorObjects() {
  const data = useLoaderData({ strict: false }) as unknown as ShopActorObjectsData;
  const { cursor, page = 0 } = useSearch({ strict: false }) as unknown as ShopActorObjectsSearch;
  const navigate = useNavigateSearch();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const objects = data.objects.slice(
    page * INVENTORY_TABLE_LIMIT,
    (page + 1) * INVENTORY_TABLE_LIMIT,
  );
  const hasPreviousPage = page > 0 || history.length > 0;
  const hasNextPage =
    (page + 1) * INVENTORY_TABLE_LIMIT < data.objects.length || data.cursor !== undefined;
  return (
    <>
      <s-section padding="none" accessibilityLabel="Shop Actor objects table">
        <s-table
          paginate={hasPreviousPage || hasNextPage}
          hasPreviousPage={hasPreviousPage}
          hasNextPage={hasNextPage}
          onPreviousPage={() => {
            if (page > 0) {
              navigate({ cursor, page: page - 1 });
              return;
            }
            const previous = history.at(-1);
            setHistory(history.slice(0, -1));
            navigate({ cursor: previous });
          }}
          onNextPage={() => {
            if ((page + 1) * INVENTORY_TABLE_LIMIT < data.objects.length) {
              navigate({ cursor, page: page + 1 });
              return;
            }
            setHistory([...history, cursor]);
            navigate({ cursor: data.cursor });
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
    </>
  );
}

/**
 * The `/admin/shop-actor-objects` route's options. `load` is the app's server function over
 * `shopActorObjects`.
 */
export const adminShopActorObjects = ({
  load,
}: {
  readonly load: ServerCall<ShopActorObjectsRequest, ShopActorObjectsData>;
}) => ({
  staticData: {
    admin: {
      title: "Shop Actor Objects",
      summary: "The stage's Shop Actor Durable Objects, with their stored data.",
      order: 20,
    },
  },
  validateSearch: searchOrFirstPage(ShopActorObjectsSearch, { cursor: undefined, page: undefined }),
  loaderDeps: ({ search: { cursor } }: { readonly search: ShopActorObjectsSearch }) => ({ cursor }),
  loader: {
    handler: ({ deps }: { readonly deps: ShopActorObjectsRequest }) => load({ data: deps }),
    staleReloadMode: STALE_RELOAD_MODE,
  },
  component: ShopActorObjects,
});

type DestroyOrphan = ServerCall<
  DestroyOrphanRequest,
  null | { readonly _tag: "OrphanInstalledError" }
>;

function OrphanShopActorObjects({ destroy }: { readonly destroy: DestroyOrphan }) {
  const router: AnyRouter = useRouter();
  const data = useLoaderData({ strict: false }) as unknown as OrphanShopActorObjectsData;
  const { cursor } = useSearch({ strict: false }) as unknown as ShopActorObjectsRequest;
  const navigate = useNavigateSearch();
  const call = useServerCall(destroy);
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [destroyingId, setDestroyingId] = useState<string>();
  const [installedAgain, setInstalledAgain] = useState(false);
  const hasNextPage = data.cursor !== undefined;
  return (
    <>
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
            navigate(previous === undefined ? {} : { cursor: previous });
          }}
          onNextPage={() => {
            setHistory([...history, cursor]);
            navigate(data.cursor === undefined ? {} : { cursor: data.cursor });
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
                        void call({ id: object.id })
                          .then(async (outcome) => {
                            if (outcome === REDIRECTED) return;
                            setInstalledAgain(outcome !== null);
                            await router.invalidate({ sync: true });
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
    </>
  );
}

/**
 * The `/admin/orphan-shop-actor-objects` route's options. `load` is the app's server function
 * over `orphanShopActorObjects`, and `destroy` its server function over `destroyOrphan`.
 */
export const adminOrphanShopActorObjects = ({
  load,
  destroy,
}: {
  readonly load: ServerCall<ShopActorObjectsRequest, OrphanShopActorObjectsData>;
  readonly destroy: DestroyOrphan;
}) => ({
  staticData: {
    admin: {
      title: "Orphan Shop Actor Objects",
      summary: "Shop Actor objects with no installed shop, each with Destroy.",
      order: 30,
    },
  },
  validateSearch: searchOrFirstPage(ShopActorObjectsRequest, { cursor: undefined }),
  loaderDeps: ({ search: { cursor } }: { readonly search: ShopActorObjectsRequest }) => ({
    cursor,
  }),
  loader: {
    handler: ({ deps }: { readonly deps: ShopActorObjectsRequest }) => load({ data: deps }),
    staleReloadMode: STALE_RELOAD_MODE,
  },
  component: () => <OrphanShopActorObjects destroy={destroy} />,
});
