import { shippingFee } from './shipping.js'

// 請求書の明細行。
export function invoiceLines(order) {
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0)
  const fee = shippingFee(order)
  return [`小計（税抜） ${subtotal.toLocaleString('ja-JP')}円`, `送料 ${fee.toLocaleString('ja-JP')}円`]
}
