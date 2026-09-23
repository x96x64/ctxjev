// Product reviews widget, gated by the flags service (rolled out 2026-06).
export function showReviews(user, { flags }) {
  return flags.isEnabled('product-reviews', user)
}
