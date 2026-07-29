export type Route =
  | { name: 'home' }
  | { name: 'upload'; editId?: string }
  | { name: 'record'; id: string }
  | { name: 'bundle-new'; id?: string }
  | { name: 'bundle-submitted'; id: string }
  | { name: 'bundle'; id: string }
  | { name: 'approver-home' }
  | { name: 'approver-review'; id: string }
  | { name: 'approver-pay'; id: string }
  | { name: 'login' }
  | { name: 'admin-employees' }
  | { name: 'my-requests' };

export type RouteName = Route['name'];

export type Nav = (route: Route) => void;
