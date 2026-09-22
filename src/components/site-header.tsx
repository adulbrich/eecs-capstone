import { Link } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { brand } from "#/lib/brand";
import { useSignOut } from "#/lib/sign-out";
import { getPublicUrl } from "#/lib/storage";
import { isStaff, type Viewer } from "#/lib/viewer";
import { GithubIcon } from "./github-icon";
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
  const viewerIsStaff = isStaff(session?.user as Viewer);

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
          {viewerIsStaff && (
            <Link className="nav-link" to="/admin">
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          {/* Ahead of both session branches: public, signed in or not. */}
          <SourceLink />
          {(() => {
            if (isPending) {
              return (
                <div className="h-8 w-24 animate-pulse rounded-md bg-[var(--surface-sunken)]" />
              );
            }
            if (signedIn) {
              return (
                <SignedIn
                  email={session.user.email}
                  image={session.user.image}
                  name={session.user.name}
                />
              );
            }
            return <SignedOut />;
          })()}
        </div>
      </div>

      {/* Mobile nav */}
      <div className="flex h-14 items-center justify-between px-4 md:hidden">
        <Link to="/">
          <InstitutionLogo />
        </Link>
        <div className="flex items-center gap-2">
          {signedIn && <NotificationBell />}
          <MobileMenu
            isPending={isPending}
            isStaff={viewerIsStaff}
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
  isStaff: viewerIsStaff,
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
        <Button
          aria-label="Open navigation"
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <Menu />
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
            <Button
              aria-label="Close navigation"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </SheetClose>
        </SheetHeader>

        <nav className="flex flex-col gap-0 py-2">
          <NavItem onClick={close} to="/projects">
            Projects
          </NavItem>
          <NavItem onClick={close} to="/inventory">
            Inventory
          </NavItem>
          {viewerIsStaff && (
            <NavItem onClick={close} to="/admin">
              Admin
            </NavItem>
          )}
          {/* Placement and naming: docs/UI-CONVENTIONS.md, Mobile navigation. */}
          <NavItem aria-label={SOURCE_LINK_LABEL} href={brand.repositoryUrl}>
            Source code
          </NavItem>
        </nav>

        <div className="border-border border-t px-4 py-4">
          {(() => {
            if (isPending) {
              return (
                <div className="h-8 w-32 animate-pulse rounded-md bg-[var(--surface-sunken)]" />
              );
            }
            if (signedIn && user) {
              return <SignedInMobile onClose={close} user={user} />;
            }
            return <SignedOutMobile onClose={close} />;
          })()}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const NAV_ITEM_CLASS =
  "px-4 py-3 font-medium text-[var(--text-secondary)] text-sm transition-colors hover:bg-secondary hover:text-[var(--text-primary)] active:bg-secondary";

/**
 * A row in the mobile Sheet. `to` is a router link and closes the Sheet;
 * `href` is an external URL in a new tab, which leaves the Sheet as it was.
 * One component with two shapes rather than a copied class string, because
 * the styling is the point and a copy is what drifts.
 */
function NavItem(
  props: { children: React.ReactNode } & (
    | { to: string; onClick: () => void; href?: never }
    | { href: string; "aria-label"?: string; to?: never }
  )
) {
  if (props.href !== undefined) {
    return (
      <a
        aria-label={props["aria-label"]}
        className={NAV_ITEM_CLASS}
        href={props.href}
        rel="noopener noreferrer"
        target="_blank"
      >
        {props.children}
      </a>
    );
  }
  return (
    <Link className={NAV_ITEM_CLASS} onClick={props.onClick} to={props.to}>
      {props.children}
    </Link>
  );
}

// Not "GitHub", which /sign-in's "Continue with GitHub" button already means.
const SOURCE_LINK_LABEL = "Source code on GitHub";

function SourceLink() {
  return (
    <Button
      aria-label={SOURCE_LINK_LABEL}
      asChild
      size="icon-sm"
      variant="ghost"
    >
      <a href={brand.repositoryUrl} rel="noopener noreferrer" target="_blank">
        <GithubIcon aria-hidden="true" />
      </a>
    </Button>
  );
}

/**
 * One control, not a sign-in and a sign-up: `/sign-in` creates accounts too
 * (#586). Default size for the reason `SignedInMobile`'s Sign out gives, a
 * full-width action at the foot of the column.
 */
function SignedOutMobile({ onClose }: { onClose: () => void }) {
  return (
    <Button asChild className="w-full">
      <Link onClick={onClose} to="/sign-in">
        Sign in
      </Link>
    </Button>
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
  const { busy, signOut } = useSignOut();
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
      {/*
        Default size, not sm: this is a full-width action at the foot of a
        column, the same shape as the Sign out on /profile, and the two are
        one control in two places. The sm rule is for a button sharing a row
        with other content (UI-CONVENTIONS, "Size follows the row").
      */}
      <Button
        className="w-full"
        disabled={busy}
        onClick={signOut}
        type="button"
        variant="outline"
      >
        {busy ? "Signing out..." : "Sign out"}
      </Button>
    </div>
  );
}

/** A button rather than a nav link, since it is now the only way in. */
function SignedOut() {
  return (
    <Button asChild size="sm">
      <Link to="/sign-in">Sign in</Link>
    </Button>
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
      <UserMenu user={{ name, email, image }} />
    </>
  );
}
