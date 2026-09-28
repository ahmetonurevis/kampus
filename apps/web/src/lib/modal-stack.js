// One Escape handler and focus trap owns the topmost dialog, including PDF previews.
export const modalStack = []
export const modalFocusOrigins = new Map()
