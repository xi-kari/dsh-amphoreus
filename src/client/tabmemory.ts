/** 工作台 Tab 记忆与 defaultView 播种。存储形状见 A.0 决策 A-2。 */
export const WORKBENCH_VIEW_ID = 'amphoreus-workbench'
export const WORKBENCH_TAB_KEY = 'dsh-amphoreus:workbench-tab'
/** 官方 ui-conversation 的持久化键前缀（SRC ui-conversation/src/client/stores.ts:6）。 */
export const CONVERSATION_PREF_PREFIX = 'dsh.conversation'
export type TabChoice = 'chat' | typeof WORKBENCH_VIEW_ID

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readRememberedTab(store: KeyValueStore): TabChoice | null {
  const value = store.getItem(WORKBENCH_TAB_KEY)
  return value === 'chat' || value === WORKBENCH_VIEW_ID ? value : null
}

export function rememberTab(store: KeyValueStore, tab: TabChoice): void {
  try { store.setItem(WORKBENCH_TAB_KEY, tab) } catch { /* 私密模式 */ }
}

/**
 * 返回应写入的 JSON 字符串，或 null（不写）。纯函数。
 * 规则见 A.0 决策 A-2：键不存在→整值；键存在且 view===null→只填 view 保留其余字段；
 * view 已是字符串（用户确有选择）或 JSON 解析失败→不动。
 */
export function decideSeed(input: {
  remembered: TabChoice | null
  defaultView: 'chat' | 'workbench'
  existingPreference: string | null
}): string | null {
  const wanted = input.remembered ?? (input.defaultView === 'workbench' ? WORKBENCH_VIEW_ID : 'chat')
  if (wanted !== WORKBENCH_VIEW_ID) return null
  if (input.existingPreference === null) {
    // 形状必须与 SRC ui-conversation/src/client/contract/views.ts:18-25 ConversationStoreState 一致
    return JSON.stringify({ draft: '', view: WORKBENCH_VIEW_ID, viewRequest: null })
  }
  let parsed: unknown
  try { parsed = JSON.parse(input.existingPreference) } catch { return null }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  if (record.view !== null && record.view !== undefined) return null
  return JSON.stringify({ ...record, view: WORKBENCH_VIEW_ID })
}

export function seedConversationView(
  store: KeyValueStore,
  sessionId: string,
  defaultView: 'chat' | 'workbench',
): boolean {
  const key = `${CONVERSATION_PREF_PREFIX}.${sessionId}`
  let existing: string | null = null
  try { existing = store.getItem(key) } catch { return false }
  const value = decideSeed({
    remembered: readRememberedTab(store),
    defaultView,
    existingPreference: existing,
  })
  if (value === null) return false
  try {
    store.setItem(key, value)
    return true
  } catch {
    return false
  }
}
