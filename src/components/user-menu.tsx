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

interface Props {
  user: { name: string | null; email: string; image?: string | null };
}

export function UserMenu({ user }: Props) {
  const img = getPublicUrl(user.image);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded hover:opacity-80">
        {img ? (
          <img
            alt=""
            className="h-7 w-7 rounded-full object-cover"
            referrerPolicy="no-referrer"
            src={img}
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-(--surface-sunken) font-medium text-xs">
            {(user.name ?? user.email).charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm">{user.name ?? user.email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          {user.name && <p className="font-medium">{user.name}</p>}
          <p className="text-muted-foreground text-xs">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/my/projects">My Projects</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/my/bookmarks">My Bookmarks</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link search={{ tab: "active" }} to="/my/items">
            My Items
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
