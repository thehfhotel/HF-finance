export type Route =
  | { name: 'home' }
  | { name: 'upload'; editId?: string }
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
  | { name: 'my-requests'; view?: 'drafts' | 'pending' | 'approved' | 'paid' | 'rejected' };

export type RouteName = Route['name'];

export type Nav = (route: Route) => void;
