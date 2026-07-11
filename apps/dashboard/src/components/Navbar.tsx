"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, clearAuthToken } from "@/utils/api";

interface User {
  id: string;
  email: string | null;
  name: string;
  avatarUrl?: string;
}

export default function Navbar() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    apiFetch("/auth/me")
      .then((res) => {
        if (res.ok) {
          return res.json();
        }
        throw new Error("Not authenticated");
      })
      .then((data) => {
        // Support both wrapped or direct structures
        setUser(data.user || data);
      })
      .catch(() => {
        router.push("/");
      });
  }, [router]);

  const handleLogout = () => {
    clearAuthToken();
    router.push("/");
  };

  return (
    <nav className="border-b border-zinc-800/80 bg-zinc-950/60 backdrop-blur-md sticky top-0 z-50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link href="/projects" className="flex items-center space-x-2 group">
              <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-xl font-black tracking-tight text-transparent transition-all group-hover:opacity-85">
                PORTWAY
              </span>
              <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400 border border-indigo-500/20">
                v1
              </span>
            </Link>
            <div className="flex space-x-4">
              <Link href="/projects" className="text-sm font-medium text-zinc-300 hover:text-white transition-colors">
                Projects
              </Link>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {user && (
              <div className="flex items-center space-x-3 border-r border-zinc-800/80 pr-4">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.name} className="h-7 w-7 rounded-full border border-zinc-700" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-xs font-semibold text-indigo-400">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-medium text-zinc-300 hidden sm:inline">{user.name}</span>
              </div>
            )}
            <button
              onClick={handleLogout}
              className="text-xs font-semibold text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
