const locks = new WeakMap<Document, { count: number; value: string; priority: string }>()

export function lockImagePreviewScroll(document: Document): () => void {
  const style = document.body.style
  let lock = locks.get(document)
  if (lock === undefined) {
    lock = { count: 0, value: style.getPropertyValue('overflow'), priority: style.getPropertyPriority('overflow') }
    locks.set(document, lock)
    style.setProperty('overflow', 'hidden')
  }
  lock.count++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--lock.count > 0) return
    locks.delete(document)
    if (style.getPropertyValue('overflow') !== 'hidden' || style.getPropertyPriority('overflow') !== '') return
    if (lock.value === '') style.removeProperty('overflow')
    else style.setProperty('overflow', lock.value, lock.priority)
  }
}
