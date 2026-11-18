/**
 * 联合求解复核 / 交叉检查用的测试 fixture（明显虚构：example.com、is_sample: true、示例学生）。
 * 不是真实机会，也不是真实学生。所有结果都是模拟。
 *
 * 默认机会：线上、需要笔记本、免费、每周 5 小时、截止 2027-03-01、要求 9–12 年级（硬性）。
 * 默认学生：10 年级、每周 10 小时、预算 $100、交通稳定、有手机和网络但**没有笔记本**。
 * 评估日：2026-11-17。
 */
import type { Intervention, Opportunity, Scenario, StudentProfile } from '../../types';

export const EVAL_DATE = '2026-11-17';

export function makeOpp(id: string, overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id,
    title: `Fictional test opportunity ${id} (sample, not real)`,
    organizer: 'Example Org (fictional)',
    category: 'summer_program',
    fields: ['computer_science'],
    summary: 'Fictional opportunity for unit tests only (sample).',
    official_url: `https://example.com/${id}`,
    verified_on: EVAL_DATE,
    verified_by: 'test-fixture',
    deadline: '2027-03-01',
    location: { format: 'online' },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 5, total_weeks: 6 },
    required_devices: ['laptop'],
    requirements: [
      {
        id: 'req-grade',
        type: 'grade',
        min: 9,
        max: 12,
        label: 'Grades 9–12',
        hard: true,
        source_text: 'Open to students in grades 9-12. (fictional example)',
      },
    ],
    preparation: [],
    is_sample: true,
    ...overrides,
  };
}

export function makeStudent(id: string, overrides: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id,
    is_sample: true,
    display_name: `Sample student ${id}`,
    grade: 10,
    age: 15,
    region: { country: 'US', state: 'CA' },
    citizenships: ['US'],
    statuses: ['high_school_student'],
    hours_per_week_available: 10,
    budget_usd: 100,
    transport: { level: 'reliable' },
    devices: ['smartphone', 'home_internet'],
    skills: [],
    evidence: [],
    ...overrides,
  };
}

export function makeIntervention(id: string, overrides: Partial<Intervention> = {}): Intervention {
  return {
    id,
    title: `Sample support measure ${id}`,
    type: 'device',
    resolves: ['device'],
    device: 'laptop',
    unit_cost_usd: 100,
    fixed_cost_usd: 0,
    capacity: null,
    ...overrides,
  };
}

export function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'test-scenario',
    title: 'Sample scenario (simulated)',
    is_sample: true,
    evaluation_date: EVAL_DATE,
    students: [],
    opportunities: [],
    interventions: [],
    budget_usd: 1000,
    ...overrides,
  };
}

/** 线性同余伪随机（固定种子，确定性；不用 Math.random）。 */
export function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
