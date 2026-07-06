import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatExpiry, formatThaiDate } from '../../lib/format';
import { FONT_DISPLAY, FONT_MONO, FONT_UI } from '../../lib/theme';
import type { AdminUser, CreateUserRequest, Role, Theme, UpdateUserRequest } from '../../lib/types';
import { useViewportPlatform } from '../../lib/useViewportPlatform';
import { DesktopShell, SidebarItem } from '../../components/DesktopShell';
import { AppBar } from '../../components/AppBar';
import { Avatar, Card, GhostButton, IconBtn, PrimaryButton } from '../../components/primitives';
import { Icon } from '../../components/icons';

const LINE_CODE_TTL_MS = 24 * 60 * 60 * 1000;

const TABLE_GRID_COLUMNS = '40px 1.5fr 1.4fr 1fr 80px';

interface ManageEmployeesProps {
  theme: Theme;
  /** Optional — when set, the back action navigates via the app's router instead of `window.history.back()`. */
  onBack?: () => void;
}

interface CodeDisplay {
  userId: string;
  userName: string;
  code: string;
  expiresAt: string;
}

interface ToastMessage {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

export function ManageEmployees({ theme, onBack }: ManageEmployeesProps): JSX.Element {
  const platform = useViewportPlatform();
  const isMobile = platform === 'mobile';

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [codeDisplay, setCodeDisplay] = useState<CodeDisplay | null>(null);
  const [regenerateTarget, setRegenerateTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const list = await api.admin.listUsers();
        if (!cancelled) setUsers(list);
      } catch (err) {
        if (!cancelled) showError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const showError = (err: unknown): void => {
    const text = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    setToast({ id: Date.now(), text, tone: 'error' });
  };

  const showInfo = (text: string): void => {
    setToast({ id: Date.now(), text, tone: 'info' });
  };


  const upsertUser = (next: AdminUser): void => {
    setUsers((prev) => {
      const exists = prev.some((u) => u.id === next.id);
      return exists ? prev.map((u) => (u.id === next.id ? next : u)) : [...prev, next];
    });
  };

  const handleCreate = async (req: CreateUserRequest): Promise<void> => {
    try {
      const created = await api.admin.createUser(req);
      upsertUser(created);
      setCreateOpen(false);
      try {
        const codeRes = await api.admin.generateLineCode(created.id);
        const refreshed: AdminUser = {
          ...created,
          lineLinkingCode: codeRes.code,
          lineLinkingCodeGeneratedAt: new Date().toISOString(),
        };
        upsertUser(refreshed);
        setCodeDisplay({
          userId: created.id,
          userName: created.name,
          code: codeRes.code,
          expiresAt: codeRes.expiresAt,
        });
      } catch (err) {
        showError(err);
      }
    } catch (err) {
      showError(err);
    }
  };

  const handleEdit = async (id: string, req: UpdateUserRequest): Promise<void> => {
    try {
      const updated = await api.admin.updateUser(id, req);
      upsertUser(updated);
      setEditing(null);
    } catch (err) {
      showError(err);
    }
  };

  const handleGenerateCode = async (user: AdminUser): Promise<void> => {
    try {
      const res = await api.admin.generateLineCode(user.id);
      const refreshed: AdminUser = {
        ...user,
        lineId: null,
        lineDisplayName: null,
        linePictureUrl: null,
        lineLinkingCode: res.code,
        lineLinkingCodeGeneratedAt: new Date().toISOString(),
      };
      upsertUser(refreshed);
      setCodeDisplay({
        userId: user.id,
        userName: user.name,
        code: res.code,
        expiresAt: res.expiresAt,
      });
    } catch (err) {
      showError(err);
    }
  };

  const handleDelete = async (user: AdminUser): Promise<void> => {
    try {
      await api.admin.deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      setDeleteTarget(null);
      showInfo('ลบพนักงานเรียบร้อย');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showError(err);
      } else {
        showError(err);
      }
    }
  };

  const handleBack = (): void => {
    if (onBack) {
      onBack();
    } else {
      window.history.back();
    }
  };

  const sharedUserListProps = {
    menuFor,
    onMenuToggle: (id: string) => setMenuFor((prev) => (prev === id ? null : id)),
    onMenuClose: () => setMenuFor(null),
    onEdit: (u: AdminUser) => {
      setEditing(u);
      setMenuFor(null);
    },
    onRegenerate: (u: AdminUser) => {
      setRegenerateTarget(u);
      setMenuFor(null);
    },
    onDelete: (u: AdminUser) => {
      setDeleteTarget(u);
      setMenuFor(null);
    },
    onGenerate: (u: AdminUser) => void handleGenerateCode(u),
    onShowCode: (u: AdminUser) => {
      if (u.lineLinkingCode && u.lineLinkingCodeGeneratedAt) {
        setCodeDisplay({
          userId: u.id,
          userName: u.name,
          code: u.lineLinkingCode,
          expiresAt: codeExpiry(u.lineLinkingCodeGeneratedAt),
        });
      }
    },
  };

  const modals = (
    <>
      {createOpen && (
        <UserFormModal
          theme={theme}
          mode="create"
          isMobile={isMobile}
          onClose={() => setCreateOpen(false)}
          onSubmit={(req) => void handleCreate(req)}
        />
      )}

      {editing && (
        <UserFormModal
          theme={theme}
          mode="edit"
          isMobile={isMobile}
          initial={editing}
          onClose={() => setEditing(null)}
          onSubmit={(req) => void handleEdit(editing.id, req)}
        />
      )}

      {codeDisplay && (
        <CodeDisplayModal
          theme={theme}
          isMobile={isMobile}
          display={codeDisplay}
          onClose={() => setCodeDisplay(null)}
        />
      )}

      {regenerateTarget && (
        <ConfirmModal
          theme={theme}
          isMobile={isMobile}
          title="สร้างรหัสใหม่?"
          body={`การสร้างรหัสใหม่จะยกเลิกการเชื่อมต่อ LINE ปัจจุบันของ ${regenerateTarget.name} (ถ้ามี) และสร้างรหัส 6 หลักใหม่`}
          confirmLabel="สร้างรหัสใหม่"
          confirmTone="warn"
          onCancel={() => setRegenerateTarget(null)}
          onConfirm={() => {
            const target = regenerateTarget;
            setRegenerateTarget(null);
            void handleGenerateCode(target);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          theme={theme}
          isMobile={isMobile}
          title={`ลบ ${deleteTarget.name}?`}
          body="พนักงานคนนี้จะถูกลบออกจากระบบ การกระทำนี้ไม่สามารถย้อนกลับได้"
          confirmLabel="ลบพนักงาน"
          confirmTone="danger"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            void handleDelete(target);
          }}
        />
      )}
    </>
  );

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.paper, position: 'relative' }}>
        {toast && <Toast theme={theme} message={toast} onClose={() => setToast(null)} />}

        <AppBar
          theme={theme}
          large
          subtitle="การจัดการ"
          title="พนักงาน"
          leading={
            <button
              onClick={handleBack}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px 0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: theme.accent,
                fontFamily: FONT_UI,
                fontSize: 14,
              }}
            >
              {Icon.back(theme.accent)}
              <span>กลับ</span>
            </button>
          }
          trailing={
            <button
              onClick={() => setCreateOpen(true)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px 0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: theme.accent,
                fontFamily: FONT_UI,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {Icon.plus(theme.accent)}
              <span>เพิ่ม</span>
            </button>
          }
        />

        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as CSSProperties}>
          <div style={{ padding: '8px 16px 100px' }}>
            <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft, marginBottom: 16 }}>
              {users.length} คน
            </div>

            {loading ? (
              <SkeletonRows theme={theme} />
            ) : users.length === 0 ? (
              <MobileEmptyState theme={theme} />
            ) : (
              <MobileEmployeeList
                theme={theme}
                users={users}
                {...sharedUserListProps}
              />
            )}
          </div>
        </div>

        {modals}
      </div>
    );
  }

  const sidebar = (
    <SidebarContent theme={theme} onBack={handleBack} />
  );

  return (
    <DesktopShell theme={theme} sidebar={sidebar}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.paper }}>
        {toast && <Toast theme={theme} message={toast} onClose={() => setToast(null)} />}

        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ padding: '32px 40px 80px', maxWidth: 1100 }}>
            <TopBar
              theme={theme}
              count={users.length}
              onAdd={() => setCreateOpen(true)}
            />

            {loading ? (
              <SkeletonRows theme={theme} />
            ) : users.length === 0 ? (
              <EmptyState theme={theme} />
            ) : (
              <UsersTable
                theme={theme}
                users={users}
                {...sharedUserListProps}
              />
            )}
          </div>
        </div>
      </div>

      {modals}
    </DesktopShell>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────

interface SidebarContentProps {
  theme: Theme;
  onBack: () => void;
}

function SidebarContent({ theme, onBack }: SidebarContentProps): JSX.Element {
  return (
    <>
      <div style={{ padding: '8px 16px 14px' }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: theme.ink, letterSpacing: -0.4 }}>
          เบิกค่าใช้จ่าย
        </div>
        <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, marginTop: 2 }}>
          การเงิน · ผู้อนุมัติ
        </div>
      </div>

      <div
        onClick={onBack}
        style={{
          margin: '1px 8px 8px',
          padding: '7px 12px',
          borderRadius: 8,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: FONT_UI,
          fontSize: 13,
          color: theme.inkSoft,
        }}
      >
        <span style={{ fontSize: 15, lineHeight: 1 }}>←</span>
        <span>กลับ</span>
      </div>

      <div
        style={{
          padding: '6px 16px 6px',
          fontFamily: FONT_UI,
          fontSize: 10,
          fontWeight: 600,
          color: theme.inkSofter,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        การจัดการ
      </div>
      <SidebarItem theme={theme} label="พนักงาน" active />

      <div style={{ flex: 1 }} />
    </>
  );
}

// ── Top bar ─────────────────────────────────────────────────────────

interface TopBarProps {
  theme: Theme;
  count: number;
  onAdd: () => void;
}

function TopBar({ theme, count, onAdd }: TopBarProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        marginBottom: 24,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: FONT_DISPLAY,
            fontWeight: 400,
            fontSize: 32,
            lineHeight: 1.05,
            letterSpacing: -0.6,
            color: theme.ink,
          }}
        >
          พนักงาน
        </h1>
        <div
          style={{
            marginTop: 4,
            fontFamily: FONT_UI,
            fontSize: 13,
            color: theme.inkSoft,
          }}
        >
          {count} คน
        </div>
      </div>
      <div style={{ minWidth: 180 }}>
        <PrimaryButton theme={theme} full={false} onClick={onAdd}>
          เพิ่มพนักงาน
        </PrimaryButton>
      </div>
    </div>
  );
}

// ── Skeleton & empty ────────────────────────────────────────────────

function SkeletonRows({ theme }: { theme: Theme }): JSX.Element {
  return (
    <Card theme={theme} padding={0}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            padding: '16px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            borderBottom: i < 3 ? `0.5px solid ${theme.hairline}` : 'none',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              background: theme.surface2,
            }}
          />
          <div style={{ flex: 1 }}>
            <div
              style={{
                width: 140,
                height: 12,
                borderRadius: 6,
                background: theme.surface2,
                marginBottom: 6,
              }}
            />
            <div
              style={{
                width: 200,
                height: 10,
                borderRadius: 5,
                background: theme.surface2,
              }}
            />
          </div>
        </div>
      ))}
    </Card>
  );
}

function EmptyState({ theme }: { theme: Theme }): JSX.Element {
  return (
    <Card theme={theme} padding={48}>
      <div
        style={{
          textAlign: 'center',
          fontFamily: FONT_UI,
          fontSize: 14,
          color: theme.inkSoft,
        }}
      >
        ยังไม่มีพนักงาน — กดเพิ่มพนักงานเพื่อเริ่ม
      </div>
    </Card>
  );
}

function MobileEmptyState({ theme }: { theme: Theme }): JSX.Element {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '60px 24px',
        fontFamily: FONT_UI,
        fontSize: 14,
        color: theme.inkSoft,
      }}
    >
      ยังไม่มีพนักงาน — กดเพิ่มเพื่อเริ่ม
    </div>
  );
}

// ── Mobile employee list & card ──────────────────────────────────────

interface MobileEmployeeListProps {
  theme: Theme;
  users: AdminUser[];
  menuFor: string | null;
  onMenuToggle: (id: string) => void;
  onMenuClose: () => void;
  onEdit: (u: AdminUser) => void;
  onRegenerate: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
  onGenerate: (u: AdminUser) => void;
  onShowCode: (u: AdminUser) => void;
}

function MobileEmployeeList({
  theme,
  users,
  menuFor,
  onMenuToggle,
  onMenuClose,
  onEdit,
  onRegenerate,
  onDelete,
  onGenerate,
  onShowCode,
}: MobileEmployeeListProps): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {users.map((u) => (
        <EmployeeCard
          key={u.id}
          theme={theme}
          user={u}
          menuOpen={menuFor === u.id}
          onMenuToggle={() => onMenuToggle(u.id)}
          onMenuClose={onMenuClose}
          onEdit={() => onEdit(u)}
          onRegenerate={() => onRegenerate(u)}
          onDelete={() => onDelete(u)}
          onGenerate={() => onGenerate(u)}
          onShowCode={() => onShowCode(u)}
        />
      ))}
    </div>
  );
}

interface EmployeeCardProps {
  theme: Theme;
  user: AdminUser;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onGenerate: () => void;
  onShowCode: () => void;
}

function EmployeeCard({
  theme,
  user,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  onEdit,
  onRegenerate,
  onDelete,
  onGenerate,
  onShowCode,
}: EmployeeCardProps): JSX.Element {
  const roleLabel = user.role === 'approver' ? 'ผู้อนุมัติ' : user.role === 'admin' ? 'แอดมิน' : 'พนักงาน';

  return (
    <div
      style={{
        background: theme.surface,
        borderRadius: 16,
        border: `0.5px solid ${theme.hairline}`,
        padding: '16px 16px 14px',
        position: 'relative',
      }}
    >
      {/* Header row: avatar + name/role + menu button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <Avatar theme={theme} initials={user.initials} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 15,
              fontWeight: 600,
              color: theme.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {user.name}
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 1 }}>
            {roleLabel}
          </div>
        </div>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <IconBtn theme={theme} onClick={onMenuToggle}>
            {Icon.more(theme.inkSoft)}
          </IconBtn>
          {menuOpen && (
            <RowMenu
              theme={theme}
              onClose={onMenuClose}
              onEdit={onEdit}
              onRegenerate={onRegenerate}
              onDelete={onDelete}
            />
          )}
        </div>
      </div>

      {/* LINE status row */}
      <div
        style={{
          paddingTop: 10,
          borderTop: `0.5px solid ${theme.hairline}`,
        }}
      >
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 10,
            color: theme.inkSofter,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          LINE
        </div>
        <LineStatusCell
          theme={theme}
          user={user}
          onGenerate={onGenerate}
          onShowCode={onShowCode}
        />
      </div>
    </div>
  );
}

// ── Users table ─────────────────────────────────────────────────────

interface UsersTableProps {
  theme: Theme;
  users: AdminUser[];
  menuFor: string | null;
  onMenuToggle: (id: string) => void;
  onMenuClose: () => void;
  onEdit: (u: AdminUser) => void;
  onRegenerate: (u: AdminUser) => void;
  onDelete: (u: AdminUser) => void;
  onGenerate: (u: AdminUser) => void;
  onShowCode: (u: AdminUser) => void;
}

function UsersTable({
  theme,
  users,
  menuFor,
  onMenuToggle,
  onMenuClose,
  onEdit,
  onRegenerate,
  onDelete,
  onGenerate,
  onShowCode,
}: UsersTableProps): JSX.Element {
  return (
    <Card theme={theme} padding={0}>
      <div
        style={{
          padding: '12px 18px',
          display: 'grid',
          gridTemplateColumns: TABLE_GRID_COLUMNS,
          gap: 16,
          fontFamily: FONT_UI,
          fontSize: 11,
          color: theme.inkSoft,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          borderBottom: `0.5px solid ${theme.hairline}`,
          fontWeight: 500,
        }}
      >
        <span />
        <span>ชื่อ</span>
        <span>LINE</span>
        <span>สร้างเมื่อ</span>
        <span style={{ textAlign: 'right' }}>จัดการ</span>
      </div>
      {users.map((u, i) => (
        <UserRow
          key={u.id}
          theme={theme}
          user={u}
          isLast={i === users.length - 1}
          menuOpen={menuFor === u.id}
          onMenuToggle={() => onMenuToggle(u.id)}
          onMenuClose={onMenuClose}
          onEdit={() => onEdit(u)}
          onRegenerate={() => onRegenerate(u)}
          onDelete={() => onDelete(u)}
          onGenerate={() => onGenerate(u)}
          onShowCode={() => onShowCode(u)}
        />
      ))}
    </Card>
  );
}

interface UserRowProps {
  theme: Theme;
  user: AdminUser;
  isLast: boolean;
  menuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
  onGenerate: () => void;
  onShowCode: () => void;
}

function UserRow({
  theme,
  user,
  isLast,
  menuOpen,
  onMenuToggle,
  onMenuClose,
  onEdit,
  onRegenerate,
  onDelete,
  onGenerate,
  onShowCode,
}: UserRowProps): JSX.Element {
  const roleLabel = user.role === 'approver' ? 'ผู้อนุมัติ' : user.role === 'admin' ? 'แอดมิน' : 'พนักงาน';
  return (
    <div
      style={{
        padding: '14px 18px',
        display: 'grid',
        gridTemplateColumns: TABLE_GRID_COLUMNS,
        gap: 16,
        alignItems: 'center',
        borderBottom: isLast ? 'none' : `0.5px solid ${theme.hairline}`,
        fontFamily: FONT_UI,
        fontSize: 13,
        color: theme.ink,
        position: 'relative',
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          background: theme.accent,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: FONT_UI,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {user.initials}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, color: theme.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.name}
        </div>
        <div style={{ fontSize: 11, color: theme.inkSoft, marginTop: 2 }}>
          {roleLabel}
        </div>
      </div>
      <LineStatusCell
        theme={theme}
        user={user}
        onGenerate={onGenerate}
        onShowCode={onShowCode}
      />
      <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: theme.inkSoft }}>
        {formatThaiDate(user.createdAt)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
        <IconBtn theme={theme} onClick={onMenuToggle}>
          {Icon.more(theme.inkSoft)}
        </IconBtn>
        {menuOpen && (
          <RowMenu
            theme={theme}
            onClose={onMenuClose}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
}

// ── LINE status cell ────────────────────────────────────────────────

interface LineStatusCellProps {
  theme: Theme;
  user: AdminUser;
  onGenerate: () => void;
  onShowCode: () => void;
}

function LineStatusCell({ theme, user, onGenerate, onShowCode }: LineStatusCellProps): JSX.Element {
  if (user.lineId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Dot color={theme.success} />
        <span style={{ fontSize: 12, color: theme.ink }}>เชื่อมต่อ LINE แล้ว</span>
        {user.linePictureUrl && (
          <img
            src={user.linePictureUrl}
            alt={user.lineDisplayName ?? 'LINE'}
            style={{ width: 24, height: 24, borderRadius: 12, objectFit: 'cover' }}
          />
        )}
      </div>
    );
  }

  if (user.lineLinkingCode && user.lineLinkingCodeGeneratedAt) {
    const expiresAt = codeExpiry(user.lineLinkingCodeGeneratedAt);
    const expired = isExpired(expiresAt);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Dot color={expired ? theme.inkSofter : theme.warn} />
        <button
          onClick={onShowCode}
          title="คลิกเพื่อคัดลอก / ดูรหัส"
          style={{
            padding: '2px 8px',
            borderRadius: 6,
            background: theme.surface2,
            border: `0.5px solid ${theme.hairline}`,
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: theme.ink,
            cursor: 'pointer',
            letterSpacing: 1,
          }}
        >
          รหัส: {user.lineLinkingCode}
        </button>
        <span style={{ fontSize: 11, color: theme.inkSoft }}>
          {formatExpiry(expiresAt)}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Dot color={theme.inkSofter} />
      <span style={{ fontSize: 12, color: theme.inkSoft }}>ยังไม่ได้เชื่อมต่อ</span>
      <button
        onClick={onGenerate}
        style={{
          padding: '4px 10px',
          borderRadius: 100,
          background: 'transparent',
          border: `0.5px solid ${theme.hairlineStrong}`,
          fontFamily: FONT_UI,
          fontSize: 11,
          fontWeight: 500,
          color: theme.ink,
          cursor: 'pointer',
        }}
      >
        สร้างรหัส
      </button>
    </div>
  );
}

function Dot({ color }: { color: string }): JSX.Element {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

// ── Row action menu ─────────────────────────────────────────────────

interface RowMenuProps {
  theme: Theme;
  onClose: () => void;
  onEdit: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}

function RowMenu({ theme, onClose, onEdit, onRegenerate, onDelete }: RowMenuProps): JSX.Element {
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 40,
          right: 0,
          minWidth: 180,
          background: theme.surface,
          borderRadius: 12,
          border: `0.5px solid ${theme.hairlineStrong}`,
          boxShadow: '0 12px 30px rgba(0,0,0,0.18)',
          padding: 6,
          zIndex: 11,
        }}
      >
        <MenuItem theme={theme} label="แก้ไข" onClick={onEdit} />
        <MenuItem theme={theme} label="สร้างรหัสใหม่" onClick={onRegenerate} />
        <MenuItem theme={theme} label="ลบ" onClick={onDelete} tone="danger" />
      </div>
    </>
  );
}

interface MenuItemProps {
  theme: Theme;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
}

function MenuItem({ theme, label, onClick, tone = 'default' }: MenuItemProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '9px 12px',
        background: 'transparent',
        border: 'none',
        borderRadius: 8,
        fontFamily: FONT_UI,
        fontSize: 13,
        color: tone === 'danger' ? theme.danger : theme.ink,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ── Toast ───────────────────────────────────────────────────────────

interface ToastProps {
  theme: Theme;
  message: ToastMessage;
  onClose: () => void;
}

function Toast({ theme, message, onClose }: ToastProps): JSX.Element {
  const isError = message.tone === 'error';
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        minWidth: 280,
        maxWidth: 480,
        padding: '12px 16px',
        borderRadius: 12,
        background: isError ? theme.danger : theme.ink,
        color: '#fff',
        fontFamily: FONT_UI,
        fontSize: 13,
        fontWeight: 500,
        boxShadow: '0 12px 30px rgba(0,0,0,0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        zIndex: 100,
      }}
    >
      <span style={{ flex: 1 }}>{message.text}</span>
      <button
        onClick={onClose}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#fff',
          fontSize: 16,
          cursor: 'pointer',
          opacity: 0.8,
          padding: 0,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

// ── Modal shell ─────────────────────────────────────────────────────

interface ModalShellProps {
  theme: Theme;
  width?: number;
  isMobile?: boolean;
  onClose: () => void;
  children: ReactNode;
}

function ModalShell({ theme, width = 480, isMobile = false, onClose, children }: ModalShellProps): JSX.Element {
  const overlayStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(10,8,5,0.55)',
    backdropFilter: 'blur(6px)',
    zIndex: 60,
    display: 'flex',
    alignItems: isMobile ? 'flex-end' : 'center',
    justifyContent: 'center',
    overflowY: 'auto',
  };

  const sheetStyle: CSSProperties = isMobile
    ? {
        width: '100%',
        maxHeight: '92dvh',
        background: theme.paper,
        borderRadius: '20px 20px 0 0',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.3)',
        padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
        fontFamily: FONT_UI,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      } as CSSProperties
    : {
        width,
        background: theme.paper,
        borderRadius: 18,
        boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
        padding: 28,
        fontFamily: FONT_UI,
      };

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={sheetStyle}>
        {isMobile && (
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: theme.hairlineStrong,
              margin: '0 auto 18px',
            }}
          />
        )}
        {children}
      </div>
    </div>
  );
}

// ── User form modal (create / edit) ────────────────────────────────

interface UserFormModalProps {
  theme: Theme;
  mode: 'create' | 'edit';
  isMobile?: boolean;
  initial?: AdminUser;
  onClose: () => void;
  onSubmit: (req: CreateUserRequest) => void;
}

function UserFormModal({
  theme,
  mode,
  isMobile = false,
  initial,
  onClose,
  onSubmit,
}: UserFormModalProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [initials, setInitials] = useState(initial?.initials ?? '');
  const [role, setRole] = useState<Role>(initial?.role ?? 'employee');
  const [badge, setBadge] = useState(initial?.badge ?? '');

  const canSubmit = name.trim().length > 0;

  /** Derive 1–2 character initials from the first letters of up to two words. */
  const deriveInitials = (n: string): string => {
    const words = n.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length === 1) return (words[0]?.[0] ?? '').slice(0, 2);
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).slice(0, 2);
  };

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    const resolvedInitials = initials.trim() || deriveInitials(name);
    onSubmit({
      name: name.trim(),
      initials: resolvedInitials,
      role,
      badge: badge.trim() === '' ? null : badge.trim(),
    });
  };

  return (
    <ModalShell theme={theme} isMobile={isMobile} onClose={onClose}>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 22,
          color: theme.ink,
          letterSpacing: -0.4,
          marginBottom: 20,
        }}
      >
        {mode === 'create' ? 'เพิ่มพนักงานใหม่' : 'แก้ไขพนักงาน'}
      </div>

      <ModalField theme={theme} label="ชื่อ-นามสกุล" required>
        <ModalInput theme={theme} value={name} onChange={setName} placeholder="นที รัตนพงศ์" />
      </ModalField>

      <ModalField theme={theme} label="อักษรย่อ (ไม่บังคับ — ระบบจะสร้างให้อัตโนมัติ)">
        <ModalInput
          theme={theme}
          value={initials}
          onChange={(v) => setInitials(v.slice(0, 4))}
          placeholder={name.trim() ? deriveInitials(name) : 'นร'}
        />
      </ModalField>

      <ModalField theme={theme} label="บทบาท">
        <div style={{ display: 'flex', gap: 8 }}>
          <RoleToggle
            theme={theme}
            label="พนักงาน"
            active={role === 'employee'}
            onClick={() => setRole('employee')}
          />
          <RoleToggle
            theme={theme}
            label="ผู้อนุมัติ"
            active={role === 'approver'}
            onClick={() => setRole('approver')}
          />
          <RoleToggle
            theme={theme}
            label="แอดมิน"
            active={role === 'admin'}
            onClick={() => setRole('admin')}
          />
        </div>
      </ModalField>

      <ModalField theme={theme} label="รหัสบัตร (badge — ไม่บังคับ, สำหรับแตะบัตรเข้าสู่ระบบ)">
        <ModalInput
          theme={theme}
          value={badge}
          onChange={setBadge}
          placeholder="เช่น 1188 หรือ Q1001"
        />
      </ModalField>

      <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
        <GhostButton theme={theme} onClick={onClose}>
          ยกเลิก
        </GhostButton>
        <div style={{ flex: 1 }}>
          <PrimaryButton theme={theme} disabled={!canSubmit} onClick={handleSubmit}>
            {mode === 'create' ? 'สร้างพนักงาน' : 'บันทึก'}
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}

interface ModalFieldProps {
  theme: Theme;
  label: string;
  required?: boolean;
  children: ReactNode;
}

function ModalField({ theme, label, required, children }: ModalFieldProps): JSX.Element {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 11,
          color: theme.inkSoft,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        {label}
        {required && <span style={{ color: theme.danger, marginLeft: 4 }}>*</span>}
      </div>
      {children}
    </div>
  );
}

interface ModalInputProps {
  theme: Theme;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

function ModalInput({ theme, value, onChange, placeholder, onFocus, onBlur }: ModalInputProps): JSX.Element {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{
        width: '100%',
        padding: '11px 14px',
        borderRadius: 12,
        background: theme.surface,
        border: `0.5px solid ${theme.hairlineStrong}`,
        fontFamily: FONT_UI,
        fontSize: 14,
        color: theme.ink,
        outline: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
}

interface RoleToggleProps {
  theme: Theme;
  label: string;
  active: boolean;
  onClick: () => void;
}

function RoleToggle({ theme, label, active, onClick }: RoleToggleProps): JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 14px',
        borderRadius: 100,
        background: active ? theme.ink : 'transparent',
        color: active ? theme.paper : theme.ink,
        border: `0.5px solid ${active ? theme.ink : theme.hairlineStrong}`,
        fontFamily: FONT_UI,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

// ── Code display modal ─────────────────────────────────────────────

interface CodeDisplayModalProps {
  theme: Theme;
  isMobile?: boolean;
  display: CodeDisplay;
  onClose: () => void;
}

function CodeDisplayModal({ theme, isMobile = false, display, onClose }: CodeDisplayModalProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(display.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const expired = isExpired(display.expiresAt);

  return (
    <ModalShell theme={theme} isMobile={isMobile} onClose={onClose}>
      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 11,
          color: theme.inkSoft,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        รหัสเชื่อมต่อ LINE
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 22,
          color: theme.ink,
          letterSpacing: -0.4,
          marginBottom: 18,
        }}
      >
        {display.userName}
      </div>

      <div
        style={{
          padding: '24px 18px',
          borderRadius: 14,
          background: theme.surface,
          border: `0.5px solid ${theme.hairline}`,
          textAlign: 'center',
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 44,
            fontWeight: 600,
            color: theme.ink,
            letterSpacing: 8,
            lineHeight: 1.1,
          }}
        >
          {display.code}
        </div>
        <div
          style={{
            marginTop: 8,
            fontFamily: FONT_UI,
            fontSize: 12,
            color: expired ? theme.danger : theme.inkSoft,
          }}
        >
          {formatExpiry(display.expiresAt)}
        </div>
      </div>

      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 13,
          color: theme.inkSoft,
          textAlign: 'center',
          marginBottom: 20,
        }}
      >
        คัดลอกและส่งให้พนักงานใช้กับ LINE Login
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <GhostButton theme={theme} onClick={onClose}>
          ปิด
        </GhostButton>
        <div style={{ flex: 1 }}>
          <PrimaryButton theme={theme} onClick={() => void copy()}>
            {copied ? 'คัดลอกแล้ว' : 'คัดลอกรหัส'}
          </PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Confirm modal ──────────────────────────────────────────────────

interface ConfirmModalProps {
  theme: Theme;
  isMobile?: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  confirmTone?: 'warn' | 'danger' | 'default';
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmModal({
  theme,
  isMobile = false,
  title,
  body,
  confirmLabel,
  confirmTone = 'default',
  onCancel,
  onConfirm,
}: ConfirmModalProps): JSX.Element {
  return (
    <ModalShell theme={theme} isMobile={isMobile} width={420} onClose={onCancel}>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 20,
          color: theme.ink,
          letterSpacing: -0.3,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 13,
          color: theme.inkSoft,
          lineHeight: 1.5,
          marginBottom: 22,
        }}
      >
        {body}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <GhostButton theme={theme} onClick={onCancel}>
          ยกเลิก
        </GhostButton>
        <div style={{ flex: 1 }}>
          <ConfirmButton theme={theme} tone={confirmTone} onClick={onConfirm}>
            {confirmLabel}
          </ConfirmButton>
        </div>
      </div>
    </ModalShell>
  );
}

interface ConfirmButtonProps {
  theme: Theme;
  tone: 'warn' | 'danger' | 'default';
  onClick: () => void;
  children: ReactNode;
}

function ConfirmButton({ theme, tone, onClick, children }: ConfirmButtonProps): JSX.Element {
  const background = tone === 'danger' ? theme.danger : tone === 'warn' ? theme.warn : theme.accent;
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: '13px 22px',
        background,
        color: '#fff',
        border: 'none',
        borderRadius: 14,
        fontFamily: FONT_UI,
        fontSize: 15,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function codeExpiry(generatedAt: string): string {
  const t = Date.parse(generatedAt);
  if (Number.isNaN(t)) return generatedAt;
  return new Date(t + LINE_CODE_TTL_MS).toISOString();
}

function isExpired(expiresAt: string): boolean {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return Date.now() > t;
}
