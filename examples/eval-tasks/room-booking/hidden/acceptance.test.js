import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canBook } from '../src/booking.js'

const ok = { ok: true }
const err = (code) => ({ ok: false, code })

test('ゼロ埋めしていない時刻（9:30）も正しく扱う', () => {
  assert.deepEqual(canBook([], { room: 'A', start: '9:30', end: '11:00' }), ok)
  assert.deepEqual(canBook([{ room: 'B', start: '09:00', end: '10:00' }], { room: 'B', start: '9:45', end: '10:15' }), err('OVERLAP'))
})

test('営業時間は 8:00〜22:00（22:00 ちょうどに終わるのは OK）', () => {
  assert.deepEqual(canBook([], { room: 'C', start: '7:30', end: '9:00' }), err('OUT_OF_HOURS'))
  assert.deepEqual(canBook([], { room: 'C', start: '8:00', end: '9:00' }), ok)
  assert.deepEqual(canBook([], { room: 'C', start: '21:00', end: '22:00' }), ok)
  assert.deepEqual(canBook([], { room: 'C', start: '21:00', end: '22:15' }), err('OUT_OF_HOURS'))
})

test('同じ部屋では前の予約の終了から 15 分空ける', () => {
  const existing = [{ room: 'A', start: '09:00', end: '10:00' }]
  assert.deepEqual(canBook(existing, { room: 'A', start: '10:00', end: '11:00' }), err('OVERLAP'))
  assert.deepEqual(canBook(existing, { room: 'A', start: '10:10', end: '11:00' }), err('OVERLAP'))
  assert.deepEqual(canBook(existing, { room: 'A', start: '10:15', end: '11:00' }), ok)
})

test('次の予約の開始前も 15 分空ける', () => {
  const existing = [{ room: 'A', start: '09:00', end: '10:00' }]
  assert.deepEqual(canBook(existing, { room: 'A', start: '8:00', end: '8:50' }), err('OVERLAP'))
  assert.deepEqual(canBook(existing, { room: 'A', start: '8:00', end: '8:45' }), ok)
})

test('別の部屋には関係ない', () => {
  assert.deepEqual(canBook([{ room: 'A', start: '09:00', end: '10:00' }], { room: 'B', start: '10:00', end: '11:00' }), ok)
})

test('エラーコードの名前は変えない', () => {
  assert.deepEqual(canBook([], { room: 'A', start: '11:00', end: '10:00' }), err('INVALID_RANGE'))
})
