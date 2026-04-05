/**
 * Image search via DuckDuckGo — no API key required.
 * Returns top image URLs for a query, biased toward face/portrait photos.
 */

interface ImageResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
  width: number;
  height: number;
}

/**
 * Search for images using DuckDuckGo.
 * @param query - Search query (e.g. "Arda Güler face portrait")
 * @param maxResults - Max results to return (default 5)
 */
export async function searchImages(
  query: string,
  maxResults = 5
): Promise<ImageResult[]> {
  // Step 1: Get the vqd token from DuckDuckGo
  const tokenRes = await fetch(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
    {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    }
  );
  const html = await tokenRes.text();
  const vqdMatch = html.match(/vqd=['"]([^'"]+)['"]/);
  if (!vqdMatch) {
    throw new Error('Failed to get DuckDuckGo search token');
  }
  const vqd = vqdMatch[1];

  // Step 2: Fetch image results
  const searchUrl = new URL('https://duckduckgo.com/i.js');
  searchUrl.searchParams.set('l', 'us-en');
  searchUrl.searchParams.set('o', 'json');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('vqd', vqd);
  searchUrl.searchParams.set('f', ',,,,,');
  searchUrl.searchParams.set('p', '1');

  const searchRes = await fetch(searchUrl.toString(), {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Referer: 'https://duckduckgo.com/',
    },
  });

  const data = await searchRes.json();
  const results: ImageResult[] = (data.results ?? [])
    .slice(0, maxResults)
    .map(
      (r: {
        image: string;
        thumbnail: string;
        title: string;
        source: string;
        width: number;
        height: number;
      }) => ({
        url: r.image,
        thumbnail: r.thumbnail,
        title: r.title,
        source: r.source,
        width: r.width,
        height: r.height,
      })
    );

  return results;
}

/**
 * Search for face/portrait photos of a person.
 * Adds "face portrait photo" to the query for better results.
 */
export async function searchFaceImages(
  name: string,
  maxResults = 3
): Promise<ImageResult[]> {
  return searchImages(`${name} face portrait photo high quality`, maxResults);
}
