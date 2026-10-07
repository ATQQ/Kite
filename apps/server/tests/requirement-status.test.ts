import { describe, expect, it } from 'bun:test';
import { deriveRequirementStatus } from '../src/lib/workspace.js';

const derive = (taskStatuses: Array<string | null | undefined>) =>
  deriveRequirementStatus({ taskStatuses });

describe('deriveRequirementStatus', () => {
  it('returns draft when the requirement has no tasks', () => {
    expect(derive([])).toBe('draft');
  });

  it('returns cancelled when every task is cancelled', () => {
    expect(derive(['cancelled', 'cancelled'])).toBe('cancelled');
  });

  it('returns done when every effective task is done', () => {
    expect(derive(['done', 'done'])).toBe('done');
    expect(derive(['done', 'cancelled'])).toBe('done');
  });

  it('returns in_progress while an active task exists', () => {
    expect(derive(['todo', 'claimed'])).toBe('in_progress');
    expect(derive(['todo', 'in_progress'])).toBe('in_progress');
    expect(derive(['todo', 'review'])).toBe('in_progress');
  });

  it('returns blocked when nothing is active but a task is blocked', () => {
    expect(derive(['todo', 'blocked'])).toBe('blocked');
    expect(derive(['done', 'blocked'])).toBe('blocked');
  });

  it('returns ready when every effective task is still todo', () => {
    expect(derive(['todo', 'todo'])).toBe('ready');
  });

  it('returns in_progress when some tasks are done and the rest are todo', () => {
    expect(derive(['done', 'todo'])).toBe('in_progress');
    expect(derive(['done', 'done', 'todo', 'todo', 'todo', 'todo', 'todo'])).toBe('in_progress');
  });

  it('lets manual status mode override the derived status', () => {
    expect(
      deriveRequirementStatus({ statusMode: 'manual', manualStatus: 'blocked', taskStatuses: ['done'] }),
    ).toBe('blocked');
    expect(deriveRequirementStatus({ statusMode: 'manual', taskStatuses: ['done'] })).toBe('draft');
  });
});
