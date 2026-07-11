"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { apiFetch } from "@/utils/api";

interface Deployment {
  id: string;
  commit_message: string | null;
  commit_author: string | null;
  commit_sha: string | null;
  status: string;
  url: string | null;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  slug: string;
  github_repo_url: string;
  branch: string;
  install_command: string | null;
  build_command: string | null;
  output_dir: string | null;
  created_at: string;
}

export default function ProjectDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchProjectData = (showLoading = false) => {
    if (showLoading) setLoading(true);
    
    apiFetch(`/projects/${projectId}`)
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("Failed to load project details.");
      })
      .then((data) => {
        setProject(data.project);
        setDeployments(data.deployments || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchProjectData(true);
  }, [projectId]);

  // Set up polling interval if any deployment is building or queued
  useEffect(() => {
    const hasActiveBuild = deployments.some(
      (d) => d.status === "building" || d.status === "queued"
    );

    if (hasActiveBuild) {
      const interval = setInterval(() => {
        fetchProjectData(false);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [deployments]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent"></div>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
        <Navbar />
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-10">
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-center">
            <p className="text-sm font-medium text-red-400">{error || "Project not found."}</p>
            <Link href="/projects" className="mt-4 inline-block text-xs font-bold text-indigo-400 hover:underline">
              &larr; Back to projects
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10 relative">
        <div className="absolute top-10 left-10 h-80 w-80 rounded-full bg-indigo-500/5 blur-[110px]"></div>

        {/* Back Link */}
        <Link
          href="/projects"
          className="text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center space-x-1"
        >
          <span>&larr;</span> <span>Back to projects</span>
        </Link>

        {/* Project Header */}
        <div className="mt-6 flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0 border-b border-zinc-800/80 pb-6 relative z-10">
          <div>
            <h1 className="text-3xl font-black text-zinc-100 tracking-tight">{project.name}</h1>
            <p className="text-xs text-zinc-400 mt-2 font-mono flex items-center space-x-2">
              <span>GitHub:</span>
              <a
                href={project.github_repo_url}
                target="_blank"
                rel="noreferrer"
                className="text-indigo-400 hover:underline hover:text-indigo-300 transition-colors"
              >
                {project.github_repo_url.replace("https://github.com/", "")}
              </a>
            </p>
          </div>

          <div className="flex items-center space-x-2 text-sm text-zinc-300 bg-zinc-900/50 border border-zinc-800/80 rounded-lg px-4 py-2">
            <span className="h-2 w-2 rounded-full bg-indigo-400"></span>
            <span className="font-semibold font-mono">Branch: {project.branch}</span>
          </div>
        </div>

        {/* Details & Deployments Section */}
        <div className="mt-8 grid gap-8 md:grid-cols-3 relative z-10">
          {/* Build Configuration Box (Left column on large screen) */}
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/10 p-6 h-fit">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-4 border-b border-zinc-800/80 pb-2">
              Build Settings
            </h3>
            
            <div className="space-y-4 text-xs">
              <div>
                <span className="block text-zinc-500 font-semibold mb-1">Install Command</span>
                <code className="block bg-zinc-950 p-2.5 rounded border border-zinc-850 font-mono text-zinc-300 overflow-x-auto">
                  {project.install_command || "None"}
                </code>
              </div>

              <div>
                <span className="block text-zinc-500 font-semibold mb-1">Build Command</span>
                <code className="block bg-zinc-950 p-2.5 rounded border border-zinc-850 font-mono text-zinc-300 overflow-x-auto">
                  {project.build_command || "None"}
                </code>
              </div>

              <div>
                <span className="block text-zinc-500 font-semibold mb-1">Output Directory</span>
                <code className="block bg-zinc-950 p-2.5 rounded border border-zinc-850 font-mono text-zinc-300 overflow-x-auto">
                  {project.output_dir || "None"}
                </code>
              </div>
            </div>
          </div>

          {/* Deployments History List (Right columns) */}
          <div className="md:col-span-2 space-y-6">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
              <h2 className="text-lg font-bold text-zinc-200">Deployments</h2>
              <button
                onClick={() => fetchProjectData(false)}
                className="text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-all cursor-pointer"
              >
                Refresh
              </button>
            </div>

            {deployments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/10 p-8 text-center">
                <p className="text-sm text-zinc-500">No deployments recorded yet.</p>
                <p className="text-xs text-zinc-600 mt-1">
                  Commit and push to your GitHub branch to trigger your first deploy!
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {deployments.map((deployment) => (
                  <div
                    key={deployment.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-5 rounded-xl border border-zinc-800/80 bg-zinc-900/20 backdrop-blur-sm hover:border-zinc-700/80 transition-all gap-4"
                  >
                    <div className="space-y-1.5 max-w-md">
                      <div className="flex items-center space-x-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                            deployment.status === "ready"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : deployment.status === "error"
                              ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                              : deployment.status === "building"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                              : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                          }`}
                        >
                          {deployment.status}
                        </span>
                        
                        {deployment.commit_sha && (
                          <span className="font-mono text-xs text-zinc-500 font-medium">
                            {deployment.commit_sha.slice(0, 7)}
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-semibold text-zinc-200 line-clamp-1">
                        {deployment.commit_message || "Manual Trigger / Code Push"}
                      </h4>

                      <p className="text-[10px] text-zinc-500 font-medium">
                        By {deployment.commit_author || "Unknown"} &bull;{" "}
                        {new Date(deployment.created_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex items-center space-x-3 sm:self-center">
                      <Link
                        href={`/deployments/${deployment.id}`}
                        className="rounded-lg border border-zinc-850 px-3 py-1.5 text-xs font-bold text-zinc-300 bg-zinc-900/30 hover:bg-zinc-850 transition-colors"
                      >
                        Logs
                      </Link>

                      {deployment.status === "ready" && deployment.url && (
                        <a
                          href={deployment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg bg-indigo-600/90 hover:bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white shadow transition-colors"
                        >
                          Visit Site &rarr;
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
