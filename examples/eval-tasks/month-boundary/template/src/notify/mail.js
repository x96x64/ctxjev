import { formatDate } from '../lib/date.js'

// 請求書発行メールの本文(表示用の日付は formatDate)
export function invoiceMailBody(invoice) {
  return `請求書を発行しました。\n発行日: ${formatDate(new Date(invoice.issueDate))}\n金額: ${invoice.amount.toLocaleString('ja-JP')}円`
}
