import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { getPublicUrl } from "#/lib/storage";
import { CartButton } from "./cart-button";
import { InstitutionLogo } from "./institution-logo";
import { NotificationBell } from "./notification-bell";
import { Button } from "./ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import { UserMenu } from "./user-menu";

export function SiteHeader() {
  const { data: session, isPending } = authClient.useSession();
  const signedIn = !!session?.user;
  const role =
    (session?.user as { role?: string | null } | undefined)?.role ?? null;
  const isStaff = role === "admin" || role === "instructor";

  return (
    <header
      className="border-b border-[var(--line)]"
      style={{ background: "var(--header-bg)", backdropFilter: "blur(8px)" }}
    >
      {/* Desktop nav */}
      <div className="mx-auto hidden h-14 max-w-5xl items-center gap-6 px-4 md:flex">
        <Link to="/">
          <InstitutionLogo />
        </Link>

        <nav className="flex flex-1 items-center gap-4 text-sm">
          <Link to="/projects" className="nav-link">
            Projects
          </Link>
          <Link to="/inventory" className="nav-link">
            Inventory
          </Link>
          {isStaff && (
            <Link to="/admin" className="nav-link">
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          {isPending ? (
            <div className="h-8 w-24 animate-pulse rounded-md bg-[var(--surface-sunken)]" />
          ) : signedIn ? (
            <SignedIn
              name={session.user.name}
              email={session.user.email}
              image={session.user.image}
            />
          ) : (
            <SignedOut />
          )}
        </div>
      </div>

      {/* Mobile nav */}
      <div className="flex h-14 items-center justify-between px-4 md:hidden">
        <Link to="/">
          <InstitutionLogo />
        </Link>
        <div className="flex items-center gap-2">
          {signedIn && (
            <>
              <NotificationBell />
              <CartButton />
            </>
          )}
          <MobileMenu
            signedIn={signedIn}
            isPending={isPending}
            isStaff={isStaff}
            user={
              signedIn
                ? {
                    name: session.user.name,
                    email: session.user.email,
                    image: session.user.image,
                  }
                : null
            }
          />
        </div>
      </div>
    </header>
  );
}

function MobileMenu({
  signedIn,
  isPending,
  isStaff,
  user,
}: {
  signedIn: boolean;
  isPending: boolean;
  isStaff: boolean;
  user: { name: string | null; email: string; image?: string | null } | null;
}) {
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-72 p-0"
        aria-describedby={undefined}
      >
        <SheetHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3">
          <SheetTitle className="text-base font-semibold">
            Navigation
          </SheetTitle>
          <SheetClose asChild>
            <Button variant="ghost" size="sm" aria-label="Close navigation">
              <X className="h-4 w-4" />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="flex flex-col gap-0 py-2">
          <NavItem to="/projects" onClick={close}>
            Projects
          </NavItem>
          <NavItem to="/inventory" onClick={close}>
            Inventory
          </NavItem>
          {isStaff && (
            <NavItem to="/admin" onClick={close}>
              Admin
            </NavItem>
          )}
        </div>

        <div className="border-t border-border px-4 py-4">
          {isPending ? (
            <div className="h-8 w-32 animate-pulse rounded-md bg-[var(--surface-sunken)]" />
          ) : signedIn && user ? (
            <SignedInMobile user={user} onClose={close} />
          ) : (
            <SignedOutMobile onClose={close} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NavItem({
  to,
  children,
  onClick,
}: {
  to: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="px-4 py-3 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-secondary hover:text-[var(--text-primary)] active:bg-secondary"
    >
      {children}
    </Link>
  );
}

function SignedOutMobile({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to="/sign-in" onClick={onClose}>
          Sign in
        </Link>
      </Button>
      <Button asChild size="sm" className="w-full">
        <Link to="/sign-up" onClick={onClose}>
          Sign up
        </Link>
      </Button>
    </div>
  );
}

function SignedInMobile({
  user,
  onClose,
}: {
  user: { name: string | null; email: string; image?: string | null };
  onClose: () => void;
}) {
  const resolvedImage = getPublicUrl(user.image);
  return (
    <div className="space-y-3">
      <Link
        to="/profile"
        onClick={onClose}
        className="flex items-center gap-3 hover:opacity-80"
      >
        {resolvedImage ? (
          <img
            src={resolvedImage}
            alt=""
            className="h-9 w-9 flex-shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-(--surface-sunken) text-sm font-medium">
            {(user.name ?? user.email).charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          {user.name && (
            <p className="truncate text-sm font-medium">{user.name}</p>
          )}
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </Link>
      <div className="-mx-4 flex flex-col gap-0 border-t border-border py-2">
        <NavItem to="/my/projects" onClick={onClose}>
          My Projects
        </NavItem>
        <NavItem to="/my/bookmarks" onClick={onClose}>
          My Bookmarks
        </NavItem>
        <NavItem to="/my/items" onClick={onClose}>
          My Items
        </NavItem>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={async () => {
          await authClient.signOut();
          window.location.href = "/sign-in";
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

function SignedOut() {
  return (
    <>
      <Link to="/sign-in" className="nav-link text-sm">
        Sign in
      </Link>
      <Button asChild size="sm">
        <Link to="/sign-up">Sign up</Link>
      </Button>
    </>
  );
}

function SignedIn({
  name,
  email,
  image,
}: {
  name: string | null;
  email: string;
  image: string | null | undefined;
}) {
  return (
    <>
      <NotificationBell />
      <CartButton />
      <UserMenu user={{ name, email, image }} />
    </>
  );
}
