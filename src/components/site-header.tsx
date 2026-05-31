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
      className="border-[var(--line)] border-b"
      style={{ background: "var(--header-bg)", backdropFilter: "blur(8px)" }}
    >
      {/* Desktop nav */}
      <div className="mx-auto hidden h-14 max-w-5xl items-center gap-6 px-4 md:flex">
        <Link to="/">
          <InstitutionLogo />
        </Link>

        <nav className="flex flex-1 items-center gap-4 text-sm">
          <Link className="nav-link" to="/projects">
            Projects
          </Link>
          <Link className="nav-link" to="/inventory">
            Inventory
          </Link>
          {isStaff && (
            <Link className="nav-link" to="/admin">
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          {isPending ? (
            <div className="h-8 w-24 animate-pulse rounded-md bg-[var(--surface-sunken)]" />
          ) : signedIn ? (
            <SignedIn
              email={session.user.email}
              image={session.user.image}
              name={session.user.name}
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
            isPending={isPending}
            isStaff={isStaff}
            signedIn={signedIn}
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
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <Button aria-label="Open navigation" size="sm" variant="ghost">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        aria-describedby={undefined}
        className="w-72 p-0"
        side="left"
      >
        <SheetHeader className="flex flex-row items-center justify-between border-border border-b px-4 py-3">
          <SheetTitle className="font-semibold text-base">
            Navigation
          </SheetTitle>
          <SheetClose asChild>
            <Button aria-label="Close navigation" size="sm" variant="ghost">
              <X className="h-4 w-4" />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="flex flex-col gap-0 py-2">
          <NavItem onClick={close} to="/projects">
            Projects
          </NavItem>
          <NavItem onClick={close} to="/inventory">
            Inventory
          </NavItem>
          {isStaff && (
            <NavItem onClick={close} to="/admin">
              Admin
            </NavItem>
          )}
        </div>

        <div className="border-border border-t px-4 py-4">
          {isPending ? (
            <div className="h-8 w-32 animate-pulse rounded-md bg-[var(--surface-sunken)]" />
          ) : signedIn && user ? (
            <SignedInMobile onClose={close} user={user} />
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
      className="px-4 py-3 font-medium text-[var(--text-secondary)] text-sm transition-colors hover:bg-secondary hover:text-[var(--text-primary)] active:bg-secondary"
      onClick={onClick}
      to={to}
    >
      {children}
    </Link>
  );
}

function SignedOutMobile({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Button asChild className="w-full" size="sm" variant="outline">
        <Link onClick={onClose} to="/sign-in">
          Sign in
        </Link>
      </Button>
      <Button asChild className="w-full" size="sm">
        <Link onClick={onClose} to="/sign-up">
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
        className="flex items-center gap-3 hover:opacity-80"
        onClick={onClose}
        to="/profile"
      >
        {resolvedImage ? (
          <img
            alt=""
            className="h-9 w-9 flex-shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
            src={resolvedImage}
          />
        ) : (
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-(--surface-sunken) font-medium text-sm">
            {(user.name ?? user.email).charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          {user.name && (
            <p className="truncate font-medium text-sm">{user.name}</p>
          )}
          <p className="truncate text-muted-foreground text-xs">{user.email}</p>
        </div>
      </Link>
      <div className="-mx-4 flex flex-col gap-0 border-border border-t py-2">
        <NavItem onClick={onClose} to="/my/projects">
          My Projects
        </NavItem>
        <NavItem onClick={onClose} to="/my/bookmarks">
          My Bookmarks
        </NavItem>
        <NavItem onClick={onClose} to="/my/items">
          My Items
        </NavItem>
      </div>
      <Button
        className="w-full"
        onClick={async () => {
          await authClient.signOut();
          window.location.href = "/sign-in";
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        Sign out
      </Button>
    </div>
  );
}

function SignedOut() {
  return (
    <>
      <Link className="nav-link text-sm" to="/sign-in">
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
