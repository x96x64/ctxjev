import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canBook } from '../src/booking.js'

const existing = [{ room: 'A', start: '09:00', end: '10:00' }]

test('重なる予約は OVERLAP', () => {
  assert.deepEqual(canBook(existing, { room: 'A', start: '09:30', end: '10:30' }), { ok: false, code: 'OVERLAP' })
})

test('別の部屋なら予約できる', () => {
  assert.deepEqual(canBook(existing, { room: 'B', start: '09:30', end: '10:30' }), { ok: true })
})
