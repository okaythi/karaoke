// The media listing walks the whole bucket, so one copy per edge location is
// reused for a short time. Uploads and saves drop the copy where they land.
export const LISTING_TTL_SECONDS = 30;

type EdgeCache = { match(key: Request): Promise<Response | undefined>; put(key: Request, response: Response): Promise<void>; delete(key: Request): Promise<boolean> };

/** Absent under `astro dev` and in Node tests. */
function edgeCache(): EdgeCache | undefined {
  return (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
}

const listingKey = (request: Request) => new Request(new URL('/api/karaoke/videos', request.url).href);

export async function readListing(request: Request): Promise<Response | undefined> {
  return edgeCache()?.match(listingKey(request));
}

export async function storeListing(request: Request, response: Response): Promise<void> {
  await edgeCache()?.put(listingKey(request), response);
}

export async function dropListing(request: Request): Promise<void> {
  await edgeCache()?.delete(listingKey(request));
}
