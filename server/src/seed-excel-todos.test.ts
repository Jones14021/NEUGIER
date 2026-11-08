import assert from 'node:assert/strict';
import test from 'node:test';
import type { Todo, TripState } from '@neugier/shared';
import { excelTodoOps } from './seed-excel-todos';

test('links Excel tasks to existing targets without recreating completed tasks', () => {
  const state = {
    days: [{ id: 'day', date: '2026-12-18' }],
    stops: [{ id: 'camp', dayId: 'day', key: 'xl:camp:2026-12-18' }],
    todos: [{ id: 'existing', targetId: 'camp', title: 'Alternative zu Woolleys Bay Western Carpark suchen', done: true }],
  } as TripState;
  const first = excelTodoOps(state);
  assert.equal(first.length, 1);
  assert.equal(first[0].op, 'create');
  if (first[0].op !== 'create') return;
  const todo = first[0].data as Todo;
  assert.equal(todo.targetId, 'camp');
  state.todos!.push(todo);
  assert.equal(excelTodoOps(state).length, 0);
  state.stops = [];
  assert.equal(excelTodoOps(state).length, 0);
});