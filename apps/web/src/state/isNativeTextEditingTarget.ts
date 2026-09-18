// A keyboard shortcut on window must not steal a key the browser already means something by
// inside a text field -- Ctrl+Z there is the field's own undo, Ctrl+C there is a text copy.
export function isNativeTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}
