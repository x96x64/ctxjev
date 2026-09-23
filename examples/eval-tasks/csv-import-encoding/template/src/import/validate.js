// 取り込み後の検証: 商品コードは英数字8桁、価格は整数。
export function validateRow(row) {
  const errors = []
  if (!/^[A-Z0-9]{8}$/.test(row['商品コード'] ?? '')) errors.push('商品コードの形式')
  if (!/^\d+$/.test(row['価格'] ?? '')) errors.push('価格の形式')
  return errors
}
