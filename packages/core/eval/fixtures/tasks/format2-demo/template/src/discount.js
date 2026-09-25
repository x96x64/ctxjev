export function discounted(price, percent) {
  return Math.round(price * (100 - percent)) / 100
}
