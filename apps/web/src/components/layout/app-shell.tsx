'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Building2,
  ChevronDown,
  FileUp,
  IdCard,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { cn, initials } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { ChangePasswordDialog } from '@/components/auth/change-password-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Permission(s) required to see this entry; null = visible to any session.
   * An array means ANY of the listed permissions unlocks the entry.
   */
  permission: string | readonly string[] | null;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, permission: null },
  { href: '/employees', label: 'Employees', icon: IdCard, permission: PERMISSIONS.employee.view },
  { href: '/items', label: 'Items', icon: Package, permission: PERMISSIONS.item.view },
  {
    href: '/imports',
    label: 'Imports',
    icon: FileUp,
    permission: [PERMISSIONS.employee.import, PERMISSIONS.item.import, PERMISSIONS.lookup.manage],
  },
  { href: '/lookups', label: 'Lookups', icon: SlidersHorizontal, permission: PERMISSIONS.lookup.view },
  { href: '/users', label: 'Users', icon: Users, permission: PERMISSIONS.user.view },
  { href: '/roles', label: 'Roles', icon: ShieldCheck, permission: PERMISSIONS.role.view },
  { href: '/branches', label: 'Branches', icon: Building2, permission: PERMISSIONS.branch.view },
  { href: '/audit-logs', label: 'Audit Log', icon: ScrollText, permission: PERMISSIONS.audit.view },
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can, canAny } = useSession();
  const visibleItems = NAV_ITEMS.filter((item) =>
    item.permission === null
      ? true
      : Array.isArray(item.permission)
        ? canAny(item.permission)
        : can(item.permission as string),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          G
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">GEM ERP</p>
          <p className="text-[11px] text-sidebar-foreground">Asset &amp; Inventory</p>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-3" aria-label="Main navigation">
        {visibleItems.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-sidebar-accent text-white'
                  : 'text-sidebar-foreground hover:bg-white/10 hover:text-white',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 text-[11px] text-sidebar-foreground/70">
        GemCor · Asia/Manila
      </div>
    </div>
  );
}

function UserMenu({ onChangePassword }: { onChangePassword: () => void }) {
  const { user, logout, loggingOut } = useSession();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span
          aria-hidden
          className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
        >
          {initials(user.displayName)}
        </span>
        <span className="hidden max-w-[10rem] truncate font-medium sm:inline">{user.displayName}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-medium text-foreground">{user.displayName}</span>
          <span className="block truncate text-xs font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onChangePassword}>
          <KeyRound aria-hidden /> Change password
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} disabled={loggingOut} destructive>
          <LogOut aria-hidden /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);
  const pathname = usePathname();

  // Close the mobile drawer on navigation.
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-sidebar lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="fixed inset-0 bg-black/50 animate-fade-in"
            aria-hidden="true"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-10 w-64 bg-sidebar shadow-xl">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-4 rounded-md p-1 text-sidebar-foreground hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            <SidebarContent onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="lg:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b bg-background px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
            >
              <Menu aria-hidden />
            </Button>
            <span className="text-sm font-semibold lg:hidden">GEM ERP</span>
          </div>
          <UserMenu onChangePassword={() => setChangePasswordOpen(true)} />
        </header>

        {/* Forced password-change banner */}
        {user.mustChangePassword ? (
          <div
            role="alert"
            className="flex flex-col gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            <p className="flex items-center gap-2 text-sm text-warning">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              Your password was reset by an administrator. You must change it before continuing.
            </p>
            <Button size="sm" variant="outline" onClick={() => setChangePasswordOpen(true)}>
              Change password now
            </Button>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>

      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
    </div>
  );
}
