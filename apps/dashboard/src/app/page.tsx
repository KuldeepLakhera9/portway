"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getAuthToken, API_BASE } from "@/utils/api";

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAuthToken();
    if (token) {
      apiFetch("/auth/me")
        .then((res) => {
          if (res.ok) {
            router.push("/projects");
          } else {
            setLoading(false);
          }
        })
        .catch(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, [router]);

  const handleGitHubLogin = () => {
    window.location.href = `${API_BASE}/auth/github`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-zinc-950 overflow-hidden px-4">
      {/* Decorative background blurs */}
      <div className="absolute top-1/4 left-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/10 blur-[120px]"></div>
      <div className="absolute bottom-1/4 left-1/3 h-72 w-72 rounded-full bg-purple-500/10 blur-[100px]"></div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="flex items-center space-x-2 mb-3">
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-3xl font-black tracking-tight text-transparent">
              PORTWAY
            </span>
            <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-xs font-semibold text-indigo-400 border border-indigo-500/20">
              v1
            </span>
          </div>
          <h2 className="text-xl font-semibold text-zinc-100">Developer Control Plane</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Deploy your static applications to an isolated, fast cloud infrastructure.
          </p>
        </div>

        <div className="mt-8 space-y-4">
          <button
            onClick={handleGitHubLogin}
            className="flex w-full items-center justify-center space-x-3 rounded-lg bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900 transition-all hover:bg-zinc-200 active:scale-[0.98] cursor-pointer"
          >
            {/* GitHub SVG Icon */}
            <svg className="h-5 w-5 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.167 6.839 9.49.5.092.682-.217.682-.48 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.577.688.479C19.138 20.164 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
            <span>Continue with GitHub</span>
          </button>
        </div>

        <div className="mt-8 border-t border-zinc-800/80 pt-6 text-center">
          <p className="text-xs text-zinc-500">
            Secure, encrypted OAuth tokens. Portway does not store your password.
          </p>
        </div>
      </div>
    </div>
  );
}
