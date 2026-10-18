import { expect } from 'vitest';
import budgets from '../../fixtures/performance/usage-budgets.json';
import { reportUsage, type Usage } from './usageMeter';

export function checkUsageBudget(scenario: keyof typeof budgets, usage: Usage) {
  reportUsage(scenario, usage);
  for (const key of ['requests', 'requestBodyBytes', 'responseBodyBytes'] as const) {
    expect(usage[key], `${scenario}: ${key}`).toBeLessThanOrEqual(budgets[scenario][key]);
  }
}
