/* ═══════════════════════════════════════════════════════════════
   Toast Queue (Svelte 5 Runes)
   ═══════════════════════════════════════════════════════════════ */

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
}

export const toasts = $state<ToastMessage[]>([]);

export function showToast(
  message: string,
  type: ToastMessage['type'] = 'success'
): void {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  toasts.push({ id, message, type });
  setTimeout(() => {
    const index = toasts.findIndex((toast) => toast.id === id);
    if (index !== -1) {
      toasts.splice(index, 1);
    }
  }, 4000);
}

export function dismissToast(id: string): void {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index !== -1) {
    toasts.splice(index, 1);
  }
}

/* ═══════════════════════════════════════════════════════════════
   Sidebar State (Svelte 5 Runes)
   ═══════════════════════════════════════════════════════════════ */

export const sidebarState = $state({
  open: false,
  collapsed: false
});

export function toggleSidebar(): void {
  sidebarState.open = !sidebarState.open;
}

export function toggleSidebarCollapse(): void {
  sidebarState.collapsed = !sidebarState.collapsed;
}

export function closeSidebar(): void {
  sidebarState.open = false;
}
