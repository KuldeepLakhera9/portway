"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { apiFetch } from "@/utils/api";

interface Project {
  id: string;
  name: string;
  slug: string;
  github_repo_url: string;
  branch: string;
  created_at: string;
  latest_deployment_status?: string | null;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/projects")
      .then((res) => {
        if (res.ok) {
          return res.json();
        }
        throw new Error("Failed to load projects.");
      })
      .then((data) => {
        setProjects(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 relative">
        {/* Background glow decoration */}
        <div className="absolute top-10 left-10 h-72 w-72 rounded-full bg-indigo-500/5 blur-[100px]"></div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0 border-b border-zinc-800/80 pb-6 relative z-10">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-100">Projects</h1>
            <p className="text-zinc-400 mt-1.5 text-sm">
              Manage your connected applications and deployments.
            </p>
          </div>
          <Link
            href="/projects/new"
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-indigo-500 active:scale-[0.98] transition-all cursor-pointer"
          >
            + New Project
          </Link>
        </div>

        <div className="mt-8 relative z-10">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-center">
              <p className="text-sm font-medium text-red-400">{error}</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/10 p-12 text-center">
              <h3 className="text-lg font-semibold text-zinc-300">No projects yet</h3>
              <p className="mt-2 text-sm text-zinc-500 max-w-sm mx-auto">
                Connect a GitHub repository to get started with your first static application deployment.
              </p>
              <div className="mt-6">
                <Link
                  href="/projects/new"
                  className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/80 transition-colors"
                >
                  Create your first project
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="group rounded-xl border border-zinc-800/80 bg-zinc-900/20 p-6 backdrop-blur-sm shadow-md hover:border-zinc-700/80 hover:bg-zinc-900/40 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <h3 className="text-lg font-bold text-zinc-100 group-hover:text-indigo-400 transition-colors truncate max-w-[180px]">
                        {project.name}
                      </h3>
                      {project.latest_deployment_status && (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            project.latest_deployment_status === "ready"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : project.latest_deployment_status === "error"
                              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              : project.latest_deployment_status === "building"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                              : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                          }`}
                        >
                          {project.latest_deployment_status}
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-xs font-medium text-zinc-500 font-mono truncate">
                      {project.github_repo_url.replace("https://github.com/", "")}
                    </p>
                    <div className="mt-4 flex items-center space-x-2 text-zinc-400">
                      <svg className="h-4 w-4 fill-current opacity-70" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M19 13H5v-2h14v2z" />
                      </svg>
                      <span className="text-xs font-semibold font-mono">{project.branch}</span>
                    </div>
                  </div>

                  <div className="mt-6 border-t border-zinc-800/60 pt-4 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 font-medium">
                      Linked {new Date(project.created_at).toLocaleDateString()}
                    </span>
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      View project &rarr;
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
