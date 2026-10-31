/**
 * One place that decides how large an upload may be, because three hosts read
 * the same request: the browser (`src/lib`), Netlify (`netlify/functions`) and
 * the Vercel bridge (`vercel/serverless.ts`). When they disagree, the user gets a
 * raw platform 413 instead of the app's friendly message.
 *
 * The arithmetic that sets these values:
 *   raw image 3 MiB → base64 ×4/3 ≈ 4 MiB chars → JSON body ≈ 4.1 MiB
 *   < 4.5 MiB, the smallest cap on the path (the Vercel function payload guard).
 */

/** Largest screenshot the app accepts, in raw bytes. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024

/** base64 inflates by 4/3; the extra KiB covers the `data:image/...;base64,` prefix. */
export const MAX_IMAGE_DATA_URL_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024

/**
 * Largest JSON body a handler will parse, and the byte ceiling the Vercel bridge
 * enforces before the function runs. Vercel and Netlify both refuse roughly 6 MiB
 * at their edge, so staying under 4.5 MiB keeps the response inside this app.
 */
export const MAX_BODY_BYTES = 4.5 * 1024 * 1024

/** Human-readable MB figure for UI copy — never hard-code the number twice. */
export const MAX_IMAGE_MB_LABEL = `${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB`
