/**
 * Image search via Serper.dev Google Images API.
 * Requires SERPER_API_KEY in env.
 */

export interface ImageResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
  width: number;
  height: number;
}

const SERPER_API_KEY = process.env.SERPER_API_KEY ?? '';

/**
 * Search for images using Serper.dev (Google Images).
 */
export async function searchImages(
  query: string,
  maxResults = 5
): Promise<ImageResult[]> {
  if (!SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY is not configured');
  }

  const response = await fetch('https://google.serper.dev/images', {
    method: 'POST',
    headers: {
      'X-API-KEY': SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      num: maxResults,
    }),
  });

  if (!response.ok) {
    throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  return (data.images ?? []).slice(0, maxResults).map(
    (img: {
      imageUrl: string;
      thumbnailUrl: string;
      title: string;
      source: string;
      imageWidth: number;
      imageHeight: number;
    }) => ({
      url: img.imageUrl,
      thumbnail: img.thumbnailUrl,
      title: img.title,
      source: img.source,
      width: img.imageWidth,
      height: img.imageHeight,
    })
  );
}

/**
 * Search for face/portrait photos of a person.
 */
export async function searchFaceImages(
  name: string,
  maxResults = 3
): Promise<ImageResult[]> {
  return searchImages(`${name} face portrait photo high quality`, maxResults);
}
