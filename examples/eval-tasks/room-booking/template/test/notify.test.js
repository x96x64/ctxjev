import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confirmationMessage } from '../src/notify.js'

test('通知文', () => {
  assert.equal(confirmationMessage({ room: 'B', start: '13:00', end: '14:00' }, '山田'), '山田さん、会議室B を 13:00〜14:00 で予約しました。')
})
