// Thumbnail sizes generated for every accepted image.
export const THUMBNAILS = [
  { name: 'small', width: 160 },
  { name: 'medium', width: 640 },
  { name: 'large', width: 1280 },
]

export function thumbnailKeys(uploadId) {
  return THUMBNAILS.map((t) => `thumbs/${uploadId}/${t.name}.webp`)
}
