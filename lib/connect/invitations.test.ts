/**
 * Talent Board 的示例邀请（./invitations）：理由只由分享的内容拼成、没有分数；发送前的拒绝规则（对所有档案都必须选任务、
 * 回应过的不能重发、同一发布者对同一句柄最多 1 条待回应）；发布者端文字与行为不透露保护状态；学生端收件箱
 * （受保护时待回应的收起、不能接受）；内存版浏览器存储里的完整流程（发送 → 列出 → 接受 / 拒绝；
 * 任务找不到时不能接受；屏蔽 → 隐藏且不能再发 → 解除屏蔽；受保护档案；撤回分享保留句柄）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  addInvitation,
  addUserPostedOpportunity,
  blockedPublisherIds,
  clearShareSettings,
  defaultShareSettings,
  loadInvitations,
  loadShareSettings,
  loadUserPostedOpportunities,
  removeUserPostedOpportunity,
  saveShareSettings,
  setInvitationStatus,
} from '../store';
import type { Invitation, Opportunity, ShareSettings, SharedProfileView, StudentProfile } from '../types';
import {
  ACCEPTED_QUEST_GONE_LABEL,
  ACTION_STATUS,
  ANSWERED_REFUSAL,
  BLOCK_HINT,
  BLOCKED_REFUSAL,
  CHOOSE_PUBLISHER_REFUSAL,
  DUPLICATE_QUEST_REFUSAL,
  NOTHING_SHARED_REFUSAL,
  NOT_ACCEPTABLE_NOTICE,
  PUBLISHER_PANE_TEXT,
  PUBLISHER_PENDING_REFUSAL,
  PUBLISHER_REFUSALS,
  QUEST_REQUIRED_REFUSAL,
  REVIEW_HELD_LABEL,
  STRICT_NO_ACCEPT_NOTICE,
  TRY_AGAIN_REFUSAL,
  actionMessage,
  actionsFor,
  blockedLine,
  heldNotice,
  inboxAllows,
  invitationInbox,
  invitationList,
  invitationReasons,
  planInvitation,
  publisherQuests,
  sentMessage,
  unblockTargets,
  type InvitationRequest,
  type InvitationRow,
} from './invitations';
import { protectionFor, unprotected, type Protection } from './protection';
import { samplePublishers } from './publishers';
import { NOT_SHARING_TEXT, publisherView, sharedProfilePreview } from './talent';

const TODAY = '2026-11-19';
const PUBLISHERS = samplePublishers();
const [A, B] = PUBLISHERS;
const PROTECTED: Protection = { protected: true, reasons: ['under_18'] };
const QA = 'sample-post-a-1';
const QA2 = 'sample-post-a-2';
const QB = 'sample-post-b-1';

function profile(id: string, over: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id,
    is_sample: false,
    display_name: 'DisplayNameMarker',
    school_name: 'SchoolNameMarker',
    grade: null,
    birth_date: null,
    skills: [
      { name: 'python', level: 'intermediate' },
      { name: 'sql', level: 'beginner' },
    ],
    interests: ['climate_data'],
    evidence: [
      { id: 'ev-1', title: 'Secret Title Marker', kind: 'project', skills: ['python'], status: 'self_reported', added_on: '2025-01-02' },
      { id: 'ev-2', title: 'Other Title Marker', kind: 'course', skills: [], status: 'reviewed', added_on: '2025-02-03' },
    ],
    ...over,
  };
}

const ADULT = profile('adult-profile-id-marker', { birth_date: '2000-01-01', grade: 16 });
const MINOR = profile('minor-profile-id-marker', { birth_date: '2010-04-05', grade: 11 });

function quest(id: string, postedBy: string, title = 'Quest Title Marker'): Opportunity {
  return {
    id,
    title,
    organizer: 'Sample organizer',
    category: 'project',
    fields: [],
    summary: 'A sample quest.',
    official_url: `https://example.com/connect-sample/${id}`,
    verified_on: TODAY,
    verified_by: 'Sample organizer',
    deadline: null,
    location: { format: 'online', country: null, state: null, city: null },
    cost: { fee_usd: 0, requires_travel_expense: false, note: null },
    time_commitment: { hours_per_week: null, total_weeks: null, start_date: null, end_date: null },
    required_devices: [],
    requirements: [],
    preparation: [],
    is_sample: true,
    source_tier: 'user_posted',
    posted_by: postedBy,
  } as unknown as Opportunity;
}

const VIEW: SharedProfileView = {
  share_handle: 'share-handle-marker',
  alias: 'Student',
  evidence: [
    { id: 'evidence-1', title: 'Secret Title Marker', kind: 'project', skills: ['python'], status: 'self_reported' },
    { id: 'evidence-2', title: 'Other Title Marker', kind: 'course', skills: [], status: 'reviewed' },
  ],
  skills: [
    { name: 'python', level: 'intermediate' },
    { name: 'sql', level: 'beginner' },
  ],
  interests: ['climate_data'],
  collaboration_note: 'Free on weekends.',
  is_sample: false,
};

describe('invitationReasons：只由分享的内容拼成，没有分数', () => {
  it('每类至多一句；证据只给条数；说明不引用原文', () => {
    expect(invitationReasons(VIEW)).toEqual([
      'You shared the skills "python" and "sql".',
      'You shared 2 pieces of evidence.',
      'You shared the interest "climate_data".',
      'You shared a collaboration note.',
    ]);
    expect(
      invitationReasons({ ...VIEW, skills: [VIEW.skills[0]], evidence: [VIEW.evidence[0]], interests: [], collaboration_note: null }),
    ).toEqual(['You shared the skill "python".', 'You shared 1 piece of evidence.']);
    expect(invitationReasons(null)).toEqual([]);
    const text = invitationReasons(VIEW).join(' ').toLowerCase();
    for (const hidden of ['secret title marker', 'free on weekends', '%', 'score', 'match', 'rank']) expect(text).not.toContain(hidden);
  });
});

describe('planInvitation：拒绝规则（对所有档案相同）', () => {
  const req = (over: Partial<InvitationRequest> = {}): InvitationRequest => ({
    publisher_id: A.id,
    quest_id: QA,
    publishers: PUBLISHERS,
    stored_quests: [quest(QA, A.id), quest(QA2, A.id), quest(QB, B.id)],
    view: VIEW,
    protection: unprotected(),
    existing: [],
    blocked: [],
    today: TODAY,
    id: 'inv-new',
    ...over,
  });
  const old = (over: Partial<Invitation> = {}): Invitation => ({
    id: 'inv-old',
    publisher_id: A.id,
    share_handle: VIEW.share_handle,
    opportunity_id: QA,
    reasons: [],
    status: 'pending',
    is_sample: true,
    sent_on: TODAY,
    ...over,
  });
  const outcome = (r: InvitationRequest) => {
    const plan = planInvitation(r);
    return plan.ok ? 'ok' : plan.message;
  };

  it('通过：只指向句柄，is_sample、pending、sent_on = today，理由来自视图', () => {
    expect(planInvitation(req())).toEqual({
      ok: true,
      invitation: {
        id: 'inv-new',
        publisher_id: A.id,
        share_handle: VIEW.share_handle,
        opportunity_id: QA,
        reasons: invitationReasons(VIEW),
        status: 'pending',
        is_sample: true,
        sent_on: TODAY,
        responded_on: null,
      },
    });
  });

  it.each<[string, Partial<InvitationRequest>, string]>([
    ['什么都没分享', { view: null }, NOTHING_SHARED_REFUSAL],
    ['没选发布者', { publisher_id: '' }, CHOOSE_PUBLISHER_REFUSAL],
    ['不是示例发布者', { publisher_id: 'someone-real' }, CHOOSE_PUBLISHER_REFUSAL],
    ['被屏蔽（名单）', { blocked: [A.id] }, BLOCKED_REFUSAL],
    ['被屏蔽（存储里的 blocked 邀请）', { existing: [old({ status: 'blocked', opportunity_id: QA2 })] }, BLOCKED_REFUSAL],
    ['不受保护也必须选任务', { quest_id: null }, QUEST_REQUIRED_REFUSAL],
    ['受保护：没选任务', { quest_id: null, protection: PROTECTED }, QUEST_REQUIRED_REFUSAL],
    ['空字符串任务', { quest_id: '' }, QUEST_REQUIRED_REFUSAL],
    ['别的发布者的任务', { quest_id: QB }, QUEST_REQUIRED_REFUSAL],
    ['任务已不在本浏览器', { quest_id: 'sample-post-gone' }, QUEST_REQUIRED_REFUSAL],
    ['同一任务已有待回应的邀请', { existing: [old()] }, DUPLICATE_QUEST_REFUSAL],
    ['同一任务已被拒绝过', { existing: [old({ status: 'declined' })] }, ANSWERED_REFUSAL],
    ['同一任务已被接受过', { existing: [old({ status: 'accepted' })] }, ANSWERED_REFUSAL],
    ['同一发布者对同一句柄已有待回应的邀请（另一个任务）', { existing: [old({ opportunity_id: QA2 })] }, PUBLISHER_PENDING_REFUSAL],
    ['同一发布者已有待回应的旧邀请（没有任务）', { existing: [old({ opportunity_id: null })] }, PUBLISHER_PENDING_REFUSAL],
    ['受保护：同一发布者已有待回应的邀请', { existing: [old({ opportunity_id: QA2 })], protection: PROTECTED }, PUBLISHER_PENDING_REFUSAL],
    ['id 重复', { existing: [old({ id: 'inv-new', opportunity_id: QA2, status: 'declined' })] }, TRY_AGAIN_REFUSAL],
    ['id 为空', { id: '' }, TRY_AGAIN_REFUSAL],
    ['今天不合法', { today: 'nope' }, TRY_AGAIN_REFUSAL],
    ['受保护且视图只剩说明', { protection: PROTECTED, view: { ...VIEW, evidence: [], skills: [], interests: [] } }, NOTHING_SHARED_REFUSAL],
  ])('%s → 拒绝', (_label, over, message) => {
    expect(outcome(req(over))).toBe(message);
  });

  it('别的任务、别的学生、别的发布者的邀请不算重复', () => {
    expect(outcome(req({ existing: [old({ opportunity_id: QA2, status: 'declined' })] }))).toBe('ok');
    expect(outcome(req({ existing: [old({ share_handle: 'another-handle', status: 'declined' })] }))).toBe('ok');
    expect(outcome(req({ publisher_id: B.id, quest_id: QB, existing: [old({ status: 'declined' })] }))).toBe('ok');
  });

  it('限流：只数同一发布者 + 同一句柄的 pending；别的发布者或别的学生的待回应邀请不算', () => {
    expect(PUBLISHER_PENDING_REFUSAL).toBe('Not sent. This sample publisher already has a pending invitation to this handle.');
    expect(outcome(req({ existing: [old({ opportunity_id: QA2, share_handle: 'another-handle' })] }))).toBe('ok');
    expect(outcome(req({ publisher_id: B.id, quest_id: QB, existing: [old({ opportunity_id: QA2 })] }))).toBe('ok');
    expect(outcome(req({ existing: [old({ opportunity_id: QA2, status: 'declined' })] }))).toBe('ok');
    expect(outcome(req({ existing: [old({ opportunity_id: QA2, status: 'accepted' })] }))).toBe('ok');
  });

  it('受保护与不受保护：同一请求得到完全相同的结果（成功时邀请也是 pending）', () => {
    const view = { ...VIEW, collaboration_note: null };
    for (const over of [{}, { existing: [old({ opportunity_id: QA2 })] }, { quest_id: null }, { blocked: [A.id] }] as Partial<InvitationRequest>[]) {
      expect(planInvitation(req({ ...over, view, protection: PROTECTED }))).toEqual(
        planInvitation(req({ ...over, view, protection: unprotected() })),
      );
    }
    const plan = planInvitation(req({ view, protection: PROTECTED }));
    expect(plan.ok && plan.invitation.status).toBe('pending');
  });

  it('受保护：理由里不提合作说明', () => {
    const plan = planInvitation(req({ protection: PROTECTED }));
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.invitation.reasons.join(' ')).not.toContain('collaboration note');
  });

  it('publisherQuests 只列该示例发布者经 Connect 发布的任务', () => {
    const stored = [quest('q-a', A.id), quest('q-b', B.id), quest('q-none', 'not-a-publisher')];
    expect(publisherQuests(stored, A.id, PUBLISHERS).map((q) => q.id)).toEqual(['q-a']);
    expect(publisherQuests(stored, '', PUBLISHERS)).toEqual([]);
  });

  it('屏蔽的说明如实：本地演示没有举报；只有一个屏蔽操作', () => {
    expect(ACTION_STATUS.block).toBe('blocked');
    expect(BLOCK_HINT).toBe(
      "Blocking hides this publisher's invitations in this browser. This local demo has no reporting: nothing is sent to anyone and no one reviews it.",
    );
    expect(actionMessage('block', A.name)).toContain('This local demo has no reporting: nothing is sent to anyone.');
    expect(actionMessage('block', A.name).toLowerCase()).not.toContain('report is sent');
    expect(actionMessage('accept', A.name)).toContain('nothing is sent and no one is contacted');
    for (const status of ['pending', 'accepted', 'declined', 'blocked'] as const) {
      for (const quest of [{ kind: 'stored', id: QA, title: 'T' }, { kind: 'missing' }, { kind: 'none' }] as const) {
        expect(actionsFor(status, quest)).not.toContain('report');
      }
    }
  });

  it('解除屏蔽：actionsFor(blocked) 只有 unblock，写入 declined；unblockTargets 只挑这个句柄 + 发布者的 blocked 邀请', () => {
    expect(actionsFor('blocked', { kind: 'stored', id: QA, title: 'T' })).toEqual(['unblock']);
    expect(actionsFor('blocked', { kind: 'missing' })).toEqual(['unblock']);
    expect(ACTION_STATUS.unblock).toBe('declined');
    expect(actionMessage('unblock', A.name)).toBe(
      `Unblocked ${A.name}. Its earlier invitations are listed as declined, and it can send you new sample invitations. Nothing is sent to anyone.`,
    );
    const invs = [
      old({ id: 'x1', status: 'blocked' }),
      old({ id: 'x2', status: 'blocked', opportunity_id: QA2 }),
      old({ id: 'x3', status: 'declined' }),
      old({ id: 'x4', status: 'blocked', publisher_id: B.id }),
      old({ id: 'x5', status: 'blocked', share_handle: 'another-handle' }),
    ];
    expect(unblockTargets(invs, VIEW.share_handle, A.id)).toEqual(['x1', 'x2']);
    expect(unblockTargets(invs, null, A.id)).toEqual([]);
    expect(unblockTargets(invs, VIEW.share_handle, '')).toEqual([]);
    // 改回 declined 之后不再被当作屏蔽：发布者可以发送（另一个任务）
    const after = invs.map((i) => (['x1', 'x2'].includes(i.id) ? { ...i, status: 'declined' as const } : i));
    expect(outcome(req({ quest_id: QA, existing: after }))).toBe(ANSWERED_REFUSAL);
    expect(outcome(req({ quest_id: QA, existing: after.filter((i) => i.opportunity_id !== QA) }))).toBe('ok');
  });

  it('已屏蔽的那一行单复数一致', () => {
    expect(blockedLine([])).toBeNull();
    expect(blockedLine([A.name])).toBe(`Blocked sample publisher: ${A.name}. Its invitations are hidden and it cannot send you new ones.`);
    expect(blockedLine([A.name, B.name])).toBe(
      `Blocked sample publishers: ${A.name} and ${B.name}. Their invitations are hidden and they cannot send you new ones.`,
    );
  });
});

describe('发布者端的文字不透露保护状态', () => {
  const FORBIDDEN = [/stricter/i, /under 18/i, /grade/i, /birth/i, /\bminor/i, /protect/i, /\bage\b/i, /guardian/i, /parent/i];

  /** 预览里所有字符串叶子（对象的值，递归）。 */
  function stringLeaves(v: unknown): string[] {
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.flatMap(stringLeaves);
    if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(stringLeaves);
    return [];
  }

  it('每条固定文字、每个拒绝原因、发送成功的提示、受保护档案的预览都不含这些词', () => {
    const settings: ShareSettings = {
      ...defaultShareSettings(MINOR.id, TODAY, 'share-handle-marker'),
      evidence_ids: ['ev-1'],
      skills: ['python'],
      share_interests: true,
      collaboration_note: 'Free on weekends.',
    };
    const texts = [
      ...Object.values(PUBLISHER_PANE_TEXT),
      ...PUBLISHER_REFUSALS,
      sentMessage(A.name),
      NOT_SHARING_TEXT,
      ...stringLeaves(sharedProfilePreview(MINOR, settings, protectionFor(MINOR, TODAY))),
    ];
    expect(texts.length).toBeGreaterThan(20);
    for (const text of texts) for (const re of FORBIDDEN) expect(text, `${re} in "${text}"`).not.toMatch(re);
  });

  it('受保护与不受保护的档案得到同一个拒绝原因', () => {
    const base: Omit<InvitationRequest, 'protection'> = {
      publisher_id: A.id,
      quest_id: null,
      publishers: PUBLISHERS,
      stored_quests: [quest(QA, A.id)],
      view: VIEW,
      existing: [],
      blocked: [],
      today: TODAY,
      id: 'inv-x',
    };
    expect(planInvitation({ ...base, protection: PROTECTED })).toEqual(planInvitation({ ...base, protection: unprotected() }));
  });
});

describe('内存版浏览器存储里的完整流程', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  function installFakeWindow(): Map<string, string> {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
    };
    (globalThis as { window?: unknown }).window = { localStorage: storage };
    return data;
  }

  function share(p: StudentProfile, over: Partial<ShareSettings>): ShareSettings {
    const s = { ...defaultShareSettings(p.id, TODAY), ...over };
    expect(saveShareSettings(s)).toBe(true);
    return s;
  }

  function postQuests(): void {
    addUserPostedOpportunity(quest(QA, A.id));
    addUserPostedOpportunity(quest(QA2, A.id, 'Second Quest'));
    addUserPostedOpportunity(quest(QB, B.id, 'B Quest'));
  }

  /** 发布者端点「Send sample invitation」：与页面相同的读取顺序，通过时 addInvitation 并读回确认。 */
  function send(p: StudentProfile, publisherId: string, questId: string | null, id: string) {
    const protection = protectionFor(p, TODAY);
    const settings = loadShareSettings(p.id);
    const handle = settings?.share_handle ?? '';
    const plan = planInvitation({
      publisher_id: publisherId,
      quest_id: questId,
      publishers: PUBLISHERS,
      stored_quests: loadUserPostedOpportunities(),
      view: publisherView(p, settings, protection),
      protection,
      existing: loadInvitations(),
      blocked: handle === '' ? [] : blockedPublisherIds(handle),
      today: TODAY,
      id,
    });
    if (plan.ok) {
      addInvitation(plan.invitation);
      expect(loadInvitations(handle).some((i) => i.id === id)).toBe(true);
    }
    return plan;
  }

  /** 学生端列表：与页面相同的读取方式。 */
  function listFor(p: StudentProfile) {
    const handle = loadShareSettings(p.id)?.share_handle ?? null;
    return invitationList({
      invitations: handle === null ? [] : loadInvitations(handle),
      share_handle: handle,
      blocked: handle === null ? [] : blockedPublisherIds(handle),
      publishers: PUBLISHERS,
      stored_quests: loadUserPostedOpportunities(),
    });
  }

  /** 直接存一条邀请（模拟导入的备份或旧数据）。 */
  function storeRaw(handle: string, over: Partial<Invitation>): void {
    addInvitation({
      id: 'inv-raw',
      publisher_id: A.id,
      share_handle: handle,
      opportunity_id: QA,
      reasons: [],
      status: 'pending',
      is_sample: true,
      sent_on: '2026-01-01',
      ...over,
    });
  }

  it('只读取不会创建分享设置或邀请', () => {
    const data = installFakeWindow();
    expect(listFor(ADULT)).toEqual({ rows: [], blocked_publishers: [], blocked_list: [] });
    expect(loadShareSettings(ADULT.id)).toBeNull();
    expect(loadInvitations()).toEqual([]);
    expect(data.size).toBe(0);
  });

  it('发送 → 学生端列出 → 接受；另一条 → 拒绝；拒绝过的同一任务不能重发', () => {
    installFakeWindow();
    postQuests();
    share(ADULT, { skills: ['python'], evidence_ids: ['ev-1', 'ev-2'] });
    expect(send(ADULT, A.id, null, 'inv-0')).toEqual({ ok: false, message: QUEST_REQUIRED_REFUSAL });
    expect(send(ADULT, A.id, QA, 'inv-1').ok).toBe(true);
    expect(send(ADULT, B.id, QB, 'inv-2').ok).toBe(true);

    let rows = listFor(ADULT).rows;
    expect(rows.map((r) => [r.id, r.publisher_name, r.status, r.status_label])).toEqual([
      ['inv-1', A.name, 'pending', 'Waiting for your answer'],
      ['inv-2', B.name, 'pending', 'Waiting for your answer'],
    ]);
    expect(rows[0].quest).toEqual({ kind: 'stored', id: QA, title: 'Quest Title Marker' });
    expect(rows[0].reasons).toEqual(['You shared the skill "python".', 'You shared 2 pieces of evidence.']);
    expect(rows[0].actions).toEqual(['accept', 'decline', 'block']);
    expect(rows[0].notice).toBeNull();

    setInvitationStatus('inv-1', ACTION_STATUS.accept, TODAY);
    setInvitationStatus('inv-2', ACTION_STATUS.decline, TODAY);
    const handle = loadShareSettings(ADULT.id)!.share_handle;
    expect(loadInvitations(handle).map((i) => [i.id, i.status, i.responded_on])).toEqual([
      ['inv-1', 'accepted', TODAY],
      ['inv-2', 'declined', TODAY],
    ]);
    rows = listFor(ADULT).rows;
    expect(rows.map((r) => [r.status_label, r.actions])).toEqual([
      ['Accepted', ['block']],
      ['Declined', ['block']],
    ]);
    expect(send(ADULT, B.id, QB, 'inv-3')).toEqual({ ok: false, message: ANSWERED_REFUSAL });
    expect(send(ADULT, A.id, QA, 'inv-4')).toEqual({ ok: false, message: ANSWERED_REFUSAL });
    // 同一发布者的另一个任务可以
    expect(send(ADULT, A.id, QA2, 'inv-5').ok).toBe(true);
  });

  it('任务找不到的邀请不能接受（任务撤回、属于别的发布者、未知 id、旧的无任务邀请）；以前接受过的换一句说明', () => {
    installFakeWindow();
    postQuests();
    const s = share(ADULT, { skills: ['python'] });
    expect(send(ADULT, A.id, QA, 'inv-withdrawn').ok).toBe(true);
    storeRaw(s.share_handle, { id: 'inv-foreign', opportunity_id: QB });
    storeRaw(s.share_handle, { id: 'inv-unknown', opportunity_id: 'sample-post-nowhere' });
    storeRaw(s.share_handle, { id: 'inv-none', publisher_id: B.id, opportunity_id: null });
    storeRaw(s.share_handle, { id: 'inv-accepted', opportunity_id: QA2, status: 'accepted', responded_on: '2026-02-01' });
    removeUserPostedOpportunity(QA);
    removeUserPostedOpportunity(QA2);

    const byId = Object.fromEntries(listFor(ADULT).rows.map((r) => [r.id, r]));
    for (const id of ['inv-withdrawn', 'inv-foreign', 'inv-unknown']) {
      expect(byId[id].quest, id).toEqual({ kind: 'missing' });
      expect(byId[id].actions, id).toEqual(['decline', 'block']);
      expect(byId[id].notice, id).toBe(NOT_ACCEPTABLE_NOTICE);
    }
    expect(byId['inv-none'].quest).toEqual({ kind: 'none' });
    expect(byId['inv-none'].actions).toEqual(['decline', 'block']);
    expect(byId['inv-accepted'].status_label).toBe(ACCEPTED_QUEST_GONE_LABEL);
    expect(byId['inv-accepted'].actions).toEqual(['block']);
    expect(NOT_ACCEPTABLE_NOTICE).toBe(
      'This invitation is not about a quest this sample publisher has posted in this browser, so it cannot be accepted.',
    );
  });

  it('屏蔽：该发布者的邀请全部隐藏，之后发送被拒绝，不新增任何存储键；解除屏蔽后可以再发', () => {
    const data = installFakeWindow();
    postQuests();
    share(ADULT, { skills: ['python'] });
    expect(send(ADULT, A.id, QA, 'inv-1').ok).toBe(true);
    // 限流：A 对这个句柄已有一条待回应
    expect(send(ADULT, A.id, QA2, 'inv-2')).toEqual({ ok: false, message: PUBLISHER_PENDING_REFUSAL });
    expect(send(ADULT, B.id, QB, 'inv-3').ok).toBe(true);

    const keysBefore = [...data.keys()].sort();
    setInvitationStatus('inv-1', ACTION_STATUS.block, TODAY);
    expect([...data.keys()].sort()).toEqual(keysBefore);

    const handle = loadShareSettings(ADULT.id)!.share_handle;
    expect(blockedPublisherIds(handle)).toEqual([A.id]);
    const list = listFor(ADULT);
    expect(list.rows.map((r) => r.id)).toEqual(['inv-3']);
    expect(list.blocked_publishers).toEqual([A.name]);
    expect(list.blocked_list).toEqual([{ id: A.id, name: A.name }]);

    const countBefore = loadInvitations().length;
    expect(send(ADULT, A.id, QA, 'inv-4')).toEqual({ ok: false, message: BLOCKED_REFUSAL });
    expect(send(ADULT, A.id, QA2, 'inv-5')).toEqual({ ok: false, message: BLOCKED_REFUSAL });
    expect(loadInvitations().length).toBe(countBefore);
    // 别的发布者不受屏蔽影响（这里因为已有待回应的邀请而被拒绝）
    expect(send(ADULT, B.id, QB, 'inv-6')).toEqual({ ok: false, message: DUPLICATE_QUEST_REFUSAL });

    // 解除屏蔽（与页面相同：unblockTargets → setInvitationStatus(…, 'declined')）
    for (const id of unblockTargets(loadInvitations(handle), handle, A.id)) setInvitationStatus(id, ACTION_STATUS.unblock, TODAY);
    expect(blockedPublisherIds(handle)).toEqual([]);
    expect([...data.keys()].sort()).toEqual(keysBefore);
    const unblocked = listFor(ADULT);
    expect(unblocked.blocked_list).toEqual([]);
    expect(unblocked.rows.map((r) => [r.id, r.status])).toEqual([
      ['inv-1', 'declined'],
      ['inv-3', 'pending'],
    ]);
    expect(send(ADULT, A.id, QA, 'inv-7')).toEqual({ ok: false, message: ANSWERED_REFUSAL });
    expect(send(ADULT, A.id, QA2, 'inv-8').ok).toBe(true);
  });

  it('受保护的档案：针对任务的邀请可以；说明不分享、标题不显示；邀请与预览里没有身份信息', () => {
    installFakeWindow();
    // 说明是以前保存的（受保护前），留在设置里但不分享
    share(MINOR, { skills: ['python'], evidence_ids: ['ev-1'], collaboration_note: 'Free on weekends.' });
    expect(send(MINOR, A.id, null, 'inv-1')).toEqual({ ok: false, message: QUEST_REQUIRED_REFUSAL });
    expect(loadInvitations()).toEqual([]);

    addUserPostedOpportunity(quest(QA, A.id));
    const plan = send(MINOR, A.id, QA, 'inv-2');
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.invitation.reasons).toEqual(['You shared the skill "python".', 'You shared 1 piece of evidence.']);
    expect(loadShareSettings(MINOR.id)?.collaboration_note).toBe('Free on weekends.');

    const settings = loadShareSettings(MINOR.id);
    const protection = protectionFor(MINOR, TODAY);
    const texts = [
      JSON.stringify(loadInvitations()),
      JSON.stringify(sharedProfilePreview(MINOR, settings, protection)),
      JSON.stringify(publisherView(MINOR, settings, protection)),
    ];
    for (const json of texts) {
      for (const hidden of [MINOR.id, 'DisplayNameMarker', 'SchoolNameMarker', '2010-04-05', 'Secret Title Marker', 'Free on weekends', 'ev-1']) {
        expect(json, hidden).not.toContain(hidden);
      }
    }

    let rows = listFor(MINOR).rows;
    expect(rows[0].quest).toEqual({ kind: 'stored', id: QA, title: 'Quest Title Marker' });
    expect(rows[0].actions).toEqual(['accept', 'decline', 'block']);
    // 学生端收件箱：受保护时收起，不直接显示，不能接受
    const inbox = invitationInbox(protection, rows);
    expect(inbox.held).toBe(1);
    expect(inbox.visible).toEqual([]);
    expect(inbox.held_rows.map((r) => [r.id, r.actions, r.notice])).toEqual([['inv-2', ['decline', 'block'], STRICT_NO_ACCEPT_NOTICE]]);
    expect(inboxAllows(inbox, 'inv-2', 'accept')).toBe(false);
    expect(inboxAllows(inbox, 'inv-2', 'decline')).toBe(true);
    removeUserPostedOpportunity(QA);
    rows = listFor(MINOR).rows;
    expect(rows[0].quest).toEqual({ kind: 'missing' });
    expect(rows[0].actions).toEqual(['decline', 'block']);
  });

  it('撤回分享：句柄保留，已有邀请仍在学生端列出；发布者端无法再发送', () => {
    installFakeWindow();
    postQuests();
    const s = share(ADULT, { skills: ['python'] });
    expect(send(ADULT, A.id, QA, 'inv-1').ok).toBe(true);
    clearShareSettings(ADULT.id, '2026-11-20');
    expect(loadShareSettings(ADULT.id)?.share_handle).toBe(s.share_handle);
    expect(listFor(ADULT).rows.map((r) => r.id)).toEqual(['inv-1']);
    expect(send(ADULT, B.id, QB, 'inv-2')).toEqual({ ok: false, message: NOTHING_SHARED_REFUSAL });
  });
});

describe('invitationInbox：受保护档案的待回应邀请先收起，不能接受', () => {
  const row = (over: Partial<InvitationRow>): InvitationRow => ({
    id: 'r',
    publisher_id: A.id,
    publisher_name: A.name,
    quest: { kind: 'stored', id: QA, title: 'Quest Title Marker' },
    reasons: ['You shared the skill "python".'],
    status: 'pending',
    status_label: 'Waiting for your answer',
    notice: null,
    sent_on: TODAY,
    actions: ['accept', 'decline', 'block'],
    ...over,
  });
  const ROWS: InvitationRow[] = [
    row({ id: 'p1' }),
    row({ id: 'p2', publisher_id: B.id, publisher_name: B.name, quest: { kind: 'missing' }, notice: NOT_ACCEPTABLE_NOTICE, actions: ['decline', 'block'] }),
    row({ id: 'd1', status: 'declined', status_label: 'Declined', actions: ['block'] }),
    row({ id: 'a1', status: 'accepted', status_label: 'Accepted', actions: ['block'] }),
  ];

  it('受保护：pending 进 held、不进直接可见列表、动作里没有 accept；已回应的历史照常显示', () => {
    const inbox = invitationInbox(PROTECTED, ROWS);
    expect(inbox.held).toBe(2);
    expect(inbox.visible.map((r) => r.id)).toEqual(['d1', 'a1']);
    expect(inbox.held_rows.map((r) => r.id)).toEqual(['p1', 'p2']);
    for (const r of [...inbox.held_rows, ...inbox.visible]) expect(r.actions).not.toContain('accept');
    expect(inbox.held_rows.map((r) => r.actions)).toEqual([
      ['decline', 'block'],
      ['decline', 'block'],
    ]);
    expect(inbox.held_rows.every((r) => r.notice === STRICT_NO_ACCEPT_NOTICE)).toBe(true);
    expect(inbox.visible.map((r) => r.notice)).toEqual([null, null]);
    expect(inbox.allowed_actions).not.toContain('accept');
    expect(inboxAllows(inbox, 'p1', 'accept')).toBe(false);
    expect(inboxAllows(inbox, 'p1', 'block')).toBe(true);
    expect(inboxAllows(inbox, 'nope', 'decline')).toBe(false);
    // 不修改输入
    expect(ROWS[0].actions).toEqual(['accept', 'decline', 'block']);
  });

  it('protection 缺失或损坏时按受保护处理', () => {
    for (const bad of [null, undefined, {}, { protected: 'no' }] as unknown as Protection[]) {
      expect(invitationInbox(bad, ROWS).held).toBe(2);
    }
  });

  it('不受保护：与以前一致，全部直接显示，held = 0，可以接受', () => {
    const inbox = invitationInbox(unprotected(), ROWS);
    expect(inbox.held).toBe(0);
    expect(inbox.held_rows).toEqual([]);
    expect(inbox.visible).toEqual(ROWS);
    expect(inboxAllows(inbox, 'p1', 'accept')).toBe(true);
    expect(inboxAllows(inbox, 'p2', 'accept')).toBe(false);
  });

  it('汇总提示与按钮文字', () => {
    expect(heldNotice(1)).toBe(
      '1 sample invitation is held because stricter defaults apply to this profile. Review it together with a parent, guardian or teacher.',
    );
    expect(heldNotice(3)).toBe(
      '3 sample invitations are held because stricter defaults apply to this profile. Review them together with a parent, guardian or teacher.',
    );
    expect(REVIEW_HELD_LABEL).toBe('Review held invitations with a trusted adult');
    expect(STRICT_NO_ACCEPT_NOTICE).toBe(
      'With stricter defaults, an invitation cannot be accepted here. Use the official application route for the quest instead.',
    );
  });
});
