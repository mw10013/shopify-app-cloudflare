import * as Effect from "effect/Effect";
import * as Scheduler from "effect/Scheduler";
// src/internal/transaction.ts
/**
* {@link Transaction} over `sql`: `body` in one storage transaction (`storage.transaction`, rolled
* back on failure). The transaction closes the object's input gate, behind which a timer never
* fires, so a fiber yield scheduled on a timer inside it could wait forever; the body runs on a
* `"sync"` scheduler instead, which yields through microtasks, as Alchemy's
* `Drizzle.DurableObject` does. Build it once per activation.
*
* @see `alchemy/src/Drizzle/Cloudflare.ts` (`DurableObject`)
*/
const syncTransaction = (sql) => {
	const scheduler = new Scheduler.MixedScheduler("sync");
	return (body) => sql.withTransaction(body).pipe(Effect.provideService(Scheduler.Scheduler, scheduler));
};
export { syncTransaction };
