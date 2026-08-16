export type Route =
  | { name: 'home' }
  // `inboxId` drains a file shared from a phone: the form opens with that
  // photo already attached and consumes the inbox row on save (CR-2026-08-16).
  | { name: 'upload'; editId?: string; inboxId?: string }
  // The employee's share inbox. Named `share-inbox`, not `inbox`, because
  // `screens/approver/Inbox.tsx` is a different screen entirely (the approver's
  // bundle queue) and one of the two names had to say which it meant.
  | { name: 'share-inbox'; shareError?: string }
  | { name: 'record'; id: string }
  | { name: 'bundle-new'; id?: string }
  | { name: 'bundle-submitted'; id: string }
  | { name: 'bundle'; id: string }
  // `filter`/`view` carry which pane the click meant. Without them every
  // sidebar row that crosses to another screen landed on that screen's default
  // — so "อนุมัติแล้ว" opened "รออนุมัติ", and "คำขอที่ฉันส่ง" opened "ฉบับร่าง".
  | { name: 'approver-home'; filter?: 'pending' | 'approved' | 'paid' | 'rejected' }
  | { name: 'overview' }
  | { name: 'approver-review'; id: string }
  | { name: 'approver-pay'; id: string }
  | { name: 'login' }
  | { name: 'admin-employees' }
  | { name: 'admin-settings' }
  | { name: 'my-requests'; view?: 'drafts' | 'pending' | 'approved' | 'paid' | 'rejected' };

export type RouteName = Route['name'];

export type Nav = (route: Route) => void;
