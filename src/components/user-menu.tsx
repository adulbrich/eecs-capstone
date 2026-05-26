import { Link } from "@tanstack/react-router";
import { authClient } from "#/lib/auth-client";
import { getPublicUrl } from "#/lib/storage";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type Props = {
  user: { name: string | null; email: string; image?: string | null };
};

export function UserMenu({ user }: Props) {
  const img = getPublicUrl(user.image);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded hover:opacity-80">
        {img ? (
          <img
            src={img}
            alt=""
            className="h-7 w-7 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-(--surface-sunken) text-xs font-medium">
            {(user.name ?? user.email).charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm">{user.name ?? user.email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          {user.name && <p className="font-medium">{user.name}</p>}
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/my/projects">My projects</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/my/bookmarks">My bookmarks</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/my/items" search={{ tab: "active" }}>
            My items
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={async () => {
            await authClient.signOut();
            window.location.href = "/sign-in";
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
